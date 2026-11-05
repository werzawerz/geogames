import type { CityId } from '@geogames/geodata';
import { distanceKm, type CircleCity } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * Pin Drop: a city is named and you click where it is on the map. Closer earns
 * more, and each miss eats into a distance budget; the run ends when it's gone.
 * Famous cities come first, and points grow as less famous ones come in.
 */

export interface PinPlan {
  /** First city this applies to. */
  from: number;
  /** Well-known cities are always in; others from this size. */
  minPopulation: number;
  /** Chinese and Indian cities only from this size, whether well known or not. */
  crowdedCountryMinPopulation: number;
  /** Multiplies the points. */
  multiplier: number;
}

export const PIN_PLANS: readonly PinPlan[] = [
  { from: 1, minPopulation: Infinity, crowdedCountryMinPopulation: 20_000_000, multiplier: 1 },
  { from: 6, minPopulation: 3_000_000, crowdedCountryMinPopulation: 10_000_000, multiplier: 2 },
  { from: 16, minPopulation: 1_000_000, crowdedCountryMinPopulation: 3_000_000, multiplier: 3 },
  { from: 31, minPopulation: 300_000, crowdedCountryMinPopulation: 300_000, multiplier: 4 },
];

/**
 * So many big cities, in such a small part of most players' mental map, that
 * they'd crowd out everything else and be hard to place early on.
 */
const CROWDED_COUNTRIES: ReadonlySet<string> = new Set(['CHN', 'IND']);

export const PIN_BUDGET_KM = 5000;
/** At this distance or further, a pin earns no points. */
export const PIN_ZERO_POINTS_KM = 2000;
export const PIN_MAX_POINTS = 100;
/** A pin this close costs no budget, and earns some back. */
export const PIN_BULLSEYE_KM = 50;
export const PIN_BULLSEYE_REFILL_KM = 250;

export const pinPlan = (level: number): PinPlan => [...PIN_PLANS].reverse().find((p) => level >= p.from)!;

export interface PinResult {
  /** Where the pin went, as [lat, lng]. */
  at: readonly [number, number];
  km: number;
  points: number;
}

export interface PinState {
  readonly seed: number;
  readonly rngState: number;
  /** 'placing': waiting for a pin. 'revealed': showing how it went. */
  readonly status: 'placing' | 'revealed' | 'over';
  readonly level: number;
  readonly city: CityId;
  readonly budgetKm: number;
  readonly score: number;
  readonly last: PinResult | null;
  /** How far off each pin was, for the result to share. */
  readonly distances: readonly number[];
  readonly used: readonly CityId[];
  /** True when every city came up. */
  readonly completed: boolean;
  /** "lat,lng" of each pin; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** Two decimals are about a kilometre: plenty, and the log replays to exactly the same distance. */
const roundCoordinate = (v: number) => Math.round(v * 100) / 100;

export function createPinDrop({ cities, famous }: { cities: readonly CircleCity[]; famous: ReadonlySet<CityId> }) {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const eligible = (c: CircleCity, level: number) => {
    const plan = pinPlan(level);
    if (CROWDED_COUNTRIES.has(c.countryId)) return c.population >= plan.crowdedCountryMinPopulation;
    return famous.has(c.id) || c.population >= plan.minPopulation;
  };

  function nextCity(rng: Rng, level: number, used: readonly CityId[]): CityId | null {
    const fresh = cities.filter((c) => !used.includes(c.id));
    const wanted = fresh.filter((c) => eligible(c, level));
    const from = wanted.length > 0 ? wanted : fresh;
    if (from.length === 0) return null;
    // Country first, then a city in it: otherwise the countries with the most big cities take over.
    const countryId = pick(rng, [...new Set(from.map((c) => c.countryId))]);
    return pick(rng, from.filter((c) => c.countryId === countryId)).id;
  }

  return {
    cities: byId,

    start(seed: number): PinState {
      const rng = createRng(seed);
      const city = nextCity(rng, 1, [])!;
      return {
        seed,
        rngState: rng.state,
        status: 'placing',
        level: 1,
        city,
        budgetKm: PIN_BUDGET_KM,
        score: 0,
        last: null,
        distances: [],
        used: [city],
        completed: false,
        moves: [],
      };
    },

    place(state: PinState, lat: number, lng: number): PinState {
      if (state.status !== 'placing' || !Number.isFinite(lat) || !Number.isFinite(lng)) return state;
      const at = [roundCoordinate(lat), roundCoordinate(lng)] as const;
      const km = distanceKm(at, byId.get(state.city)!.latlng);
      const points = Math.round(PIN_MAX_POINTS * Math.max(0, 1 - km / PIN_ZERO_POINTS_KM)) * pinPlan(state.level).multiplier;
      const budgetKm = km <= PIN_BULLSEYE_KM ? Math.min(PIN_BUDGET_KM, state.budgetKm + PIN_BULLSEYE_REFILL_KM) : state.budgetKm - km;
      return {
        ...state,
        status: budgetKm > 0 ? 'revealed' : 'over',
        budgetKm: Math.max(0, budgetKm),
        score: state.score + points,
        last: { at, km, points },
        distances: [...state.distances, km],
        moves: [...state.moves, `${at[0]},${at[1]}`],
      };
    },

    next(state: PinState): PinState {
      if (state.status !== 'revealed') return state;
      const rng = createRng(state.rngState);
      const level = state.level + 1;
      const city = nextCity(rng, level, state.used);
      if (!city) return { ...state, status: 'over', completed: true };
      return { ...state, rngState: rng.state, status: 'placing', level, city, used: [...state.used, city], last: null };
    },
  };
}

export type PinDrop = ReturnType<typeof createPinDrop>;

/** Replays pins from a seed; this is what a server uses to verify a score. */
export function replayPinDrop(game: PinDrop, seed: number, moves: readonly string[]): PinState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'revealed') state = game.next(state);
    if (state.status === 'over') break;
    const [lat, lng] = move.split(',').map(Number) as [number, number];
    state = game.place(state, lat, lng);
  }
  return state;
}
