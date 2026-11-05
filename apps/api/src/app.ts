import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  DAILY_GAMES,
  DATASET_VERSION,
  dailyDate,
  dailySeed,
  dailySettings,
  dailyVariant,
  getGame,
  normalizeSettings,
  randomSeed,
  replayGame,
  variantKey,
  type AllowanceDto,
  type ApiErrorCode,
  type ApiErrorResponse,
  type FinishSessionResponse,
  type GameSettings,
  type LeaderboardEntryDto,
  type LeaderboardResponse,
  type MeResponse,
  type StartDailyResponse,
  type StartSessionResponse,
} from '@geogames/games';

/** Runs a database function by name; the only way this API touches the database. */
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface AppOptions {
  rpc: Rpc;
  /** The player id a bearer token belongs to, or null if it isn't valid. */
  verifyToken(token: string): Promise<string | null>;
  freePlaysPerDay: number;
  /** Keeps coming days' seeds unguessable. */
  dailySecret: string;
  /** Origins allowed to call the API. Requests carry a token rather than cookies, so "*" is safe. */
  allowedOrigins: readonly string[] | '*';
}

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MOVES = 10_000;
const MAX_MOVE_LENGTH = 64;
const MAX_NAME_LENGTH = 24;
const LEADERBOARD_MAX = 100;

const newPlayerName = () => `Explorer ${Math.floor(1000 + Math.random() * 9000)}`;

function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

type StoredAllowance = Omit<AllowanceDto, 'resetsAt'>;
const allowanceDto = (a: StoredAllowance): AllowanceDto => ({ ...a, resetsAt: nextUtcMidnight() });

type Env = { Variables: { player: string } };

export function createApp({ rpc, verifyToken, freePlaysPerDay, dailySecret, allowedOrigins }: AppOptions) {
  const app = new Hono<Env>().basePath('/api');

  const fail = (c: Context, status: 400 | 401 | 402 | 404 | 409 | 422 | 500, error: ApiErrorCode, extra: Partial<ApiErrorResponse> = {}) =>
    c.json<ApiErrorResponse>({ error, ...extra }, status);

  const bearer = (c: Context) => c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];

  app.use(
    '*',
    cors({
      origin: allowedOrigins === '*' ? '*' : [...allowedOrigins],
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86_400,
    }),
  );
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 400, 'bad-request') }));

  app.onError((err, c) => {
    console.error(err);
    return fail(c, 500, 'internal');
  });
  app.notFound((c) => fail(c, 404, 'not-found'));

  const signedIn = async (c: Context<Env>, next: () => Promise<void>) => {
    const token = bearer(c);
    const player = token ? await verifyToken(token) : null;
    if (!player) return fail(c, 401, 'unauthorized');
    c.set('player', player);
    return next();
  };

  const body = async (c: Context) => {
    try {
      const value: unknown = await c.req.json();
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  app.get('/health', async (c) => {
    await rpc('ping', {});
    return c.json({ ok: true, datasetVersion: DATASET_VERSION });
  });

  app.get('/me', signedIn, async (c) => {
    const player = c.get('player');
    const me = (await rpc('get_me', { p_player: player, p_default_name: newPlayerName(), p_free_limit: freePlaysPerDay })) as {
      name: string;
      allowance: StoredAllowance;
      bests: MeResponse['bests'];
    };
    return c.json<MeResponse>({ player: { id: player, name: me.name }, allowance: allowanceDto(me.allowance), bests: me.bests });
  });

  app.patch('/me', signedIn, async (c) => {
    const input = await body(c);
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    if (!name) return fail(c, 400, 'bad-request');
    await rpc('rename_player', { p_player: c.get('player'), p_name: name });
    return c.json({ name });
  });

  app.post('/sessions', signedIn, async (c) => {
    const input = await body(c);
    const game = typeof input?.gameId === 'string' ? getGame(input.gameId) : undefined;
    if (!game || game.status !== 'live') return fail(c, 400, 'bad-request');
    if (input!.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const settings = normalizeSettings((input!.settings ?? {}) as Partial<GameSettings>, game);
    const seed = randomSeed();
    const started = (await rpc('start_session', {
      p_player: c.get('player'),
      p_default_name: newPlayerName(),
      p_game_id: game.id,
      p_variant: variantKey(settings, game),
      p_settings: settings,
      p_seed: seed,
      p_dataset_version: DATASET_VERSION,
      p_free_limit: freePlaysPerDay,
    })) as { ok: boolean; sessionId?: string; allowance: StoredAllowance };
    if (!started.ok) return fail(c, 402, 'out-of-plays', { allowance: allowanceDto(started.allowance) });
    return c.json<StartSessionResponse>({ sessionId: started.sessionId!, seed, allowance: allowanceDto(started.allowance) }, 201);
  });

  app.post('/daily/:gameId/start', signedIn, async (c) => {
    const gameId = c.req.param('gameId') ?? '';
    const game = DAILY_GAMES.includes(gameId) ? getGame(gameId) : undefined;
    if (!game) return fail(c, 404, 'not-found');
    const input = await body(c);
    if (input?.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const date = dailyDate();
    const session = (await rpc('start_daily_session', {
      p_player: c.get('player'),
      p_default_name: newPlayerName(),
      p_game_id: game.id,
      p_variant: dailyVariant(date),
      p_settings: dailySettings(game),
      p_seed: await dailySeed(game.id, date, dailySecret),
      p_dataset_version: DATASET_VERSION,
    })) as { sessionId: string; seed: number; status: 'playing' | 'finished'; score: number | null };
    return c.json<StartDailyResponse>({
      date,
      sessionId: session.sessionId,
      seed: Number(session.seed),
      finishedScore: session.status === 'finished' ? session.score : null,
    });
  });

  app.post('/sessions/:id/finish', signedIn, async (c) => {
    const sessionId = c.req.param('id') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return fail(c, 404, 'not-found');
    const player = c.get('player');
    const input = await body(c);
    const moves = input?.moves;
    if (
      !Array.isArray(moves) ||
      moves.length > MAX_MOVES ||
      !moves.every((m): m is string => typeof m === 'string' && m.length <= MAX_MOVE_LENGTH)
    ) {
      return fail(c, 400, 'bad-request');
    }
    const session = (await rpc('get_session', { p_session: sessionId, p_player: player })) as {
      gameId: string;
      settings: GameSettings;
      seed: number;
      datasetVersion: string;
      status: 'playing' | 'finished';
      score: number | null;
    } | null;
    if (!session) return fail(c, 404, 'not-found');
    const finish = async (score: number) =>
      (await rpc('finish_session', { p_session: sessionId, p_player: player, p_moves: moves, p_score: score })) as FinishSessionResponse;
    // Already finished: answer as before, without replaying the new moves.
    if (session.status === 'finished') return c.json<FinishSessionResponse>(await finish(session.score!));
    // Data deployed since this game started can't replay it.
    if (session.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const game = getGame(session.gameId);
    if (!game) return fail(c, 404, 'not-found');
    const { score, finished } = await replayGame(game, session.settings, Number(session.seed), moves);
    if (!finished) return fail(c, 422, 'unfinished-game');
    return c.json<FinishSessionResponse>(await finish(score));
  });

  app.get('/leaderboards/:gameId/:variant', async (c) => {
    const { gameId, variant } = c.req.param();
    const limit = Math.min(LEADERBOARD_MAX, Math.max(1, Number(c.req.query('limit')) || 20));
    let entries: unknown;
    if (c.req.query('scope') === 'personal') {
      const token = bearer(c);
      const player = token ? await verifyToken(token) : null;
      if (!player) return fail(c, 401, 'unauthorized');
      entries = await rpc('leaderboard_personal', { p_player: player, p_game_id: gameId, p_variant: variant, p_limit: limit });
    } else {
      entries = await rpc('leaderboard_global', { p_game_id: gameId, p_variant: variant, p_limit: limit });
    }
    return c.json<LeaderboardResponse>({ entries: entries as LeaderboardEntryDto[] });
  });

  return app;
}
