import type { CityId } from '@geogames/geodata';
import { destination, distanceKm, type CircleCity, type CirclePuzzle } from './circle.ts';
import { createRng, pick, type Rng } from './rng.ts';

/**
 * City Circle Arcade: endless levels of "name the top N cities in this circle".
 * Circles can land anywhere in the world from the first level. What makes a
 * level easy is that most cities to find are well known (among the world's
 * most visited); later levels need fewer well-known ones, use smaller circles
 * and ask for more cities. Lives carry across levels.
 */

export interface LevelPlan {
  /** First level this plan applies to. */
  from: number;
  /** Cities to find. */
  target: number;
  /** Radius range in km (picked in 50 km steps). */
  radius: readonly [number, number];
  /** Share of the cities to find that must be well known (rounded up). With any, circles centre on a well-known city. */
  famousShare: number;
  /** Smallest city a circle may be centred on, when it needn't be a well-known one. */
  anchorMinPopulation: number;
  /** Every city to find must be at least this big. */
  topMinPopulation: number;
}

export const LEVEL_PLANS: readonly LevelPlan[] = [
  { from: 1, target: 3, radius: [1000, 3000], famousShare: 2 / 3, anchorMinPopulation: 0, topMinPopulation: 500_000 },
  { from: 5, target: 4, radius: [700, 2000], famousShare: 1 / 2, anchorMinPopulation: 0, topMinPopulation: 300_000 },
  { from: 9, target: 5, radius: [500, 1200], famousShare: 2 / 5, anchorMinPopulation: 0, topMinPopulation: 200_000 },
  { from: 13, target: 5, radius: [350, 800], famousShare: 1 / 5, anchorMinPopulation: 0, topMinPopulation: 100_000 },
  { from: 17, target: 6, radius: [250, 500], famousShare: 0, anchorMinPopulation: 300_000, topMinPopulation: 0 },
  { from: 21, target: 7, radius: [200, 350], famousShare: 0, anchorMinPopulation: 0, topMinPopulation: 0 },
];

/** How many of a plan's cities to find must be well known. */
export const famousNeeded = (plan: LevelPlan) => Math.ceil(plan.target * plan.famousShare - 1e-9);

export const START_LIVES = 5;
export const MAX_LIVES = 9;
/** Points per city are this × the level number. */
export const POINTS_PER_LEVEL = 10;
/** Each hint on a city takes this share off its points. */
export const HINT_COST = 0.5;
/**
 * Hints are scarce: a stock that starts at START_HINTS (max MAX_HINTS), refilled
 * by one for every flawless level. A hint shows a city's country and every third
 * letter (never the first, which the search box would complete), once per city;
 * past that it's knowing it or skipping it.
 */
export const START_HINTS = 3;
export const MAX_HINTS = 5;

export function planFor(level: number): LevelPlan {
  return [...LEVEL_PLANS].reverse().find((p) => level >= p.from)!;
}

export type ArcadeGuessResult = 'found' | 'in-circle' | 'outside' | 'repeat' | 'unknown';

export interface ArcadeLevel {
  number: number;
  puzzle: CirclePuzzle;
  target: number;
  /** Every guess in order, right or wrong. */
  guesses: readonly CityId[];
  /** Top cities revealed with a skip (no points). */
  skipped: readonly CityId[];
  /** Top cities hinted (1 = country and first letter shown). */
  hints: Readonly<Record<CityId, number>>;
  misses: number;
  points: number;
  status: 'playing' | 'cleared' | 'lost';
}

export interface ArcadeState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: ArcadeLevel;
  readonly score: number;
  readonly lives: number;
  /** Levels finished, for the summary. */
  readonly cleared: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** True when the last cleared level was perfect and earned a life. */
  readonly bonusLife: boolean;
  /** Hints left to spend. */
  readonly hintsLeft: number;
  /** True when the last cleared level was flawless and earned a hint back. */
  readonly bonusHint: boolean;
  /** Every circle so far, so new ones don't repeat them. */
  readonly past: readonly PastCircle[];
  /** City guesses, ">" (skip) and "?" (hint) in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export interface PastCircle {
  center: readonly [number, number];
  radiusKm: number;
  /** Its cities to find. */
  top: readonly CityId[];
}

export interface ArcadeOptions {
  cities: readonly CircleCity[];
  /** Well-known cities (the world's most visited): early levels are mostly about these. */
  famous: ReadonlySet<CityId>;
}

const SKIP = '>';
const HINT = '?';
/** A circle must hold this many cities beyond the target, so there's something to get wrong. */
const EXTRA_INSIDE = 3;
/** New circles stay this far from the last few. */
const MIN_SEPARATION_KM = 1000;
const SEPARATION_MEMORY = 6;
/** Levels whose answers can't come up again at all. */
const ANSWER_MEMORY = 4;
/**
 * Against every earlier circle of the game: at most this share of the two
 * circles' combined area may overlap, and at most this share of the smaller
 * circle's cities to find may be shared (rounded down: 1 of 3, 2 of 5). A
 * near-copy (London, Paris, Berlin again) is refused; a smaller circle inside
 * an earlier big one with mostly new answers (France after Western Europe) is fine.
 */
const MAX_OVERLAP = 0.5;
const MAX_SHARED_ANSWERS = 0.5;

/** Whether two circles' cities to find overlap too much. */
export const sharesTooMany = (a: readonly CityId[], b: readonly CityId[]) =>
  a.filter((id) => b.includes(id)).length > Math.floor(MAX_SHARED_ANSWERS * Math.min(a.length, b.length));
/** After this many tries a long game may repeat older circles, rather than run out. */
const STRICT_ATTEMPTS = 300;

/** Intersection over union of two circles (flat approximation, fine at these sizes). */
export function circleOverlap(a: Pick<PastCircle, 'center' | 'radiusKm'>, b: Pick<PastCircle, 'center' | 'radiusKm'>): number {
  const d = distanceKm(a.center, b.center);
  const [r1, r2] = [a.radiusKm, b.radiusKm];
  const areaA = Math.PI * r1 * r1;
  const areaB = Math.PI * r2 * r2;
  if (d >= r1 + r2) return 0;
  const lens =
    d <= Math.abs(r1 - r2)
      ? Math.PI * Math.min(r1, r2) ** 2
      : r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)) +
        r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)) -
        0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return lens / (areaA + areaB - lens);
}

export function createCircleArcade({ cities, famous }: ArcadeOptions) {
  const byId = new Map(cities.map((c) => [c.id, c]));

  function citiesWithin(center: readonly [number, number], radius: number): CityId[] {
    return cities
      .filter((c) => distanceKm(center, c.latlng) <= radius)
      .sort((a, b) => b.population - a.population)
      .map((c) => c.id);
  }

  function makePuzzle(rng: Rng, level: number, past: readonly PastCircle[]): CirclePuzzle {
    const plan = planFor(level);
    const needed = famousNeeded(plan);
    const anchors = cities.filter((c) => (needed > 0 ? famous.has(c.id) : c.population >= plan.anchorMinPopulation));
    const [min, max] = plan.radius;
    const recent = past.slice(-SEPARATION_MEMORY);
    const recentAnswers = past.slice(-ANSWER_MEMORY).flatMap((p) => p.top);
    for (let attempt = 0; attempt < STRICT_ATTEMPTS * 2; attempt++) {
      const strict = attempt < STRICT_ATTEMPTS;
      const anchor = pick(rng, anchors);
      if (recent.some((p) => distanceKm(p.center, anchor.latlng) < MIN_SEPARATION_KM)) continue;
      const radius = min + 50 * Math.floor(rng.next() * ((max - min) / 50 + 1));
      // Offset the centre so it doesn't sit on (and give away) a city.
      const center = destination(anchor.latlng, radius * rng.next() * 0.4, rng.next() * 2 * Math.PI);
      if (strict && past.some((p) => circleOverlap(p, { center, radiusKm: radius }) > MAX_OVERLAP)) continue;
      const inside = citiesWithin(center, radius);
      if (inside.length < plan.target + EXTRA_INSIDE) continue;
      const top = inside.slice(0, plan.target);
      if (top.filter((id) => famous.has(id)).length < needed) continue;
      if (byId.get(top[top.length - 1]!)!.population < plan.topMinPopulation) continue;
      if (top.some((id) => recentAnswers.includes(id))) continue;
      if (strict && past.some((p) => sharesTooMany(top, p.top))) continue;
      return { center, radiusKm: radius, inside };
    }
    throw new Error(`no circle for level ${level}`);
  }

  function newLevel(rng: Rng, number: number, past: readonly PastCircle[]): ArcadeLevel {
    const puzzle = makePuzzle(rng, number, past);
    return { number, puzzle, target: planFor(number).target, guesses: [], skipped: [], hints: {}, misses: 0, points: 0, status: 'playing' };
  }

  const top = (level: ArcadeLevel) => level.puzzle.inside.slice(0, level.target);
  const pastCircle = (level: ArcadeLevel): PastCircle => ({ center: level.puzzle.center, radiusKm: level.puzzle.radiusKm, top: top(level) });
  /** Top cities not yet found or skipped, best first. */
  const remaining = (level: ArcadeLevel) => top(level).filter((id) => !level.guesses.includes(id) && !level.skipped.includes(id));

  const cityPoints = (level: ArcadeLevel, id: CityId) =>
    Math.round(POINTS_PER_LEVEL * level.number * Math.max(0, 1 - HINT_COST * (level.hints[id] ?? 0)));

  /** Applies a finished-or-not level to the state: clears it, ends the game, or keeps playing. */
  function settle(state: ArcadeState, level: ArcadeLevel, livesLost: number, gained: number, move: string): ArcadeState {
    let lives = state.lives - livesLost;
    const done = remaining(level).length === 0;
    if (lives <= 0) {
      return { ...state, level: { ...level, status: 'lost' }, lives: 0, score: state.score + gained, status: 'over', moves: [...state.moves, move] };
    }
    const noHints = Object.keys(level.hints).length === 0;
    const perfect = done && level.misses === 0 && level.skipped.length === 0 && noHints;
    if (perfect) lives = Math.min(MAX_LIVES, lives + 1);
    // A hint back only for a flawless level, like the life.
    const bonusHint = perfect && state.hintsLeft < MAX_HINTS;
    return {
      ...state,
      level: done ? { ...level, status: 'cleared' } : level,
      lives,
      score: state.score + gained,
      cleared: state.cleared + (done ? 1 : 0),
      status: done ? 'level-clear' : 'playing',
      bonusLife: done && perfect,
      hintsLeft: state.hintsLeft + (bonusHint ? 1 : 0),
      bonusHint,
      moves: [...state.moves, move],
    };
  }

  /** 1-based rank inside the level's circle, or null when outside. */
  function rankOf(level: ArcadeLevel, id: CityId): number | null {
    const i = level.puzzle.inside.indexOf(id);
    return i < 0 ? null : i + 1;
  }

  /** The city the next hint is about: the best remaining one without a hint. Null when no hint is possible. */
  function hintTarget(level: ArcadeLevel): { id: CityId; hints: number } | null {
    const id = remaining(level).find((c) => !level.hints[c]);
    return id ? { id, hints: 0 } : null;
  }

  return {
    cities: byId,
    top,
    remaining,
    cityPoints,
    rankOf,
    hintTarget,

    start(seed: number): ArcadeState {
      const rng = createRng(seed);
      const level = newLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        score: 0,
        lives: START_LIVES,
        cleared: 0,
        status: 'playing',
        bonusLife: false,
        hintsLeft: START_HINTS,
        bonusHint: false,
        past: [pastCircle(level)],
        moves: [],
      };
    },

    guess(state: ArcadeState, id: CityId): { state: ArcadeState; result: ArcadeGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !byId.has(id)) return { state, result: 'unknown' };
      if (level.guesses.includes(id) || level.skipped.includes(id)) return { state, result: 'repeat' };
      const rank = rankOf(level, id);
      const result: ArcadeGuessResult = rank === null ? 'outside' : rank <= level.target ? 'found' : 'in-circle';
      const found = result === 'found';
      const gained = found ? cityPoints(level, id) : 0;
      const next: ArcadeLevel = {
        ...level,
        guesses: [...level.guesses, id],
        misses: level.misses + (found ? 0 : 1),
        points: level.points + gained,
      };
      // A wrong guess costs no life, only the level's perfect bonus.
      return { result, state: settle(state, next, 0, gained, id) };
    },

    /** Reveals the best remaining top city for a life; it scores nothing. */
    skip(state: ArcadeState): ArcadeState {
      const [first] = remaining(state.level);
      if (state.status !== 'playing' || !first) return state;
      return settle(state, { ...state.level, skipped: [...state.level.skipped, first] }, 1, 0, SKIP);
    },

    /** Spends a hint on the best remaining unhinted city: its country and first letter. Costs half its points. */
    hint(state: ArcadeState): ArcadeState {
      const target = state.status === 'playing' && state.hintsLeft > 0 ? hintTarget(state.level) : null;
      if (!target) return state;
      const hints = { ...state.level.hints, [target.id]: target.hints + 1 };
      return { ...state, hintsLeft: state.hintsLeft - 1, level: { ...state.level, hints }, moves: [...state.moves, HINT] };
    },

    /** Starts the next level after a cleared one. */
    nextLevel(state: ArcadeState): ArcadeState {
      if (state.status !== 'level-clear') return state;
      const rng = createRng(state.rngState);
      const level = newLevel(rng, state.level.number + 1, state.past);
      return {
        ...state,
        rngState: rng.state,
        level,
        status: 'playing',
        bonusLife: false,
        bonusHint: false,
        past: [...state.past, pastCircle(level)],
      };
    },
  };
}

export type CircleArcade = ReturnType<typeof createCircleArcade>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayCircleArcade(game: CircleArcade, seed: number, moves: readonly string[]): ArcadeState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    if (move === SKIP) state = game.skip(state);
    else if (move === HINT) state = game.hint(state);
    else state = game.guess(state, move).state;
  }
  return state;
}

/**
 * What a hint shows of a name (the country is shown beside it): every third
 * letter, starting with the third, so never the first one, which would let
 * the search box finish the name. Spaces and punctuation always show.
 */
export function hintText(name: string, hints: number): string {
  return [...name].map((ch, i) => (/[\s'’.-]/.test(ch) || (hints > 0 && i % 3 === 2) ? ch : '_')).join('');
}
