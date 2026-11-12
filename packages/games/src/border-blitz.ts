import { countryProminence, type Country, type CountryId } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';
import { buildBorderGraph, routeScopes, type RouteScope } from './route.ts';

/**
 * Border Blitz: a country is lit up on a map without borders; name all of its
 * neighbours before the clock runs out. A run is up to 20 levels of more
 * neighbours, less familiar places and less time per neighbour; three wrong
 * answers on one level, or running out of time, ends it.
 *
 * Neighbours come from the same border graph as Border Route, so bridges and
 * tunnels (the Channel Tunnel, the Øresund Bridge) count. Only countries are
 * asked or answers, not territories: Hong Kong doesn't count as China's neighbour.
 *
 * The clock runs on the player's screen. When it runs out, the screen sends a
 * TIMEOUT move, so the score still follows from the moves alone and a server
 * can replay it.
 */

export interface BlitzLevelPlan {
  /** First level this plan applies to. */
  from: number;
  /** How many neighbours the country has. */
  neighbours: readonly [number, number];
  scope: RouteScope;
  /** Keeps out countries few players could place, 0..1 (see countryProminence). */
  minProminence: number;
  /** Seconds on the clock per neighbour, on top of BLITZ_BASE_SECONDS. */
  secondsEach: number;
}

export const BLITZ_LEVELS: readonly BlitzLevelPlan[] = [
  { from: 1, neighbours: [3, 5], scope: 'known', minProminence: 0.5, secondsEach: 8 },
  { from: 5, neighbours: [3, 6], scope: 'no-africa', minProminence: 0.35, secondsEach: 7 },
  { from: 9, neighbours: [4, 7], scope: 'any', minProminence: 0.25, secondsEach: 6 },
  { from: 13, neighbours: [5, 8], scope: 'any', minProminence: 0, secondsEach: 5 },
  { from: 17, neighbours: [7, Infinity], scope: 'any', minProminence: 0, secondsEach: 4.5 },
];

export const BLITZ_BASE_SECONDS = 10;
/** Seconds a wrong answer takes off the clock. The screen applies it; the score doesn't depend on it. */
export const BLITZ_WRONG_SECONDS = 2;
export const BLITZ_LIVES = 3;
/** Points per neighbour are this × the level number. */
export const BLITZ_POINTS_PER_LEVEL = 10;
/** A flawless level earns this share of its neighbour points again. */
export const BLITZ_FLAWLESS_SHARE = 0.5;
/** A new country may share at most this share of the smaller neighbour set with an earlier one. */
const MAX_SHARED = 0.5;
/** The move the screen sends when the clock runs out. */
export const BLITZ_TIMEOUT = 'timeout';

export const blitzPlan = (level: number): BlitzLevelPlan => [...BLITZ_LEVELS].reverse().find((p) => level >= p.from)!;

/** Seconds on the clock for a level whose country has `neighbours` neighbours. */
export const blitzSeconds = (level: number, neighbours: number) => BLITZ_BASE_SECONDS + Math.round(blitzPlan(level).secondsEach * neighbours);

/** The bonus for clearing a level without a wrong answer. */
export const blitzFlawlessBonus = (level: number, neighbours: number) =>
  Math.round(BLITZ_POINTS_PER_LEVEL * level * neighbours * BLITZ_FLAWLESS_SHARE);

export type BlitzGuessResult = 'found' | 'wrong' | 'repeat' | 'target' | 'unknown';

export interface BlitzState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: number;
  readonly target: CountryId;
  /** The target's neighbours, the answers. */
  readonly neighbours: readonly CountryId[];
  readonly found: readonly CountryId[];
  /** Wrong answers on this level; naming one again is free. */
  readonly wrong: readonly CountryId[];
  readonly score: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** Why the run ended early. */
  readonly ended: 'lives' | 'time' | null;
  /** True when the last level of the run was cleared. */
  readonly completed: boolean;
  /** Every country asked so far, so none comes back. */
  readonly past: readonly CountryId[];
  /** For each cleared level, whether it was flawless: for the shared result. */
  readonly cleared: readonly boolean[];
  /** Answers and timeouts in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export function createBorderBlitz({ countries, rounds }: { countries: readonly Country[]; rounds: number }) {
  // Border Route's graph (with its territories, so it is the very same graph), then only countries.
  const graph = buildBorderGraph(countries);
  const sovereign = countries.filter((c) => c.sovereignty !== 'territory');
  const isSovereign = new Set(sovereign.map((c) => c.id));
  const neighboursOf = (id: CountryId): CountryId[] => (graph.get(id) ?? []).filter((n) => isSovereign.has(n)).sort();
  // Countries without neighbours (islands) are never asked.
  const askable = sovereign.filter((c) => neighboursOf(c.id).length > 0);
  const { inScope, isRemote } = routeScopes(countries);
  const prominence = countryProminence(sovereign);

  const fits = (c: Country, plan: BlitzLevelPlan, scope: RouteScope) => {
    const n = neighboursOf(c.id);
    return (
      n.length >= plan.neighbours[0] &&
      n.length <= plan.neighbours[1] &&
      inScope(scope, c.id) &&
      (prominence.get(c.id) ?? 0) >= plan.minProminence &&
      // A familiar level shouldn't need the unfamiliar regions as answers either.
      (scope === 'any' || !n.some(isRemote))
    );
  };
  /** Too much like an earlier level: over half the smaller set of neighbours in common. */
  const overlaps = (a: CountryId, b: CountryId) => {
    const na = neighboursOf(a);
    const nb = new Set(neighboursOf(b));
    return na.filter((n) => nb.has(n)).length > MAX_SHARED * Math.min(na.length, nb.size);
  };

  function nextTarget(rng: Rng, level: number, past: readonly CountryId[]): CountryId {
    const plan = blitzPlan(level);
    const previous = past[past.length - 1];
    const fresh = askable.filter((c) => !past.includes(c.id) && !past.some((p) => overlaps(c.id, p)));
    // The plan first; if the run has used it up, its sizes anywhere, then anything fresh.
    for (const candidates of [
      fresh.filter((c) => fits(c, plan, plan.scope)),
      fresh.filter((c) => fits(c, { ...plan, minProminence: 0 }, 'any')),
      fresh,
      askable.filter((c) => !past.includes(c.id)),
    ]) {
      if (candidates.length === 0) continue;
      // Straight after a country, one of its neighbours would feel like the same level again.
      const apart = candidates.filter((c) => !previous || !neighboursOf(previous).includes(c.id));
      return pick(rng, (apart.length > 0 ? apart : candidates).map((c) => c.id));
    }
    throw new Error('no country left to ask');
  }

  const levelState = (state: BlitzState, rng: Rng, level: number): BlitzState => {
    const target = nextTarget(rng, level, state.past);
    return {
      ...state,
      rngState: rng.state,
      level,
      target,
      neighbours: neighboursOf(target),
      found: [],
      wrong: [],
      status: 'playing',
      past: [...state.past, target],
    };
  };

  return {
    graph,
    neighboursOf,
    askable: askable.map((c) => c.id),

    start(seed: number): BlitzState {
      const empty: BlitzState = {
        seed,
        rngState: 0,
        level: 0,
        target: '',
        neighbours: [],
        found: [],
        wrong: [],
        score: 0,
        status: 'playing',
        ended: null,
        completed: false,
        past: [],
        cleared: [],
        moves: [],
      };
      return levelState(empty, createRng(seed), 1);
    },

    /** Wrong answers cost a life; repeats, the country itself and unknown names are free. */
    guess(state: BlitzState, id: CountryId): { state: BlitzState; result: BlitzGuessResult } {
      if (state.status !== 'playing' || !isSovereign.has(id)) return { state, result: 'unknown' };
      if (id === state.target) return { state, result: 'target' };
      if (state.found.includes(id) || state.wrong.includes(id)) return { state, result: 'repeat' };
      const moves = [...state.moves, id];
      if (!state.neighbours.includes(id)) {
        const wrong = [...state.wrong, id];
        const out = wrong.length >= BLITZ_LIVES;
        return { result: 'wrong', state: { ...state, wrong, moves, status: out ? 'over' : 'playing', ended: out ? 'lives' : null } };
      }
      const found = [...state.found, id];
      const clear = found.length === state.neighbours.length;
      const flawless = clear && state.wrong.length === 0;
      const points =
        BLITZ_POINTS_PER_LEVEL * state.level + (flawless ? blitzFlawlessBonus(state.level, state.neighbours.length) : 0);
      const last = clear && state.level >= rounds;
      return {
        result: 'found',
        state: {
          ...state,
          found,
          moves,
          score: state.score + points,
          status: last ? 'over' : clear ? 'level-clear' : 'playing',
          completed: last,
          cleared: clear ? [...state.cleared, flawless] : state.cleared,
        },
      };
    },

    /** The clock ran out: the run ends, keeping the points so far. */
    timeout(state: BlitzState): BlitzState {
      if (state.status !== 'playing') return state;
      return { ...state, moves: [...state.moves, BLITZ_TIMEOUT], status: 'over', ended: 'time' };
    },

    nextLevel(state: BlitzState): BlitzState {
      if (state.status !== 'level-clear') return state;
      return levelState(state, createRng(state.rngState), state.level + 1);
    },
  };
}

export type BorderBlitz = ReturnType<typeof createBorderBlitz>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayBorderBlitz(game: BorderBlitz, seed: number, moves: readonly string[]): BlitzState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === BLITZ_TIMEOUT ? game.timeout(state) : game.guess(state, move).state;
  }
  return state;
}
