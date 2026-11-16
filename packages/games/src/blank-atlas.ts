import type { BlankAtlasFeature, BlankAtlasKind } from '@geogames/geodata/blank-atlas';
import { distanceKm } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * Blank Atlas: a sea, range, desert, lake, peninsula or island lights up on a
 * shaded-relief map with no labels and no borders, and you pick its name from
 * four of the same kind (four deserts, four straits). A right pick is
 * flawless and gives a life back (3 at most); a wrong pick or a skip costs
 * the level's life. The run has no end but the lives.
 *
 * The ramp changes what you need to know, not how much is hidden: headline
 * features against far-off look-alikes first, then regional features, then
 * straits, small ranges and archipelagos, against their neighbours.
 */

/** How alike the wrong options are: far away, a few thousand km off, or the answer's neighbours. */
export type BlankAtlasDistractors = 'far' | 'mid' | 'near' | 'nearest';

export interface BlankAtlasPlan {
  /** First level this plan applies to. */
  from: number;
  /** Which tier of features is asked (see the build script's list). */
  tier: 1 | 2 | 3;
  /** The map shows at least this far around the feature, so there's enough coast to find your way. */
  frameKm: number;
  distractors: BlankAtlasDistractors;
}

export const BLANK_ATLAS_PLANS: readonly BlankAtlasPlan[] = [
  { from: 1, tier: 1, frameKm: 2000, distractors: 'far' },
  { from: 5, tier: 1, frameKm: 2000, distractors: 'mid' },
  { from: 9, tier: 2, frameKm: 1300, distractors: 'mid' },
  { from: 15, tier: 2, frameKm: 1300, distractors: 'near' },
  { from: 21, tier: 3, frameKm: 700, distractors: 'near' },
  { from: 31, tier: 3, frameKm: 700, distractors: 'nearest' },
];

export const blankAtlasPlan = (level: number): BlankAtlasPlan => [...BLANK_ATLAS_PLANS].reverse().find((p) => level >= p.from)!;

/** The map always shows this much around a feature (or a shore, when that's further), so you can find your way. */
const MIN_VIEW_KM = 300;
/** A small feature gets a view at most this many times its size, up to the plan's: it stays easy to see. */
const VIEW_PER_SIZE = 8;

/**
 * How far around a feature's centre the map shows: all of the feature, at least
 * the plan's view (closer for a small feature, so it stays clearly visible), and
 * always a shore, the coast or a big lake, so an inland range isn't lost in blank land.
 */
export function blankAtlasViewKm(feature: BlankAtlasFeature, level: number): number {
  const plan = blankAtlasPlan(level);
  return Math.round(
    Math.max(feature.radiusKm * 1.15, feature.coastKm + MIN_VIEW_KM, Math.min(plan.frameKm, Math.max(feature.radiusKm * VIEW_PER_SIZE, MIN_VIEW_KM))),
  );
}

const SKIP = '>';
export const BLANK_ATLAS_OPTIONS = 4;
export const BLANK_ATLAS_START_LIVES = 3;
/** A flawless level gives a life back, but never above the start. */
export const BLANK_ATLAS_MAX_LIVES = 3;
/** A right pick is worth this × the level's number. */
export const BLANK_ATLAS_POINTS_PER_LEVEL = 15;
/** A feature isn't asked again within this many levels. */
export const BLANK_ATLAS_MEMORY = 150;
/** A new feature is at least this far from the last two, so a run moves around the world. */
export const BLANK_ATLAS_NEAR_KM = 1500;
/** 'far' wrong options are at least this far from the answer… */
export const BLANK_ATLAS_FAR_KM = 3000;
/** …and 'mid' ones within this band. */
export const BLANK_ATLAS_MID_KM: readonly [number, number] = [800, 5000];
/** 'near' wrong options are drawn from this many of the answer's nearest look-alikes. */
const NEAR_POOL = 6;

/** Kinds that ask for the same knowledge: two in a row would feel like the same question. */
export type BlankAtlasGroup = 'water' | 'lake' | 'mountains' | 'dry land' | 'coast and islands';
export const blankAtlasGroup = (kind: BlankAtlasKind): BlankAtlasGroup => {
  switch (kind) {
    case 'sea':
    case 'gulf':
    case 'strait':
    case 'reef':
      return 'water';
    case 'lake':
      return 'lake';
    case 'range':
      return 'mountains';
    case 'peninsula':
    case 'island':
    case 'islands':
    case 'coast':
    case 'isthmus':
      return 'coast and islands';
    default:
      return 'dry land';
  }
};

export interface BlankAtlasLevel {
  number: number;
  /** The feature to name. */
  feature: string;
  /** Four feature ids of the same kind, the answer among them, in the order shown. */
  options: readonly string[];
  /** The option picked, once it is. */
  picked: string | null;
  points: number;
  status: 'playing' | 'cleared' | 'lost';
}

export type BlankAtlasGuessResult = 'right' | 'wrong' | 'unknown';

/** One mark per level for a spoiler-free result; 'lost' is a level that cost a life. */
export type BlankAtlasMark = 'flawless' | 'lost';

export interface BlankAtlasState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: BlankAtlasLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done (cleared or not) and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just cleared gave a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly BlankAtlasMark[];
  /** Features asked so far, for keeping new ones fresh. */
  readonly past: readonly string[];
  /** Options picked, or a skip; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** A copy of `items` in random order (Fisher–Yates). */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function createBlankAtlas(features: readonly BlankAtlasFeature[]) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const byTier = (tier: number) => features.filter((f) => f.tier === tier);

  function pickFeature(rng: Rng, number: number, past: readonly string[]): BlankAtlasFeature {
    const plan = blankAtlasPlan(number);
    const remembered = new Set(past.slice(-BLANK_ATLAS_MEMORY));
    const recent = past.slice(-2).map((id) => byId.get(id)!);
    const last = recent.at(-1);
    // Not a neighbour of the last two, nor the same kind of question as the last one.
    const varied = (f: BlankAtlasFeature) =>
      (!last || blankAtlasGroup(f.kind) !== blankAtlasGroup(last.kind)) &&
      recent.every((r) => distanceKm(r.center, f.center) >= BLANK_ATLAS_NEAR_KM);
    // Each pass gives up a rule, only when nothing keeps it: first the variety, then the tier
    // (an easier one, never needed in testing), and last the memory.
    const passes: (() => BlankAtlasFeature[])[] = [
      () => byTier(plan.tier).filter((f) => !remembered.has(f.id) && varied(f)),
      () => byTier(plan.tier).filter((f) => !remembered.has(f.id)),
      () => features.filter((f) => f.tier <= plan.tier && !remembered.has(f.id)),
      () => features.filter((f) => f.id !== past.at(-1)),
    ];
    for (const pass of passes) {
      const options = pass();
      if (options.length > 0) return pick(rng, options);
    }
    throw new Error(`no Blank Atlas level ${number}`);
  }

  /**
   * Three wrong options of the same kind, as alike as the plan asks: far-off
   * ones first, then a few thousand km away, then the answer's neighbours.
   * They come from the answer's own tier while there are enough, so "pick the
   * obscure one" (or the famous one) doesn't work; never a more obscure tier
   * than the next one up; and never one the lit-up area also fits, because it's
   * part of the answer, or the answer part of it (`related`).
   */
  function distractors(rng: Rng, target: BlankAtlasFeature, plan: BlankAtlasPlan): BlankAtlasFeature[] {
    const related = new Set(target.related);
    const alike = features
      .filter((f) => f.kind === target.kind && f.id !== target.id && !related.has(f.id) && f.tier <= Math.max(plan.tier, target.tier) + 1)
      .map((f) => ({ f, km: distanceKm(f.center, target.center) }))
      .sort((a, b) => a.km - b.km);
    const need = BLANK_ATLAS_OPTIONS - 1;
    const aim = { far: Infinity, mid: 2500, near: 0, nearest: 0 }[plan.distractors];
    /** The pool's options in the plan's band (shuffled), then the rest, nearest the band first. */
    const ranked = (pool: typeof alike) => {
      const band = {
        far: () => shuffled(rng, pool.filter((a) => a.km >= BLANK_ATLAS_FAR_KM)),
        mid: () => shuffled(rng, pool.filter((a) => a.km >= BLANK_ATLAS_MID_KM[0] && a.km <= BLANK_ATLAS_MID_KM[1])),
        near: () => shuffled(rng, pool.slice(0, NEAR_POOL)),
        nearest: () => pool.slice(0, need),
      }[plan.distractors]().slice(0, need);
      const rest = pool.filter((a) => !band.includes(a)).sort((a, b) => Math.abs(a.km - aim) - Math.abs(b.km - aim));
      return [...band, ...rest];
    };
    const sameTier = ranked(alike.filter((a) => a.f.tier === target.tier));
    const otherTiers = ranked(alike.filter((a) => a.f.tier !== target.tier));
    return [...sameTier, ...otherTiers].slice(0, need).map((a) => a.f);
  }

  function makeLevel(rng: Rng, number: number, past: readonly string[]): BlankAtlasLevel {
    const target = pickFeature(rng, number, past);
    const wrong = distractors(rng, target, blankAtlasPlan(number));
    const options = shuffled(rng, [target, ...wrong]).map((f) => f.id);
    return { number, feature: target.id, options, picked: null, points: 0, status: 'playing' };
  }

  /** Ends a level, cleared or not, and the run with it when the lives are gone. */
  function endLevel(state: BlankAtlasState, level: BlankAtlasLevel, lives: number, mark: BlankAtlasMark, move: string): BlankAtlasState {
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
    features: byId,

    start(seed: number): BlankAtlasState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: BLANK_ATLAS_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        past: [level.feature],
        moves: [],
      };
    },

    /** Picks one of the level's options: right clears it (and gives a life back), wrong costs its life. */
    guess(state: BlankAtlasState, id: string): { state: BlankAtlasState; result: BlankAtlasGuessResult } {
      const { level } = state;
      // Only the four options can be picked; anything else isn't a guess and costs nothing.
      if (state.status !== 'playing' || !level.options.includes(id)) return { state, result: 'unknown' };
      if (id !== level.feature) {
        return { result: 'wrong', state: endLevel(state, { ...level, picked: id, status: 'lost' }, state.lives - 1, 'lost', id) };
      }
      const cleared: BlankAtlasLevel = { ...level, picked: id, points: BLANK_ATLAS_POINTS_PER_LEVEL * level.number, status: 'cleared' };
      return { result: 'right', state: endLevel(state, cleared, Math.min(BLANK_ATLAS_MAX_LIVES, state.lives + 1), 'flawless', id) };
    },

    /** Gives the level up for a life, like a wrong pick. */
    skip(state: BlankAtlasState): BlankAtlasState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: BlankAtlasState): BlankAtlasState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, level.feature] };
    },
  };
}

export type BlankAtlas = ReturnType<typeof createBlankAtlas>;

/** The move a skip is logged as. */
export const BLANK_ATLAS_SKIP = SKIP;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayBlankAtlas(game: BlankAtlas, seed: number, moves: readonly string[]): BlankAtlasState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    state = move === SKIP ? game.skip(state) : game.guess(state, move).state;
  }
  return state;
}
