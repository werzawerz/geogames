import { countryProminence, type Country, type CountryId } from '@geogames/geodata';
import type { LandGrid } from '@geogames/geodata/land-grid';
import { distanceKm, type CircleCity } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * On the Grid: a latitude and longitude are given, and you type the country that
 * contains that point. A blind map (coastlines only: no borders, names, lines or
 * marker) is there to place the coordinate on yourself. A wrong guess says which
 * way the spot lies from the country you named, and how far. The last allowed
 * miss, or a skip, costs a life and ends the level. The run has no end but the
 * lives.
 *
 * Each band tests more of the map in your head:
 * 1. Round coordinates (multiples of 10°) deep inside big, well-known countries.
 * 2. Multiples of 5°, medium countries too, still well clear of the borders.
 * 3. Any whole degree, any country, near borders too (but never on one).
 * 4. As band 3, with the map hidden until the answer: coordinates and memory only.
 *
 * Nothing on screen may give the answer away, and nothing in a score depends on
 * the map's shapes: a guess is right when it is the country the point is in.
 */

export interface GridPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3 | 4;
  /** Targets are multiples of this many degrees, both ways. */
  step: number;
  /** A target is at least this far (km) from any other country. */
  minClearKm: number;
  /** Band 1 keeps to the countries and parts of the world players know best. */
  fair: boolean;
  /** Targets lie no nearer a pole than this: the Arctic is empty, and nothing there is known. */
  maxLat: number;
  /** Wrong guesses that end the level: the last costs a life. */
  misses: number;
  /** The blind map is hidden while the question is open. */
  mapHidden: boolean;
}

export const GRID_PLANS: readonly GridPlan[] = [
  { from: 1, band: 1, step: 10, minClearKm: 300, fair: true, maxLat: 55, misses: 3, mapHidden: false },
  { from: 9, band: 2, step: 5, minClearKm: 150, fair: false, maxLat: 80, misses: 3, mapHidden: false },
  { from: 21, band: 3, step: 1, minClearKm: 0, fair: false, maxLat: 80, misses: 2, mapHidden: false },
  { from: 41, band: 4, step: 1, minClearKm: 0, fair: false, maxLat: 80, misses: 1, mapHidden: true },
];

export const gridPlan = (level: number): GridPlan => [...GRID_PLANS].reverse().find((p) => level >= p.from)!;

export const GRID_START_LIVES = 3;
export const GRID_MAX_LIVES = 3;
/** A cleared level is worth this × the level number, less for each miss. */
export const GRID_POINTS_PER_LEVEL = 10;
/** Share of the points kept after 0, 1 or 2 misses. */
const MISS_SHARE = [1, 0.6, 0.3];
/** A flawless level earns this share of its points again, and a life. */
export const GRID_FLAWLESS_SHARE = 0.5;
/** A country isn't asked again within this many levels, while the band has others left. */
export const GRID_COUNTRY_GAP = 8;
/** The countries band 1 leaves out, and those too little known to be fair there. */
const FAIR_MIN_PROMINENCE = 0.3;
export const GRID_SKIP = 'skip';

export type GridGuessResult = 'right' | 'wrong' | 'lost' | 'repeat' | 'unknown';
export type GridMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface GridLevel {
  number: number;
  /** The spot, [lat, lng] in whole degrees. */
  target: readonly [number, number];
  /** The country the spot is in. */
  country: CountryId;
  /** Countries named so far, in order. */
  guesses: readonly CountryId[];
  status: 'playing' | 'cleared' | 'lost';
  points: number;
  flawless: boolean;
}

export interface GridState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: GridLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly GridMark[];
  /** Spots asked so far as "lat,lng", oldest first. */
  readonly past: readonly string[];
  /** Countries asked so far, oldest first. */
  readonly pastCountries: readonly CountryId[];
  /** Country ids and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** "23°S, 47°W". */
export function formatCoordinates([lat, lng]: readonly [number, number]): string {
  return `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng)}°${lng < 0 ? 'W' : lng > 0 && lng < 180 ? 'E' : ''}`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
/** "north-east" for a bearing in degrees. */
export const compassPoint = (bearing: number): string => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;

/** The direction from one point to another, in degrees clockwise from north. */
export function bearingDegrees([lat1, lng1]: readonly [number, number], [lat2, lng2]: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

export function createOnTheGrid({ grid, countries }: { grid: LandGrid; countries: readonly Country[] }) {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const prominence = countryProminence(countries.filter((c) => c.sovereignty === 'un-member'));
  const fairCountry = (id: CountryId) => {
    const c = byId.get(id);
    return !!c && c.continent !== 'Africa' && c.subregion !== 'Caribbean' && (prominence.get(id) ?? 0) >= FAIR_MIN_PROMINENCE;
  };
  // Cells in countries the run knows nothing of couldn't be answered.
  const cells = grid.cells.filter(([, , c]) => byId.has(grid.countries[c]!));

  type Cell = (typeof cells)[number];
  // The spots a plan may ask, by country: worked out once per plan, not each level.
  const spotCache = new Map<string, Map<CountryId, Cell[]>>();
  function spotsOf(plan: GridPlan): Map<CountryId, Cell[]> {
    const key = `${plan.step}/${plan.fair}/${plan.maxLat}/${plan.minClearKm}`;
    let spots = spotCache.get(key);
    if (!spots) {
      spots = new Map();
      for (const cell of cells) {
        const [lat, lng, c, clear] = cell;
        const country = grid.countries[c]!;
        if (lat % plan.step !== 0 || lng % plan.step !== 0 || Math.abs(lat) > plan.maxLat || clear < plan.minClearKm) continue;
        if (plan.fair && !fairCountry(country)) continue;
        spots.set(country, [...(spots.get(country) ?? []), cell]);
      }
      spotCache.set(key, spots);
    }
    return spots;
  }

  function nextSpot(rng: Rng, plan: GridPlan, past: readonly string[], pastCountries: readonly CountryId[]): { target: [number, number]; country: CountryId } {
    const used = new Set(past);
    const byCountry = spotsOf(plan);
    const fresh = (s: Cell) => !used.has(`${s[0]},${s[1]}`);
    const recent = new Set(pastCountries.slice(-GRID_COUNTRY_GAP));
    const last = pastCountries.at(-1);
    // Country first, then a spot in it: otherwise Russia and the United States take over.
    // Countries asked lately are left out while others remain, never the one just asked
    // unless nothing else is left, and a repeated spot only as a last resort.
    const tiers: ((country: CountryId, s: Cell) => boolean)[] = [
      (c, s) => !recent.has(c) && fresh(s),
      (c, s) => c !== last && fresh(s),
      (_, s) => fresh(s),
      () => true,
    ];
    for (const fits of tiers) {
      const left = [...byCountry.keys()];
      while (left.length) {
        const country = left.splice(Math.floor(rng.next() * left.length), 1)[0]!;
        const spots = byCountry.get(country)!.filter((s) => fits(country, s));
        if (spots.length) {
          const [lat, lng] = pick(rng, spots);
          return { target: [lat, lng], country };
        }
      }
    }
    throw new Error('On the Grid has no spots');
  }

  function makeLevel(rng: Rng, number: number, past: readonly string[], pastCountries: readonly CountryId[]): GridLevel {
    const { target, country } = nextSpot(rng, gridPlan(number), past, pastCountries);
    return { number, target, country, guesses: [], status: 'playing', points: 0, flawless: false };
  }

  function endLevel(state: GridState, level: GridLevel, lives: number, mark: GridMark, move: string): GridState {
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
    countries: byId,

    start(seed: number): GridState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, [], []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: GRID_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        past: [`${level.target}`],
        pastCountries: [level.country],
        moves: [],
      };
    },

    /** Names the country the spot is in. */
    guess(state: GridState, id: CountryId): { state: GridState; result: GridGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !byId.has(id)) return { state, result: 'unknown' };
      if (level.guesses.includes(id)) return { state, result: 'repeat' };
      const guesses = [...level.guesses, id];
      if (id === level.country) {
        const missed = guesses.length - 1;
        const flawless = missed === 0;
        const base = GRID_POINTS_PER_LEVEL * level.number;
        const points = Math.round(base * MISS_SHARE[Math.min(missed, MISS_SHARE.length - 1)]! + (flawless ? base * GRID_FLAWLESS_SHARE : 0));
        const lives = flawless ? Math.min(GRID_MAX_LIVES, state.lives + 1) : state.lives;
        const mark = flawless ? 'flawless' : missed === 1 ? 'cleared' : 'missed';
        return { result: 'right', state: endLevel(state, { ...level, guesses, status: 'cleared', points, flawless }, lives, mark, id) };
      }
      if (guesses.length >= gridPlan(level.number).misses) {
        return { result: 'lost', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', id) };
      }
      return { result: 'wrong', state: { ...state, level: { ...level, guesses }, moves: [...state.moves, id] } };
    },

    /** Gives up on the level for a life. */
    skip(state: GridState): GridState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', GRID_SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: GridState): GridState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past, state.pastCountries);
      return {
        ...state,
        rngState: rng.state,
        level,
        status: 'playing',
        bonusLife: false,
        past: [...state.past, `${level.target}`],
        pastCountries: [...state.pastCountries, level.country],
      };
    },
  };
}

export type OnTheGrid = ReturnType<typeof createOnTheGrid>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayOnTheGrid(game: OnTheGrid, seed: number, moves: readonly string[], observe?: (state: GridState, move: string) => void): GridState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === GRID_SKIP ? game.skip(state) : game.guess(state, move).state;
    observe?.(state, move);
  }
  return state;
}

/** A city whose name is a district or an industrial area, not somewhere a player would know. */
const NOT_A_PLACE = /industrial|district|\bzone\b|\barea\b|\bport\b|\bcity of\b|\bsuburb|\bcantonment\b/i;
/** A city this near the spot is worth naming. */
export const NEAR_CITY_KM = 150;
/** Small cities would only add noise to the line. */
export const NEAR_CITY_MIN_POPULATION = 300_000;

/**
 * The city "near" a spot, for the reveal. Only a city in the same country and
 * within NEAR_CITY_KM counts: "Zimbabwe, near Lusaka" is a wrong fact however
 * close, and a city across a border is a political claim. Null when none fits.
 */
export function nearCity(spot: readonly [number, number], countryId: CountryId, cities: readonly CircleCity[]): CircleCity | null {
  let best: { city: CircleCity; km: number } | null = null;
  for (const city of cities) {
    if (city.countryId !== countryId || city.population < NEAR_CITY_MIN_POPULATION || NOT_A_PLACE.test(city.name)) continue;
    const km = distanceKm(spot, city.latlng);
    if (km <= NEAR_CITY_KM && (!best || km < best.km)) best = { city, km };
  }
  return best?.city ?? null;
}
