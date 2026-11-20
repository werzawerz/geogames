import { dataset, queryCountries } from '@geogames/geodata';
import { cityIndex, loadGreatCircles } from '@geogames/geodata/cities';
import type { GameDefinition } from './catalog.ts';
import { BLANK_ATLAS_VERSION, loadBlankAtlas } from '@geogames/geodata/blank-atlas';
import { RIVERS_VERSION, loadRivers } from '@geogames/geodata/rivers';
import { LAND_GRID_VERSION, loadLandGrid } from '@geogames/geodata/land-grid';
import { NATIVE_NAMES_VERSION, loadNativeNames } from '@geogames/geodata/native-names';
import { createNativeTongue, replayNativeTongue, type TongueState } from './native-tongue.ts';
import { SUPPLY_CHAIN_VERSION, loadSupplyChain } from '@geogames/geodata/supply-chain';
import { createSupplyChain, replaySupplyChain, type ChainState } from './supply-chain.ts';
import { createBlankAtlas, replayBlankAtlas, type BlankAtlas, type BlankAtlasState } from './blank-atlas.ts';
import { createBorderBlitz, replayBorderBlitz, type BlitzState } from './border-blitz.ts';
import { createChoiceQuiz, replayChoiceQuiz, type QuizState } from './choice-quiz.ts';
import { createCircleArcade, replayCircleArcade, type ArcadeState, type CircleArcade } from './circle-arcade.ts';
import { CLOCK_TZDB, clockworkCountries, createClockwork, replayClockwork, type ClockState } from './clockwork.ts';
import { createCircleGame, replayCircle, type CircleGameState } from './circle.ts';
import { createHigherLowerGame, replayHigherLower, type Guess } from './higher-lower.ts';
import { createHalfway, replayHalfway, type Halfway, type HalfwayState } from './halfway.ts';
import { createGreatCircle, replayGreatCircle, type GreatCircleState } from './great-circle.ts';
import { createMysteryCountry, replayMysteryCountry, type MysteryState } from './mystery-country.ts';
import { createOnTheGrid, replayOnTheGrid, type GridState } from './on-the-grid.ts';
import { PIN_BULLSEYE_KM, createPinDrop, replayPinDrop, type PinState } from './pin-drop.ts';
import { createRiverRun, replayRiverRun, type RiverRunState } from './river-run.ts';
import { arcadePools, circleCities, halfwayPools, loadPool, quizItems, routeCountries } from './pools.ts';
import { createRouteGame, replayRoute, type RouteGameState } from './route.ts';
import type { GameSettings } from './settings.ts';

/**
 * Identifies the data a game was played on. Replaying needs the same pools the
 * player had, so a server only accepts sessions from clients on its version.
 */
// The tz release too: Clockwork's offsets come from it, so a rebuild of them must ask clients to update.
// And Blank Atlas's features, the rivers and On the Grid's land points: a rebuild can change which options a seed gives.
// And the supply-chain data: which countries lead which commodity decides the answers.
// And the CLDR release behind Native Tongue's names: which countries make a puzzle depends on them.
export const DATASET_VERSION = `${dataset.generatedAt}|${cityIndex.generatedAt}|tz${CLOCK_TZDB}|atlas${BLANK_ATLAS_VERSION}|rivers${RIVERS_VERSION}|names${NATIVE_NAMES_VERSION}|grid${LAND_GRID_VERSION}|chain${SUPPLY_CHAIN_VERSION}`;

export interface ReplayResult {
  score: number;
  /** False when the moves don't play the game to its end. */
  finished: boolean;
}

// Building these reads every city, so a server keeps them between requests.
const arcades = new Map<string, Promise<CircleArcade>>();
function arcadeFor(settings: GameSettings): Promise<CircleArcade> {
  let arcade = arcades.get(settings.cityData);
  if (!arcade) {
    arcade = arcadePools(settings).then(createCircleArcade);
    arcades.set(settings.cityData, arcade);
  }
  return arcade;
}

// Halfway works out its fair pairs once per engine.
let halfwayEngine: Promise<Halfway> | undefined;
const halfway = () => (halfwayEngine ??= halfwayPools().then(createHalfway));

let blankAtlasEngine: Promise<BlankAtlas> | undefined;
/** The Blank Atlas engine, on its features (names and places, no outlines). */
export const blankAtlasGame = () => (blankAtlasEngine ??= loadBlankAtlas().then((d) => createBlankAtlas(d.features)));

/** How one level of a run ended, for comparing two runs of a duel level by level. */
export type LevelOutcome = 'perfect' | 'cleared' | 'skipped' | 'timeout' | 'lost' | 'playing';

export interface LevelRow {
  number: number;
  /** Points scored while on this level. */
  points: number;
  outcome: LevelOutcome;
}

export interface RunSummary extends ReplayResult {
  /** The level the run ended on (or has reached); for a quiz or a streak, the question it got to. */
  level: number;
  /** Each level played, in order, with its points and how it ended. */
  levels: LevelRow[];
}

/** One state of a run, in the terms every game shares. */
interface RunView {
  level: number;
  score: number;
  /** How the level stands as the engine sees it: a skip shows up here as a lost (or even a cleared) level. */
  outcome: 'playing' | 'perfect' | 'cleared' | 'lost';
}

/** Moves that give a level up: the engines' skips and give-ups. */
const SKIP_MOVES = new Set(['>', 'skip', 'give-up', '-']);
const TIMEOUT_MOVE = 'timeout';

const levelStatus = (level: { status: 'playing' | 'cleared' | 'lost'; flawless?: boolean }, flawless = level.flawless): RunView['outcome'] =>
  level.status === 'cleared' ? (flawless ? 'perfect' : 'cleared') : level.status;

/** Builds the level rows from the states a replay goes through. */
function levelRows() {
  const rows: LevelRow[] = [];
  let before = 0;
  let last = 0;
  let skipped = false;
  let timedOut = false;
  return {
    rows,
    see(view: RunView, move: string) {
      let row = rows[rows.length - 1];
      if (!row || row.number !== view.level) {
        before = last;
        skipped = timedOut = false;
        row = { number: view.level, points: 0, outcome: 'playing' };
        rows.push(row);
      }
      skipped ||= SKIP_MOVES.has(move);
      timedOut ||= move === TIMEOUT_MOVE;
      row.points = view.score - before;
      // A level given up isn't cleared, even where the engine counts it as done (City Circle Arcade).
      row.outcome =
        view.outcome === 'playing' ? 'playing' : timedOut ? 'timeout' : skipped && view.outcome !== 'perfect' ? 'skipped' : view.outcome;
      last = view.score;
    },
  };
}

/**
 * Plays a game again from its seed and the player's moves, like replayGame,
 * and says how far it got, level by level. Duels show this.
 */
export async function replayRun(game: GameDefinition, settings: GameSettings, seed: number, moves: readonly string[]): Promise<RunSummary> {
  const rows = levelRows();
  const run = await play(game, settings, seed, moves, rows.see);
  return { ...run, levels: rows.rows };
}

/**
 * Plays a game again from its seed and the player's moves, with the same
 * engines the player used. The score comes from this, never from the client.
 */
export async function replayGame(
  game: GameDefinition,
  settings: GameSettings,
  seed: number,
  moves: readonly string[],
): Promise<ReplayResult> {
  const { score, finished } = await play(game, settings, seed, moves);
  return { score, finished };
}

type Observe = (view: RunView, move: string) => void;

/** Replays with the game's engine; `observe` sees the state after every move, in shared terms. */
async function play(
  game: GameDefinition,
  settings: GameSettings,
  seed: number,
  moves: readonly string[],
  observe?: Observe,
): Promise<ReplayResult & { level: number }> {
  /** Runs `replay`, with `view` putting its states in shared terms. */
  function using<S extends { score: number; status: string }>(
    view: (state: S) => RunView,
    replay: (observe?: (state: S, move: string | number) => void) => S,
  ) {
    const state = replay(observe && ((s, move) => observe(view(s), String(move))));
    return { score: state.score, finished: state.status === 'over', level: Math.max(1, view(state).level) };
  }

  switch (game.kind) {
    case 'higher-lower': {
      const engine = createHigherLowerGame({ metric: game.metric, pool: await loadPool(game, settings) });
      // A streak has no levels: its "level" is the comparison it got to.
      return using(
        (s: ReturnType<typeof engine.start>) => ({ level: s.guesses.length + (s.status === 'guessing' ? 1 : 0), score: s.score, outcome: 'playing' }),
        (o) => replayHigherLower(engine, seed, moves as readonly Guess[], o),
      );
    }
    case 'route': {
      const engine = createRouteGame({
        countries: routeCountries(settings),
        rounds: game.rounds,
        hard: settings.routeMode === 'hard',
      });
      return using(
        (s: RouteGameState) => {
          const round = s.rounds[s.rounds.length - 1]!;
          const used = round.guesses.length + round.misses.length;
          const outcome = round.status === 'solved' ? (used === round.puzzle.minimal ? 'perfect' : 'cleared') : round.status === 'failed' ? 'lost' : 'playing';
          return { level: s.rounds.length, score: s.score, outcome };
        },
        (o) => replayRoute(engine, seed, moves, o),
      );
    }
    case 'quiz': {
      const engine = createChoiceQuiz({ items: quizItems(game, settings), lives: game.lives });
      return using(
        (s: QuizState) => ({ level: s.moves.length + (s.status === 'answering' ? 1 : 0), score: s.score, outcome: 'playing' }),
        (o) => replayChoiceQuiz(engine, seed, moves.map(Number), o),
      );
    }
    case 'circle': {
      const engine = createCircleGame({
        ...(await circleCities(settings)),
        rounds: game.rounds,
        target: game.target,
        misses: game.misses,
        radiusKm: settings.circleRadiusKm,
        placement: settings.circlePlacement,
      });
      return using(
        (s: CircleGameState) => {
          const round = s.status === 'placing' ? undefined : s.rounds[s.rounds.length - 1];
          const outcome = round?.status === 'solved' ? (round.misses === 0 ? 'perfect' : 'cleared') : round?.status === 'failed' ? 'lost' : 'playing';
          return { level: s.rounds.length, score: s.score, outcome };
        },
        (o) => replayCircle(engine, seed, moves, o),
      );
    }
    case 'great-circle': {
      const { puzzles } = await loadGreatCircles();
      const engine = createGreatCircle({ puzzles, countries: queryCountries(), rounds: game.rounds });
      return using(
        (s: GreatCircleState) => {
          const done = engine.remaining(s).length === 0;
          const perfect = s.wrong.length === 0 && s.skipped.length === 0;
          return { level: s.level, score: s.score, outcome: done ? (perfect ? 'perfect' : 'cleared') : s.status === 'over' ? 'lost' : 'playing' };
        },
        (o) => replayGreatCircle(engine, seed, moves, o),
      );
    }
    case 'mystery-country': {
      const engine = createMysteryCountry({ countries: queryCountries(), rounds: game.rounds });
      return using(
        (s: MysteryState) => {
          const solved = s.guesses.includes(s.target);
          const outcome = solved ? (s.guesses.length === 1 ? 'perfect' : 'cleared') : s.status === 'over' ? 'lost' : 'playing';
          return { level: s.level, score: s.score, outcome };
        },
        (o) => replayMysteryCountry(engine, seed, moves, o),
      );
    }
    case 'border-blitz': {
      const engine = createBorderBlitz({ countries: routeCountries(settings), rounds: game.rounds });
      return using(
        (s: BlitzState) => {
          const done = s.found.length === s.neighbours.length;
          const outcome = done ? (s.wrong.length === 0 ? 'perfect' : 'cleared') : s.status === 'over' ? 'lost' : 'playing';
          return { level: s.level, score: s.score, outcome };
        },
        (o) => replayBorderBlitz(engine, seed, moves, o),
      );
    }
    case 'clockwork': {
      const engine = createClockwork({ countries: clockworkCountries() });
      return using((s: ClockState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replayClockwork(engine, seed, moves, o));
    }
    case 'pin-drop': {
      const engine = createPinDrop(await arcadePools());
      return using(
        (s: PinState) => {
          // Every pin scores; the one that uses up the budget ends the run.
          const outcome = !s.last ? 'playing' : s.status === 'over' ? 'lost' : s.last.km <= PIN_BULLSEYE_KM ? 'perfect' : 'cleared';
          return { level: s.level, score: s.score, outcome };
        },
        (o) => replayPinDrop(engine, seed, moves, o),
      );
    }
    case 'halfway': {
      const engine = await halfway();
      return using((s: HalfwayState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replayHalfway(engine, seed, moves, o));
    }
    case 'river-run': {
      const engine = createRiverRun(await loadRivers());
      return using((s: RiverRunState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replayRiverRun(engine, seed, moves, o));
    }
    case 'on-the-grid': {
      const engine = createOnTheGrid({ grid: await loadLandGrid(), countries: queryCountries() });
      return using((s: GridState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replayOnTheGrid(engine, seed, moves, o));
    }
    case 'native-tongue': {
      const engine = createNativeTongue({ names: (await loadNativeNames()).names, countries: queryCountries() });
      return using((s: TongueState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replayNativeTongue(engine, seed, moves, o));
    }
    case 'supply-chain': {
      const engine = createSupplyChain({ commodities: (await loadSupplyChain()).commodities, countries: queryCountries() });
      return using((s: ChainState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level) }), (o) => replaySupplyChain(engine, seed, moves, o));
    }
    case 'blank-atlas': {
      const engine = await blankAtlasGame();
      // A right pick is always flawless: four options leave no free misses.
      return using((s: BlankAtlasState) => ({ level: s.level.number, score: s.score, outcome: levelStatus(s.level, true) }), (o) => replayBlankAtlas(engine, seed, moves, o));
    }
    case 'circle-arcade': {
      const engine = await arcadeFor(settings);
      return using(
        (s: ArcadeState) => {
          const { level } = s;
          const flawless = level.misses === 0 && level.skipped.length === 0 && Object.keys(level.hints).length === 0;
          return { level: level.number, score: s.score, outcome: levelStatus(level, flawless) };
        },
        (o) => replayCircleArcade(engine, seed, moves, o),
      );
    }
  }
}
