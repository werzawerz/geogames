import type { GameSettings } from './settings.ts';

/**
 * What the API and the web app send each other (types only). All paths are under `/api`.
 * Every call except the health check and the global leaderboard needs a Supabase
 * access token (`Authorization: Bearer`); anonymous players have one too.
 */

/** GET /me: signs a new player up on first use. */
export interface MeResponse {
  player: { id: string; name: string };
  /** Best score per game, then per variant. */
  bests: Record<string, Record<string, number>>;
}

/** PATCH /me. An offensive name is refused with `name-not-allowed`. */
export interface RenameRequest {
  name: string;
}

/** DELETE /me: deletes the player's games, feedback and sign-in account. */
export interface DeleteAccountResponse {
  deleted: true;
}

/** Passwords for email accounts: at least this long. */
export const MIN_PASSWORD_LENGTH = 8;
/** And at most this long (the most bcrypt reads). */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * POST /me/account, by an anonymous player: gives the player an email and password
 * to sign in with, keeping their games. Afterwards the browser signs in with them.
 * An email another account has is refused with `email-taken`.
 */
export interface CreateAccountRequest {
  email: string;
  password: string;
}

export interface CreateAccountResponse {
  created: true;
}

/**
 * POST /me/merge, called with the token of the account just signed in to:
 * moves the games of the anonymous player this browser had before into it.
 */
export interface MergeRequest {
  anonymousToken: string;
}

export interface MergeResponse {
  /** How many games moved over. */
  moved: number;
}

/** POST /feedback. Only stored; there's no way to read it through the API. */
export interface FeedbackRequest {
  /** 1–2000 characters. */
  message: string;
  email?: string;
  /** Where the player was, e.g. "#/play/capitals". */
  page?: string;
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

/** POST /daily/:gameId/start: opens or reopens the player's run. */
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

/**
 * GET /leaderboards/:gameId/:variant?scope=global|personal&limit=20. Global needs
 * no sign-in and lists signed-in players only; personal lists the caller's games.
 */
export interface LeaderboardResponse {
  entries: LeaderboardEntryDto[];
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  /** Too many games or messages in a short time (or a daily limit, if the server has one). */
  | 'rate-limited'
  /** PATCH /me with a name the server won't show. */
  | 'name-not-allowed'
  /** POST /me/account with an email another account already has. */
  | 'email-taken'
  /** The client's game data differs from the server's: it should reload. */
  | 'update-required'
  /** The moves don't play the game to its end. */
  | 'unfinished-game'
  | 'internal';

export interface ApiErrorResponse {
  error: ApiErrorCode;
}
