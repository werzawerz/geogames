import { describe, expect, it } from 'vitest';
import { GAMES, GROUPS, gamesByGroup } from './catalog.ts';

describe('catalog groups', () => {
  it('puts every live game in a known group', () => {
    const ids = GROUPS.map((g) => g.id) as string[];
    for (const g of GAMES.filter((x) => x.status === 'live')) expect(ids, g.id).toContain(g.group);
  });

  it('lists each live game once, in group order', () => {
    const listed = gamesByGroup().flatMap((g) => g.games.map((x) => x.id));
    expect(listed.sort()).toEqual(GAMES.filter((x) => x.status === 'live').map((x) => x.id).sort());
    expect(gamesByGroup().map((g) => g.title)).toEqual(['Map games', 'Routes & borders', 'Cities', 'Quick quizzes']);
  });

  it('has unique game ids', () => {
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
  });
});
