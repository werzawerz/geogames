import type { MetricId, MetricValue } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';

export type Guess = 'higher' | 'lower';

/** Anything with an id and metrics can be compared: countries, cities, ... */
export interface Comparable {
  id: string;
  metrics: Partial<Record<MetricId, MetricValue>>;
}

export interface HigherLowerOptions<T extends Comparable> {
  metric: MetricId;
  pool: readonly T[];
  /**
   * A challenger must differ from the current country by at least this ratio,
   * so rounds aren't coin flips between near-identical values.
   */
  minRatio?: number;
}

export interface GuessResult {
  guess: Guess;
  correct: boolean;
  currentValue: number;
  challengerValue: number;
}

export interface HigherLowerState<T extends Comparable = Comparable> {
  readonly seed: number;
  readonly current: T;
  readonly challenger: T;
  readonly score: number;
  readonly status: 'guessing' | 'revealed' | 'over';
  /** True when the game ended because every item in the pool was shown and guessed. */
  readonly completed: boolean;
  readonly lastResult: GuessResult | null;
  readonly guesses: readonly Guess[];
  /** Every item shown so far; nothing is offered twice. */
  readonly used: readonly string[];
  readonly rngState: number;
}

export interface HigherLowerGame<T extends Comparable = Comparable> {
  readonly metric: MetricId;
  readonly pool: readonly T[];
  /** The compared value of an item in the pool. */
  valueOf(item: T): number;
  start(seed: number): HigherLowerState<T>;
  guess(state: HigherLowerState<T>, guess: Guess): HigherLowerState<T>;
  /**
   * Move on after a correct reveal: the challenger becomes the current item.
   * When no unseen item is left, the game ends as completed.
   */
  next(state: HigherLowerState<T>): HigherLowerState<T>;
}

export function createHigherLowerGame<T extends Comparable>(options: HigherLowerOptions<T>): HigherLowerGame<T> {
  const { metric, minRatio = 1.1 } = options;
  const pool = options.pool.filter((c) => (c.metrics[metric]?.value ?? 0) > 0);
  if (pool.length < 3) throw new Error(`higher-lower needs at least 3 items with ${metric}`);
  const value = (c: T) => c.metrics[metric]!.value;

  /** A not-yet-shown item, preferably clearly different from `current`; null when the pool is used up. */
  function pickChallenger(rng: Rng, current: T, used: ReadonlySet<string>): T | null {
    const fresh = pool.filter((c) => !used.has(c.id));
    if (fresh.length === 0) return null;
    const distinct = fresh.filter((c) => {
      const ratio = value(c) / value(current);
      return ratio >= minRatio || ratio <= 1 / minRatio;
    });
    return pick(rng, distinct.length > 0 ? distinct : fresh);
  }

  return {
    metric,
    pool,
    valueOf: value,

    start(seed) {
      const rng = createRng(seed);
      const current = pick(rng, pool);
      const challenger = pickChallenger(rng, current, new Set([current.id]))!;
      return {
        seed,
        current,
        challenger,
        score: 0,
        status: 'guessing',
        completed: false,
        lastResult: null,
        guesses: [],
        used: [current.id, challenger.id],
        rngState: rng.state,
      };
    },

    guess(state, guess) {
      if (state.status !== 'guessing') return state;
      const currentValue = value(state.current);
      const challengerValue = value(state.challenger);
      const correct =
        challengerValue === currentValue ||
        (guess === 'higher' ? challengerValue > currentValue : challengerValue < currentValue);
      return {
        ...state,
        score: correct ? state.score + 1 : state.score,
        status: correct ? 'revealed' : 'over',
        lastResult: { guess, correct, currentValue, challengerValue },
        guesses: [...state.guesses, guess],
      };
    },

    next(state) {
      if (state.status !== 'revealed') return state;
      const rng = createRng(state.rngState);
      const current = state.challenger;
      const challenger = pickChallenger(rng, current, new Set(state.used));
      if (!challenger) return { ...state, status: 'over', completed: true };
      return {
        ...state,
        current,
        challenger,
        status: 'guessing',
        lastResult: null,
        used: [...state.used, challenger.id],
        rngState: rng.state,
      };
    },
  };
}

/**
 * Replays a sequence of guesses from a seed and returns the final state.
 * This is what a backend will use to verify a submitted score.
 */
export function replayHigherLower<T extends Comparable>(
  game: HigherLowerGame<T>,
  seed: number,
  guesses: readonly Guess[],
  observe?: (state: HigherLowerState<T>, move: Guess) => void,
): HigherLowerState<T> {
  let state = game.start(seed);
  for (const g of guesses) {
    if (state.status === 'over') break;
    state = game.next(game.guess(state, g));
    observe?.(state, g);
  }
  return state;
}
