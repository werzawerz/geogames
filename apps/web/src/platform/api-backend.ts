import {
  DATASET_VERSION,
  randomSeed,
  type ApiErrorCode,
  type ApiErrorResponse,
  type CreateAccountRequest,
  type FeedbackRequest,
  type FinishSessionRequest,
  type FinishSessionResponse,
  type LeaderboardResponse,
  type MeResponse,
  type MergeRequest,
  type RenameRequest,
  type StartDailyRequest,
  type StartDailyResponse,
  type StartSessionRequest,
  type StartSessionResponse,
} from '@geogames/games';
import { SignInError, type Auth } from './auth.ts';
import { createLocalBackend, type Backend, type FinishResult } from './backend.ts';
import { loadPlayer } from './player.ts';
import { clearAll, load, remove, save } from './storage.ts';
import type { ScoreService } from './scores.ts';

const TIMEOUT_MS = 10_000;

/** The server answered, with an error. Anything else thrown means it couldn't be reached. */
class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode) {
    super(code);
    this.code = code;
  }
}

const NOTICES = {
  offline: "We couldn't reach the server, so this score wasn't saved online. It's kept in this browser.",
  offlineAtStart: "We couldn't reach the server when this game started, so this score wasn't saved online. It's kept in this browser.",
  updated: 'The game was updated while you played, so this score wasn’t saved online. It’s kept in this browser.',
  busy: "You've finished a lot of games in a short time, so this score wasn't saved online. It's kept in this browser.",
} as const;

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
    throw new ApiError(failure?.error ?? 'internal');
  };

  // Before anything else: the session this browser kept.
  let settled: Promise<void> | null = null;
  const settle = () => (settled ??= auth.ready());

  // Best scores per game and variant, from sign-in on. Null until the server answers.
  let bests: MeResponse['bests'] | null = null;
  let me: Promise<MeResponse> | null = null;
  const loadMe = () => {
    me ??= settle()
      .then(() => request<MeResponse>('GET', '/me'))
      .then(
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

  const loadAll = async () => {
    const { player } = await loadMe();
    save('api-player-name', player.name);
    return { player, account: await auth.account() };
  };

  /** After signing out or deleting: this browser starts over as a new anonymous player. */
  const startOver = async () => {
    me = null;
    bests = null;
    remove('api-player-name');
    clearAll('daily:');
    try {
      return await loadAll();
    } catch {
      return { player: loadPlayer(), account: { status: 'anonymous' as const } };
    }
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
    initial: {
      player: { ...local.initial.player, name: load<string | null>('api-player-name', local.initial.player.name) ?? local.initial.player.name },
      account: auth.initialAccount,
    },
    async load() {
      try {
        return await loadAll();
      } catch {
        return null;
      }
    },
    async rename(player) {
      try {
        await request('PATCH', '/me', { name: player.name } satisfies RenameRequest);
        save('api-player-name', player.name);
        return 'ok';
      } catch (error) {
        if (error instanceof ApiError && error.code === 'name-not-allowed') return 'rejected';
        // Keeps the name here; the next rename tries again.
        save('api-player-name', player.name);
        return 'offline';
      }
    },
    scores,
    async startPlay(game, settings) {
      try {
        await settle();
        const { sessionId, seed } = await request<StartSessionResponse>('POST', '/sessions', {
          gameId: game.id,
          settings,
          datasetVersion: DATASET_VERSION,
        } satisfies StartSessionRequest);
        return { status: 'ok', play: { seed, sessionId } };
      } catch (error) {
        if (error instanceof ApiError && error.code === 'update-required') return { status: 'update-required' };
        // Still playable; the score stays in this browser.
        const unsaved = error instanceof ApiError ? 'refused' : 'offline';
        return { status: 'ok', play: { seed: randomSeed(), sessionId: null, unsaved } };
      }
    },
    async startDaily(game) {
      try {
        await settle();
        const { date, sessionId, seed, finishedScore } = await request<StartDailyResponse>('POST', `/daily/${game.id}/start`, {
          datasetVersion: DATASET_VERSION,
        } satisfies StartDailyRequest);
        return { status: 'ok', date, play: { seed, sessionId }, finishedScore };
      } catch (error) {
        return { status: error instanceof ApiError && error.code === 'update-required' ? 'update-required' : 'unavailable' };
      }
    },
    async finishPlay(play, game, player): Promise<FinishResult> {
      const keepLocally = async (status: 'offline' | 'refused', notice: string): Promise<FinishResult> => ({
        ...(await local.finishPlay(play, game, player)),
        status,
        notice,
      });
      if (!play.sessionId) {
        return play.unsaved === 'refused' ? keepLocally('refused', NOTICES.busy) : keepLocally('offline', NOTICES.offlineAtStart);
      }
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
        return { ...result, status: 'saved' };
      } catch (error) {
        if (!(error instanceof ApiError) || error.code === 'internal') return keepLocally('offline', NOTICES.offline);
        return keepLocally('refused', error.code === 'update-required' ? NOTICES.updated : error.code === 'rate-limited' ? NOTICES.busy : NOTICES.offline);
      }
    },
    async logIn(email, password) {
      await settle();
      const { mergeFrom } = await auth.logIn(email, password).catch((error: unknown) => {
        throw error instanceof SignInError ? error : new SignInError('offline');
      });
      if (mergeFrom) {
        await request('POST', '/me/merge', { anonymousToken: mergeFrom } satisfies MergeRequest).catch(() => {
          // The anonymous player's games stay behind; nothing else to do.
        });
      }
      return startOver();
    },
    async createAccount(email, password) {
      await settle();
      await auth
        .createAccount(email, password, async () => {
          await request('POST', '/me/account', { email: email.trim(), password } satisfies CreateAccountRequest);
        })
        .catch((error: unknown) => {
          if (error instanceof SignInError) throw error;
          if (error instanceof ApiError && error.code === 'email-taken') throw new SignInError('email-taken');
          if (error instanceof ApiError && error.code === 'bad-request') throw new SignInError('bad-input');
          throw new SignInError('offline');
        });
      // The same player: only the account changed.
      me = null;
      return loadAll();
    },
    async signOut() {
      await settle();
      await auth.signOut();
      return startOver();
    },
    async deleteAccount() {
      await settle();
      await request('DELETE', '/me');
      await auth.signOut();
      // This browser's copies of the scores go too.
      clearAll('scores');
      return startOver();
    },
    async sendFeedback(input) {
      const message = input.message.trim();
      if (!message || message.length > 2000) throw new Error('Feedback must be 1 to 2000 characters.');
      await settle();
      try {
        await request('POST', '/feedback', {
          message,
          ...(input.email?.trim() ? { email: input.email.trim() } : {}),
          ...(input.page ? { page: input.page.slice(0, 200) } : {}),
        } satisfies FeedbackRequest);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'rate-limited') {
          throw new Error("You've sent a lot of feedback in the last hour. Please try again later.");
        }
        if (error instanceof ApiError && error.code === 'bad-request') throw new Error('Please check the message and email address.');
        throw new Error("We couldn't reach the server. Please try again later.");
      }
    },
  };
}
