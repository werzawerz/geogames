import type { GameDefinition, GameSettings } from '@geogames/games';

export interface GameOutcome {
  score: number;
  moves: readonly string[];
  /** Shown on the game-over screen, e.g. when a player went through the whole pool. */
  message?: string;
  /** A spoiler-free picture of the game for sharing, e.g. 🟩🟩🟧🟥. */
  shareLine?: string;
}

/** Contract every game screen implements, so pages and platform code stay game-agnostic. */
export interface GameScreenProps<G extends GameDefinition = GameDefinition> {
  game: G;
  settings: GameSettings;
  seed: number;
  /** Picks a game up where it was left. Only games with a daily challenge support this. */
  initialMoves?: readonly string[];
  onMovesChange?(moves: readonly string[]): void;
  onGameOver(outcome: GameOutcome): void;
}
