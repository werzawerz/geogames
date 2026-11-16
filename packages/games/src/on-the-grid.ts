import { countryProminence, type Country, type CountryId } from '@geogames/geodata';
import type { LandGrid } from '@geogames/geodata/land-grid';
import { destination, distanceKm, type CircleCity } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * On the Grid: a latitude and longitude are given, and you click that spot on a
 * map with no borders or names. Up to three clicks (two from level 26); after a
 * miss, an arrow shows which way the spot is and how far. A click within the
 * level's radius finds it. The last miss, or a skip, costs a life and ends the
 * level. The run has no end but the lives.
 *
 * Each band takes away a scaffold the band before taught you to replace:
 * 1. A grid line every 10°, on round coordinates in the well-known, populated
 *    part of the world: read the grid.
 * 2. Only the Equator, the tropics and the prime meridian are drawn, on
 *    coordinates to 5°: know where those lines run.
 * 3. No lines at all, any whole degree, and the radius narrowing late on: an
 *    internal grid.
 */

export type GridLines = 'every-10' | 'key' | 'none';

export interface GridPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3;
  lines: GridLines;
  /** Targets are multiples of this many degrees, both ways. */
  step: number;
  /** A click this close (km) finds the spot. */
  radiusKm: number;
  /** Band 1 keeps to the countries and parts of the world players know best. */
  fair: boolean;
  /** Targets lie no nearer a pole than this: the Arctic is empty, and nothing there is known. */
  maxLat: number;
  /** Clicks a level allows; the last miss costs the life. */
  clicks: number;
}

export const GRID_PLANS: readonly GridPlan[] = [
  { from: 1, band: 1, lines: 'every-10', step: 10, radiusKm: 500, fair: true, maxLat: 55, clicks: 3 },
  { from: 9, band: 2, lines: 'key', step: 5, radiusKm: 350, fair: false, maxLat: 80, clicks: 3 },
  { from: 21, band: 3, lines: 'none', step: 1, radiusKm: 250, fair: false, maxLat: 80, clicks: 3 },
  // The hints make survival easy for an expert, so from here a level allows two clicks, then a tighter radius.
  { from: 26, band: 3, lines: 'none', step: 1, radiusKm: 250, fair: false, maxLat: 80, clicks: 2 },
  { from: 40, band: 3, lines: 'none', step: 1, radiusKm: 180, fair: false, maxLat: 80, clicks: 2 },
];

export const gridPlan = (level: number): GridPlan => [...GRID_PLANS].reverse().find((p) => level >= p.from)!;

export const GRID_START_LIVES = 3;
export const GRID_MAX_LIVES = 3;
/** Clicks a level allows at first; see GridPlan.clicks. */
export const GRID_CLICKS = 3;
/** A found spot is worth this × the level number, less for each miss. */
export const GRID_POINTS_PER_LEVEL = 10;
/** Share of the points kept when found with the 1st, 2nd or 3rd click. */
const CLICK_SHARE = [1, 0.6, 0.3];
/** A spot found with the first click earns this share of its points again, and a life. */
export const GRID_FLAWLESS_SHARE = 0.5;
/** A spot within this many levels of an earlier one isn't asked if it's closer to it than the gap. */
export const GRID_REPEAT_GAP = 8;
export const GRID_NEAR_KM = 1200;
/** The countries band 1 leaves out, and those too little known to be fair there. */
const FAIR_MIN_PROMINENCE = 0.3;
export const GRID_SKIP = 'skip';

export type GridResult = 'found' | 'miss' | 'lost' | 'invalid';
export type GridMark = 'flawless' | 'found' | 'lost';

export interface GridClick {
  /** Where the click went, [lat, lng]. */
  at: readonly [number, number];
  km: number;
  /** Compass bearing from the click to the spot, in degrees clockwise from north. */
  bearing: number;
}

export interface GridLevel {
  number: number;
  /** The spot, [lat, lng] in whole degrees. */
  target: readonly [number, number];
  /** The country the spot is in, for the reveal. */
  country: CountryId;
  clicks: readonly GridClick[];
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
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly GridMark[];
  /** The closest find so far, in km (the click that found it); null before the first. */
  readonly closestKm: number | null;
  /** Spots asked so far as "lat,lng", oldest first. */
  readonly past: readonly string[];
  /** "lat,lng" clicks and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** Two decimals are about a kilometre: plenty, and the log replays to exactly the same distance. */
const roundCoordinate = (v: number) => Math.round(v * 100) / 100;

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

/** Where the arrow after a miss points, for drawing: a spot `km` from the click, towards the target. */
export const towards = (click: GridClick, km: number): [number, number] => destination(click.at, km, (click.bearing * Math.PI) / 180);

export function createOnTheGrid({ grid, countries }: { grid: LandGrid; countries: readonly Country[] }) {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const prominence = countryProminence(countries.filter((c) => c.sovereignty === 'un-member'));
  const fairCountry = (id: CountryId) => {
    const c = byId.get(id);
    return !!c && c.continent !== 'Africa' && c.subregion !== 'Caribbean' && (prominence.get(id) ?? 0) >= FAIR_MIN_PROMINENCE;
  };
  const known = new Set(countries.map((c) => c.id));
  // Cells in countries the run knows nothing of couldn't be labelled.
  const cells = grid.cells.filter(([, , c]) => known.has(grid.countries[c]!));

  type Cell = (typeof cells)[number];
  // The spots a plan may ask, by country: worked out once per plan, not each level.
  const spotCache = new Map<string, Map<number, Cell[]>>();
  function spotsOf(plan: GridPlan): Map<number, Cell[]> {
    const key = `${plan.step}/${plan.fair}/${plan.maxLat}`;
    let spots = spotCache.get(key);
    if (!spots) {
      spots = new Map();
      for (const cell of cells) {
        const [lat, lng, c] = cell;
        if (lat % plan.step !== 0 || lng % plan.step !== 0 || Math.abs(lat) > plan.maxLat || (plan.fair && !fairCountry(grid.countries[c]!))) continue;
        spots.set(c, [...(spots.get(c) ?? []), cell]);
      }
      spotCache.set(key, spots);
    }
    return spots;
  }

  function nextSpot(rng: Rng, plan: GridPlan, past: readonly string[]): { target: [number, number]; country: CountryId } {
    const used = new Set(past);
    const recent = past.slice(-GRID_REPEAT_GAP).map((p) => p.split(',').map(Number) as [number, number]);
    const byCountry = spotsOf(plan);
    const fresh = (s: Cell) => !used.has(`${s[0]},${s[1]}`);
    const apart = (s: Cell) => fresh(s) && recent.every((r) => distanceKm(r, [s[0], s[1]]) >= GRID_NEAR_KM);
    // Country first, then a spot in it: otherwise Russia and the United States take over.
    // A country with nothing fresh and far enough is passed over; if every one is, repeats come last.
    for (const fits of [apart, fresh, () => true]) {
      const left = [...byCountry.keys()];
      while (left.length) {
        const country = left.splice(Math.floor(rng.next() * left.length), 1)[0]!;
        const spots = byCountry.get(country)!.filter(fits);
        if (spots.length) {
          const [lat, lng] = pick(rng, spots);
          return { target: [lat, lng], country: grid.countries[country]! };
        }
      }
    }
    throw new Error('On the Grid has no spots');
  }

  function makeLevel(rng: Rng, number: number, past: readonly string[]): GridLevel {
    const { target, country } = nextSpot(rng, gridPlan(number), past);
    return { number, target, country, clicks: [], status: 'playing', points: 0, flawless: false };
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
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: GRID_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        closestKm: null,
        past: [`${level.target}`],
        moves: [],
      };
    },

    /** A click at a latitude and longitude. */
    click(state: GridState, lat: number, lng: number): { state: GridState; result: GridResult } {
      if (state.status !== 'playing' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) return { state, result: 'invalid' };
      const { level } = state;
      const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
      const at = [roundCoordinate(lat), roundCoordinate(wrapped)] as const;
      const km = distanceKm(at, level.target);
      const click: GridClick = { at, km, bearing: bearingDegrees(at, level.target) };
      const clicks = [...level.clicks, click];
      const move = `${at[0]},${at[1]}`;
      if (km <= gridPlan(level.number).radiusKm) {
        const flawless = clicks.length === 1;
        const base = GRID_POINTS_PER_LEVEL * level.number;
        const points = Math.round(base * CLICK_SHARE[clicks.length - 1]! + (flawless ? base * GRID_FLAWLESS_SHARE : 0));
        const closestKm = state.closestKm === null ? km : Math.min(state.closestKm, km);
        const lives = flawless ? Math.min(GRID_MAX_LIVES, state.lives + 1) : state.lives;
        return { result: 'found', state: { ...endLevel(state, { ...level, clicks, status: 'cleared', points, flawless }, lives, flawless ? 'flawless' : 'found', move), closestKm } };
      }
      if (clicks.length >= gridPlan(level.number).clicks) {
        return { result: 'lost', state: endLevel(state, { ...level, clicks, status: 'lost' }, state.lives - 1, 'lost', move) };
      }
      return { result: 'miss', state: { ...state, level: { ...level, clicks }, moves: [...state.moves, move] } };
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
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, `${level.target}`] };
    },
  };
}

export type OnTheGrid = ReturnType<typeof createOnTheGrid>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayOnTheGrid(game: OnTheGrid, seed: number, moves: readonly string[]): GridState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    if (move === GRID_SKIP) state = game.skip(state);
    else {
      const [lat, lng] = move.split(',').map(Number) as [number, number];
      state = game.click(state, lat, lng).state;
    }
  }
  return state;
}

/** A city whose name is a district or an industrial area, not somewhere a player would know. */
const NOT_A_PLACE = /industrial|district|zone|area|port|city of|suburb|cantonment/i;
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
