import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from './router.ts';

describe('router', () => {
  it.each(['about', 'privacy', 'terms', 'contact'] as const)('parses and builds #/%s', (page) => {
    expect(parseRoute(`#/${page}`)).toEqual({ page });
    expect(href({ page })).toBe(`#/${page}`);
  });

  it('round-trips every route', () => {
    const routes: Route[] = [
      { page: 'home' },
      { page: 'dailies' },
      { page: 'duels' },
      { page: 'duel-new' },
      { page: 'duel-new', rematchOf: 'K7Q2M9XD' },
      { page: 'duel-new', gameId: 'mystery-country' },
      { page: 'duel', code: 'K7Q2M9XD' },
      { page: 'play', gameId: 'pin-drop' },
      { page: 'daily', gameId: 'pin-drop' },
      { page: 'scores', gameId: 'pin-drop', variant: 'x' },
      { page: 'about' },
      { page: 'privacy' },
      { page: 'terms' },
      { page: 'contact' },
      { page: 'profile' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });

  it('puts duels at #/duels, #/duels/new[/CODE] and #/duel/CODE', () => {
    expect(href({ page: 'duel', code: 'K7Q2M9XD' })).toBe('#/duel/K7Q2M9XD');
    expect(href({ page: 'duel-new', rematchOf: 'K7Q2M9XD' })).toBe('#/duels/new/K7Q2M9XD');
    expect(parseRoute('#/duels/new')).toEqual({ page: 'duel-new' });
    expect(href({ page: 'duel-new', gameId: 'pin-drop' })).toBe('#/duels/new/pin-drop');
    expect(parseRoute('#/duels/new/pin-drop')).toEqual({ page: 'duel-new', gameId: 'pin-drop' });
  });

  it('parses #/profile', () => {
    expect(parseRoute('#/profile')).toEqual({ page: 'profile' });
    expect(href({ page: 'profile' })).toBe('#/profile');
  });

  it('sends the old #/premium links home', () => {
    expect(parseRoute('#/premium')).toEqual({ page: 'home' });
  });

  it('falls back to home for unknown pages', () => {
    expect(parseRoute('#/nope')).toEqual({ page: 'home' });
    expect(parseRoute('')).toEqual({ page: 'home' });
  });
});
