import type { CityId, Continent, Country } from '@geogames/geodata';
import { distanceKm, type CircleCity } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';
import { routeScopes, type RouteScope } from './route.ts';

/**
 * Halfway: two cities are shown, and you name a real city near the midpoint
 * of the great circle between them. A guess inside the level's radius clears
 * it. Two wrong guesses are free; the third, or a skip, costs a life and ends
 * the level. The run has no end but the lives: the radii shrink and the cities
 * get less familiar up to level 16, and the hardest band holds from there.
 *
 * Every level is checked for fairness when it's made: enough well-known
 * cities (famous, or 1M+) lie inside its radius, so no midpoint falls in the
 * sea, a desert or the Arctic with nothing most players could name. Any city
 * in the game may be typed, though, and counts by its distance.
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
  /** The two cities: famous ones always, others from this size. */
  endMinPopulation: number;
  /** Chinese and Indian cities, as an end or a well-known city, only from this size. */
  crowdedCountryMinPopulation: number;
  /** Well-known cities that must lie inside the radius. */
  minKnown: number;
  /** Of those, how many must be famous. */
  minFamous: number;
  /**
   * Only cities players have heard of as ends: famous ones from FAMOUS_END_MIN_POPULATION,
   * and never a satellite of a better-known city (Depok next to Jakarta).
   */
  wellKnownEnds: boolean;
  /** The great circle between them is drawn. */
  showLine: boolean;
  /** The two cities' names are shown, not only their dots. */
  showNames: boolean;
}

export const HALFWAY_PLANS: readonly HalfwayPlan[] = [
  { from: 1, radiusKm: 300, separationKm: [700, 3000], scope: 'known', sameContinent: true, endMinPopulation: Infinity, crowdedCountryMinPopulation: 20_000_000, minKnown: 3, minFamous: 1, wellKnownEnds: true, showLine: true, showNames: true },
  { from: 6, radiusKm: 250, separationKm: [900, 4000], scope: 'no-africa', sameContinent: false, endMinPopulation: 3_000_000, crowdedCountryMinPopulation: 10_000_000, minKnown: 3, minFamous: 1, wellKnownEnds: true, showLine: true, showNames: true },
  { from: 11, radiusKm: 200, separationKm: [800, 6000], scope: 'any', sameContinent: false, endMinPopulation: 1_000_000, crowdedCountryMinPopulation: 3_000_000, minKnown: 3, minFamous: 0, wellKnownEnds: false, showLine: false, showNames: true },
  { from: 16, radiusKm: 120, separationKm: [600, 6000], scope: 'any', sameContinent: false, endMinPopulation: 1_000_000, crowdedCountryMinPopulation: 2_000_000, minKnown: 2, minFamous: 0, wellKnownEnds: false, showLine: false, showNames: false },
];

/** Wrong guesses in a level; the last of them costs a life and ends it. */
export const HALFWAY_MISSES = 3;
const SKIP = '>';
/** Cities this big (or famous) count as well known; smaller ones can still be typed. */
export const HALFWAY_KNOWN_POPULATION = 1_000_000;
export const HALFWAY_START_LIVES = 3;
/** A flawless level gives a life back, but never above the start: the run should stay at risk. */
export const HALFWAY_MAX_LIVES = 3;
/** Famous but this small (Hạ Long, Bodrum) is too obscure for a well-known end. */
export const FAMOUS_END_MIN_POPULATION = 250_000;
/** A city this close to a better-known one is its satellite. */
export const SATELLITE_KM = 50;
/** At most this many midpoints per run in one subregion (East Asia, Western Europe…), never two in a row. */
export const HALFWAY_SUBREGION_MAX = 4;
/** …counted over this many levels in a row, so an endless run keeps moving. */
export const HALFWAY_SUBREGION_WINDOW = 20;
/** East and Southeast Asia have so many big cities that, counted apart, they still fill a run between them. */
const spreadGroup = (subregion: string) => (subregion === 'Eastern Asia' || subregion === 'South-Eastern Asia' ? 'East and Southeast Asia' : subregion);
/** Points for a level are up to this × its number, by how close the guess was. */
export const HALFWAY_POINTS_PER_LEVEL = 10;
/** A first guess within this share of the radius is flawless: half as many points again, and a life back. */
export const HALFWAY_FLAWLESS_SHARE = 1 / 3;
/** At most one African midpoint in this many levels in a row: Africa has many countries but few cities most players know. */
export const HALFWAY_AFRICA_SPACING = 3;

/** New midpoints stay this far from the last few, so a run moves around the world. */
const MIN_SEPARATION_KM = 800;
const SEPARATION_MEMORY = 4;
/** At most this share of a level's fair cities may be fair cities of an earlier level (of the smaller set). */
const MAX_SHARED = 0.5;

/** Too many big cities in too small a part of most players' mental map (as in Pin Drop). */
const CROWDED_COUNTRIES: ReadonlySet<string> = new Set(['CHN', 'IND']);

export const halfwayPlan = (level: number): HalfwayPlan => [...HALFWAY_PLANS].reverse().find((p) => level >= p.from)!;

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

type Vector = readonly [number, number, number];
const toVector = ([lat, lng]: readonly [number, number]): Vector => [
  Math.cos(rad(lat)) * Math.cos(rad(lng)),
  Math.cos(rad(lat)) * Math.sin(rad(lng)),
  Math.sin(rad(lat)),
];
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Index of the first item whose z is at least `z`, in a list sorted by z. */
function firstAbove(items: readonly { v: Vector }[], z: number): number {
  let lo = 0;
  for (let hi = items.length; lo < hi; ) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.v[2] < z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The point halfway along the great circle between two [lat, lng] points. */
export function midpoint(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const [va, vb] = [toVector(a), toVector(b)];
  const [x, y, z] = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
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
  /** Continent of the well-known city nearest the midpoint. */
  region: Continent;
  /** Subregion of the same city (its continent where there's none). */
  subregion: string;
  guesses: readonly HalfwayGuess[];
  points: number;
  flawless: boolean;
  status: 'playing' | 'cleared' | 'lost';
}

export type HalfwayGuessResult = 'inside' | 'outside' | 'repeat' | 'end' | 'unknown';

/** One mark per level for a spoiler-free result; 'lost' is a level that cost a life. */
export type HalfwayMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface HalfwayState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: HalfwayLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done (cleared or not) and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just cleared gave a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly HalfwayMark[];
  /** Earlier levels, for keeping new ones different. */
  readonly past: readonly Pick<HalfwayLevel, 'from' | 'to' | 'midpoint' | 'fair' | 'region' | 'subregion'>[];
  /** City ids guessed; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export interface HalfwayOptions {
  cities: readonly CircleCity[];
  /** Well-known cities (the world's most visited). */
  famous: ReadonlySet<CityId>;
  /** Rank of each famous city by visitors, 1 = most visited: tells a city from its satellites. */
  tourismRank?: Readonly<Record<CityId, number>>;
  /** Every country and territory, so cities in Hong Kong or Puerto Rico have a continent. */
  countries: readonly Country[];
}

/** A pair of end cities that makes a fair level for a plan. */
interface Pair {
  a: CircleCity;
  b: CircleCity;
  middle: [number, number];
  fair: CityId[];
  region: Continent;
  subregion: string;
}

export function createHalfway({ cities, famous, tourismRank = {}, countries }: HalfwayOptions) {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const countryById = new Map(countries.map((c) => [c.id, c]));
  const continentOf = (c: CircleCity) => countryById.get(c.countryId)?.continent;
  const { inScope, isRemote } = routeScopes(countries);
  // Territories have no prominence of their own: Hong Kong counts as well known, San Juan (Caribbean) doesn't.
  const endInScope = (scope: RouteScope, c: CircleCity) =>
    countryById.get(c.countryId)?.sovereignty === 'territory' ? scope === 'any' || !isRemote(c.countryId) : inScope(scope, c.countryId);

  const sizeable = (c: CircleCity, minPopulation: number, plan: HalfwayPlan) =>
    CROWDED_COUNTRIES.has(c.countryId) ? c.population >= plan.crowdedCountryMinPopulation : famous.has(c.id) || c.population >= minPopulation;
  const rankOf = (c: CircleCity) => (famous.has(c.id) ? (tourismRank[c.id] ?? 1e9) : Infinity);
  const famousCities = cities.filter((c) => famous.has(c.id));
  const satellites = new Set(
    cities
      .filter((c) => famousCities.some((f) => f !== c && rankOf(f) < rankOf(c) && distanceKm(f.latlng, c.latlng) <= SATELLITE_KM))
      .map((c) => c.id),
  );
  const wellKnown = (c: CircleCity) => !satellites.has(c.id) && (!famous.has(c.id) || c.population >= FAMOUS_END_MIN_POPULATION);
  const isEnd = (c: CircleCity, plan: HalfwayPlan) =>
    sizeable(c, plan.endMinPopulation, plan) && endInScope(plan.scope, c) && (!plan.wellKnownEnds || wellKnown(c));
  const isKnown = (c: CircleCity, plan: HalfwayPlan) => sizeable(c, HALFWAY_KNOWN_POPULATION, plan);

  /**
   * Every pair of ends that makes a fair level for the plan, worked out once:
   * picking from all of them (not a city, then a partner) keeps the few
   * possible pairs in a region from coming up in every run.
   */
  function findPairs(plan: HalfwayPlan): Pair[] {
    const ends = cities.filter((c) => isEnd(c, plan)).map((c) => ({ c, v: toVector(c.latlng) }));
    const known = cities
      .filter((c) => isKnown(c, plan))
      .map((c) => ({ c, v: toVector(c.latlng) }))
      .sort((x, y) => x.v[2] - y.v[2]);
    const [minKm, maxKm] = plan.separationKm;
    const [minDot, maxDot] = [Math.cos(maxKm / EARTH_KM), Math.cos(minKm / EARTH_KM)];
    // A little slack: the exact distance decides, the dot product only skips the far ones quickly.
    const nearDot = Math.cos((plan.radiusKm + 1) / EARTH_KM);
    // Within the radius, a city's z (sine of its latitude) differs from the midpoint's by at most this.
    const nearZ = (plan.radiusKm + 1) / EARTH_KM;
    const pairs: Pair[] = [];
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const [a, b] = [ends[i]!, ends[j]!];
        const d = dot(a.v, b.v);
        if (d < minDot || d > maxDot) continue;
        if (plan.sameContinent && continentOf(a.c) !== continentOf(b.c)) continue;
        const middle = midpoint(a.c.latlng, b.c.latlng);
        const m = toVector(middle);
        const near: { c: CircleCity; km: number }[] = [];
        for (let n = firstAbove(known, m[2] - nearZ); n < known.length && known[n]!.v[2] <= m[2] + nearZ; n++) {
          const k = known[n]!;
          if (dot(k.v, m) < nearDot) continue;
          const km = distanceKm(k.c.latlng, middle);
          if (km <= plan.radiusKm) near.push({ c: k.c, km });
        }
        if (near.length < plan.minKnown || near.filter((k) => famous.has(k.c.id)).length < plan.minFamous) continue;
        near.sort((x, y) => x.km - y.km);
        const country = countryById.get(near[0]!.c.countryId);
        if (!country) continue;
        const { continent: region, subregion } = country;
        pairs.push({ a: a.c, b: b.c, middle, fair: near.map((k) => k.c.id), region, subregion: spreadGroup(subregion ?? region) });
      }
    }
    return pairs;
  }
  const pairsByPlan = new Map<HalfwayPlan, Pair[]>();
  const pairsFor = (plan: HalfwayPlan) => {
    let pairs = pairsByPlan.get(plan);
    if (!pairs) pairsByPlan.set(plan, (pairs = findPairs(plan)));
    return pairs;
  };

  function makeLevel(rng: Rng, number: number, past: HalfwayState['past']): HalfwayLevel {
    const plan = halfwayPlan(number);
    // An end is never used twice in a run, nor (while possible) an earlier level's answer, and the reverse.
    const ends = new Set(past.flatMap((p) => [p.from, p.to]));
    const answers = new Set(past.flatMap((p) => p.fair));
    const recent = past.slice(-SEPARATION_MEMORY);
    const africaRecently = past.slice(-(HALFWAY_AFRICA_SPACING - 1)).some((p) => p.region === 'Africa');
    const last = past.at(-1)?.subregion;
    const perSubregion = new Map<string, number>();
    for (const p of past.slice(-(HALFWAY_SUBREGION_WINDOW - 1))) perSubregion.set(p.subregion, (perSubregion.get(p.subregion) ?? 0) + 1);
    const fresh = pairsFor(plan).filter((p) => !ends.has(p.a.id) && !ends.has(p.b.id));
    const spread = (p: Pair) =>
      p.subregion !== last &&
      (perSubregion.get(p.subregion) ?? 0) < HALFWAY_SUBREGION_MAX &&
      !(africaRecently && p.region === 'Africa') &&
      !recent.some((q) => distanceKm(q.midpoint, p.middle) < MIN_SEPARATION_KM) &&
      !answers.has(p.a.id) &&
      !answers.has(p.b.id) &&
      !p.fair.some((id) => ends.has(id));
    // The first pass keeps every rule; the next drops the ones that spread a run around the world;
    // the last, never needed in testing, allows answers an earlier level had.
    for (const pass of [2, 1, 0]) {
      let options = fresh.filter((p) => pass < 2 || spread(p));
      while (options.length > 0) {
        // Any allowed pair, equally: the spreading rules, not weights, keep a run varied.
        const pair = pick(rng, options);
        if (pass >= 1 && past.some((q) => sharesTooMany(pair.fair, q.fair))) {
          options = options.filter((p) => p !== pair);
          continue;
        }
        // Either city may come first.
        const [from, to] = rng.next() < 0.5 ? [pair.a, pair.b] : [pair.b, pair.a];
        return {
          number,
          from: from.id,
          to: to.id,
          midpoint: pair.middle,
          radiusKm: plan.radiusKm,
          fair: pair.fair,
          region: pair.region,
          subregion: pair.subregion,
          guesses: [],
          points: 0,
          flawless: false,
          status: 'playing',
        };
      }
    }
    throw new Error(`no Halfway level ${number}`);
  }

  /** Points for clearing a level with a guess `km` from the midpoint: half to all of the level's worth, closer earning more. */
  const levelPoints = (level: HalfwayLevel, km: number, flawless: boolean) => {
    const base = HALFWAY_POINTS_PER_LEVEL * level.number * (1 - (0.5 * km) / level.radiusKm);
    return Math.round(base * (flawless ? 1.5 : 1));
  };

  /** Ends a level, cleared or not, and the run with it when the lives are gone. */
  function endLevel(state: HalfwayState, level: HalfwayLevel, lives: number, mark: HalfwayMark, move: string): HalfwayState {
    return {
      ...state,
      level,
      lives,
      bonusLife: lives > state.lives,
      score: state.score + level.points,
      status: lives > 0 ? 'level-over' : 'over',
      marks: [...state.marks, mark],
      moves: [...state.moves, move],
    };
  }

  return {
    cities: byId,

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
        bonusLife: false,
        marks: [],
        past: [level],
        moves: [],
      };
    },

    /** Wrong guesses a level still allows before it costs a life. */
    missesLeft: (level: HalfwayLevel) => HALFWAY_MISSES - level.guesses.filter((g) => g.km > level.radiusKm).length,

    guess(state: HalfwayState, id: CityId): { state: HalfwayState; result: HalfwayGuessResult } {
      const { level } = state;
      const city = byId.get(id);
      if (state.status !== 'playing' || !city) return { state, result: 'unknown' };
      // Naming one of the two cities isn't a guess: it can never be halfway. While their names are
      // hidden it's an ordinary (far) guess, so it can't be used to find out which cities they are.
      if ((id === level.from || id === level.to) && halfwayPlan(level.number).showNames) return { state, result: 'end' };
      if (level.guesses.some((g) => g.id === id)) return { state, result: 'repeat' };
      const km = distanceKm(city.latlng, level.midpoint);
      const guesses = [...level.guesses, { id, km }];
      if (km > level.radiusKm) {
        const misses = guesses.filter((g) => g.km > level.radiusKm).length;
        // The first misses are free (they only spoil a flawless level); the last costs a life and ends the level.
        if (misses < HALFWAY_MISSES) {
          return { result: 'outside', state: { ...state, level: { ...level, guesses }, moves: [...state.moves, id] } };
        }
        return { result: 'outside', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', id) };
      }
      const flawless = guesses.length === 1 && km <= level.radiusKm * HALFWAY_FLAWLESS_SHARE;
      const cleared: HalfwayLevel = { ...level, guesses, points: levelPoints(level, km, flawless), flawless, status: 'cleared' };
      const lives = flawless ? Math.min(HALFWAY_MAX_LIVES, state.lives + 1) : state.lives;
      return { result: 'inside', state: endLevel(state, cleared, lives, flawless ? 'flawless' : guesses.length === 1 ? 'cleared' : 'missed', id) };
    },

    /** Gives the level up for a life, like running out of guesses. */
    skip(state: HalfwayState): HalfwayState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: HalfwayState): HalfwayState {
      if (state.status !== 'level-over') return state;
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

/** The move a skip is logged as. */
export const HALFWAY_SKIP = SKIP;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayHalfway(game: Halfway, seed: number, moves: readonly string[]): HalfwayState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === SKIP ? game.skip(state) : game.guess(state, move).state;
  }
  return state;
}
