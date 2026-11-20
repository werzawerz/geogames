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

/** Duels: two players, the same circles, one try each (see docs/ideas/duels.md). */
export const DUEL_GAMES: readonly string[] = ['city-circle-arcade'];
/** The variant of the challenger's run, which keeps it off every leaderboard. */
export const DUEL_VARIANT = 'duel';
/** A duel nobody has taken lasts this many days. */
export const DUEL_OPEN_DAYS = 7;
/** Once the challenger starts, they have this many hours to finish. */
export const DUEL_PLAY_HOURS = 24;

/** POST /duels: makes a duel from the caller's own finished run (at most a day old). */
export interface CreateDuelRequest {
  sessionId: string;
  /** The duel this one is a rematch of; only the other player can accept it. */
  rematchOf?: string;
}

export interface CreateDuelResponse {
  code: string;
}

/** POST /duels/:code/accept: the first caller to ask takes the duel and gets the seed. */
export interface AcceptDuelRequest {
  datasetVersion: string;
}

export interface AcceptDuelResponse {
  sessionId: string;
  seed: number;
}

export type DuelState = 'open' | 'playing' | 'finished' | 'expired';

export interface DuelPlayerDto {
  name: string;
  /** Null until it may be shown (the challenger's, before the duel is over). */
  score: number | null;
  /** The level reached; null for the challenger, whose run is hidden until it's over. */
  level: number | null;
  status: 'playing' | 'finished' | 'forfeit';
  durationSec: number | null;
  /** Only once the duel is finished, and only when asked for (GET /duels/:code). */
  moves?: string[];
}

export interface DuelDto {
  code: string;
  gameId: string;
  settings: GameSettings;
  createdAt: string;
  expiresAt: string;
  you: 'creator' | 'challenger' | 'visitor';
  state: DuelState;
  expiredReason?: 'time' | 'outdated';
  creator: DuelPlayerDto;
  challenger: DuelPlayerDto | null;
  /** The name of the only player who may take this rematch. */
  reservedFor: string | null;
  reservedForYou: boolean;
  outcome: 'creator' | 'challenger' | 'draw' | null;
  /** Once the duel is finished (and only then): the circles can be replayed from it. */
  seed?: number;
  /** Only for the challenger, while playing. */
  session?: { sessionId: string; seed: number };
  /** The newest rematch of this duel. */
  rematch: { code: string; forYou: boolean; byYou: boolean; state: DuelState } | null;
}

/** GET /duels */
export interface DuelListResponse {
  duels: DuelDto[];
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
  /** POST /duels without an account: a duel needs to know who is playing. */
  | 'account-required'
  /** The duel was taken, expired or can't be played any more. */
  | 'duel-unavailable'
  | 'internal';

export interface ApiErrorResponse {
  error: ApiErrorCode;
}
