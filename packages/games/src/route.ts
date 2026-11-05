import { EXCLAVES, FIXED_LINKS, countryProminence, type Country, type CountryId, type Exclave } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';

/** Undirected land-border graph. */
export type BorderGraph = ReadonlyMap<CountryId, readonly CountryId[]>;

/**
 * Builds the border graph over `countries`. A border only counts when both
 * sides list it, which drops one-sided sea "borders" in the source data
 * (e.g. Sri Lanka listing India). Bridges and tunnels (`FIXED_LINKS`, e.g.
 * Denmark–Sweden) count as borders.
 */
export function buildBorderGraph(countries: readonly Country[]): BorderGraph {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const graph = new Map(
    countries.map((c) => [c.id, c.borders.filter((b) => byId.get(b)?.borders.includes(c.id))] as const),
  );
  for (const [a, b] of FIXED_LINKS) {
    if (!graph.has(a) || !graph.has(b) || graph.get(a)!.includes(b)) continue;
    graph.get(a)!.push(b);
    graph.get(b)!.push(a);
  }
  return graph;
}

/** A country's main part (its id) or one of its exclaves ("RUS/Kaliningrad"): what a route really passes through. */
export type PieceId = string;

export interface PieceGraph {
  neighbours: ReadonlyMap<PieceId, readonly PieceId[]>;
  country: ReadonlyMap<PieceId, CountryId>;
  pieces: ReadonlyMap<CountryId, readonly PieceId[]>;
}

/** Splits the countries of a border graph into their parts, each bordering only what it touches. */
export function buildPieceGraph(graph: BorderGraph, exclaves: readonly Exclave[] = EXCLAVES): PieceGraph {
  const own = (id: CountryId) => exclaves.filter((e) => e.country === id);
  const pieceId = (e: Exclave): PieceId => `${e.country}/${e.name}`;
  /** The parts of `a` that touch `b`. */
  const touching = (a: CountryId, b: CountryId): PieceId[] => {
    const parts = own(a);
    const main = parts.every((e) => !e.borders.includes(b) || e.mainlandToo?.includes(b));
    return [...(main ? [a] : []), ...parts.filter((e) => e.borders.includes(b)).map(pieceId)];
  };
  const neighbours = new Map<PieceId, PieceId[]>();
  const country = new Map<PieceId, CountryId>();
  const pieces = new Map<CountryId, PieceId[]>();
  for (const id of graph.keys()) {
    const ids = [id, ...own(id).map(pieceId)];
    pieces.set(id, ids);
    for (const piece of ids) {
      country.set(piece, id);
      neighbours.set(piece, []);
    }
  }
  for (const [a, borders] of graph) {
    for (const b of borders) for (const pa of touching(a, b)) neighbours.get(pa)!.push(...touching(b, a));
  }
  return { neighbours, country, pieces };
}

/** Hop counts from the `sources` to every node reachable in `graph`. */
function hops<T>(graph: ReadonlyMap<T, readonly T[]>, sources: readonly T[]): Map<T, number> {
  const dist = new Map(sources.map((s) => [s, 0]));
  const queue = [...sources];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (const next of graph.get(at) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(at)! + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/** Hop counts from `from` to every reachable country. */
export function distancesFrom(graph: BorderGraph, from: CountryId): Map<CountryId, number> {
  return hops(graph, [from]);
}

/** Countries that can take part in routes: those in a connected group of at least `minGroup`. */
export function routableCountries(graph: BorderGraph, minGroup = 3): CountryId[] {
  const seen = new Set<CountryId>();
  const result: CountryId[] = [];
  for (const id of graph.keys()) {
    if (seen.has(id)) continue;
    const group = [...distancesFrom(graph, id).keys()];
    group.forEach((g) => seen.add(g));
    if (group.length >= minGroup) result.push(...group);
  }
  return result;
}

export interface RoutePuzzle {
  start: CountryId;
  end: CountryId;
  /** Fewest countries in between start and end. */
  minimal: number;
}

/** How a guessed country relates to the shortest routes. */
export type GuessQuality = 'optimal' | 'near' | 'far';

export interface RouteRound {
  puzzle: RoutePuzzle;
  guesses: readonly CountryId[];
  /** Hard mode: countries guessed that didn't border the route. Not on the map, but they count. */
  misses: readonly CountryId[];
  status: 'playing' | 'solved' | 'failed';
  points: number;
}

export interface RouteGameState {
  readonly seed: number;
  readonly rngState: number;
  /** Finished rounds plus the current one (last). */
  readonly rounds: readonly RouteRound[];
  readonly score: number;
  readonly status: 'playing' | 'round-over' | 'over';
  /** Every guess that counted, in order; with the seed this replays the game. */
  readonly moves: readonly CountryId[];
}

export type RouteGuessResult = 'accepted' | 'unknown' | 'repeat' | 'endpoint' | 'not-adjacent';

export interface RouteGameOptions {
  countries: readonly Country[];
  rounds: number;
  /**
   * Hard mode. Every route gets the same number of guesses, so the count doesn't
   * reveal how long it is (routes too long for it still get their EXTRA_GUESSES),
   * and a country that doesn't border the route costs a guess instead of being
   * refused for free, which would reveal borders the map hides.
   */
  hard?: boolean;
}

export const EXTRA_GUESSES = 4;
export const MAX_POINTS = 10;
/** Hard mode's guesses per route: the longest route (8 in between) and EXTRA_GUESSES. */
export const HARD_MODE_GUESSES = 12;

/** Which countries a level's start and goal may be. */
export type RouteScope =
  /** The better-known half of the world, without the regions below. */
  | 'known'
  /** Anywhere but Africa and the Caribbean, which most players know less well. */
  | 'no-africa'
  | 'any';

export interface RouteLevelPlan {
  /** First level this plan applies to. */
  from: number;
  /** Countries in between, shortest route. */
  between: readonly [number, number];
  scope: RouteScope;
}

/** A game is one run through these: longer routes, in less familiar places. */
export const ROUTE_LEVELS: readonly RouteLevelPlan[] = [
  { from: 1, between: [2, 3], scope: 'known' },
  { from: 5, between: [3, 4], scope: 'no-africa' },
  { from: 9, between: [3, 5], scope: 'any' },
  { from: 13, between: [4, 6], scope: 'any' },
  { from: 17, between: [5, 8], scope: 'any' },
];

/** The longest route ever asked: hard mode's fixed guesses have to cover it. */
const LONGEST_ROUTE = 8;
/** Share of countries, by population and economy, that count as better known. */
const KNOWN_FROM_PROMINENCE = 0.5;

/** Which countries count as unfamiliar, for the games that ease players in. */
export function routeScopes(countries: readonly Country[]) {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const prominence = countryProminence(countries.filter((c) => c.sovereignty !== 'territory'));
  const isRemote = (id: CountryId) => {
    const c = byId.get(id);
    return c?.continent === 'Africa' || c?.subregion === 'Caribbean';
  };
  const inScope = (scope: RouteScope, id: CountryId) =>
    scope === 'any' || (!isRemote(id) && (scope === 'no-africa' || (prominence.get(id) ?? 0) >= KNOWN_FROM_PROMINENCE));
  return { isRemote, inScope };
}

export function routeLevelPlan(level: number): RouteLevelPlan {
  return [...ROUTE_LEVELS].reverse().find((p) => level >= p.from)!;
}

export function maxGuesses(puzzle: RoutePuzzle): number {
  return puzzle.minimal + EXTRA_GUESSES;
}

/** 10 for a perfect route, 2 fewer per extra guess, never below 2 when solved. */
export function routePoints(puzzle: RoutePuzzle, guessesUsed: number): number {
  return Math.max(2, MAX_POINTS - 2 * (guessesUsed - puzzle.minimal));
}

export function createRouteGame({ countries, rounds, hard = false }: RouteGameOptions) {
  const guessLimit = (puzzle: RoutePuzzle) => Math.max(hard ? HARD_MODE_GUESSES : 0, maxGuesses(puzzle));
  const graph = buildBorderGraph(countries);
  // Routes are played on country parts, so an exclave can't be used as a shortcut.
  const parts = buildPieceGraph(graph);
  const piecesOf = (id: CountryId) => parts.pieces.get(id) ?? [];
  const countryOf = (piece: PieceId) => parts.country.get(piece)!;
  // Territories (e.g. Western Sahara) can be crossed but never start or end a route.
  const sovereign = new Set(countries.filter((c) => c.sovereignty !== 'territory').map((c) => c.id));
  const routable = routableCountries(graph).filter((id) => sovereign.has(id));
  if (routable.length < 3) throw new Error('route game needs at least 3 connected countries');
  const routableSet = new Set(routable);
  const { isRemote, inScope } = routeScopes(countries);
  const pieceDistCache = new Map<CountryId, Map<PieceId, number>>();
  /** Hops from any part of `from` to every reachable part. */
  const pieceDist = (from: CountryId) => {
    let d = pieceDistCache.get(from);
    if (!d) pieceDistCache.set(from, (d = hops(parts.neighbours, piecesOf(from))));
    return d;
  };
  const distCache = new Map<CountryId, Map<CountryId, number>>();
  /** Hops from `from` to every reachable country (its nearest part). */
  const dist = (from: CountryId) => {
    let d = distCache.get(from);
    if (!d) {
      d = new Map();
      for (const [piece, n] of pieceDist(from)) {
        const id = countryOf(piece);
        if (!(d.get(id)! <= n)) d.set(id, n);
      }
      distCache.set(from, d);
    }
    return d;
  };

  function makePuzzle(rng: Rng, level: number, used: ReadonlySet<CountryId>): RoutePuzzle {
    const { between, scope } = routeLevelPlan(level);
    const [lo, hi] = between;
    const fresh = routable.filter((id) => !used.has(id));
    // The level's plan first. Small maps can't always meet it: then the plan's lengths
    // anywhere, then any route with at least one country in between.
    for (const [plan, min, max] of [
      [scope, lo, hi],
      ['any', lo, hi],
      ['any', 1, LONGEST_ROUTE],
      ['any', 1, Infinity],
    ] as const) {
      const allowed = fresh.filter((id) => inScope(plan, id));
      const starts = allowed.length >= 2 ? allowed : routable;
      for (let attempt = 0; attempt < 60 && starts.length > 0; attempt++) {
        const start = pick(rng, starts);
        const ends = [...dist(start)]
          .filter(([id, d]) => d - 1 >= min && d - 1 <= max && !used.has(id) && sovereign.has(id) && inScope(plan, id))
          .map(([id]) => id);
        if (ends.length === 0) continue;
        const end = pick(rng, ends);
        const puzzle = { start, end, minimal: dist(start).get(end)! - 1 };
        // A familiar level shouldn't need the unfamiliar regions in between either.
        if (plan !== 'any' && shortestRoute(puzzle).some(isRemote)) continue;
        return puzzle;
      }
    }
    throw new Error('no route puzzle available');
  }

  function newRound(rng: Rng, previous: readonly RouteRound[]): RouteRound {
    const used = new Set(previous.flatMap((r) => [r.puzzle.start, r.puzzle.end]));
    return { puzzle: makePuzzle(rng, previous.length + 1, used), guesses: [], misses: [], status: 'playing', points: 0 };
  }

  function classify(puzzle: RoutePuzzle, id: CountryId): GuessQuality {
    const viaStart = pieceDist(puzzle.start);
    const viaEnd = pieceDist(puzzle.end);
    // The best route through any one part of the country.
    const through = Math.min(...piecesOf(id).map((p) => (viaStart.get(p) ?? Infinity) + (viaEnd.get(p) ?? Infinity)));
    if (through === Infinity) return 'far';
    const extra = through - (puzzle.minimal + 1);
    return extra === 0 ? 'optimal' : extra === 1 ? 'near' : 'far';
  }

  /** Parts reached from the start by land through guessed countries only. */
  function reached(puzzle: RoutePuzzle, guesses: readonly CountryId[]): Set<PieceId> {
    const allowed = new Set(guesses);
    const seen = new Set(piecesOf(puzzle.start));
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) {
      for (const next of parts.neighbours.get(queue[i]!) ?? []) {
        if (allowed.has(countryOf(next)) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  /** True when start and end are connected using only guessed countries. */
  function isConnected(puzzle: RoutePuzzle, guesses: readonly CountryId[]): boolean {
    for (const piece of reached(puzzle, guesses)) {
      if ((parts.neighbours.get(piece) ?? []).some((n) => countryOf(n) === puzzle.end)) return true;
    }
    return false;
  }

  /**
   * Countries the player may guess next: neighbours of the start or of any
   * placed guess, so the route grows country by country. Branching off an
   * earlier country is allowed, so a dead end doesn't force a restart. Only
   * the parts actually reached count: from Poland, Russia is a neighbour (via
   * Kaliningrad), but Russia's other neighbours are not.
   */
  function frontier(round: RouteRound): Set<CountryId> {
    const placed = new Set([round.puzzle.start, ...round.guesses]);
    const next = new Set<CountryId>();
    for (const piece of reached(round.puzzle, round.guesses)) {
      for (const n of parts.neighbours.get(piece) ?? []) if (!placed.has(countryOf(n))) next.add(countryOf(n));
    }
    next.delete(round.puzzle.end);
    return next;
  }

  /** One shortest route (start..end inclusive), preferring countries the player guessed. */
  function shortestRoute(puzzle: RoutePuzzle, guesses: readonly CountryId[] = []): CountryId[] {
    const fromStart = pieceDist(puzzle.start);
    const guessed = new Set(guesses);
    const d = (p: PieceId) => fromStart.get(p) ?? Infinity;
    let at = piecesOf(puzzle.end).reduce((best, p) => (d(p) < d(best) ? p : best));
    const path = [puzzle.end];
    while (d(at) > 0) {
      const prev = (parts.neighbours.get(at) ?? []).filter((n) => d(n) === d(at) - 1);
      at = prev.find((n) => guessed.has(countryOf(n))) ?? prev[0]!;
      path.push(countryOf(at));
    }
    return path.reverse();
  }

  return {
    graph,
    routable: routableSet,
    rounds,
    classify,
    frontier,
    shortestRoute,
    guessLimit,

    start(seed: number): RouteGameState {
      const rng = createRng(seed);
      const first = newRound(rng, []);
      return { seed, rngState: rng.state, rounds: [first], score: 0, status: 'playing', moves: [] };
    },

    current(state: RouteGameState): RouteRound {
      return state.rounds[state.rounds.length - 1]!;
    },

    /**
     * Applies a guess. Unknown, repeated and start/end guesses don't use up a try.
     * Nor do countries not bordering the route, except in hard mode.
     */
    guess(state: RouteGameState, id: CountryId): { state: RouteGameState; result: RouteGuessResult } {
      const round = state.rounds[state.rounds.length - 1]!;
      if (state.status !== 'playing') return { state, result: 'unknown' };
      if (!graph.has(id)) return { state, result: 'unknown' };
      if (id === round.puzzle.start || id === round.puzzle.end) return { state, result: 'endpoint' };
      if (round.guesses.includes(id)) return { state, result: 'repeat' };
      const borders = frontier(round).has(id);
      if (!borders && (!hard || round.misses.includes(id))) return { state, result: hard ? 'repeat' : 'not-adjacent' };

      const guesses = borders ? [...round.guesses, id] : round.guesses;
      const misses = borders ? round.misses : [...round.misses, id];
      const used = guesses.length + misses.length;
      const solved = borders && isConnected(round.puzzle, guesses);
      const failed = !solved && used >= guessLimit(round.puzzle);
      // Later levels are worth more; a failed route ends the run.
      const points = solved ? routePoints(round.puzzle, used) * state.rounds.length : 0;
      const updated: RouteRound = { ...round, guesses, misses, status: solved ? 'solved' : failed ? 'failed' : 'playing', points };
      const roundOver = solved || failed;
      const last = state.rounds.length >= rounds;
      return {
        result: borders ? 'accepted' : 'not-adjacent',
        state: {
          ...state,
          rounds: [...state.rounds.slice(0, -1), updated],
          score: state.score + points,
          moves: [...state.moves, id],
          status: roundOver ? (last || failed ? 'over' : 'round-over') : 'playing',
        },
      };
    },

    /** Starts the next puzzle after a finished round. */
    nextRound(state: RouteGameState): RouteGameState {
      if (state.status !== 'round-over') return state;
      const rng = createRng(state.rngState);
      const next = newRound(rng, state.rounds);
      return { ...state, rngState: rng.state, rounds: [...state.rounds, next], status: 'playing' };
    },
  };
}

export type RouteGame = ReturnType<typeof createRouteGame>;

/** Replays a guess log from a seed; this is what a server uses to verify a score. */
export function replayRoute(game: RouteGame, seed: number, moves: readonly CountryId[]): RouteGameState {
  let state = game.start(seed);
  for (const id of moves) {
    if (state.status === 'round-over') state = game.nextRound(state);
    if (state.status === 'over') break;
    state = game.guess(state, id).state;
  }
  return state;
}
