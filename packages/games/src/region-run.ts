import { createRng, pick, type Rng } from './rng.ts';

/**
 * Region Run: a country is drawn as plain shapes (its states, provinces or
 * regions, with no names), and one lights up. Type its name. A wrong guess is
 * shaded where it really is, so a miss teaches. The last allowed miss, or a
 * skip, costs a life and ends the level. The run has no end but the lives.
 *
 * Which country and which division come from the seed and the level alone, never
 * from what the player did, so two players on one seed (a duel, a daily) get
 * the same run. Nothing in a score depends on the map's shapes or the names:
 * a guess is right when it is the lit division's id.
 *
 * The ramp changes two things separately, so it never jumps from easy to
 * impossible: which countries are in (tier 1: the United States, Canada,
 * Australia, Germany; tier 2: the other big, well-mapped countries; tier 3: the
 * rest) and how well known a division must be (its fame: size, lifted for the
 * famous ones) to be asked in each.
 */

/** What a replay needs of a division: never the name or the shape. */
export interface RegionRunDivision {
  id: string;
  /** 0 to 1; how well known. */
  fame: number;
  /** Big enough to see and not disputed. Only targets are asked. */
  target: boolean;
}
export interface RegionRunCountry {
  id: string;
  tier: 1 | 2 | 3;
  divisions: readonly RegionRunDivision[];
}

export interface RegionPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3 | 4;
  /** Per tier, the least fame a division needs to be asked (a tier left out is not asked). */
  minFame: Readonly<Partial<Record<1 | 2 | 3, number>>>;
}

export const REGION_PLANS: readonly RegionPlan[] = [
  { from: 1, band: 1, minFame: { 1: 0.6 } },
  { from: 9, band: 2, minFame: { 1: 0.3, 2: 0.55 } },
  { from: 21, band: 3, minFame: { 1: 0, 2: 0.3, 3: 0.55 } },
  { from: 36, band: 4, minFame: { 1: 0, 2: 0, 3: 0.2 } },
];

export const regionPlan = (level: number): RegionPlan => [...REGION_PLANS].reverse().find((p) => level >= p.from)!;

export const REGION_START_LIVES = 3;
export const REGION_MAX_LIVES = 3;
/** Wrong guesses that end a level: the last one costs a life. */
export const REGION_MISSES = 3;
/** A cleared level is worth this × the level number, less for each miss. */
export const REGION_POINTS_PER_LEVEL = 10;
/** Share of the points kept after 0, 1 or 2 misses. */
const MISS_SHARE = [1, 0.6, 0.3];
/** A flawless level earns this share of its points again, and a life. */
export const REGION_FLAWLESS_SHARE = 0.5;
/** A country isn't asked again within this many levels, while the plan has others left. */
export const REGION_COUNTRY_GAP = 3;
export const REGION_SKIP = 'skip';

export type RegionGuessResult = 'right' | 'wrong' | 'lost' | 'repeat' | 'elsewhere' | 'unknown';
export type RegionMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface RegionLevel {
  number: number;
  country: string;
  /** The lit division's id. */
  division: string;
  /** Divisions named so far, in order. */
  guesses: readonly string[];
  status: 'playing' | 'cleared' | 'lost';
  points: number;
  flawless: boolean;
}

export interface RegionState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: RegionLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly RegionMark[];
  /** Divisions asked so far, oldest first. */
  readonly past: readonly string[];
  /** Division ids and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export function createRegionRun({ countries }: { countries: readonly RegionRunCountry[] }) {
  const countryOf = new Map<string, string>();
  const byId = new Map(countries.map((c) => [c.id, c]));
  for (const c of countries) for (const d of c.divisions) countryOf.set(d.id, c.id);

  function nextDivision(rng: Rng, plan: RegionPlan, past: readonly string[], pastCountries: readonly string[]): { country: string; division: string } {
    const used = new Set(past);
    const recent = new Set(pastCountries.slice(-REGION_COUNTRY_GAP));
    const last = pastCountries.at(-1);
    const fits = (c: RegionRunCountry, d: RegionRunDivision, relaxed: boolean) =>
      d.target && !used.has(d.id) && (relaxed || d.fame >= (plan.minFame[c.tier] ?? Infinity));
    // Country first, then a division in it: otherwise the big countries (the United States, Turkey) take over.
    // Countries asked lately wait while others remain; then any target of the plan; then any unseen target; then a repeat.
    const tiers: ((c: RegionRunCountry, d: RegionRunDivision) => boolean)[] = [
      (c, d) => !recent.has(c.id) && fits(c, d, false),
      (c, d) => c.id !== last && fits(c, d, false),
      (c, d) => fits(c, d, false),
      (c, d) => fits(c, d, true),
      (_, d) => d.target,
    ];
    for (const ok of tiers) {
      const left = countries.filter((c) => c.divisions.some((d) => ok(c, d)));
      if (!left.length) continue;
      const country = pick(rng, left);
      return { country: country.id, division: pick(rng, country.divisions.filter((d) => ok(country, d))).id };
    }
    throw new Error('Region Run has no divisions');
  }

  const pastCountriesOf = (past: readonly string[]) => past.map((id) => countryOf.get(id)!);

  function makeLevel(rng: Rng, number: number, past: readonly string[]): RegionLevel {
    const { country, division } = nextDivision(rng, regionPlan(number), past, pastCountriesOf(past));
    return { number, country, division, guesses: [], status: 'playing', points: 0, flawless: false };
  }

  function endLevel(state: RegionState, level: RegionLevel, lives: number, mark: RegionMark, move: string): RegionState {
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
    /** The country a division is in, for ids the run knows. */
    countryOf: (division: string) => countryOf.get(division),

    start(seed: number): RegionState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: REGION_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        past: [level.division],
        moves: [],
      };
    },

    /** Names the lit division. A division of another country is a free "no, that's elsewhere": nothing changes. */
    guess(state: RegionState, id: string): { state: RegionState; result: RegionGuessResult } {
      const { level } = state;
      const country = countryOf.get(id);
      if (state.status !== 'playing' || !country) return { state, result: 'unknown' };
      if (country !== level.country) return { state, result: 'elsewhere' };
      if (level.guesses.includes(id)) return { state, result: 'repeat' };
      const guesses = [...level.guesses, id];
      if (id === level.division) {
        const missed = guesses.length - 1;
        const flawless = missed === 0;
        const base = REGION_POINTS_PER_LEVEL * level.number;
        const points = Math.round(base * MISS_SHARE[Math.min(missed, MISS_SHARE.length - 1)]! + (flawless ? base * REGION_FLAWLESS_SHARE : 0));
        const lives = flawless ? Math.min(REGION_MAX_LIVES, state.lives + 1) : state.lives;
        const mark = flawless ? 'flawless' : missed === 1 ? 'cleared' : 'missed';
        return { result: 'right', state: endLevel(state, { ...level, guesses, status: 'cleared', points, flawless }, lives, mark, id) };
      }
      if (guesses.length >= REGION_MISSES) {
        return { result: 'lost', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', id) };
      }
      return { result: 'wrong', state: { ...state, level: { ...level, guesses }, moves: [...state.moves, id] } };
    },

    /** Gives up on the level for a life. */
    skip(state: RegionState): RegionState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', REGION_SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: RegionState): RegionState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, level.division] };
    },
  };
}

export type RegionRun = ReturnType<typeof createRegionRun>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayRegionRun(game: RegionRun, seed: number, moves: readonly string[]): RegionState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === REGION_SKIP ? game.skip(state) : game.guess(state, move).state;
  }
  return state;
}
