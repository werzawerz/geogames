import { describe, expect, it } from 'vitest';
import { getGame } from './catalog.ts';
import { DAILY_GAMES, dailyDateOf, dailySettings, dailyVariant, hasDaily } from './daily.ts';
import { canDuel } from './duel.ts';

describe('daily variants', () => {
  it("reads a daily run's day back from its variant, and nothing else", () => {
    expect(dailyDateOf(dailyVariant('2026-11-20'))).toBe('2026-11-20');
    expect(dailyDateOf('duel')).toBeNull();
    expect(dailyDateOf('world')).toBeNull();
    expect(dailyDateOf('daily-2026-11')).toBeNull();
    expect(dailyDateOf('daily-2026-11-20x')).toBeNull();
  });

  it('can make a daily duel of every game with a daily, played with the daily settings', () => {
    for (const id of DAILY_GAMES) {
      const game = getGame(id)!;
      expect(hasDaily(game)).toBe(true);
      expect(canDuel(game, dailySettings(game))).toBe(true);
    }
    expect(hasDaily(getGame('capitals')!)).toBe(false);
  });
});
