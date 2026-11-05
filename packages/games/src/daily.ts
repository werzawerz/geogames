import { getGame, type GameDefinition } from './catalog.ts';
import { normalizeSettings, type GameSettings } from './settings.ts';

/** The games with a daily challenge: everyone gets the same run, once a day. */
export const DAILY_GAMES: readonly string[] = ['border-route', 'city-circle-arcade', 'pin-drop', 'mystery-country'];

export const dailyGames = (): GameDefinition[] => DAILY_GAMES.map((id) => getGame(id)!);

/** Challenges change at midnight UTC. "2026-11-05" */
export const dailyDate = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Each day's scores are a leaderboard of their own. */
export const dailyVariant = (date: string): string => `daily-${date}`;

/** Everyone plays the default settings, so scores compare. */
export const dailySettings = (game: GameDefinition): GameSettings => normalizeSettings({}, game);

/**
 * The day's seed. With a secret only the server knows, nobody can look ahead and
 * practise tomorrow's run; builds without a server use none.
 */
export async function dailySeed(gameId: string, date: string, secret = ''): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${gameId}|${date}`));
  return new DataView(digest).getUint32(0);
}
