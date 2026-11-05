import { countryProminence, type Country, type CountryId } from '@geogames/geodata';
import { distanceKm } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';
import { buildBorderGraph, routeScopes, type RouteScope } from './route.ts';

/**
 * Mystery Country: work out a hidden country from what each guess gives away.
 * A run is up to 20 levels of less familiar countries and fewer guesses, and
 * running out of guesses on one ends it.
 *
 * The engine only decides right or wrong, which is all a score depends on. The
 * clues come from `compareCountries`, which only the player's screen calls: a
 * server replaying a game doesn't need the countries' positions.
 */

export interface MysteryLevelPlan {
  /** First level this plan applies to. */
  from: number;
  guesses: number;
  scope: RouteScope;
  /** Keeps out countries few players could tell apart, 0..1 (see countryProminence). */
  minProminence: number;
}

export const MYSTERY_LEVELS: readonly MysteryLevelPlan[] = [
  { from: 1, guesses: 6, scope: 'known', minProminence: 0.5 },
  { from: 6, guesses: 6, scope: 'no-africa', minProminence: 0.35 },
  { from: 11, guesses: 5, scope: 'any', minProminence: 0.25 },
  { from: 16, guesses: 4, scope: 'any', minProminence: 0 },
];

export const MYSTERY_POINTS_PER_LEVEL = 10;

export const mysteryPlan = (level: number): MysteryLevelPlan => [...MYSTERY_LEVELS].reverse().find((p) => level >= p.from)!;

export type MysteryGuessResult = 'correct' | 'wrong' | 'repeat' | 'unknown';

export interface MysteryState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: number;
  readonly target: CountryId;
  /** This level's guesses, oldest first. */
  readonly guesses: readonly CountryId[];
  readonly score: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** True when the last level of the run was solved. */
  readonly completed: boolean;
  /** Every mystery country so far, so none comes back. */
  readonly past: readonly CountryId[];
  /** Guesses each solved level took, for the shared result. */
  readonly solvedIn: readonly number[];
  /** Guesses in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export function createMysteryCountry({ countries, rounds }: { countries: readonly Country[]; rounds: number }) {
  const known = new Set(countries.map((c) => c.id));
  const byId = new Map(countries.map((c) => [c.id, c]));
  const { inScope } = routeScopes(countries);
  const prominence = countryProminence(countries);

  const fits = (c: Country, plan: MysteryLevelPlan) => inScope(plan.scope, c.id) && (prominence.get(c.id) ?? 0) >= plan.minProminence;

  function nextTarget(rng: Rng, level: number, past: readonly CountryId[]): CountryId {
    const plan = mysteryPlan(level);
    const previous = byId.get(past[past.length - 1] ?? '');
    const fresh = countries.filter((c) => fits(c, plan) && !past.includes(c.id));
    // Two in a row from one part of the world would make the second too easy to place.
    const varied = fresh.filter((c) => c.subregion !== previous?.subregion);
    return pick(rng, (varied.length > 0 ? varied : fresh.length > 0 ? fresh : countries).map((c) => c.id));
  }

  return {
    start(seed: number): MysteryState {
      const rng = createRng(seed);
      const target = nextTarget(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level: 1,
        target,
        guesses: [],
        score: 0,
        status: 'playing',
        completed: false,
        past: [target],
        solvedIn: [],
        moves: [],
      };
    },

    guess(state: MysteryState, id: CountryId): { state: MysteryState; result: MysteryGuessResult } {
      if (state.status !== 'playing' || !known.has(id)) return { state, result: 'unknown' };
      if (state.guesses.includes(id)) return { state, result: 'repeat' };
      const guesses = [...state.guesses, id];
      const moves = [...state.moves, id];
      const allowed = mysteryPlan(state.level).guesses;
      if (id === state.target) {
        const left = allowed - state.guesses.length;
        const last = state.level >= rounds;
        return {
          result: 'correct',
          state: {
            ...state,
            guesses,
            moves,
            score: state.score + MYSTERY_POINTS_PER_LEVEL * state.level * left,
            solvedIn: [...state.solvedIn, guesses.length],
            status: last ? 'over' : 'level-clear',
            completed: last,
          },
        };
      }
      return { result: 'wrong', state: { ...state, guesses, moves, status: guesses.length >= allowed ? 'over' : 'playing' } };
    },

    nextLevel(state: MysteryState): MysteryState {
      if (state.status !== 'level-clear') return state;
      const rng = createRng(state.rngState);
      const level = state.level + 1;
      const target = nextTarget(rng, level, state.past);
      return { ...state, rngState: rng.state, level, target, guesses: [], status: 'playing', past: [...state.past, target] };
    },
  };
}

export type MysteryCountry = ReturnType<typeof createMysteryCountry>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayMysteryCountry(game: MysteryCountry, seed: number, moves: readonly string[]): MysteryState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = game.guess(state, move).state;
  }
  return state;
}

/** How the mystery country compares: "much-more" means over 3 times as much, "same" within 10%. */
export type Comparison = 'much-more' | 'more' | 'same' | 'less' | 'much-less';

function compareMetric(target: number, guess: number): Comparison {
  const ratio = target / guess;
  if (ratio > 3) return 'much-more';
  if (ratio > 1.1) return 'more';
  if (ratio >= 1 / 1.1) return 'same';
  return ratio >= 1 / 3 ? 'less' : 'much-less';
}

export type Compass = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
const COMPASS: readonly Compass[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Which way to set off from one point on the globe to go straight to another. */
export function compassBetween([lat1, lng1]: readonly [number, number], [lat2, lng2]: readonly [number, number]): Compass {
  const rad = (d: number) => (d * Math.PI) / 180;
  const Δλ = rad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(Δλ);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8]!;
}

export interface CountryClue {
  /** Centre to centre. */
  km: number;
  /** From the guess towards the mystery country. */
  compass: Compass;
  neighbour: boolean;
  sameContinent: boolean;
  /** The mystery country compared to the guess. */
  population: Comparison;
  area: Comparison;
}

/** What a wrong guess reveals about the mystery country. */
export function createCountryClues(countries: readonly Country[]) {
  const graph = buildBorderGraph(countries);
  return (target: Country, guess: Country): CountryClue => ({
    km: distanceKm(guess.latlng, target.latlng),
    compass: compassBetween(guess.latlng, target.latlng),
    neighbour: graph.get(guess.id)?.includes(target.id) ?? false,
    sameContinent: guess.continent === target.continent,
    population: compareMetric(target.metrics.population!.value, guess.metrics.population!.value),
    area: compareMetric(target.metrics.area!.value, guess.metrics.area!.value),
  });
}

/** Clues about the country itself, each unlocked after this many wrong guesses. */
export const mysteryExtraClues = (level: number) => {
  const { guesses } = mysteryPlan(level);
  return { coast: 2, subregion: 3, capital: guesses - 1 };
};
