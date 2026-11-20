import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  DAILY_GAMES,
  DATASET_VERSION,
  DUEL_OPEN_DAYS,
  DUEL_PLAY_HOURS,
  DUEL_VARIANT,
  canDuel,
  dailyDate,
  dailySeed,
  dailySettings,
  dailyVariant,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  getGame,
  normalizeSettings,
  randomSeed,
  replayGame,
  replayRun,
  variantKey,
  type ApiErrorCode,
  type AcceptDuelResponse,
  type ApiErrorResponse,
  type CreateAccountResponse,
  type CreateDuelResponse,
  type DuelDto,
  type DuelListResponse,
  type DeleteAccountResponse,
  type FinishSessionResponse,
  type GameSettings,
  type LeaderboardEntryDto,
  type LeaderboardResponse,
  type MeResponse,
  type MergeResponse,
  type StartDailyResponse,
  type StartSessionResponse,
} from '@geogames/games';
import { isOffensiveName } from './names.ts';

/** Runs a database function by name; the only way this API touches the database. */
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** Who a verified token belongs to. `anonymous` comes from the token, never from the request body. */
export interface Caller {
  id: string;
  anonymous: boolean;
}

/** How fast one player may go. Generous for people, a wall for scripts. */
export interface Limits {
  startsPerMinute: number;
  startsPerHour: number;
  finishesPerMinute: number;
  finishesPerHour: number;
  feedbackPerPlayerHour: number;
  feedbackPerIpHour: number;
  duelsPerHour: number;
  openDuelsMax: number;
}

export const DEFAULT_LIMITS: Limits = {
  startsPerMinute: 30,
  startsPerHour: 600,
  finishesPerMinute: 12,
  finishesPerHour: 300,
  feedbackPerPlayerHour: 5,
  feedbackPerIpHour: 20,
  duelsPerHour: 20,
  openDuelsMax: 20,
};

export interface AppOptions {
  rpc: Rpc;
  /** The player a bearer token belongs to, or null if it isn't valid. */
  verifyToken(token: string): Promise<Caller | null>;
  /** Deletes a sign-in account (needs the service role, so only the server can). */
  deleteUser(id: string): Promise<void>;
  /**
   * Gives an anonymous sign-in account an email and password, confirmed, which
   * makes it a full account (needs the service role, so only the server can).
   */
  createLogin(id: string, email: string, password: string): Promise<void>;
  /** Games a player may start per day; null (the default) for no limit. A switch for a paid tier later. */
  freePlaysPerDay?: number | null;
  limits?: Partial<Limits>;
  /** Keeps coming days' seeds unguessable; also salts hashed IP addresses. */
  dailySecret: string;
  /** Origins allowed to call the API. Requests carry a token rather than cookies, so "*" is safe. */
  allowedOrigins: readonly string[] | '*';
  /** The caller's IP address, for rate limits; null when unknown. Defaults to the first X-Forwarded-For entry. */
  clientIp?(request: Request): string | null;
}

const MAX_BODY_BYTES = 512 * 1024;
const MAX_MOVES = 10_000;
const MAX_MOVE_LENGTH = 64;
const MAX_NAME_LENGTH = 24;
const LEADERBOARD_MAX = 100;
const MAX_FEEDBACK_LENGTH = 2000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PAGE_LENGTH = 200;
const UUID = /^[0-9a-f-]{36}$/i;
// No 0, 1, I, L or O: a code read out or typed from a phone can't be misread.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const DUEL_MAX_AGE_MS = 24 * 3_600_000;

function newDuelCode(): string {
  // 31 symbols, so only bytes below 248 (8 × 31) map evenly; the rest are drawn again.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(8))) {
      if (b < limit && code.length < 8) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/** A code from the URL: pasted lowercase works; anything of the wrong shape is no duel. */
const duelCode = (raw: string | undefined) => {
  const code = (raw ?? '').toUpperCase();
  return CODE.test(code) ? code : null;
};

const newPlayerName = () => `Explorer ${Math.floor(1000 + Math.random() * 9000)}`;

const forwardedFor = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

async function hashIp(ip: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Env = { Variables: { caller: Caller } };

export function createApp({
  rpc,
  verifyToken,
  deleteUser,
  createLogin,
  freePlaysPerDay = null,
  limits: limitOverrides,
  dailySecret,
  allowedOrigins,
  clientIp = forwardedFor,
}: AppOptions) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const app = new Hono<Env>().basePath('/api');

  const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500, error: ApiErrorCode) =>
    c.json<ApiErrorResponse>({ error }, status);

  const bearer = (c: Context) => c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];

  app.use(
    '*',
    cors({
      origin: allowedOrigins === '*' ? '*' : [...allowedOrigins],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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
    const caller = token ? await verifyToken(token) : null;
    if (!caller) return fail(c, 401, 'unauthorized');
    c.set('caller', caller);
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

  /** Who is calling, as every database function that may sign a player up takes it. */
  const who = (c: Context<Env>) => {
    const { id, anonymous } = c.get('caller');
    return { p_player: id, p_anonymous: anonymous, p_default_name: newPlayerName() };
  };

  app.get('/health', async (c) => {
    await rpc('ping', {});
    return c.json({ ok: true, datasetVersion: DATASET_VERSION });
  });

  app.get('/me', signedIn, async (c) => {
    const me = (await rpc('get_me', who(c))) as { name: string; bests: MeResponse['bests'] };
    return c.json<MeResponse>({ player: { id: c.get('caller').id, name: me.name }, bests: me.bests });
  });

  app.patch('/me', signedIn, async (c) => {
    const input = await body(c);
    const name = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH).trim() : '';
    if (!name) return fail(c, 400, 'bad-request');
    if (isOffensiveName(name)) return fail(c, 422, 'name-not-allowed');
    await rpc('get_me', who(c)); // a rename can be a new player's first call
    await rpc('rename_player', { p_player: c.get('caller').id, p_name: name });
    return c.json({ name });
  });

  // Games, feedback and the player go first, then the sign-in account: if that
  // fails, all that's left is an empty account.
  app.delete('/me', signedIn, async (c) => {
    const { id } = c.get('caller');
    await rpc('delete_player', { p_player: id });
    await deleteUser(id);
    return c.json<DeleteAccountResponse>({ deleted: true });
  });

  // "Create account": the anonymous player gets an email and password, keeping its
  // games; the browser then signs in with them. Asked of the player's own token only.
  app.post('/me/account', signedIn, async (c) => {
    const caller = c.get('caller');
    if (!caller.anonymous) return fail(c, 403, 'forbidden');
    const input = await body(c);
    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (
      email.length > MAX_EMAIL_LENGTH ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return fail(c, 400, 'bad-request');
    }
    if (await rpc('email_in_use', { p_email: email })) return fail(c, 409, 'email-taken');
    await createLogin(caller.id, email, password);
    return c.json<CreateAccountResponse>({ created: true });
  });

  // After logging in to an existing account, the browser hands over the token of
  // the anonymous player it had before: holding both tokens proves both are its own.
  app.post('/me/merge', signedIn, async (c) => {
    const caller = c.get('caller');
    if (caller.anonymous) return fail(c, 403, 'forbidden');
    const input = await body(c);
    const token = typeof input?.anonymousToken === 'string' ? input.anonymousToken : '';
    const from = token ? await verifyToken(token) : null;
    if (!from) return fail(c, 401, 'unauthorized');
    if (!from.anonymous || from.id === caller.id) return fail(c, 403, 'forbidden');
    const moved = Number(await rpc('merge_players', { p_from: from.id, p_into: caller.id, p_default_name: newPlayerName() }));
    await deleteUser(from.id);
    return c.json<MergeResponse>({ moved });
  });

  app.post('/feedback', signedIn, async (c) => {
    const input = await body(c);
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
    const rawEmail = input?.email ?? undefined;
    const rawPage = input?.page ?? undefined;
    const email = typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim() : undefined;
    const page = typeof rawPage === 'string' && rawPage ? rawPage : undefined;
    if (
      !message ||
      message.length > MAX_FEEDBACK_LENGTH ||
      (rawEmail !== undefined && typeof rawEmail !== 'string') ||
      (email !== undefined && (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
      (rawPage !== undefined && typeof rawPage !== 'string') ||
      (page !== undefined && page.length > MAX_PAGE_LENGTH)
    ) {
      return fail(c, 400, 'bad-request');
    }
    const ip = clientIp(c.req.raw);
    const stored = (await rpc('submit_feedback', {
      ...who(c),
      p_message: message,
      p_email: email ?? null,
      p_page: page ?? null,
      p_ip_hash: ip ? await hashIp(ip, dailySecret) : null,
      p_per_player_hour: limits.feedbackPerPlayerHour,
      p_per_ip_hour: limits.feedbackPerIpHour,
    })) as { ok: boolean };
    if (!stored.ok) return fail(c, 429, 'rate-limited');
    return c.json({ ok: true }, 201);
  });

  app.post('/sessions', signedIn, async (c) => {
    const input = await body(c);
    const game = typeof input?.gameId === 'string' ? getGame(input.gameId) : undefined;
    if (!game || game.status !== 'live') return fail(c, 400, 'bad-request');
    if (input!.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const settings = normalizeSettings((input!.settings ?? {}) as Partial<GameSettings>, game);
    const seed = randomSeed();
    const started = (await rpc('start_session', {
      ...who(c),
      p_game_id: game.id,
      p_variant: variantKey(settings, game),
      p_settings: settings,
      p_seed: seed,
      p_dataset_version: DATASET_VERSION,
      p_daily_limit: freePlaysPerDay,
      p_per_minute: limits.startsPerMinute,
      p_per_hour: limits.startsPerHour,
    })) as { ok: boolean; sessionId?: string };
    if (!started.ok) return fail(c, 429, 'rate-limited');
    return c.json<StartSessionResponse>({ sessionId: started.sessionId!, seed }, 201);
  });

  app.post('/daily/:gameId/start', signedIn, async (c) => {
    const gameId = c.req.param('gameId') ?? '';
    const game = DAILY_GAMES.includes(gameId) ? getGame(gameId) : undefined;
    if (!game) return fail(c, 404, 'not-found');
    const input = await body(c);
    if (input?.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const date = dailyDate();
    const session = (await rpc('start_daily_session', {
      ...who(c),
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
    if (!UUID.test(sessionId)) return fail(c, 404, 'not-found');
    const player = c.get('caller').id;
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
    const finish = async (score: number) => {
      const result = (await rpc('finish_session', {
        p_session: sessionId,
        p_player: player,
        p_moves: moves,
        p_score: score,
        p_per_minute: limits.finishesPerMinute,
        p_per_hour: limits.finishesPerHour,
      })) as FinishSessionResponse | { error: 'rate-limited' };
      return 'error' in result ? fail(c, 429, 'rate-limited') : c.json<FinishSessionResponse>(result);
    };
    // Already finished: answer as before, without replaying the new moves.
    if (session.status === 'finished') return finish(session.score!);
    // Data deployed since this game started can't replay it.
    if (session.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const game = getGame(session.gameId);
    if (!game) return fail(c, 404, 'not-found');
    const { score, finished } = await replayGame(game, session.settings, Number(session.seed), moves);
    if (!finished) return fail(c, 422, 'unfinished-game');
    return finish(score);
  });

  const duelArgs = (c: Context<Env>) => ({
    p_player: c.get('caller').id,
    p_dataset_version: DATASET_VERSION,
    p_play_hours: DUEL_PLAY_HOURS,
  });

  // A duel is made from the caller's own finished run, so it needs an account:
  // the friend should know who they're playing, and the duel follows the player.
  app.post('/duels', signedIn, async (c) => {
    if (c.get('caller').anonymous) return fail(c, 403, 'account-required');
    const input = await body(c);
    const sessionId = input?.sessionId;
    const rematchOf = input?.rematchOf === undefined ? null : duelCode(typeof input.rematchOf === 'string' ? input.rematchOf : undefined);
    if (typeof sessionId !== 'string' || !UUID.test(sessionId) || (input?.rematchOf !== undefined && !rematchOf)) {
      return fail(c, 400, 'bad-request');
    }
    const player = c.get('caller').id;
    const source = (await rpc('duel_source', { p_session: sessionId, p_player: player })) as {
      gameId: string;
      variant: string;
      settings: GameSettings;
      seed: number;
      datasetVersion: string;
      status: 'playing' | 'finished';
      finishedAt: string | null;
      moves: string[] | null;
      duelCode: string | null;
    } | null;
    if (!source) return fail(c, 404, 'not-found');
    const game = getGame(source.gameId);
    // Only runs whose seed gives a friend the very same puzzles (see canDuel), and not dailies or duels.
    if (!game || !canDuel(game, source.settings) || source.variant === DUEL_VARIANT || source.variant.startsWith('daily-')) {
      return fail(c, 400, 'bad-request');
    }
    if (source.status !== 'finished') return fail(c, 422, 'unfinished-game');
    if (source.duelCode) return c.json<CreateDuelResponse>({ code: source.duelCode });
    if (Date.now() - new Date(source.finishedAt!).getTime() > DUEL_MAX_AGE_MS) return fail(c, 400, 'bad-request');
    if (source.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    if (rematchOf) {
      // A rematch is the same game again.
      const original = (await rpc('get_duel', { p_code: rematchOf, ...duelArgs(c) })) as DuelDto | null;
      if (original && original.gameId !== source.gameId) return fail(c, 400, 'bad-request');
    }
    const { level } = await replayRun(game, source.settings, Number(source.seed), source.moves ?? []);
    for (let attempt = 0; attempt < 3; attempt++) {
      const made = (await rpc('create_duel', {
        p_player: player,
        p_code: newDuelCode(),
        p_session: sessionId,
        p_level: level,
        p_rematch_of: rematchOf,
        p_open_days: DUEL_OPEN_DAYS,
        p_per_hour: limits.duelsPerHour,
        p_max_open: limits.openDuelsMax,
        p_dataset_version: DATASET_VERSION,
        p_play_hours: DUEL_PLAY_HOURS,
      })) as { ok: boolean; code?: string; error?: string };
      if (made.ok) return c.json<CreateDuelResponse>({ code: made.code! }, 201);
      if (made.error === 'rate-limited') return fail(c, 429, 'rate-limited');
      if (made.error === 'forbidden') return fail(c, 403, 'forbidden');
      if (made.error !== 'code-taken') return fail(c, 404, 'not-found');
    }
    return fail(c, 500, 'internal');
  });

  app.get('/duels', signedIn, async (c) => {
    const duels = (await rpc('list_duels', { ...duelArgs(c), p_limit: 50 })) as DuelDto[];
    return c.json<DuelListResponse>({ duels });
  });

  // Anonymous players may look: the link is what a friend opens first.
  app.get('/duels/:code', signedIn, async (c) => {
    const code = duelCode(c.req.param('code'));
    if (!code) return fail(c, 404, 'not-found');
    const duel = (await rpc('get_duel', { p_code: code, ...duelArgs(c) })) as DuelDto | null;
    return duel ? c.json<DuelDto>(duel) : fail(c, 404, 'not-found');
  });

  app.post('/duels/:code/accept', signedIn, async (c) => {
    const code = duelCode(c.req.param('code'));
    if (!code) return fail(c, 404, 'not-found');
    const input = await body(c);
    if (input?.datasetVersion !== DATASET_VERSION) return fail(c, 409, 'update-required');
    const result = (await rpc('accept_duel', {
      ...who(c),
      p_code: code,
      p_dataset_version: DATASET_VERSION,
      p_per_minute: limits.startsPerMinute,
      p_per_hour: limits.startsPerHour,
    })) as { ok: boolean; error?: string; sessionId?: string; seed?: number };
    if (result.ok) return c.json<AcceptDuelResponse>({ sessionId: result.sessionId!, seed: Number(result.seed) });
    switch (result.error) {
      case 'not-found':
        return fail(c, 404, 'not-found');
      case 'forbidden':
      case 'reserved':
        return fail(c, 403, 'forbidden');
      case 'rate-limited':
        return fail(c, 429, 'rate-limited');
      default:
        return fail(c, 409, 'duel-unavailable');
    }
  });

  app.get('/leaderboards/:gameId/:variant', async (c) => {
    const { gameId, variant } = c.req.param();
    const limit = Math.min(LEADERBOARD_MAX, Math.max(1, Number(c.req.query('limit')) || 20));
    let entries: unknown;
    if (c.req.query('scope') === 'personal') {
      const token = bearer(c);
      const caller = token ? await verifyToken(token) : null;
      if (!caller) return fail(c, 401, 'unauthorized');
      entries = await rpc('leaderboard_personal', { p_player: caller.id, p_game_id: gameId, p_variant: variant, p_limit: limit });
    } else {
      // Duel runs are played against one friend, not the world.
      if (variant === DUEL_VARIANT) return fail(c, 404, 'not-found');
      entries = await rpc('leaderboard_global', { p_game_id: gameId, p_variant: variant, p_limit: limit });
    }
    return c.json<LeaderboardResponse>({ entries: entries as LeaderboardEntryDto[] });
  });

  return app;
}

/** FREE_PLAYS_PER_DAY: a positive whole number turns a daily limit on; anything else, or nothing, means none. */
export function parseDailyLimit(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
