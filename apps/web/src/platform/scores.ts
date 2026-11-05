import { load, save } from './storage.ts';

export interface ScoreEntry {
  id: string;
  gameId: string;
  /** Settings bucket (see `variantKey`); scores only compete within a variant. */
  variant: string;
  playerId: string;
  playerName: string;
  score: number;
  /** Seed + settings + guess log let a server replay the game to verify the score. */
  seed: number;
  moves: readonly string[];
  playedAt: string;
}

export type LeaderboardScope = 'personal' | 'global';

/** One row of a leaderboard. */
export type RankedScore = Pick<ScoreEntry, 'id' | 'playerName' | 'score' | 'playedAt'>;

export interface SubmitResult {
  isPersonalBest: boolean;
  personalBest: number;
}

/** Async on purpose: the global leaderboard will be a network call. */
export interface ScoreService {
  submit(entry: Omit<ScoreEntry, 'id' | 'playedAt'>): Promise<SubmitResult>;
  /** Returns `null` when the scope isn't available (e.g. global, without a server to ask). */
  top(gameId: string, variant: string, scope: LeaderboardScope, limit?: number): Promise<RankedScore[] | null>;
  /** Best score in one variant, or across all variants when omitted. */
  personalBest(gameId: string, variant?: string): Promise<number>;
}

const MAX_LOCAL_ENTRIES = 500;

// Entries saved before regions existed were whole-world games.
const variantOf = (e: ScoreEntry) => e.variant ?? 'world';

export function createLocalScores(): ScoreService {
  const all = () => load<ScoreEntry[]>('scores', []);
  const best = (gameId: string, variant: string | undefined, entries = all()) =>
    entries
      .filter((e) => e.gameId === gameId && (variant === undefined || variantOf(e) === variant))
      .reduce((max, e) => Math.max(max, e.score), 0);

  return {
    async submit(input) {
      const entries = all();
      const previousBest = best(input.gameId, input.variant, entries);
      const entry: ScoreEntry = { ...input, id: crypto.randomUUID(), playedAt: new Date().toISOString() };
      save('scores', [...entries, entry].slice(-MAX_LOCAL_ENTRIES));
      return {
        isPersonalBest: entry.score > previousBest,
        personalBest: Math.max(previousBest, entry.score),
      };
    },
    async top(gameId, variant, scope, limit = 10) {
      if (scope === 'global') return null;
      return all()
        .filter((e) => e.gameId === gameId && variantOf(e) === variant)
        .sort((a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt))
        .slice(0, limit);
    },
    async personalBest(gameId, variant) {
      return best(gameId, variant);
    },
  };
}
