import { dataset } from '@geogames/geodata';
import { cityIndex } from '@geogames/geodata/cities';
import type { GameDefinition } from './catalog.ts';
import { createChoiceQuiz, replayChoiceQuiz } from './choice-quiz.ts';
import { createCircleArcade, replayCircleArcade, type CircleArcade } from './circle-arcade.ts';
import { createCircleGame, replayCircle } from './circle.ts';
import { createHigherLowerGame, replayHigherLower, type Guess } from './higher-lower.ts';
import { arcadePools, circleCities, loadPool, quizItems, routeCountries } from './pools.ts';
import { createRouteGame, replayRoute } from './route.ts';
import type { GameSettings } from './settings.ts';

/**
 * Identifies the data a game was played on. Replaying needs the same pools the
 * player had, so a server only accepts sessions from clients on its version.
 */
export const DATASET_VERSION = `${dataset.generatedAt}|${cityIndex.generatedAt}`;

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
      const engine = createRouteGame({ countries: routeCountries(settings), rounds: game.rounds });
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
    case 'circle-arcade': {
      const state = replayCircleArcade(await arcadeFor(settings), seed, moves);
      return { score: state.score, finished: state.status === 'over' };
    }
  }
}
