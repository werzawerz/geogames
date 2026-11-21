import type { CityId, CountryId } from '@geogames/geodata';
import { createRng, pick, type Rng } from './rng.ts';

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance between [lat, lng] points. */
export function distanceKm([lat1, lng1]: readonly [number, number], [lat2, lng2]: readonly [number, number]): number {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** The point `km` away from [lat, lng] along `bearing` (radians). */
export function destination([lat, lng]: readonly [number, number], km: number, bearing: number): [number, number] {
  const d = km / EARTH_KM;
  const φ1 = rad(lat);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(bearing));
  const λ2 = rad(lng) + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [deg(φ2), ((deg(λ2) + 540) % 360) - 180];
}

/** What City Circle needs to know about a city (full City records and slim small-city rows both fit). */
export interface CircleCity {
  id: CityId;
  name: string;
  countryId: CountryId;
  /** [lat, lng] */
  latlng: readonly [number, number];
  population: number;
  aliases?: readonly string[];
  /** Other big cities inside this urban area ("Essen" includes Duisburg, Bochum). */
  includes?: readonly string[];
}

/** Placements are stored rounded, so a replay rebuilds exactly the same circle. */
const roundCoord = (v: number) => Math.round(v * 1e4) / 1e4;

export interface CirclePuzzle {
  /** [lat, lng] */
  center: [number, number];
  radiusKm: number;
  /** Every pool city inside the circle, most populous first. */
  inside: readonly CityId[];
}

export type CircleGuessResult = 'found' | 'in-circle' | 'outside' | 'repeat' | 'unknown';
export type CirclePlaceResult = 'placed' | 'too-few' | 'not-placing';

export interface CircleRound {
  puzzle: CirclePuzzle;
  guesses: readonly CityId[];
  status: 'playing' | 'solved' | 'failed';
  found: number;
  misses: number;
}

export interface CircleGameState {
  readonly seed: number;
  readonly rngState: number;
  /** Rounds so far; the last is the current one unless the player is placing the next circle. */
  readonly rounds: readonly CircleRound[];
  readonly score: number;
  /** `placing`: waiting for the player to put down the next circle (custom placement). */
  readonly status: 'placing' | 'playing' | 'round-over' | 'over';
  /** Accepted guesses, placements ("@lat,lng") and give-ups ("-") in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

export interface CircleGameOptions {
  /** Cities that can be named and counted (all of them, worldwide: circles cross borders). */
  cities: readonly CircleCity[];
  /** Cities random circles may be placed around (e.g. those in the chosen region). */
  centers: readonly CircleCity[];
  rounds: number;
  /** How many of the most populous cities to find per circle. */
  target: number;
  /** Wrong guesses allowed per circle. */
  misses: number;
  /** Fixed radius, or 0 for auto (smallest of AUTO_RADII_KM holding enough cities). */
  radiusKm: number;
  /** Random circles, or the player places each one. */
  placement: 'random' | 'custom';
}

/** Radii tried from small to large in auto mode; the first that holds enough cities wins. */
const AUTO_RADII_KM = [250, 400, 600, 900] as const;
/** A random circle should hold this many cities beyond the target, so there's something to get wrong. */
const EXTRA_INSIDE = 3;
/** New random circles stay this far from earlier ones in the same game. */
const MIN_SEPARATION_KM = 1500;
/** Move-log token for giving up a circle. */
const GIVE_UP = '-';
/** How far a too-small chosen radius may grow before giving up. */
const MAX_GROWN_RADIUS_KM = 2000;

export function createCircleGame({ cities, centers, rounds, target, misses, radiusKm, placement }: CircleGameOptions) {
  const byId = new Map(cities.map((c) => [c.id, c]));
  const population = (c: CircleCity) => c.population;

  function citiesWithin(center: readonly [number, number], radius: number): CityId[] {
    return cities
      .filter((c) => distanceKm(center, c.latlng) <= radius)
      .sort((a, b) => population(b) - population(a))
      .map((c) => c.id);
  }

  // In a region game, random circles must be mostly about that region: at least
  // half of the top cities inside it. Otherwise a circle anchored on Cyprus
  // ("Europe") would be a Turkey / Levant / Egypt circle.
  const regionIds = new Set(centers.map((c) => c.id));
  const regional = regionIds.size < cities.length;
  const mostlyInRegion = (inside: readonly CityId[]) =>
    !regional || inside.slice(0, target).filter((id) => regionIds.has(id)).length >= Math.ceil(target / 2);

  /** Up to 80 random anchors; the first circle (of the given radii, smallest first) holding `minInside` cities wins. */
  function tryAnchors(rng: Rng, previous: readonly CirclePuzzle[], radii: readonly number[], minInside: number) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const anchor = pick(rng, centers);
      if (previous.some((p) => distanceKm(p.center, anchor.latlng) < MIN_SEPARATION_KM)) continue;
      // Offset the centre so it doesn't sit on (and give away) a city.
      const offset = rng.next() * 0.4;
      const bearing = rng.next() * 2 * Math.PI;
      for (const radius of radii) {
        const center = destination(anchor.latlng, radius * offset, bearing);
        const inside = citiesWithin(center, radius);
        if (inside.length >= minInside && mostlyInRegion(inside)) return { center, radiusKm: radius, inside };
      }
    }
    return null;
  }

  function randomPuzzle(rng: Rng, previous: readonly CirclePuzzle[]): CirclePuzzle {
    // Prefer roomy circles; a small radius in a sparse region may only manage the target itself.
    const minima = [target + EXTRA_INSIDE, target];
    if (radiusKm === 0) {
      for (const min of minima) {
        const puzzle = tryAnchors(rng, previous, AUTO_RADII_KM, min);
        if (puzzle) return puzzle;
      }
    } else {
      // A chosen radius too small for the region grows until circles fit.
      for (let radius = radiusKm; radius <= Math.max(radiusKm, MAX_GROWN_RADIUS_KM); radius += 50) {
        for (const min of minima) {
          const puzzle = tryAnchors(rng, previous, [radius], min);
          if (puzzle) return puzzle;
        }
      }
    }
    throw new Error('no circle puzzle available');
  }

  const newRound = (puzzle: CirclePuzzle): CircleRound => ({ puzzle, guesses: [], status: 'playing', found: 0, misses: 0 });

  /** 1-based rank inside the circle, or null when outside. */
  function rankOf(puzzle: CirclePuzzle, id: CityId): number | null {
    const i = puzzle.inside.indexOf(id);
    return i < 0 ? null : i + 1;
  }

  const customRadius = radiusKm > 0 ? radiusKm : 500;

  return {
    cities: byId,
    /** Cities circles may be placed around; also where a placement map should look. */
    centers,
    rounds,
    target,
    misses,
    placement,
    /** Radius of player-placed circles. */
    customRadius,
    rankOf,

    top(puzzle: CirclePuzzle): readonly CityId[] {
      return puzzle.inside.slice(0, target);
    },

    /** Cities a circle at `center` would hold, most populous first (for placement previews). */
    preview(center: readonly [number, number]): CityId[] {
      return citiesWithin(center, customRadius);
    },

    /** The round being played or just finished; null while placing the first circle. */
    current(state: CircleGameState): CircleRound | null {
      return state.status === 'placing' ? null : (state.rounds[state.rounds.length - 1] ?? null);
    },

    start(seed: number): CircleGameState {
      const rng = createRng(seed);
      if (placement === 'custom') {
        return { seed, rngState: rng.state, rounds: [], score: 0, status: 'placing', moves: [] };
      }
      const first = newRound(randomPuzzle(rng, []));
      return { seed, rngState: rng.state, rounds: [first], score: 0, status: 'playing', moves: [] };
    },

    /** Puts the next circle at `center` ([lat, lng]); it must hold at least `target` cities. */
    place(state: CircleGameState, center: readonly [number, number]): { state: CircleGameState; result: CirclePlaceResult } {
      if (state.status !== 'placing') return { state, result: 'not-placing' };
      const at: [number, number] = [roundCoord(center[0]), roundCoord(center[1])];
      const inside = citiesWithin(at, customRadius);
      if (inside.length < target) return { state, result: 'too-few' };
      const round = newRound({ center: at, radiusKm: customRadius, inside });
      return {
        result: 'placed',
        state: { ...state, rounds: [...state.rounds, round], status: 'playing', moves: [...state.moves, `@${at[0]},${at[1]}`] },
      };
    },

    /** Applies a guess. Unknown or repeated cities don't count as misses. */
    guess(state: CircleGameState, id: CityId): { state: CircleGameState; result: CircleGuessResult } {
      const round = state.rounds[state.rounds.length - 1];
      if (state.status !== 'playing' || !round || !byId.has(id)) return { state, result: 'unknown' };
      if (round.guesses.includes(id)) return { state, result: 'repeat' };

      const rank = rankOf(round.puzzle, id);
      const result: CircleGuessResult = rank === null ? 'outside' : rank <= target ? 'found' : 'in-circle';
      const found = round.found + (result === 'found' ? 1 : 0);
      const missCount = round.misses + (result === 'found' ? 0 : 1);
      const status = found === target ? 'solved' : missCount >= misses ? 'failed' : 'playing';
      const updated: CircleRound = { ...round, guesses: [...round.guesses, id], found, misses: missCount, status };
      const roundOver = status !== 'playing';
      return {
        result,
        state: {
          ...state,
          rounds: [...state.rounds.slice(0, -1), updated],
          score: state.score + (result === 'found' ? 1 : 0),
          moves: [...state.moves, id],
          status: roundOver ? (state.rounds.length >= rounds ? 'over' : 'round-over') : 'playing',
        },
      };
    },

    /** Ends the current circle as failed, keeping the points already earned. */
    giveUp(state: CircleGameState): CircleGameState {
      const round = state.rounds[state.rounds.length - 1];
      if (state.status !== 'playing' || !round) return state;
      return {
        ...state,
        rounds: [...state.rounds.slice(0, -1), { ...round, status: 'failed' }],
        moves: [...state.moves, GIVE_UP],
        status: state.rounds.length >= rounds ? 'over' : 'round-over',
      };
    },

    /** After a finished round: the next random circle, or back to placing. */
    nextRound(state: CircleGameState): CircleGameState {
      if (state.status !== 'round-over') return state;
      if (placement === 'custom') return { ...state, status: 'placing' };
      const rng = createRng(state.rngState);
      const next = newRound(randomPuzzle(rng, state.rounds.map((r) => r.puzzle)));
      return { ...state, rngState: rng.state, rounds: [...state.rounds, next], status: 'playing' };
    },
  };
}

export type CircleGame = ReturnType<typeof createCircleGame>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayCircle(game: CircleGame, seed: number, moves: readonly string[], observe?: (state: CircleGameState, move: string) => void): CircleGameState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'round-over') state = game.nextRound(state);
    if (state.status === 'over') break;
    if (move === GIVE_UP) {
      state = game.giveUp(state);
    } else if (move.startsWith('@')) {
      const [lat, lng] = move.slice(1).split(',').map(Number) as [number, number];
      state = game.place(state, [lat, lng]).state;
    } else {
      state = game.guess(state, move).state;
    }
    observe?.(state, move);
  }
  return state;
}
