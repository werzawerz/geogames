import { dataset, queryCountries } from '@geogames/geodata';
import { cityIndex, loadGreatCircles } from '@geogames/geodata/cities';
import type { GameDefinition } from './catalog.ts';
import { BLANK_ATLAS_VERSION, loadBlankAtlas } from '@geogames/geodata/blank-atlas';
import { RIVERS_VERSION, loadRivers } from '@geogames/geodata/rivers';
import { createBlankAtlas, replayBlankAtlas, type BlankAtlas } from './blank-atlas.ts';
import { createBorderBlitz, replayBorderBlitz } from './border-blitz.ts';
import { createChoiceQuiz, replayChoiceQuiz } from './choice-quiz.ts';
import { createCircleArcade, replayCircleArcade, type CircleArcade } from './circle-arcade.ts';
import { CLOCK_TZDB, clockworkCountries, createClockwork, replayClockwork } from './clockwork.ts';
import { createCircleGame, replayCircle } from './circle.ts';
import { createHigherLowerGame, replayHigherLower, type Guess } from './higher-lower.ts';
import { createHalfway, replayHalfway, type Halfway } from './halfway.ts';
import { createGreatCircle, replayGreatCircle } from './great-circle.ts';
import { createMysteryCountry, replayMysteryCountry } from './mystery-country.ts';
import { createPinDrop, replayPinDrop } from './pin-drop.ts';
import { createRiverRun, replayRiverRun } from './river-run.ts';
import { arcadePools, circleCities, halfwayPools, loadPool, quizItems, routeCountries } from './pools.ts';
import { createRouteGame, replayRoute } from './route.ts';
import type { GameSettings } from './settings.ts';

/**
 * Identifies the data a game was played on. Replaying needs the same pools the
 * player had, so a server only accepts sessions from clients on its version.
 */
// The tz release too: Clockwork's offsets come from it, so a rebuild of them must ask clients to update.
// And Blank Atlas's features and the rivers: a rebuild can change which options a seed gives.
export const DATASET_VERSION = `${dataset.generatedAt}|${cityIndex.generatedAt}|tz${CLOCK_TZDB}|atlas${BLANK_ATLAS_VERSION}|rivers${RIVERS_VERSION}`;

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
  switch (game.kind) {
    case 'higher-lower': {
      const engine = createHigherLowerGame({ metric: game.metric, pool: await loadPool(game, settings) });
      const state = replayHigherLower(engine, seed, moves as readonly Guess[]);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'route': {
      const engine = createRouteGame({
        countries: routeCountries(settings),
        rounds: game.rounds,
        hard: settings.routeMode === 'hard',
      });
      const state = replayRoute(engine, seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'quiz': {
      const engine = createChoiceQuiz({ items: quizItems(game, settings), lives: game.lives });
      const state = replayChoiceQuiz(engine, seed, moves.map(Number));
      return { score: state.score, finished: state.status === 'over' };
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
      const state = replayCircle(engine, seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'great-circle': {
      const { puzzles } = await loadGreatCircles();
      const engine = createGreatCircle({ puzzles, countries: queryCountries(), rounds: game.rounds });
      const state = replayGreatCircle(engine, seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'mystery-country': {
      const engine = createMysteryCountry({ countries: queryCountries(), rounds: game.rounds });
      const state = replayMysteryCountry(engine, seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'border-blitz': {
      const engine = createBorderBlitz({ countries: routeCountries(settings), rounds: game.rounds });
      const state = replayBorderBlitz(engine, seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'clockwork': {
      const state = replayClockwork(createClockwork({ countries: clockworkCountries() }), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'pin-drop': {
      const state = replayPinDrop(createPinDrop(await arcadePools()), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'halfway': {
      const state = replayHalfway(await halfway(), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'river-run': {
      const state = replayRiverRun(createRiverRun(await loadRivers()), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'blank-atlas': {
      const state = replayBlankAtlas(await blankAtlasGame(), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
    case 'circle-arcade': {
      const state = replayCircleArcade(await arcadeFor(settings), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
  }
}
