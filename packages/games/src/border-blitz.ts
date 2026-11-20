import { EXCLAVES, TERRITORY_OWNERS, countryProminence, type Continent, type Country, type CountryId } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';
import { buildBorderGraph, routeScopes, type RouteScope } from './route.ts';

/**
 * Border Blitz: a country is lit up on a map without borders; name all of its
 * neighbours before the clock runs out. A run is up to 20 levels, ordered from
 * famous countries with famous neighbours to obscure ones, with less time per
 * neighbour as it goes. Lives carry over the whole run: a wrong country costs
 * one, a flawless level earns one back. Running out of lives or time, or giving
 * up on a level, ends the run.
 *
 * Neighbours come from the same border graph as Border Route, so bridges and
 * tunnels (the Channel Tunnel, the Øresund Bridge) count. Only countries are
 * asked or answers, not territories: Hong Kong doesn't count as China's neighbour.
 * Naming a territory's owner (France for Brazil, through French Guiana) is a
 * free pass, not a mistake: that border just doesn't count here.
 *
 * The clock runs on the player's screen, which turns it into moves: TIMEOUT
 * when it runs out, and `t:<seconds>` for the seconds left when a level is
 * cleared, which earn a bonus. So the score still follows from the moves alone
 * and a server can replay it.
 */

export interface BlitzLevelPlan {
  /** First level this plan applies to. */
  from: number;
  scope: RouteScope;
  /** Seconds on the clock per neighbour, on top of BLITZ_BASE_SECONDS. */
  secondsEach: number;
  /** Keeps out Central Asia and the Caucasus, as the country or an answer: well known only by name. */
  familiar?: boolean;
  /** How often an African country is asked, at most; Africa would otherwise take half the levels. */
  africaShare?: number;
}

/** What each stretch of the run allows; which country comes when is set by `blitzDifficulty`. */
export const BLITZ_LEVELS: readonly BlitzLevelPlan[] = [
  { from: 1, scope: 'known', secondsEach: 6, familiar: true },
  { from: 5, scope: 'no-africa', secondsEach: 5 },
  { from: 9, scope: 'any', secondsEach: 4, africaShare: 0.3 },
  { from: 13, scope: 'any', secondsEach: 3.5, africaShare: 0.3 },
  { from: 17, scope: 'any', secondsEach: 3, africaShare: 0.35 },
];

export const BLITZ_BASE_SECONDS = 5;
/** Seconds a wrong answer takes off the clock. The screen applies it; the score doesn't depend on it. */
export const BLITZ_WRONG_SECONDS = 2;
export const BLITZ_START_LIVES = 3;
export const BLITZ_MAX_LIVES = 5;
/** Points per neighbour are this × the level number. */
export const BLITZ_POINTS_PER_LEVEL = 10;
/** A flawless level earns this share of its neighbour points again, and a life. */
export const BLITZ_FLAWLESS_SHARE = 0.5;
/** Points per second left on the clock, × the level number. */
export const BLITZ_TIME_POINTS = 2;
/** From this level on, the screen doesn't say how many neighbours there are. */
export const BLITZ_HIDDEN_COUNT_FROM = 11;
/** Fewer neighbours than this makes a level too quick to be worth playing. */
const MIN_NEIGHBOURS = 3;
/**
 * How many fitting countries nearest its place on the difficulty scale a level
 * picks from: many at first, so runs don't keep opening on the same few
 * countries, then fewer, to keep the order.
 */
const choices = (level: number) => Math.max(14, 39 - 4 * level);
/**
 * Prominence (people and economy) undersells small countries players know by
 * name anyway: Liechtenstein, Slovenia, Uruguay. Here they count as at least this
 * well known.
 */
const KNOWN_BY_NAME: Partial<Record<Continent, number>> = { Europe: 0.7, 'South America': 0.6 };
/** A new country may share at most this share of the smaller neighbour set with an earlier one. */
const MAX_SHARED = 0.5;
/** No two countries from the same subregion within this many levels. */
const SUBREGION_GAP = 3;
/** At most this many African countries in a row. */
const MAX_AFRICA_IN_A_ROW = 2;
/** The Caucasus, which the UN counts as Western Asia; Central Asia is a subregion of its own. */
const CAUCASUS: readonly CountryId[] = ['ARM', 'AZE', 'GEO'];
/** The move the screen sends when the clock runs out. */
export const BLITZ_TIMEOUT = 'timeout';
/** The move the screen sends when the player gives up on a level. */
export const BLITZ_GIVE_UP = 'give-up';
const TIME_MOVE = 't:';

export const blitzPlan = (level: number): BlitzLevelPlan => [...BLITZ_LEVELS].reverse().find((p) => level >= p.from)!;

/** Seconds on the clock for a level whose country has `neighbours` neighbours. */
export const blitzSeconds = (level: number, neighbours: number) => BLITZ_BASE_SECONDS + Math.round(blitzPlan(level).secondsEach * neighbours);

/** The bonus for clearing a level without a wrong answer. */
export const blitzFlawlessBonus = (level: number, neighbours: number) =>
  Math.round(BLITZ_POINTS_PER_LEVEL * level * neighbours * BLITZ_FLAWLESS_SHARE);

/** 'territory': a neighbour only through a territory (France for Brazil), which is free. */
export type BlitzGuessResult = 'found' | 'wrong' | 'repeat' | 'target' | 'territory' | 'unknown';

export interface BlitzState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: number;
  readonly target: CountryId;
  /** The target's neighbours, the answers. */
  readonly neighbours: readonly CountryId[];
  readonly found: readonly CountryId[];
  /** Wrong answers on this level; naming one again is free. */
  readonly wrong: readonly CountryId[];
  /** Carried over the whole run. */
  readonly lives: number;
  readonly score: number;
  readonly status: 'playing' | 'level-clear' | 'over';
  /** Why the run ended early. */
  readonly ended: 'lives' | 'time' | 'gave-up' | null;
  /** True when the last level of the run was cleared. */
  readonly completed: boolean;
  /** True when the level just cleared was flawless and earned a life (or would have, at full lives). */
  readonly bonusLife: boolean;
  /** Seconds left that were turned into points on the level just cleared, if any. */
  readonly secondsLeft: number | null;
  /** Every country asked so far, so none comes back. */
  readonly past: readonly CountryId[];
  /** For each cleared level, whether it was flawless: for the shared result. */
  readonly cleared: readonly boolean[];
  /** Answers, timeouts, give-ups and time left, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export function createBorderBlitz({ countries, rounds }: { countries: readonly Country[]; rounds: number }) {
  // Border Route's graph (with its territories, so it is the very same graph), then only countries.
  const graph = buildBorderGraph(countries);
  const sovereign = countries.filter((c) => c.sovereignty !== 'territory');
  const isSovereign = new Set(sovereign.map((c) => c.id));
  const neighbourSets = new Map(sovereign.map((c) => [c.id, (graph.get(c.id) ?? []).filter((n) => isSovereign.has(n)).sort()]));
  const neighboursOf = (id: CountryId): readonly CountryId[] => neighbourSets.get(id) ?? [];
  const { inScope, isRemote } = routeScopes(countries);
  const prominence = countryProminence(sovereign);
  const byId = new Map(countries.map((c) => [c.id, c]));
  const known = (id: CountryId) => Math.max(prominence.get(id) ?? 0, KNOWN_BY_NAME[byId.get(id)!.continent] ?? 0);

  /**
   * How hard a country's neighbours are to name: each neighbour adds a little,
   * an obscure one far more, and an obscure country is harder to picture too.
   * Belgium is about 1.8, Austria and Brazil about 3.1, the Central African
   * Republic 4.9, China 5.9.
   */
  const difficulty = (id: CountryId) =>
    neighboursOf(id).reduce((sum, n) => sum + 0.05 + (1 - known(n)) ** 1.5, 0) + 3 * (1 - known(id));
  // Countries without neighbours (islands) are never asked, nor are those with too few to be a level.
  const askable = sovereign
    .filter((c) => neighboursOf(c.id).length >= MIN_NEIGHBOURS)
    .sort((a, b) => difficulty(a.id) - difficulty(b.id) || a.id.localeCompare(b.id));
  const isAfrican = (id: CountryId) => byId.get(id)?.continent === 'Africa';
  /**
   * Each country's place on the difficulty scale, 0 (easiest) to 1, among the
   * African countries or among the rest: a level picks from one or the other, and
   * a late level should get the hardest of either.
   */
  const rankOf = new Map(
    [askable.filter((c) => isAfrican(c.id)), askable.filter((c) => !isAfrican(c.id))].flatMap((group) =>
      group.map((c, i) => [c.id, i / Math.max(1, group.length - 1)] as const),
    ),
  );

  const subregion = (id: CountryId) => byId.get(id)?.subregion;
  const lessKnown = (id: CountryId) => subregion(id) === 'Central Asia' || CAUCASUS.includes(id);
  /** Spain reaches Morocco only through Ceuta and Melilla: that doesn't make Spain an unfamiliar level. */
  const onlyViaExclave = (id: CountryId, n: CountryId) =>
    EXCLAVES.some((e) => e.country === id && e.borders.includes(n) && !e.mainlandToo?.includes(n));

  /**
   * The territory through which `guess` borders `target`, when it does only that
   * way: French Guiana for France and Brazil (either way round), Gibraltar for
   * Spain and the United Kingdom.
   */
  function throughTerritory(target: CountryId, guess: CountryId): CountryId | null {
    if (guess === target || neighboursOf(target).includes(guess)) return null;
    for (const [territory, owner] of Object.entries(TERRITORY_OWNERS)) {
      const touches = graph.get(territory) ?? [];
      if ((owner === guess && touches.includes(target)) || (owner === target && touches.includes(guess))) return territory;
    }
    return null;
  }

  const fits = (c: Country, plan: BlitzLevelPlan) => {
    const n = neighboursOf(c.id);
    return (
      inScope(plan.scope, c.id) &&
      // A familiar level shouldn't need the unfamiliar regions as answers either.
      (plan.scope === 'any' || !n.some((a) => isRemote(a) && !onlyViaExclave(c.id, a))) &&
      (!plan.familiar || (!lessKnown(c.id) && !n.some(lessKnown)))
    );
  };
  /** Too much like an earlier level: over half the smaller set of neighbours in common. */
  const overlaps = (a: CountryId, b: CountryId) => {
    const na = neighboursOf(a);
    const nb = neighboursOf(b);
    return na.filter((n) => nb.includes(n)).length > MAX_SHARED * Math.min(na.length, nb.length);
  };

  /**
   * Africa has most of the countries with many neighbours, so left alone it takes
   * half the later levels. This asks an African country at most `africaShare` of
   * the time, and never more than MAX_AFRICA_IN_A_ROW in a row.
   */
  function balanceAfrica(rng: Rng, plan: BlitzLevelPlan, past: readonly CountryId[], candidates: readonly Country[]): readonly Country[] {
    if (plan.africaShare === undefined) return candidates;
    const african = candidates.filter((c) => isAfrican(c.id));
    const other = candidates.filter((c) => !isAfrican(c.id));
    if (african.length === 0 || other.length === 0) return candidates;
    const streak = past.slice(-MAX_AFRICA_IN_A_ROW);
    if (streak.length === MAX_AFRICA_IN_A_ROW && streak.every(isAfrican)) return other;
    return rng.next() < plan.africaShare ? african : other;
  }

  /** The countries nearest the level's place on the difficulty scale, easiest first at level 1. */
  const nearest = (candidates: readonly Country[], level: number) => {
    const aim = (level - 0.5) / rounds;
    return [...candidates]
      .sort((a, b) => Math.abs(rankOf.get(a.id)! - aim) - Math.abs(rankOf.get(b.id)! - aim) || a.id.localeCompare(b.id))
      .slice(0, choices(level));
  };

  function nextTarget(rng: Rng, level: number, past: readonly CountryId[]): CountryId {
    const plan = blitzPlan(level);
    const previous = past[past.length - 1];
    const recentRegions = past.slice(-SUBREGION_GAP).map(subregion);
    const unused = askable.filter((c) => !past.includes(c.id));
    const fresh = unused.filter((c) => !past.some((p) => overlaps(c.id, p)));
    // Straight after a country, one of its neighbours, or another from its part of
    // the world, would feel like the same level again.
    const apart = (c: Country) => !recentRegions.includes(c.subregion) && !(previous && neighboursOf(previous).includes(c.id));
    // Everything first; if the run has used that up, let the variety rules go, then the plan.
    for (const candidates of [
      fresh.filter((c) => fits(c, plan) && apart(c)),
      fresh.filter((c) => fits(c, plan)),
      fresh,
      unused,
    ]) {
      if (candidates.length === 0) continue;
      // Africa or not first, then the nearest in difficulty within that, so the
      // late levels' few non-African countries don't come up every run.
      return pick(rng, nearest(balanceAfrica(rng, plan, past, candidates), level).map((c) => c.id));
    }
    throw new Error('no country left to ask');
  }

  const levelState = (state: BlitzState, rng: Rng, level: number): BlitzState => {
    const target = nextTarget(rng, level, state.past);
    return {
      ...state,
      rngState: rng.state,
      level,
      target,
      neighbours: neighboursOf(target),
      found: [],
      wrong: [],
      status: 'playing',
      bonusLife: false,
      secondsLeft: null,
      past: [...state.past, target],
    };
  };

  /** Ends the run on this level, keeping the points so far. */
  const endLevel = (state: BlitzState, move: string, ended: 'time' | 'gave-up'): BlitzState =>
    state.status !== 'playing' ? state : { ...state, moves: [...state.moves, move], status: 'over', ended };

  /** True right after a level is cleared, before its time bonus is claimed. */
  const justCleared = (state: BlitzState) =>
    (state.status === 'level-clear' || (state.status === 'over' && state.completed)) && state.secondsLeft === null;

  return {
    graph,
    neighboursOf,
    throughTerritory,
    difficulty,
    /** Every country that can be asked, easiest first. */
    askable: askable.map((c) => c.id),

    start(seed: number): BlitzState {
      const empty: BlitzState = {
        seed,
        rngState: 0,
        level: 0,
        target: '',
        neighbours: [],
        found: [],
        wrong: [],
        lives: BLITZ_START_LIVES,
        score: 0,
        status: 'playing',
        ended: null,
        completed: false,
        bonusLife: false,
        secondsLeft: null,
        past: [],
        cleared: [],
        moves: [],
      };
      return levelState(empty, createRng(seed), 1);
    },

    /** Wrong answers cost a life; repeats, the country itself, neighbours through a territory and unknown names are free. */
    guess(state: BlitzState, id: CountryId): { state: BlitzState; result: BlitzGuessResult } {
      if (state.status !== 'playing' || !isSovereign.has(id)) return { state, result: 'unknown' };
      if (id === state.target) return { state, result: 'target' };
      if (state.found.includes(id) || state.wrong.includes(id)) return { state, result: 'repeat' };
      if (throughTerritory(state.target, id)) return { state, result: 'territory' };
      const moves = [...state.moves, id];
      if (!state.neighbours.includes(id)) {
        const lives = state.lives - 1;
        const out = lives <= 0;
        return {
          result: 'wrong',
          state: { ...state, wrong: [...state.wrong, id], lives, moves, status: out ? 'over' : 'playing', ended: out ? 'lives' : null },
        };
      }
      const found = [...state.found, id];
      const clear = found.length === state.neighbours.length;
      const flawless = clear && state.wrong.length === 0;
      const points =
        BLITZ_POINTS_PER_LEVEL * state.level + (flawless ? blitzFlawlessBonus(state.level, state.neighbours.length) : 0);
      const last = clear && state.level >= rounds;
      return {
        result: 'found',
        state: {
          ...state,
          found,
          moves,
          score: state.score + points,
          lives: flawless ? Math.min(BLITZ_MAX_LIVES, state.lives + 1) : state.lives,
          bonusLife: flawless,
          status: last ? 'over' : clear ? 'level-clear' : 'playing',
          completed: last,
          cleared: clear ? [...state.cleared, flawless] : state.cleared,
        },
      };
    },

    /**
     * Turns the seconds left on a level just cleared into points. The screen
     * sends it at once; anything more than the level's clock counts as the clock.
     */
    claimTime(state: BlitzState, seconds: number): BlitzState {
      if (!justCleared(state)) return state;
      const kept = Math.max(0, Math.min(blitzSeconds(state.level, state.neighbours.length), Math.floor(seconds) || 0));
      return {
        ...state,
        secondsLeft: kept,
        score: state.score + BLITZ_TIME_POINTS * state.level * kept,
        moves: [...state.moves, `${TIME_MOVE}${kept}`],
      };
    },

    /** The clock ran out: the run ends, keeping the points so far. */
    timeout: (state: BlitzState) => endLevel(state, BLITZ_TIMEOUT, 'time'),

    /** Giving up on a level ends the run like a timeout, without the wait. */
    giveUp: (state: BlitzState) => endLevel(state, BLITZ_GIVE_UP, 'gave-up'),

    nextLevel(state: BlitzState): BlitzState {
      if (state.status !== 'level-clear') return state;
      return levelState(state, createRng(state.rngState), state.level + 1);
    },
  };
}

export type BorderBlitz = ReturnType<typeof createBorderBlitz>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayBorderBlitz(game: BorderBlitz, seed: number, moves: readonly string[], observe?: (state: BlitzState, move: string) => void): BlitzState {
  let state = game.start(seed);
  for (const move of moves) {
    if (move.startsWith(TIME_MOVE)) {
      state = game.claimTime(state, Number(move.slice(TIME_MOVE.length)));
      observe?.(state, move);
      continue;
    }
    if (state.status === 'level-clear') state = game.nextLevel(state);
    if (state.status === 'over') break;
    if (move === BLITZ_TIMEOUT) state = game.timeout(state);
    else if (move === BLITZ_GIVE_UP) state = game.giveUp(state);
    else state = game.guess(state, move).state;
    observe?.(state, move);
  }
  return state;
}
