import type { GameSettings } from './settings.ts';

/** What the API and the web app send each other (types only). All paths are under `/api`. */

export interface AllowanceDto {
  plan: 'free' | 'premium';
  /** Plays per day on this plan; `null` means unlimited. */
  limit: number | null;
  used: number;
  /** ISO time the daily count starts over. */
  resetsAt: string;
}

/** GET /me: signs a new player up on first use. */
export interface MeResponse {
  player: { id: string; name: string };
  allowance: AllowanceDto;
  /** Best score per game, then per variant. */
  bests: Record<string, Record<string, number>>;
}

/** PATCH /me */
export interface RenameRequest {
  name: string;
}

/** POST /sessions */
export interface StartSessionRequest {
  gameId: string;
  settings: Partial<GameSettings>;
  datasetVersion: string;
}

export interface StartSessionResponse {
  sessionId: string;
  /** Chosen by the server, so a player can't look for a lucky seed. */
  seed: number;
  allowance: AllowanceDto;
}

/** POST /sessions/:id/finish */
export interface FinishSessionRequest {
  moves: readonly string[];
}

export interface FinishSessionResponse {
  /** The score from replaying the moves. */
  score: number;
  isPersonalBest: boolean;
  personalBest: number;
}

/** POST /daily/:gameId/start: opens or reopens the player's run. Spends no free play. */
export interface StartDailyRequest {
  datasetVersion: string;
}

export interface StartDailyResponse {
  /** Leaderboards are at the variant `dailyVariant(date)`. */
  date: string;
  sessionId: string;
  seed: number;
  /** Set when today's one try has been played. */
  finishedScore: number | null;
}

export interface LeaderboardEntryDto {
  id: string;
  playerName: string;
  score: number;
  playedAt: string;
}

/** GET /leaderboards/:gameId/:variant?scope=global|personal&limit=20 (global needs no sign-in) */
export interface LeaderboardResponse {
  entries: LeaderboardEntryDto[];
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'bad-request'
  /** Daily free plays are used up. Comes with the allowance. */
  | 'out-of-plays'
  /** The client's game data differs from the server's: it should reload. */
  | 'update-required'
  /** The moves don't play the game to its end. */
  | 'unfinished-game'
  | 'internal';

export interface ApiErrorResponse {
  error: ApiErrorCode;
  allowance?: AllowanceDto;
}
