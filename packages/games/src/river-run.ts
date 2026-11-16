import type { River, RiverTier } from '@geogames/geodata/rivers';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * River Run: a river draws itself on a map from its source towards its mouth,
 * and you name it before it gets there. The earlier, the more points.
 *
 * Two wrong guesses are free; the third, a skip, or the line reaching the mouth
 * costs a life and ends the level. The run goes on until the lives are gone.
 *
 * Once half the river is drawn, four names are offered as a costed help: a
 * pick scores half what typing the name at that moment would, and a wrong pick
 * costs the level's life at once (free misses don't fit four options). Typing
 * one of the four names once they're shown counts as picking it.
 *
 * The ramp changes what you need to know, not how much the map gives away:
 * the great rivers first, then regional rivers, then tributaries and rivers
 * whose start misleads you. Speed moves on its own: each band starts slowly
 * and speeds up, so a new kind of river is never also a rushed one.
 *
 * The clock runs on the player's screen. A guess is logged with how much of
 * the river was drawn when it was made, and the score follows from that, so a
 * server replays it without a clock (like Border Blitz's time bonus).
 */

export interface RiverRunPlan {
  /** First level this plan applies to. */
  from: number;
  tier: RiverTier;
  /** Seconds the line takes from source to mouth on this plan's first level… */
  slowSeconds: number;
  /** …dropping by this much per level… */
  speedUp: number;
  /** …down to this. */
  fastSeconds: number;
  /** The map shows at least this many km across, so it sets the scene without pointing at the river. */
  viewKm: number;
}

export const RIVER_RUN_PLANS: readonly RiverRunPlan[] = [
  { from: 1, tier: 1, slowSeconds: 30, speedUp: 1.25, fastSeconds: 20, viewKm: 3600 },
  { from: 9, tier: 2, slowSeconds: 32, speedUp: 1, fastSeconds: 20, viewKm: 2600 },
  { from: 21, tier: 3, slowSeconds: 28, speedUp: 0.8, fastSeconds: 16, viewKm: 2000 },
  { from: 36, tier: 4, slowSeconds: 26, speedUp: 0.6, fastSeconds: 12, viewKm: 2000 },
];

export const riverRunPlan = (level: number): RiverRunPlan => [...RIVER_RUN_PLANS].reverse().find((p) => level >= p.from)!;

/** Seconds the river of `level` takes to draw itself. */
export const riverSeconds = (level: number): number => {
  const plan = riverRunPlan(level);
  return Math.max(plan.fastSeconds, plan.slowSeconds - (level - plan.from) * plan.speedUp);
};

const SKIP = '>';
const TIMEOUT = 'timeout';
/** A guess is `river@permille`: how much of the river (by length, in thousandths) was drawn. */
const AT = '@';
/** …followed by this when it was one of the offered names, not typed. */
const PICK = '@pick';

export const RIVER_RUN_START_LIVES = 3;
/** A flawless level gives a life back, but never above the start. */
export const RIVER_RUN_MAX_LIVES = 3;
/** Wrong guesses a level allows; the last of them costs a life and ends it. */
export const RIVER_RUN_MISSES = 3;
/** Points for a level are up to this × (its number + RIVER_RUN_POINTS_HEAD_START). */
export const RIVER_RUN_POINTS_PER_LEVEL = 10;
/** So early levels are worth something too: level 1 pays like level 5 would. */
export const RIVER_RUN_POINTS_HEAD_START = 4;
/** Once this share of the river is drawn, four names are offered. */
export const RIVER_RUN_CHOICE_SHARE = 0.5;
/** A picked name scores this share of a typed one at the same moment. */
export const RIVER_RUN_PICK_FACTOR = 0.5;
/** A level is flawless when named first time with no more than this share of the river drawn. */
export const RIVER_RUN_FLAWLESS_SHARE = 0.5;
/** How many levels back a river can't come again, once a band has used up its own rivers. */
const RUN_MEMORY = 60;

export interface RiverGuess {
  id: string;
  /** Share of the river drawn when it was made, 0–1. */
  share: number;
  /** One of the offered names, not typed. */
  picked?: boolean;
}

export interface RiverRunLevel {
  number: number;
  river: string;
  /** Seconds the line takes to draw. */
  seconds: number;
  guesses: readonly RiverGuess[];
  points: number;
  flawless: boolean;
  status: 'playing' | 'cleared' | 'lost';
}

export type RiverGuessResult = 'right' | 'wrong' | 'repeat' | 'unknown';

/** One mark per level for a spoiler-free result; 'lost' is a level that cost a life. */
export type RiverRunMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface RiverRunState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: RiverRunLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done (cleared or not) and shows its river, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** How the last level ended, when it was lost. */
  readonly lostBy: 'misses' | 'pick' | 'skip' | 'timeout' | null;
  /** True when the level just cleared gave a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly RiverRunMark[];
  /** Rivers of earlier levels, oldest first. */
  readonly past: readonly string[];
  /** Guesses (`id@permille`), skips and timeouts; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export interface RiverRunOptions {
  rivers: readonly Pick<River, 'id' | 'name' | 'tier' | 'continent' | 'anchor'>[];
}

export function createRiverRun({ rivers }: RiverRunOptions) {
  const byId = new Map(rivers.map((r) => [r.id, r]));

  function makeLevel(rng: Rng, number: number, past: readonly string[]): RiverRunLevel {
    const plan = riverRunPlan(number);
    const used = new Set(past);
    const recent = new Set(past.slice(-RUN_MEMORY));
    const lastContinent = byId.get(past.at(-1) ?? '')?.continent;
    // The band's own unused rivers; once they run out (an endless run), any unused tributary or
    // regional river, and after that anything not seen for a long while.
    const options = [
      rivers.filter((r) => r.tier === plan.tier && !used.has(r.id)),
      rivers.filter((r) => r.tier >= 2 && !used.has(r.id)),
      rivers.filter((r) => r.tier >= 2 && !recent.has(r.id)),
      rivers.filter((r) => r.id !== past.at(-1)),
    ].find((list) => list.length > 0)!;
    // Around the world: never the same continent twice in a row while there's a choice.
    const elsewhere = options.filter((r) => r.continent !== lastContinent);
    const river = pick(rng, elsewhere.length > 0 ? elsewhere : options);
    return { number, river: river.id, seconds: riverSeconds(number), guesses: [], points: 0, flawless: false, status: 'playing' };
  }

  const levelPoints = (level: RiverRunLevel, share: number, flawless: boolean, picked: boolean) =>
    riverRunPoints(level.number, share) * (flawless ? 1.5 : 1) * (picked ? RIVER_RUN_PICK_FACTOR : 1);

  function endLevel(
    state: RiverRunState,
    level: RiverRunLevel,
    lives: number,
    mark: RiverRunMark,
    move: string,
    lostBy: RiverRunState['lostBy'],
  ): RiverRunState {
    return {
      ...state,
      level,
      lives,
      lostBy,
      bonusLife: lives > state.lives,
      score: state.score + level.points,
      status: lives > 0 ? 'level-over' : 'over',
      marks: [...state.marks, mark],
      moves: [...state.moves, move],
    };
  }

  const lose = (state: RiverRunState, move: string, lostBy: NonNullable<RiverRunState['lostBy']>) =>
    state.status !== 'playing' ? state : endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', move, lostBy);

  return {
    rivers: byId,

    start(seed: number): RiverRunState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: RIVER_RUN_START_LIVES,
        score: 0,
        status: 'playing',
        lostBy: null,
        bonusLife: false,
        marks: [],
        past: [level.river],
        moves: [],
      };
    },

    /** Wrong guesses the level still allows before one costs a life. */
    missesLeft: (level: RiverRunLevel) => RIVER_RUN_MISSES - level.guesses.filter((g) => g.id !== level.river).length,

    /**
     * Names a river with `share` (0–1) of the level's river drawn; `picked` when it was one
     * of the offered names, which are only offered from RIVER_RUN_CHOICE_SHARE.
     */
    guess(state: RiverRunState, id: string, share: number, picked = false): { state: RiverRunState; result: RiverGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !byId.has(id)) return { state, result: 'unknown' };
      if (level.guesses.some((g) => g.id === id)) return { state, result: 'repeat' };
      // Logged to the thousandth, and never earlier than a guess before it: the line only grows.
      const drawn = Math.min(999, Math.max(Math.round(share * 1000), Math.round((level.guesses.at(-1)?.share ?? 0) * 1000), 0));
      // Once the four names are offered, typing one of them counts as picking it: the screen
      // shows them, so typing can't be a way round the pick's cost.
      if (drawn >= RIVER_RUN_CHOICE_SHARE * 1000 && riverChoices(rivers, level.river, level.number, state.seed).includes(id)) picked = true;
      const permille = picked ? Math.max(drawn, RIVER_RUN_CHOICE_SHARE * 1000) : drawn;
      const guesses = [...level.guesses, { id, share: permille / 1000, ...(picked ? { picked } : {}) }];
      const move = `${id}${AT}${permille}${picked ? PICK : ''}`;
      // Four options leave no room for free misses: a wrong pick costs the life at once.
      if (id !== level.river && picked) {
        return { result: 'wrong', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', move, 'pick') };
      }
      if (id !== level.river) {
        const misses = guesses.length;
        if (misses < RIVER_RUN_MISSES) {
          return { result: 'wrong', state: { ...state, level: { ...level, guesses }, moves: [...state.moves, move] } };
        }
        return { result: 'wrong', state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', move, 'misses') };
      }
      const flawless = guesses.length === 1 && !picked && permille / 1000 <= RIVER_RUN_FLAWLESS_SHARE;
      const points = Math.round(levelPoints(level, permille / 1000, flawless, picked));
      const cleared: RiverRunLevel = { ...level, guesses, points, flawless, status: 'cleared' };
      const lives = flawless ? Math.min(RIVER_RUN_MAX_LIVES, state.lives + 1) : state.lives;
      const mark: RiverRunMark = flawless ? 'flawless' : guesses.length === 1 ? 'cleared' : 'missed';
      return { result: 'right', state: endLevel(state, cleared, lives, mark, move, null) };
    },

    /** Gives the level up for a life. */
    skip: (state: RiverRunState) => lose(state, SKIP, 'skip'),

    /** The line reached the mouth unnamed: like a skip. */
    timeout: (state: RiverRunState) => lose(state, TIMEOUT, 'timeout'),

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: RiverRunState): RiverRunState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', lostBy: null, bonusLife: false, past: [...state.past, level.river] };
    },
  };
}

export type RiverRun = ReturnType<typeof createRiverRun>;

/** A level's worth for naming its river (typed) with `share` of it drawn: 30% to all of it. */
export const riverRunPoints = (level: number, share: number) =>
  RIVER_RUN_POINTS_PER_LEVEL * (level + RIVER_RUN_POINTS_HEAD_START) * (0.3 + 0.7 * (1 - share));

/** How many of the nearest rivers of a kind the wrong options come from: fewer, so closer, as levels rise. */
const choiceWindow = (level: number) => (level < 9 ? 8 : level < 21 ? 6 : 4);
/** The other two wrong options come from this many of the rivers nearest the first. */
const PIVOT_WINDOW = 4;

/**
 * The four names offered once half the river is drawn: the answer and three real
 * rivers of the same kind (a tier either side) from near it, nearer as the
 * levels rise, in a shuffled order. Seeded by the run and level, so it's
 * the same after a reload, and on the server, which needs it to score a typed
 * name that was on offer as a pick.
 */
export function riverChoices(
  rivers: readonly Pick<River, 'id' | 'tier' | 'anchor'>[],
  answerId: string,
  level: number,
  seed: number,
): string[] {
  const answer = rivers.find((r) => r.id === answerId)!;
  const apart = (from: Pick<River, 'anchor'>) => (r: Pick<River, 'anchor'>) => {
    const [[x, y], [a, b]] = [from.anchor, r.anchor];
    return Math.hypot((a - x) * Math.cos((y * Math.PI) / 180), b - y);
  };
  const byDistance = (from: Pick<River, 'anchor'>, list: typeof rivers) => [...list].sort((a, b) => apart(from)(a) - apart(from)(b));
  const kind = rivers.filter((r) => r.id !== answerId && Math.abs(r.tier - answer.tier) <= 1);
  const rng = createRng((seed ^ Math.imul(level, 2654435761)) >>> 0);
  // One wrong option near the answer, then two near that one: the answer sits at the edge of the
  // group as often as in its middle, so "the one in the middle" isn't a tell.
  const near = byDistance(answer, kind).slice(0, choiceWindow(level));
  const pivot = near[Math.floor(rng.next() * near.length)]!;
  const around = byDistance(pivot, kind.filter((r) => r !== pivot)).slice(0, PIVOT_WINDOW);
  const options = [answerId, pivot.id];
  while (options.length < 4 && around.length > 0) options.push(around.splice(Math.floor(rng.next() * around.length), 1)[0]!.id);
  // Fisher-Yates, so the answer's place has no pattern.
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}

/** The moves a skip and a timeout are logged as. */
export const RIVER_RUN_SKIP = SKIP;
export const RIVER_RUN_TIMEOUT = TIMEOUT;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayRiverRun(game: RiverRun, seed: number, moves: readonly string[]): RiverRunState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    if (move === SKIP) state = game.skip(state);
    else if (move === TIMEOUT) state = game.timeout(state);
    else {
      const [id = '', permille = '', pick] = move.split(AT);
      state = game.guess(state, id, Number(permille) / 1000 || 0, `${AT}${pick}` === PICK).state;
    }
  }
  return state;
}
