import { randomSeed, type GameDefinition, type GameSettings } from '@geogames/games';
import { createLocalEntitlements, type Allowance, type Plan } from './entitlements.ts';
import { loadPlayer, savePlayer, type Player } from './player.ts';
import { createLocalScores, type ScoreService, type SubmitResult } from './scores.ts';

/** A game in progress. Without a session id it's only known to this browser. */
export interface Play {
  seed: number;
  sessionId: string | null;
}

export type StartResult =
  | { status: 'ok'; play: Play; allowance: Allowance }
  | { status: 'out-of-plays'; allowance: Allowance }
  /** This page is on older game data than the server: it has to reload. */
  | { status: 'update-required' };

export interface FinishedGame {
  gameId: string;
  variant: string;
  score: number;
  seed: number;
  moves: readonly string[];
}

export interface FinishResult extends SubmitResult {
  /** The score that counts: the server's, once it has replayed the game. */
  score: number;
  /** Set when the score couldn't reach the leaderboard; says why. */
  notice?: string;
}

/**
 * Everything the app needs from "the backend", so pages and game screens don't
 * know whether they run against the API or against this browser alone.
 */
export interface Backend {
  initial: { player: Player; allowance: Allowance };
  /** The server's view of the player, or null when there's none to ask. */
  load(): Promise<{ player: Player; allowance: Allowance } | null>;
  rename(player: Player): Promise<void>;
  scores: ScoreService;
  startPlay(game: GameDefinition, settings: GameSettings): Promise<StartResult>;
  finishPlay(play: Play, game: FinishedGame, player: Player): Promise<FinishResult>;
  /** Stand-in for a checkout while there's no server to hold subscriptions. */
  simulatePlan?(plan: Plan): Allowance;
}

/** Everything stays in this browser: no accounts, and no global leaderboard. */
export function createLocalBackend(): Backend {
  // Dev builds default to unlimited plays; the Premium page can switch back to Free to test the limit.
  const entitlements = createLocalEntitlements(import.meta.env.DEV ? 'premium' : 'free');
  const scores = createLocalScores();
  return {
    initial: { player: loadPlayer(), allowance: entitlements.getAllowance() },
    load: async () => null,
    rename: async (player) => savePlayer(player),
    scores,
    async startPlay() {
      if (!entitlements.consumePlay()) return { status: 'out-of-plays', allowance: entitlements.getAllowance() };
      return { status: 'ok', play: { seed: randomSeed(), sessionId: null }, allowance: entitlements.getAllowance() };
    },
    async finishPlay(_play, game, player) {
      const result = await scores.submit({ ...game, playerId: player.id, playerName: player.name });
      return { ...result, score: game.score };
    },
    simulatePlan(plan) {
      entitlements.setPlan(plan);
      return entitlements.getAllowance();
    },
  };
}
