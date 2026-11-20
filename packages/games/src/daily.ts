import { getGame, type GameDefinition } from './catalog.ts';
import { normalizeSettings, type GameSettings } from './settings.ts';

/** The games with a daily challenge: everyone gets the same run, once a day. */
export const DAILY_GAMES: readonly string[] = ['border-route', 'city-circle-arcade', 'pin-drop', 'mystery-country'];

export const dailyGames = (): GameDefinition[] => DAILY_GAMES.map((id) => getGame(id)!);

/** Challenges change at midnight UTC. "2026-11-05" */
export const dailyDate = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Each day's scores are a leaderboard of their own. */
export const dailyVariant = (date: string): string => `daily-${date}`;

/** The day of a daily run's variant ("daily-2026-11-05" → "2026-11-05"); null for any other variant. */
export const dailyDateOf = (variant: string): string | null => /^daily-(\d{4}-\d{2}-\d{2})$/.exec(variant)?.[1] ?? null;

export const hasDaily = (game: Pick<GameDefinition, 'id'>): boolean => DAILY_GAMES.includes(game.id);

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
