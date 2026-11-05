import type { GameDefinition, GameSettings } from '@geogames/games';

export interface GameOutcome {
  score: number;
  moves: readonly string[];
  /** Shown on the game-over screen, e.g. when a player went through the whole pool. */
  message?: string;
}

/** Contract every game screen implements, so pages and platform code stay game-agnostic. */
export interface GameScreenProps<G extends GameDefinition = GameDefinition> {
  game: G;
  settings: GameSettings;
  seed: number;
  onGameOver(outcome: GameOutcome): void;
}
