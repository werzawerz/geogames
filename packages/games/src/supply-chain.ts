import { type Country, type CountryId } from '@geogames/geodata';
import type { Commodity } from '@geogames/geodata/supply-chain';
import { createRng, pick, type Rng } from './rng.ts';
import { routeScopes, type RouteScope } from './route.ts';

/**
 * Supply Chain: a commodity is named (coffee, cobalt, crude oil) and you name the countries that
 * make the most of it, in any order. The map has no borders and shows nothing until you find a
 * producer; it then fills in, with its share of the world's output. Three wrong guesses (two from
 * level 21, one from level 36), or a skip, cost a life and end the level. The run has no end
 * but the lives.
 *
 * Each band tests a different skill:
 * 1. General knowledge of the world economy: famous goods with famous leaders, top 3.
 * 2. Knowing who really produces what: the order surprises people, top 4, then top 5.
 * 3. Depth: niche and regional goods, top 5.
 *
 * Fair rules about the edges of the list:
 * - A producer counts if it is in the top N, or within a tenth of the Nth's output: a near-tie
 *   is never the difference between a hit and a miss.
 * - Only countries with at least 3% of world output are ever asked for, and dependencies
 *   (New Caledonia) never are, though they take their place in the ranking.
 * - A wrong guess that is a top-10 producer says which place it holds.
 *
 * Only data the server has decides a score: the producers' ids, ranks and shares.
 */

export interface ChainLevelPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3;
  /** How many producers to find. */
  size: number;
  /** The tiers a level draws from (see Commodity.tier) and how often: [tier, weight]. */
  mix: readonly (readonly [1 | 2 | 3, number])[];
  /** Where the producers may be (see routeScopes). */
  scope: RouteScope;
  /** Wrong guesses that end the level: the last of them costs a life. */
  misses: number;
}

export const CHAIN_PLANS: readonly ChainLevelPlan[] = [
  { from: 1, band: 1, size: 3, mix: [[1, 1]], scope: 'no-africa', misses: 3 },
  {
    from: 9,
    band: 2,
    size: 4,
    mix: [
      [2, 0.6],
      [1, 0.4],
    ],
    scope: 'any',
    misses: 3,
  },
  {
    from: 15,
    band: 2,
    size: 5,
    mix: [
      [2, 0.6],
      [1, 0.4],
    ],
    scope: 'any',
    misses: 3,
  },
  {
    from: 21,
    band: 3,
    size: 5,
    mix: [
      [2, 0.5],
      [3, 0.3],
      [1, 0.2],
    ],
    scope: 'any',
    misses: 2,
  },
  {
    from: 36,
    band: 3,
    size: 5,
    mix: [
      [2, 0.5],
      [3, 0.3],
      [1, 0.2],
    ],
    scope: 'any',
    misses: 1,
  },
];

export const chainPlan = (level: number): ChainLevelPlan => [...CHAIN_PLANS].reverse().find((p) => level >= p.from)!;

export const CHAIN_START_LIVES = 3;
export const CHAIN_MAX_LIVES = 3;
/** Each producer found is worth this + the level number. */
export const CHAIN_POINTS_BASE = 5;
/** Share of a level's points kept after 0, 1 or 2 misses. */
const MISS_SHARE = [1, 0.7, 0.4];
/** A flawless level earns this share of its points again, and a life. */
export const CHAIN_FLAWLESS_SHARE = 0.5;
/** A level that ends in a lost life still pays this share for each producer found. */
export const CHAIN_PARTIAL_SHARE = 0.5;
/** A country is only asked for if it makes this share of the world's output. */
export const CHAIN_MIN_SHARE = 0.03;
/**
 * A commodity with fewer than three producers at 3% (cobalt, cement) is still asked, for exactly three countries,
 * as long as three have this share of the world.
 */
export const CHAIN_MIN_SHARE_SMALL = 0.015;
/** A producer within this share of the Nth's output counts as well. */
export const CHAIN_TIE_BAND = 0.1;
/** The ranks the data holds, and so the ranks a wrong guess can be told. */
export const CHAIN_RANKS = 10;
/** A level doesn't share more than this much of its answers with the last few levels' (of the smaller set). */
export const CHAIN_MAX_OVERLAP = 0.5;
/** How many earlier levels the overlap rule looks back over. */
export const CHAIN_OVERLAP_WINDOW = 3;
export const CHAIN_SKIP = 'skip';

export type ChainGuessResult = 'found' | 'wrong' | 'repeat' | 'unknown';
export type ChainMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface ChainLevel {
  number: number;
  commodity: string;
  /** Producers to find. */
  need: number;
  /** Countries tried, oldest first. */
  guesses: readonly CountryId[];
  /** The tried countries that count, oldest first. */
  found: readonly CountryId[];
  status: 'playing' | 'cleared' | 'lost';
  points: number;
  flawless: boolean;
}

export interface ChainState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: ChainLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly ChainMark[];
  /** The smallest producer named so far (the hardest find), for the end screen. */
  readonly best: { commodity: string; country: CountryId; share: number } | null;
  /** Commodities asked so far, oldest first. */
  readonly past: readonly string[];
  /** Country ids and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** What a level asks: how many to find, and the countries that count. */
export interface ChainAnswers {
  need: number;
  /** Every country that counts, biggest first. */
  accepted: readonly CountryId[];
  /** The commodity has only three real producers, so its list is three long at any level. */
  limited: boolean;
}

export function createSupplyChain({
  commodities,
  countries,
}: {
  commodities: readonly Pick<Commodity, 'id' | 'kind' | 'tier' | 'producers'>[];
  countries: readonly Country[];
}) {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const byCommodity = new Map(commodities.map((c) => [c.id, c]));
  // Dependencies rank but are never typed, asked or counted.
  const guessable = new Set(countries.filter((c) => c.sovereignty !== 'territory').map((c) => c.id));
  const { inScope } = routeScopes(countries);

  /** The countries that count for a level of `size`, or null when the commodity has too few real producers. */
  function answers(commodity: Pick<Commodity, 'producers'>, size: number): ChainAnswers | null {
    const typable = commodity.producers.filter((p) => guessable.has(p.id));
    let real = typable.filter((p) => p.share >= CHAIN_MIN_SHARE);
    let limited = false;
    if (real.length < 3) {
      // Cobalt and cement: three countries over 1.5% make a list of three, at any level.
      real = typable.filter((p) => p.share >= CHAIN_MIN_SHARE_SMALL);
      if (real.length < 3) return null;
      limited = true;
    }
    const need = limited ? 3 : Math.min(size, real.length);
    const cut = real[need - 1]!.value * (1 - CHAIN_TIE_BAND);
    return {
      need,
      accepted: real.filter((p) => p.value >= cut).map((p) => p.id),
      limited,
    };
  }

  /** A commodity's answers at a plan's size, if it can be asked there at all. */
  function planAnswers(id: string, plan: ChainLevelPlan): ChainAnswers | null {
    const commodity = byCommodity.get(id)!;
    const a = answers(commodity, plan.size);
    return a && a.accepted.every((c) => inScope(plan.scope, c)) ? a : null;
  }

  const overlapOk = (a: ChainAnswers, past: readonly string[], plan: ChainLevelPlan) =>
    past.slice(-CHAIN_OVERLAP_WINDOW).every((id) => {
      const before = answers(byCommodity.get(id)!, plan.size);
      if (!before) return true;
      const shared = a.accepted.filter((c) => before.accepted.includes(c)).length;
      return shared / Math.min(a.need, before.need) <= CHAIN_MAX_OVERLAP;
    });

  function nextCommodity(rng: Rng, plan: ChainLevelPlan, past: readonly string[]): string {
    const asked = new Set(past);
    const lastKind = byCommodity.get(past.at(-1) ?? '')?.kind;
    const fresh = commodities.filter((c) => !asked.has(c.id));
    // The level's tier is drawn from the plan's mix; the other tiers of the mix follow, and then the whole pool.
    let roll = rng.next() * plan.mix.reduce((sum, [, w]) => sum + w, 0);
    const drawn = plan.mix.find(([, w]) => (roll -= w) < 0) ?? plan.mix[0]!;
    const tiers = [drawn, ...plan.mix.filter((m) => m !== drawn)].map(([t]) => fresh.filter((c) => c.tier === t)).filter((g) => g.length);
    // Strictest first: a full-size list (never fewer than the plan's size, unless the commodity has fewer real
    // producers), the variety rules (not the same sort of thing twice in a row, not the same producers as lately).
    for (const [full, rules] of [
      [true, 2],
      [true, 1],
      [false, 1],
      [false, 0],
    ] as const) {
      for (const group of tiers) {
        const options = group.filter((c) => {
          const a = planAnswers(c.id, plan);
          if (!a || (full && a.need < plan.size && !a.limited)) return false;
          if (rules >= 1 && lastKind === c.kind) return false;
          return rules < 2 || overlapOk(a, past, plan);
        });
        if (options.length)
          return pick(
            rng,
            options.map((c) => c.id),
          );
      }
    }
    // The scope or the overlap rule ruled out everything fresh: any fresh commodity with enough producers.
    const any = fresh.filter((c) => answers(c, plan.size));
    if (any.length)
      return pick(
        rng,
        any.map((c) => c.id),
      );
    // Every commodity has been asked: the one asked longest ago.
    const all = commodities.filter((c) => answers(c, plan.size));
    return [...all].sort((a, b) => past.lastIndexOf(a.id) - past.lastIndexOf(b.id) || a.id.localeCompare(b.id))[0]!.id;
  }

  function makeLevel(rng: Rng, number: number, past: readonly string[]): ChainLevel {
    const plan = chainPlan(number);
    const commodity = nextCommodity(rng, plan, past);
    const a = answers(byCommodity.get(commodity)!, plan.size)!;
    return {
      number,
      commodity,
      need: a.need,
      guesses: [],
      found: [],
      status: 'playing',
      points: 0,
      flawless: false,
    };
  }

  const perFind = (level: ChainLevel) => CHAIN_POINTS_BASE + level.number;

  function endLevel(state: ChainState, level: ChainLevel, lives: number, mark: ChainMark, move: string): ChainState {
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
    commodities,
    countryName: (id: CountryId) => byId.get(id)?.name ?? id,
    answers: (id: string, level: number) => answers(byCommodity.get(id)!, chainPlan(level).size),

    /** The place a country holds among the countries a player can name (dependencies don't take a place), or null outside the top ten. */
    rank(commodity: string, id: CountryId): number | null {
      const i = byCommodity
        .get(commodity)!
        .producers.filter((p) => guessable.has(p.id))
        .findIndex((p) => p.id === id);
      return i >= 0 && i < CHAIN_RANKS ? i + 1 : null;
    },

    /** Whether players can name it: dependencies like New Caledonia can't be. */
    isNameable: (id: CountryId) => guessable.has(id),

    start(seed: number): ChainState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: CHAIN_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        best: null,
        past: [level.commodity],
        moves: [],
      };
    },

    guess(state: ChainState, id: CountryId): { state: ChainState; result: ChainGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !guessable.has(id)) return { state, result: 'unknown' };
      if (level.guesses.includes(id)) return { state, result: 'repeat' };
      const guesses = [...level.guesses, id];
      const a = answers(byCommodity.get(level.commodity)!, chainPlan(level.number).size)!;
      if (a.accepted.includes(id)) {
        const found = [...level.found, id];
        const share = byCommodity.get(level.commodity)!.producers.find((p) => p.id === id)!.share;
        if (!state.best || share < state.best.share) state = { ...state, best: { commodity: level.commodity, country: id, share } };
        if (found.length < level.need)
          return {
            result: 'found',
            state: {
              ...state,
              level: { ...level, guesses, found },
              moves: [...state.moves, id],
            },
          };
        const missed = guesses.length - found.length;
        const flawless = missed === 0;
        const base = perFind(level) * level.need;
        const points = Math.round(base * MISS_SHARE[missed]! + (flawless ? base * CHAIN_FLAWLESS_SHARE : 0));
        const lives = flawless ? Math.min(CHAIN_MAX_LIVES, state.lives + 1) : state.lives;
        const mark = flawless ? 'flawless' : missed === 1 ? 'cleared' : 'missed';
        return {
          result: 'found',
          state: endLevel(state, { ...level, guesses, found, status: 'cleared', points, flawless }, lives, mark, id),
        };
      }
      const missed = guesses.length - level.found.length;
      if (missed >= chainPlan(level.number).misses) {
        const points = Math.round(level.found.length * perFind(level) * CHAIN_PARTIAL_SHARE);
        return {
          result: 'wrong',
          state: endLevel(state, { ...level, guesses, status: 'lost', points }, state.lives - 1, 'lost', id),
        };
      }
      return {
        result: 'wrong',
        state: {
          ...state,
          level: { ...level, guesses },
          moves: [...state.moves, id],
        },
      };
    },

    /** Gives up on the level for a life; what was found still pays a little. */
    skip(state: ChainState): ChainState {
      if (state.status !== 'playing') return state;
      const points = Math.round(state.level.found.length * perFind(state.level) * CHAIN_PARTIAL_SHARE);
      return endLevel(state, { ...state.level, status: 'lost', points }, state.lives - 1, 'lost', CHAIN_SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: ChainState): ChainState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return {
        ...state,
        rngState: rng.state,
        level,
        status: 'playing',
        bonusLife: false,
        past: [...state.past, level.commodity],
      };
    },
  };
}

export type SupplyChain = ReturnType<typeof createSupplyChain>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replaySupplyChain(game: SupplyChain, seed: number, moves: readonly string[], observe?: (state: ChainState, move: string) => void): ChainState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === CHAIN_SKIP ? game.skip(state) : game.guess(state, move).state;
    observe?.(state, move);
  }
  return state;
}
