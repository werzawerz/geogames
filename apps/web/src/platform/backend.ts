import { dailyDate, dailySeed, dailyVariant, randomSeed, type GameDefinition, type GameSettings } from '@geogames/games';
import type { Account } from './auth.ts';
import { loadPlayer, savePlayer, type Player } from './player.ts';
import { createLocalScores, type ScoreService, type SubmitResult } from './scores.ts';
import { clearAll } from './storage.ts';

/** A game in progress. Without a session id it's only known to this browser. */
export interface Play {
  seed: number;
  sessionId: string | null;
  /** Why a game with a server but without a session won't be saved there. */
  unsaved?: 'offline' | 'refused';
}

export type StartResult =
  | { status: 'ok'; play: Play }
  /** This page is on older game data than the server: it has to reload. */
  | { status: 'update-required' };

export type DailyStart =
  | { status: 'ok'; date: string; play: Play; finishedScore: number | null }
  | { status: 'update-required' }
  /** The same run for everyone comes from the server, so it can't be played without it. */
  | { status: 'unavailable' };

export interface FinishedGame {
  gameId: string;
  variant: string;
  score: number;
  seed: number;
  moves: readonly string[];
}

/**
 * Where a finished game's score went:
 * - `saved`: the server replayed and stored it.
 * - `local`: a build without a server; kept in this browser, as always.
 * - `offline`: the server couldn't be reached; kept in this browser only.
 * - `refused`: the server answered but didn't store it (game data changed, too many games); kept in this browser only.
 */
export type FinishStatus = 'saved' | 'local' | 'offline' | 'refused';

export interface FinishResult extends SubmitResult {
  status: FinishStatus;
  /** The score that counts: the server's, once it has replayed the game. */
  score: number;
  /** Set when the score couldn't reach the server; says why, for the player. */
  notice?: string;
}

export type RenameResult = 'ok' | 'rejected' | 'offline';

export interface FeedbackInput {
  message: string;
  email?: string;
  page?: string;
}

/**
 * Everything the app needs from "the backend", so pages and game screens don't
 * know whether they run against the API or against this browser alone.
 */
export interface Backend {
  initial: { player: Player; account: Account };
  /** The server's view of the player, or null when there's none to ask. */
  load(): Promise<{ player: Player; account: Account } | null>;
  rename(player: Player): Promise<RenameResult>;
  scores: ScoreService;
  startPlay(game: GameDefinition, settings: GameSettings): Promise<StartResult>;
  /** Opens or reopens today's run of a game. */
  startDaily(game: GameDefinition): Promise<DailyStart>;
  finishPlay(play: Play, game: FinishedGame, player: Player): Promise<FinishResult>;
  signIn(): Promise<void>;
  /** Both return who the player is afterwards: a fresh anonymous (or local) player. */
  signOut(): Promise<{ player: Player; account: Account }>;
  deleteAccount(): Promise<{ player: Player; account: Account }>;
  sendFeedback(input: FeedbackInput): Promise<void>;
}

/** Everything stays in this browser: no accounts, and no global leaderboard. */
export function createLocalBackend(): Backend {
  const scores = createLocalScores();
  const unavailable = async () => {
    throw new Error('This needs the GeoGames server, which this build has none of.');
  };
  return {
    initial: { player: loadPlayer(), account: { status: 'local' } },
    load: async () => null,
    async rename(player) {
      savePlayer(player);
      return 'ok';
    },
    scores,
    async startPlay() {
      return { status: 'ok', play: { seed: randomSeed(), sessionId: null } };
    },
    async startDaily(game) {
      const date = dailyDate();
      const [played] = (await scores.top(game.id, dailyVariant(date), 'personal', 1)) ?? [];
      return {
        status: 'ok',
        date,
        play: { seed: await dailySeed(game.id, date), sessionId: null },
        finishedScore: played ? played.score : null,
      };
    },
    async finishPlay(_play, game, player) {
      const result = await scores.submit({ ...game, playerId: player.id, playerName: player.name });
      return { ...result, status: 'local', score: game.score };
    },
    signIn: unavailable,
    signOut: unavailable,
    async deleteAccount() {
      // Everything this player has is in this browser.
      clearAll();
      return { player: loadPlayer(), account: { status: 'local' } };
    },
    sendFeedback: unavailable,
  };
}
