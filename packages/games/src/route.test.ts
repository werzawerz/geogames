import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { routeCountries } from './pools.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import {
  EXTRA_GUESSES,
  buildBorderGraph,
  createRouteGame,
  distancesFrom,
  replayRoute,
  type RouteGameState,
} from './route.ts';

const game = createRouteGame({ countries: queryCountries(), rounds: 5 });

/** Plays the current round perfectly. */
function solve(state: RouteGameState): RouteGameState {
  const { puzzle } = game.current(state);
  for (const id of game.shortestRoute(puzzle).slice(1, -1)) state = game.guess(state, id).state;
  return state;
}

describe('border graph', () => {
  it('only keeps borders both sides agree on', () => {
    const graph = buildBorderGraph(queryCountries());
    expect(graph.get('LKA')).toEqual([]);
    expect(graph.get('HUN')).toContain('AUT');
    for (const [a, neighbours] of graph) for (const b of neighbours) expect(graph.get(b)).toContain(a);
  });

  it('counts bridges and tunnels as borders', () => {
    const graph = buildBorderGraph(queryCountries());
    expect(graph.get('DNK')).toContain('SWE');
    expect(graph.get('SWE')).toContain('DNK');
    expect(graph.get('GBR')).toContain('FRA');
  });

  it('measures hops', () => {
    const d = distancesFrom(buildBorderGraph(queryCountries()), 'HUN');
    expect(d.get('AUT')).toBe(1);
    expect(d.get('DEU')).toBe(2);
    expect(d.get('USA')).toBeUndefined();
  });
});

describe('route game', () => {
  it('is deterministic for a seed', () => {
    expect(game.current(game.start(7)).puzzle).toEqual(game.current(game.start(7)).puzzle);
  });

  it('scores a perfect route with full points and gets longer each round', () => {
    let state = game.start(42);
    const minimals: number[] = [];
    while (state.status !== 'over') {
      minimals.push(game.current(state).puzzle.minimal);
      state = solve(state);
      expect(game.current(state).status).toBe('solved');
      state = game.nextRound(state);
    }
    expect(state.score).toBe(50);
    expect(minimals).toHaveLength(5);
    expect(minimals[4]!).toBeGreaterThanOrEqual(minimals[0]!);
  });

  it('classifies guesses against the shortest routes', () => {
    const state = game.start(3);
    const { puzzle } = game.current(state);
    const route = game.shortestRoute(puzzle);
    expect(game.classify(puzzle, route[1]!)).toBe('optimal');
    expect(game.classify(puzzle, 'AUS')).toBe('far');
  });

  it('ignores invalid guesses without using a try', () => {
    const state = game.start(11);
    const { puzzle } = game.current(state);
    expect(game.guess(state, puzzle.start).result).toBe('endpoint');
    expect(game.guess(state, 'XXX').result).toBe('unknown');
    expect(game.guess(state, 'AUS').result).toBe('not-adjacent');
  });

  it('only accepts countries bordering the route so far', () => {
    let state = game.start(21);
    const round = game.current(state);
    const neighbour = [...game.frontier(round)][0]!;
    expect(game.graph.get(round.puzzle.start)).toContain(neighbour);
    state = game.guess(state, neighbour).state;
    // The frontier grows from the new country too.
    for (const next of game.graph.get(neighbour)!) {
      if (next !== round.puzzle.start && next !== round.puzzle.end) expect(game.frontier(game.current(state)).has(next)).toBe(true);
    }
  });

  it('fails after running out of guesses on detours', () => {
    let state = game.start(11);
    const { puzzle } = game.current(state);
    for (let i = 0; i < puzzle.minimal + EXTRA_GUESSES && state.status === 'playing'; i++) {
      const round = game.current(state);
      const detour = [...game.frontier(round)].find((id) => game.classify(puzzle, id) !== 'optimal');
      if (!detour) return; // tiny region with no detours left; nothing to assert
      state = game.guess(state, detour).state;
    }
    expect(game.current(state).status).toBe('failed');
    expect(state.score).toBe(0);
  });

  it('replays a move log to the same score', () => {
    let state = game.start(99);
    state = solve(state);
    state = game.nextRound(state);
    const round = game.current(state);
    const detour = [...game.frontier(round)].find((id) => game.classify(round.puzzle, id) !== 'optimal')!;
    state = game.guess(state, detour).state;
    state = solve(state);
    const replayed = replayRoute(game, 99, state.moves);
    expect(replayed.score).toBe(state.score);
    expect(replayed.rounds.map((r) => r.status)).toEqual(state.rounds.map((r) => r.status));
  });

  it('keeps routes inside a region', () => {
    const europe = createRouteGame({ countries: routeCountries({ ...DEFAULT_SETTINGS, region: 'Europe' }), rounds: 5 });
    const route = europe.shortestRoute(europe.current(europe.start(5)).puzzle);
    const continents = new Set(route.map((id) => queryCountries().find((c) => c.id === id)!.continent));
    expect([...continents]).toEqual(['Europe']);
  });

  it('drives over the Øresund Bridge', () => {
    const puzzle = { start: 'DEU', end: 'NOR', minimal: 2 };
    expect(game.classify(puzzle, 'DNK')).toBe('optimal');
    expect(game.shortestRoute(puzzle, ['DNK', 'SWE'])).toEqual(['DEU', 'DNK', 'SWE', 'NOR']);
  });

  it("doesn't cross a country from its exclave", () => {
    // Poland only touches Kaliningrad, which has no land link to the rest of Russia.
    const puzzle = { start: 'POL', end: 'FIN', minimal: 2 };
    expect(game.shortestRoute(puzzle)).toEqual(['POL', 'BLR', 'RUS', 'FIN']);
    let state: RouteGameState = { ...game.start(1), rounds: [{ puzzle, guesses: [], status: 'playing', points: 0 }] };
    expect(game.frontier(game.current(state)).has('RUS')).toBe(true);
    state = game.guess(state, 'RUS').state;
    expect(game.current(state).status).toBe('playing');
    expect(game.frontier(game.current(state)).has('EST')).toBe(false);
    // Through Belarus the mainland is reached, and with it Finland.
    state = game.guess(state, 'BLR').state;
    expect(game.current(state).status).toBe('solved');
    // Same for Nakhchivan: Turkey reaches Azerbaijan, but not Russia through it.
    expect(game.shortestRoute({ start: 'TUR', end: 'KAZ', minimal: 2 })).toEqual(['TUR', 'GEO', 'RUS', 'KAZ']);
  });

  it('passes through bordering territories but never starts or ends at one', () => {
    const world = createRouteGame({ countries: routeCountries(), rounds: 5 });
    // Mauritania and Morocco only connect through Western Sahara.
    expect(world.graph.get('MRT')).toContain('ESH');
    expect(world.graph.get('ESH')).toEqual(expect.arrayContaining(['MAR', 'MRT', 'DZA']));
    expect(world.graph.get('MRT')).not.toContain('MAR');

    const pairs: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const { puzzle } = world.current(world.start(seed));
      pairs.push(puzzle.start, puzzle.end);
    }
    const territories = new Set(['ESH', 'GIB', 'GUF', 'HKG', 'MAC', 'MAF', 'SXM']);
    expect(pairs.filter((id) => territories.has(id))).toEqual([]);

    // Western Sahara is a valid step on a shortest route (Algeria is the other).
    const puzzle = { start: 'MRT', end: 'ESP', minimal: 2 };
    expect(world.classify(puzzle, 'ESH')).toBe('optimal');
    expect(world.shortestRoute(puzzle, ['ESH'])).toEqual(['MRT', 'ESH', 'MAR', 'ESP']);
  });
});
