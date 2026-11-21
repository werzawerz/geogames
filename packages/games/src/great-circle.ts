import type { Country, CountryId, GreatCirclePuzzle } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';
import { routeScopes, type RouteScope } from './route.ts';

/**
 * Great Circle: a straight line runs between two cities; name every country it
 * crosses on the way. A run is up to 20 levels of longer lines through less
 * familiar places, on a shared stock of lives. The lines and what they cross are
 * computed at build time (scripts/build-great-circles.ts).
 */

export interface GreatCircleLevelPlan {
  /** First level this plan applies to. */
  from: number;
  /** Countries to name. */
  between: readonly [number, number];
  scope: RouteScope;
  /** Both ends must be cities most players could place. */
  easyEnds: boolean;
}

export const GREAT_CIRCLE_LEVELS: readonly GreatCircleLevelPlan[] = [
  { from: 1, between: [1, 2], scope: 'known', easyEnds: true },
  { from: 5, between: [2, 3], scope: 'no-africa', easyEnds: true },
  { from: 9, between: [2, 4], scope: 'any', easyEnds: false },
  { from: 13, between: [3, 5], scope: 'any', easyEnds: false },
  { from: 17, between: [4, 7], scope: 'any', easyEnds: false },
];

export const GC_START_LIVES = 5;
export const GC_MAX_LIVES = 9;
/** Points per country are this × the level number. */
export const GC_POINTS_PER_LEVEL = 10;
/** A new line may share at most this share of the shorter line's countries with an earlier one. */
const MAX_SHARED_VIA = 0.5;

export const greatCirclePlan = (level: number): GreatCircleLevelPlan =>
  [...GREAT_CIRCLE_LEVELS].reverse().find((p) => level >= p.from)!;

export type GreatCircleGuessResult = 'found' | 'wrong' | 'repeat' | 'endpoint' | 'unknown';

export interface GreatCircleState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: number;
  readonly puzzle: GreatCirclePuzzle;
  readonly found: readonly CountryId[];
  /** Countries given away by a skip: no points. */
  readonly skipped: readonly CountryId[];
  /** Wrong answers on this line; naming one again is free. */
  readonly wrong: readonly CountryId[];
  readonly lives: number;
  readonly score: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** True when the last level had no wrong answers or skips, and earned a life. */
  readonly bonusLife: boolean;
  /** True when the last level of the run was cleared. */
  readonly completed: boolean;
  /** Every line so far, so new ones don't repeat them. */
  readonly past: readonly GreatCirclePuzzle[];
  /** Guesses and ">" (skip) in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

const SKIP = '>';

export function createGreatCircle({
  puzzles,
  countries,
  rounds,
}: {
  puzzles: readonly GreatCirclePuzzle[];
  countries: readonly Country[];
  rounds: number;
}) {
  const known = new Set(countries.map((c) => c.id));
  const { inScope } = routeScopes(countries);

  const fits = (p: GreatCirclePuzzle, plan: GreatCircleLevelPlan) =>
    p.via.length >= plan.between[0] &&
    p.via.length <= plan.between[1] &&
    (!plan.easyEnds || p.easy) &&
    [p.from.countryId, p.to.countryId, ...p.via].every((id) => inScope(plan.scope, id));

  const tooSimilar = (p: GreatCirclePuzzle, past: readonly GreatCirclePuzzle[]) =>
    past.some((q) => {
      if ([q.from.id, q.to.id].includes(p.from.id) || [q.from.id, q.to.id].includes(p.to.id)) return true;
      const shared = p.via.filter((id) => q.via.includes(id)).length;
      return shared > Math.floor(MAX_SHARED_VIA * Math.min(p.via.length, q.via.length));
    });

  function nextPuzzle(rng: Rng, level: number, past: readonly GreatCirclePuzzle[]): GreatCirclePuzzle {
    const plan = greatCirclePlan(level);
    // The plan and nothing similar to earlier lines first; a long run may have to give a little.
    const candidates =
      [
        puzzles.filter((p) => fits(p, plan) && !tooSimilar(p, past)),
        puzzles.filter((p) => p.via.length >= plan.between[0] && p.via.length <= plan.between[1] && !tooSimilar(p, past)),
        puzzles.filter((p) => fits(p, plan) && !past.includes(p)),
      ].find((list) => list.length > 0) ?? puzzles;
    return pick(rng, candidates);
  }

  const remaining = (state: Pick<GreatCircleState, 'puzzle' | 'found' | 'skipped'>) =>
    state.puzzle.via.filter((id) => !state.found.includes(id) && !state.skipped.includes(id));

  /** Applies a move: clears the level when nothing's left, ends the run when lives or levels are. */
  function settle(state: GreatCircleState, changes: Partial<GreatCircleState>): GreatCircleState {
    const next = { ...state, ...changes };
    if (next.lives <= 0) return { ...next, lives: 0, status: 'over' };
    if (remaining(next).length > 0) return next;
    const perfect = next.wrong.length === 0 && next.skipped.length === 0;
    const lives = perfect ? Math.min(GC_MAX_LIVES, next.lives + 1) : next.lives;
    const last = next.level >= rounds;
    return { ...next, lives, bonusLife: perfect, status: last ? 'over' : 'level-clear', completed: last };
  }

  return {
    remaining,

    start(seed: number): GreatCircleState {
      const rng = createRng(seed);
      const puzzle = nextPuzzle(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level: 1,
        puzzle,
        found: [],
        skipped: [],
        wrong: [],
        lives: GC_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        completed: false,
        past: [puzzle],
        moves: [],
      };
    },

    guess(state: GreatCircleState, id: CountryId): { state: GreatCircleState; result: GreatCircleGuessResult } {
      if (state.status !== 'playing' || !known.has(id)) return { state, result: 'unknown' };
      if (id === state.puzzle.from.countryId || id === state.puzzle.to.countryId) return { state, result: 'endpoint' };
      if (state.found.includes(id) || state.skipped.includes(id) || state.wrong.includes(id)) return { state, result: 'repeat' };
      const moves = [...state.moves, id];
      if (state.puzzle.via.includes(id)) {
        const score = state.score + GC_POINTS_PER_LEVEL * state.level;
        return { result: 'found', state: settle(state, { found: [...state.found, id], score, moves }) };
      }
      return { result: 'wrong', state: settle(state, { wrong: [...state.wrong, id], lives: state.lives - 1, moves }) };
    },

    /** Gives away the next country along the line for a life; it scores nothing. */
    skip(state: GreatCircleState): GreatCircleState {
      const [next] = remaining(state);
      if (state.status !== 'playing' || !next) return state;
      return settle(state, { skipped: [...state.skipped, next], lives: state.lives - 1, moves: [...state.moves, SKIP] });
    },

    nextLevel(state: GreatCircleState): GreatCircleState {
      if (state.status !== 'level-clear') return state;
      const rng = createRng(state.rngState);
      const level = state.level + 1;
      const puzzle = nextPuzzle(rng, level, state.past);
      return {
        ...state,
        rngState: rng.state,
        level,
        puzzle,
        found: [],
        skipped: [],
        wrong: [],
        status: 'playing',
        bonusLife: false,
        past: [...state.past, puzzle],
      };
    },
  };
}

export type GreatCircle = ReturnType<typeof createGreatCircle>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayGreatCircle(game: GreatCircle, seed: number, moves: readonly string[], observe?: (state: GreatCircleState, move: string) => void): GreatCircleState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === SKIP ? game.skip(state) : game.guess(state, move).state;
    observe?.(state, move);
  }
  return state;
}
