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
      { page: 'home', focus: 'daily' },
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
