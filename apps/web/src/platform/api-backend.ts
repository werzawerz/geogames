import {
  DATASET_VERSION,
  randomSeed,
  type AllowanceDto,
  type ApiErrorCode,
  type ApiErrorResponse,
  type FinishSessionRequest,
  type FinishSessionResponse,
  type LeaderboardResponse,
  type MeResponse,
  type RenameRequest,
  type StartSessionRequest,
  type StartSessionResponse,
} from '@geogames/games';
import type { Auth } from './auth.ts';
import { createLocalBackend, type Backend } from './backend.ts';
import type { Allowance } from './entitlements.ts';
import { FREE_PLAYS_PER_DAY } from './entitlements.ts';
import { load, save } from './storage.ts';
import type { ScoreService } from './scores.ts';

const TIMEOUT_MS = 10_000;

class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly allowance?: AllowanceDto;
  constructor(code: ApiErrorCode, allowance?: AllowanceDto) {
    super(code);
    this.code = code;
    this.allowance = allowance;
  }
}

const toAllowance = (a: AllowanceDto): Allowance => ({
  plan: a.plan,
  limit: a.limit,
  used: a.used,
  remaining: a.limit === null ? null : Math.max(0, a.limit - a.used),
  resetsAt: new Date(a.resetsAt),
});

/** What's shown until the server has answered: never blocks a player who may have plays left. */
const assumedAllowance = (): Allowance =>
  toAllowance({ plan: 'free', limit: FREE_PLAYS_PER_DAY, used: 0, resetsAt: new Date(Date.now() + 86_400_000).toISOString() });

/**
 * The server holds players, plays and scores. The local backend is the fallback
 * when it can't be reached (a free Supabase project pauses when idle): games stay
 * playable, and those scores stay in this browser.
 */
export function createApiBackend(baseUrl: string, auth: Auth): Backend {
  const local = createLocalBackend();

  const request = async <T>(method: string, path: string, body?: unknown, signedIn = true): Promise<T> => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(signedIn ? { Authorization: `Bearer ${await auth.token()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as T;
    const failure = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(failure?.error ?? 'internal', failure?.allowance);
  };

  // Best scores per game and variant, from sign-in on. Null until the server answers.
  let bests: MeResponse['bests'] | null = null;
  let me: Promise<MeResponse> | null = null;
  const loadMe = () => {
    me ??= request<MeResponse>('GET', '/me').then(
      (response) => {
        bests = response.bests;
        return response;
      },
      (error: unknown) => {
        me = null; // try again next time
        throw error;
      },
    );
    return me;
  };

  const scores: ScoreService = {
    async submit(entry) {
      return local.scores.submit(entry);
    },
    async top(gameId, variant, scope, limit = 20) {
      try {
        const path = `/leaderboards/${gameId}/${variant}?scope=${scope}&limit=${limit}`;
        return (await request<LeaderboardResponse>('GET', path, undefined, scope === 'personal')).entries;
      } catch {
        return scope === 'global' ? null : local.scores.top(gameId, variant, scope, limit);
      }
    },
    async personalBest(gameId, variant) {
      try {
        await loadMe();
      } catch {
        return local.scores.personalBest(gameId, variant);
      }
      const forGame = Object.entries(bests?.[gameId] ?? {});
      return forGame.reduce((best, [v, score]) => (variant === undefined || v === variant ? Math.max(best, score) : best), 0);
    },
  };

  return {
    initial: { player: { ...local.initial.player, name: load<string | null>('api-player-name', local.initial.player.name) ?? local.initial.player.name }, allowance: assumedAllowance() },
    async load() {
      try {
        const { player, allowance } = await loadMe();
        save('api-player-name', player.name);
        return { player, allowance: toAllowance(allowance) };
      } catch {
        return null;
      }
    },
    async rename(player) {
      save('api-player-name', player.name);
      try {
        await request('PATCH', '/me', { name: player.name } satisfies RenameRequest);
      } catch {
        // Keeps the local name; the next rename tries again.
      }
    },
    scores,
    async startPlay(game, settings) {
      try {
        const { sessionId, seed, allowance } = await request<StartSessionResponse>('POST', '/sessions', {
          gameId: game.id,
          settings,
          datasetVersion: DATASET_VERSION,
        } satisfies StartSessionRequest);
        return { status: 'ok', play: { seed, sessionId }, allowance: toAllowance(allowance) };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'out-of-plays' && error.allowance) {
          return { status: 'out-of-plays', allowance: toAllowance(error.allowance) };
        }
        if (error instanceof ApiError && error.code === 'update-required') return { status: 'update-required' };
        return { status: 'ok', play: { seed: randomSeed(), sessionId: null }, allowance: assumedAllowance() };
      }
    },
    async finishPlay(play, game, player) {
      const keepLocally = async (notice: string) => ({
        ...(await local.finishPlay(play, game, player)),
        notice,
      });
      if (!play.sessionId) return keepLocally("We couldn't reach the server when this game started, so this score isn't on the leaderboard.");
      const finish = () =>
        request<FinishSessionResponse>('POST', `/sessions/${play.sessionId}/finish`, { moves: game.moves } satisfies FinishSessionRequest);
      try {
        const result = await finish().catch((error: unknown) => {
          if (error instanceof ApiError && error.code !== 'internal') throw error;
          return finish(); // Finishing twice is safe: the server keeps the first result.
        });
        if (bests) {
          const forGame = (bests[game.gameId] ??= {});
          forGame[game.variant] = result.personalBest;
        }
        return result;
      } catch (error) {
        return keepLocally(
          error instanceof ApiError && error.code === 'update-required'
            ? 'The game was updated while you played, so this score isn’t on the leaderboard.'
            : "We couldn't reach the server, so this score isn't on the leaderboard.",
        );
      }
    },
  };
}
