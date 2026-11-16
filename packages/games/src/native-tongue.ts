import { type Country, type CountryId } from '@geogames/geodata';
import type { NativeName } from '@geogames/geodata/native-names';
import { createRng, pick, type Rng } from './rng.ts';
import { routeScopes, type RouteScope } from './route.ts';

/**
 * Native Tongue: a country's name for itself is shown in its own script, and
 * you type the English name of the country. Two wrong names are free (one from
 * level 21, none from level 41): the next, or a skip, costs a life and ends the
 * level. The run has no end but the lives.
 *
 * Each band tests a different skill, rather than the same one on more obscure
 * countries:
 * 1. Knowing endonyms: Deutschland, Suomi, Magyarország, in Latin letters.
 * 2. Recognising a script that belongs to one country: Greek, Georgian, Thai.
 * 3. Reading a little of a shared script: Cyrillic (Беларусь or България?),
 *    Arabic, Devanagari, and the Latin names nobody has met. Holds from there.
 *
 * Only data the server has decides a score: the names' scripts and the
 * countries, never what a name looks like. The screen shows the name.
 */

export interface TongueLevelPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3;
  /** Where the countries may be (see routeScopes). */
  scope: RouteScope;
  /** Wrong guesses that end the level: the last of them costs a life. */
  misses: number;
}

export const TONGUE_PLANS: readonly TongueLevelPlan[] = [
  { from: 1, band: 1, scope: 'known', misses: 3 },
  { from: 9, band: 2, scope: 'no-africa', misses: 3 },
  { from: 15, band: 2, scope: 'any', misses: 3 },
  { from: 21, band: 3, scope: 'any', misses: 2 },
  { from: 41, band: 3, scope: 'any', misses: 1 },
];

export const tonguePlan = (level: number): TongueLevelPlan => [...TONGUE_PLANS].reverse().find((p) => level >= p.from)!;

/**
 * Countries whose script points to them alone, or all but: Greek Ελλάδα, Korean
 * 대한민국. Cyprus and the North (Greek, Korean too) wait for band 3, where the
 * script no longer settles it; so do Eritrea, Taiwan and Nepal.
 */
export const DISTINCT_SCRIPT: ReadonlySet<CountryId> = new Set([
  'GRC', 'GEO', 'ARM', 'THA', 'KOR', 'ISR', 'ETH', 'KHM', 'LAO', 'MMR', 'LKA', 'BGD', 'BTN', 'CHN', 'JPN',
]);

export const TONGUE_START_LIVES = 3;
export const TONGUE_MAX_LIVES = 3;
/** A cleared level is worth this × the level number, less for each miss. */
export const TONGUE_POINTS_PER_LEVEL = 10;
/** Share of the points kept after 0, 1 or 2 misses. */
const MISS_SHARE = [1, 0.6, 0.3];
/** A flawless level earns this share of its points again, and a life. */
export const TONGUE_FLAWLESS_SHARE = 0.5;
/** Countries smaller than this (km²) are hard to see on the answer map: never asked. */
export const TONGUE_MIN_AREA_KM2 = 400;
export const TONGUE_SKIP = 'skip';

export type TongueGuessResult = 'right' | 'wrong' | 'repeat' | 'unknown';
export type TongueMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface TongueLevel {
  number: number;
  country: CountryId;
  /** Countries tried, oldest first. */
  guesses: readonly CountryId[];
  status: 'playing' | 'cleared' | 'lost';
  points: number;
  flawless: boolean;
}

export interface TongueState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: TongueLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly TongueMark[];
  /** Countries asked so far, oldest first. */
  readonly past: readonly CountryId[];
  /** Country ids and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** The names a level may ask: those that make a puzzle, of countries big enough to see. */
export function tonguePool(names: readonly NativeName[], countries: readonly Country[]): NativeName[] {
  const area = new Map(countries.map((c) => [c.id, c.metrics.area?.value ?? 0]));
  return names.filter((n) => !n.looksEnglish && (area.get(n.id) ?? 0) >= TONGUE_MIN_AREA_KM2);
}

export function createNativeTongue({ names, countries }: { names: readonly NativeName[]; countries: readonly Country[] }) {
  const known = new Set(countries.map((c) => c.id));
  const byId = new Map(countries.map((c) => [c.id, c]));
  const scriptOf = new Map(names.map((n) => [n.id, n.script]));
  const pool = tonguePool(names, countries).filter((n) => known.has(n.id));
  const { inScope } = routeScopes(countries);

  /** Band 1's names: Latin letters, in the better-known countries. */
  const isBand1 = (n: NativeName) => n.script === 'Latin' && inScope('known', n.id);

  /** The group a band asks from first; the rest of the pool only once it has run out. */
  function firstChoice(plan: TongueLevelPlan): NativeName[] {
    const here = pool.filter((n) => inScope(plan.scope, n.id));
    switch (plan.band) {
      case 1:
        // The skill is the endonym, not the geography: Latin letters, the better-known countries.
        return here.filter(isBand1);
      case 2:
        return here.filter((n) => DISTINCT_SCRIPT.has(n.id));
      case 3:
        // Shared scripts and the Latin names nobody has met; what bands 1 and 2 would have asked comes last.
        return here.filter((n) => !DISTINCT_SCRIPT.has(n.id) && !isBand1(n));
    }
  }

  function nextCountry(rng: Rng, plan: TongueLevelPlan, past: readonly CountryId[]): CountryId {
    const asked = new Set(past);
    const lastScript = past.length ? scriptOf.get(past[past.length - 1]!) : undefined;
    // Never a repeat while the band has others; then the rest of the scope, then anything unasked.
    const fallbacks = [firstChoice(plan), pool.filter((n) => inScope(plan.scope, n.id)), pool];
    for (const group of fallbacks) {
      const fresh = group.filter((n) => !asked.has(n.id));
      if (fresh.length === 0) continue;
      // Two of one script in a row would make the second easier to place.
      const varied = fresh.filter((n) => n.script !== lastScript);
      return pick(rng, (varied.length ? varied : fresh).map((n) => n.id));
    }
    // Every country has been asked: the one asked longest ago.
    return [...pool].sort((a, b) => past.lastIndexOf(a.id) - past.lastIndexOf(b.id) || a.id.localeCompare(b.id))[0]!.id;
  }

  function makeLevel(rng: Rng, number: number, past: readonly CountryId[]): TongueLevel {
    return { number, country: nextCountry(rng, tonguePlan(number), past), guesses: [], status: 'playing', points: 0, flawless: false };
  }

  function endLevel(state: TongueState, level: TongueLevel, lives: number, mark: TongueMark, move: string): TongueState {
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
    pool,
    countryName: (id: CountryId) => byId.get(id)?.name ?? id,

    start(seed: number): TongueState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: TONGUE_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        past: [level.country],
        moves: [],
      };
    },

    guess(state: TongueState, id: CountryId): { state: TongueState; result: TongueGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !known.has(id)) return { state, result: 'unknown' };
      if (level.guesses.includes(id)) return { state, result: 'repeat' };
      const guesses = [...level.guesses, id];
      if (id === level.country) {
        const missed = guesses.length - 1;
        const flawless = missed === 0;
        const base = TONGUE_POINTS_PER_LEVEL * level.number;
        const points = Math.round(base * MISS_SHARE[missed]! + (flawless ? base * TONGUE_FLAWLESS_SHARE : 0));
        const lives = flawless ? Math.min(TONGUE_MAX_LIVES, state.lives + 1) : state.lives;
        const mark = flawless ? 'flawless' : missed === 1 ? 'cleared' : 'missed';
        return { result: 'right', state: endLevel(state, { ...level, guesses, status: 'cleared', points, flawless }, lives, mark, id) };
      }
      if (guesses.length >= tonguePlan(level.number).misses) {
        return { result: 'wrong', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', id) };
      }
      return { result: 'wrong', state: { ...state, level: { ...level, guesses }, moves: [...state.moves, id] } };
    },

    /** Gives up on the level for a life. */
    skip(state: TongueState): TongueState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', TONGUE_SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: TongueState): TongueState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, level.country] };
    },
  };
}

export type NativeTongue = ReturnType<typeof createNativeTongue>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayNativeTongue(game: NativeTongue, seed: number, moves: readonly string[]): TongueState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === TONGUE_SKIP ? game.skip(state) : game.guess(state, move).state;
  }
  return state;
}
