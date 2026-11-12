import type { CityId, Country } from '@geogames/geodata';
import { distanceKm, type CircleCity } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';
import { routeScopes, type RouteScope } from './route.ts';

/**
 * Halfway: two cities are shown, and you name a real city near the midpoint
 * of the great circle between them. A guess inside the level's radius clears
 * it; one outside costs a life. A run is up to 20 levels, with smaller radii
 * and less familiar cities, and ends when the lives are gone.
 *
 * Every level is checked for fairness when it's made: at least
 * HALFWAY_FAIR_CITIES well-known cities lie inside its radius, so no midpoint
 * falls in the sea, a desert or the Arctic with nothing to name.
 */

export interface HalfwayPlan {
  /** First level this plan applies to. */
  from: number;
  /** A guess this close to the midpoint clears the level. */
  radiusKm: number;
  /** How far apart the two cities are. */
  separationKm: readonly [number, number];
  /** Where the two cities may be (see routeScopes). */
  scope: RouteScope;
  /** Both cities on the same continent. */
  sameContinent: boolean;
  /** The two cities: well-known ones always, others from this size. */
  endMinPopulation: number;
  /** Cities that count towards a fair level: well-known ones, and others from this size. */
  answerMinPopulation: number;
  /** Chinese and Indian cities, as an end or a fair answer, only from this size. */
  crowdedCountryMinPopulation: number;
  /** The great circle between them is drawn. */
  showLine: boolean;
  /** The two cities' names are shown, not only their dots. */
  showNames: boolean;
}

export const HALFWAY_PLANS: readonly HalfwayPlan[] = [
  { from: 1, radiusKm: 300, separationKm: [700, 3000], scope: 'known', sameContinent: true, endMinPopulation: Infinity, answerMinPopulation: 3_000_000, crowdedCountryMinPopulation: 20_000_000, showLine: true, showNames: true },
  { from: 6, radiusKm: 250, separationKm: [900, 4000], scope: 'no-africa', sameContinent: false, endMinPopulation: 3_000_000, answerMinPopulation: 1_000_000, crowdedCountryMinPopulation: 10_000_000, showLine: true, showNames: true },
  { from: 11, radiusKm: 200, separationKm: [800, 6000], scope: 'any', sameContinent: false, endMinPopulation: 1_000_000, answerMinPopulation: 500_000, crowdedCountryMinPopulation: 3_000_000, showLine: false, showNames: true },
  { from: 16, radiusKm: 120, separationKm: [600, 6000], scope: 'any', sameContinent: false, endMinPopulation: 1_000_000, answerMinPopulation: 300_000, crowdedCountryMinPopulation: 1_000_000, showLine: false, showNames: false },
];

export const HALFWAY_LEVELS = 20;
/** Well-known cities that must lie inside a level's radius. */
export const HALFWAY_FAIR_CITIES = 3;
export const HALFWAY_START_LIVES = 3;
export const HALFWAY_MAX_LIVES = 5;
/** Points for a level are up to this × its number, by how close the guess was. */
export const HALFWAY_POINTS_PER_LEVEL = 10;
/** A first guess within this share of the radius is flawless: half as many points again, and a life back. */
export const HALFWAY_FLAWLESS_SHARE = 1 / 3;

/** New midpoints stay this far from the last few, so a run moves around the world. */
const MIN_SEPARATION_KM = 800;
const SEPARATION_MEMORY = 4;
/** At most this share of a level's fair cities may be fair cities of an earlier level (of the smaller set). */
const MAX_SHARED = 0.5;

/** Too many big cities in too small a part of most players' mental map (as in Pin Drop). */
const CROWDED_COUNTRIES: ReadonlySet<string> = new Set(['CHN', 'IND']);

export const halfwayPlan = (level: number): HalfwayPlan => [...HALFWAY_PLANS].reverse().find((p) => level >= p.from)!;

const KM_PER_DEGREE_LAT = 111.19;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point halfway along the great circle between two [lat, lng] points. */
export function midpoint(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const toVector = ([lat, lng]: readonly [number, number]) => [
    Math.cos(rad(lat)) * Math.cos(rad(lng)),
    Math.cos(rad(lat)) * Math.sin(rad(lng)),
    Math.sin(rad(lat)),
  ];
  const [x, y, z] = toVector(a).map((v, i) => v + toVector(b)[i]!) as [number, number, number];
  return [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
}

export interface HalfwayGuess {
  id: CityId;
  km: number;
}

export interface HalfwayLevel {
  number: number;
  from: CityId;
  to: CityId;
  /** [lat, lng] */
  midpoint: readonly [number, number];
  radiusKm: number;
  /** Well-known cities inside the radius, nearest first: what a player could have said. */
  fair: readonly CityId[];
  guesses: readonly HalfwayGuess[];
  points: number;
  flawless: boolean;
  status: 'playing' | 'cleared' | 'lost';
}

export type HalfwayGuessResult = 'inside' | 'outside' | 'repeat' | 'end' | 'unknown';

/** One mark per level for a spoiler-free result. */
export type HalfwayMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface HalfwayState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: HalfwayLevel;
  readonly lives: number;
  readonly score: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** True when every level of the run was cleared. */
  readonly completed: boolean;
  /** True when the level just cleared gave a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly HalfwayMark[];
  /** Earlier levels, for keeping new ones different. */
  readonly past: readonly Pick<HalfwayLevel, 'from' | 'to' | 'midpoint' | 'fair'>[];
  /** City ids guessed; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export interface HalfwayOptions {
  cities: readonly CircleCity[];
  /** Well-known cities (the world's most visited). */
  famous: ReadonlySet<CityId>;
  countries: readonly Country[];
  rounds?: number;
}

export function createHalfway({ cities, famous, countries, rounds = HALFWAY_LEVELS }: HalfwayOptions) {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const continent = new Map(countries.map((c) => [c.id, c.continent]));
  const { inScope } = routeScopes(countries);

  const sizeable = (c: CircleCity, minPopulation: number, plan: HalfwayPlan) =>
    CROWDED_COUNTRIES.has(c.countryId) ? c.population >= plan.crowdedCountryMinPopulation : famous.has(c.id) || c.population >= minPopulation;
  const isEnd = (c: CircleCity, plan: HalfwayPlan) => sizeable(c, plan.endMinPopulation, plan) && inScope(plan.scope, c.countryId);
  const isFair = (c: CircleCity, plan: HalfwayPlan) => sizeable(c, plan.answerMinPopulation, plan);

  /** Country first, then a city in it, so countries with many big cities don't take over. */
  const pickCity = (rng: Rng, from: readonly CircleCity[]) => {
    const countryId = pick(rng, [...new Set(from.map((c) => c.countryId))]);
    return pick(rng, from.filter((c) => c.countryId === countryId));
  };

  /** Each plan's fair cities, sorted by latitude so the ones near a midpoint are found quickly. */
  const fairPools = new Map<HalfwayPlan, CircleCity[]>();
  const fairPool = (plan: HalfwayPlan) => {
    let pool = fairPools.get(plan);
    if (!pool) fairPools.set(plan, (pool = cities.filter((c) => isFair(c, plan)).sort((a, b) => a.latlng[0] - b.latlng[0])));
    return pool;
  };

  /** Fair cities within the plan's radius of `middle`, nearest first. */
  function fairNear(plan: HalfwayPlan, middle: readonly [number, number]): CityId[] {
    const pool = fairPool(plan);
    const south = middle[0] - plan.radiusKm / KM_PER_DEGREE_LAT;
    let lo = 0;
    for (let hi = pool.length; lo < hi; ) {
      const mid = (lo + hi) >> 1;
      if (pool[mid]!.latlng[0] < south) lo = mid + 1;
      else hi = mid;
    }
    const north = middle[0] + plan.radiusKm / KM_PER_DEGREE_LAT;
    const near: { id: CityId; km: number }[] = [];
    for (let i = lo; i < pool.length && pool[i]!.latlng[0] <= north; i++) {
      const km = distanceKm(pool[i]!.latlng, middle);
      if (km <= plan.radiusKm) near.push({ id: pool[i]!.id, km });
    }
    return near.sort((x, y) => x.km - y.km).map((c) => c.id);
  }

  function makeLevel(rng: Rng, number: number, past: HalfwayState['past']): HalfwayLevel {
    const plan = halfwayPlan(number);
    const used = new Set(past.flatMap((p) => [p.from, p.to]));
    const ends = cities.filter((c) => !used.has(c.id) && isEnd(c, plan));
    const recent = past.slice(-SEPARATION_MEMORY);
    const [minKm, maxKm] = plan.separationKm;
    // Each city gets one try as the first end per pass. The first pass keeps midpoints apart and answers
    // fresh; the second lets a midpoint come near a recent one; the last, never needed in testing, allows anything.
    for (const pass of [2, 1, 0]) {
      let untried = ends;
      while (untried.length > 0) {
        const a = pickCity(rng, untried);
        untried = untried.filter((c) => c !== a);
        const options = new Map<CityId, { middle: [number, number]; fair: CityId[] }>();
        for (const b of ends) {
          if (b === a || (plan.sameContinent && continent.get(b.countryId) !== continent.get(a.countryId))) continue;
          const km = distanceKm(a.latlng, b.latlng);
          if (km < minKm || km > maxKm) continue;
          const middle = midpoint(a.latlng, b.latlng);
          if (pass >= 2 && recent.some((p) => distanceKm(p.midpoint, middle) < MIN_SEPARATION_KM)) continue;
          const fair = fairNear(plan, middle);
          if (fair.length < HALFWAY_FAIR_CITIES) continue;
          if (pass >= 1 && past.some((p) => sharesTooMany(fair, p.fair))) continue;
          options.set(b.id, { middle, fair });
        }
        if (options.size === 0) continue;
        const b = pickCity(rng, ends.filter((c) => options.has(c.id)));
        const { middle, fair } = options.get(b.id)!;
        return { number, from: a.id, to: b.id, midpoint: middle, radiusKm: plan.radiusKm, fair, guesses: [], points: 0, flawless: false, status: 'playing' };
      }
    }
    throw new Error(`no Halfway level ${number}`);
  }

  /** Points for clearing a level with a guess `km` from the midpoint: half to all of the level's worth, closer earning more. */
  const levelPoints = (level: HalfwayLevel, km: number, flawless: boolean) => {
    const base = HALFWAY_POINTS_PER_LEVEL * level.number * (1 - (0.5 * km) / level.radiusKm);
    return Math.round(base * (flawless ? 1.5 : 1));
  };

  return {
    cities: byId,
    rounds,

    start(seed: number): HalfwayState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: HALFWAY_START_LIVES,
        score: 0,
        status: 'playing',
        completed: false,
        bonusLife: false,
        marks: [],
        past: [level],
        moves: [],
      };
    },

    guess(state: HalfwayState, id: CityId): { state: HalfwayState; result: HalfwayGuessResult } {
      const { level } = state;
      const city = byId.get(id);
      if (state.status !== 'playing' || !city) return { state, result: 'unknown' };
      // Naming one of the two cities isn't a guess: it can never be halfway.
      if (id === level.from || id === level.to) return { state, result: 'end' };
      if (level.guesses.some((g) => g.id === id)) return { state, result: 'repeat' };
      const km = distanceKm(city.latlng, level.midpoint);
      const guesses = [...level.guesses, { id, km }];
      const moves = [...state.moves, id];
      if (km > level.radiusKm) {
        const lives = state.lives - 1;
        if (lives > 0) return { result: 'outside', state: { ...state, lives, level: { ...level, guesses }, moves } };
        const lost = { ...level, guesses, status: 'lost' as const };
        return { result: 'outside', state: { ...state, lives: 0, level: lost, status: 'over', marks: [...state.marks, 'lost'], moves } };
      }
      const flawless = guesses.length === 1 && km <= level.radiusKm * HALFWAY_FLAWLESS_SHARE;
      const points = levelPoints(level, km, flawless);
      const lives = flawless ? Math.min(HALFWAY_MAX_LIVES, state.lives + 1) : state.lives;
      const cleared: HalfwayLevel = { ...level, guesses, points, flawless, status: 'cleared' };
      const last = level.number >= rounds;
      return {
        result: 'inside',
        state: {
          ...state,
          level: cleared,
          lives,
          bonusLife: lives > state.lives,
          score: state.score + points,
          status: last ? 'over' : 'level-clear',
          completed: last,
          marks: [...state.marks, flawless ? 'flawless' : guesses.length === 1 ? 'cleared' : 'missed'],
          moves,
        },
      };
    },

    /** Starts the next level after a cleared one. */
    nextLevel(state: HalfwayState): HalfwayState {
      if (state.status !== 'level-clear') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, level] };
    },
  };
}

/** Whether two levels' fair cities overlap too much, counted against the smaller set. */
const sharesTooMany = (a: readonly CityId[], b: readonly CityId[]) =>
  a.filter((id) => b.includes(id)).length > Math.floor(MAX_SHARED * Math.min(a.length, b.length));

export type Halfway = ReturnType<typeof createHalfway>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayHalfway(game: Halfway, seed: number, moves: readonly string[]): HalfwayState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = game.guess(state, move).state;
  }
  return state;
}
