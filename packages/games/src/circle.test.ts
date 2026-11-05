import { describe, expect, it } from 'vitest';
import { getCountry } from '@geogames/geodata';
import { createCircleGame, distanceKm, replayCircle, type CircleGame, type CircleGameState } from './circle.ts';
import { circleCities } from './pools.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const pools = await circleCities();
const game = createCircleGame({ ...pools, rounds: 3, target: 5, misses: 5, radiusKm: 0, placement: 'random' });

/** Names the current circle's top cities. */
function solve(state: CircleGameState, g: CircleGame = game): CircleGameState {
  for (const id of g.top(g.current(state)!.puzzle)) state = g.guess(state, id).state;
  return state;
}

describe('distance', () => {
  it('measures great-circle distances', () => {
    const budapest: [number, number] = [47.5, 19.04];
    const vienna: [number, number] = [48.21, 16.37];
    expect(distanceKm(budapest, vienna)).toBeGreaterThan(200);
    expect(distanceKm(budapest, vienna)).toBeLessThan(230);
  });
});

describe('city circle', () => {
  it('builds circles holding enough cities, ranked by population', () => {
    let state = game.start(1);
    for (let r = 0; r < 3; r++) {
      const { puzzle } = game.current(state)!;
      expect(puzzle.inside.length).toBeGreaterThanOrEqual(8);
      const pops = puzzle.inside.map((id) => game.cities.get(id)!.population);
      expect(pops).toEqual([...pops].sort((a, b) => b - a));
      for (const id of puzzle.inside) expect(distanceKm(puzzle.center, game.cities.get(id)!.latlng)).toBeLessThanOrEqual(puzzle.radiusKm);
      state = game.nextRound(solve(state));
    }
  });

  it('scores the top cities, ranks other cities in the circle, and rejects the rest', () => {
    let state = game.start(2);
    const { puzzle } = game.current(state)!;
    const [first] = game.top(puzzle);
    const sixth = puzzle.inside[5]!;
    const outside = [...game.cities.keys()].find((id) => !puzzle.inside.includes(id))!;

    let r = game.guess(state, first!);
    expect(r.result).toBe('found');
    state = r.state;
    expect(game.guess(state, first!).result).toBe('repeat');
    expect(game.rankOf(puzzle, sixth)).toBe(6);
    r = game.guess(state, sixth);
    expect(r.result).toBe('in-circle');
    r = game.guess(r.state, outside);
    expect(r.result).toBe('outside');
    expect(game.current(r.state)!).toMatchObject({ found: 1, misses: 2, status: 'playing' });
    expect(r.state.score).toBe(1);
  });

  it('ends a circle after too many misses and the game after the last circle', () => {
    let state = game.start(3);
    const { puzzle } = game.current(state)!;
    const outsiders = [...game.cities.keys()].filter((id) => !puzzle.inside.includes(id)).slice(0, 5);
    for (const id of outsiders) state = game.guess(state, id).state;
    expect(game.current(state)!.status).toBe('failed');
    state = game.nextRound(state);
    state = game.nextRound(solve(state));
    state = solve(state);
    expect(state.status).toBe('over');
    expect(state.score).toBe(10);
    expect(replayCircle(game, 3, state.moves).score).toBe(10);
  });

  it('places circles in the chosen region, keeps them apart, and counts cities across borders', async () => {
    const europe = await circleCities({ ...DEFAULT_SETTINGS, region: 'Europe' });
    expect(europe.centers.every((c) => getCountry(c.countryId)!.continent === 'Europe')).toBe(true);
    expect(europe.cities.some((c) => c.population < 200_000)).toBe(true);
    expect(europe.cities.length).toBe(pools.cities.length);

    const g = createCircleGame({ ...europe, rounds: 3, target: 5, misses: 5, radiusKm: 0, placement: 'random' });
    let state = g.start(8);
    const centers = [g.current(state)!.puzzle.center];
    for (let i = 0; i < 2; i++) {
      state = g.nextRound(solve(state, g));
      centers.push(g.current(state)!.puzzle.center);
    }
    expect(distanceKm(centers[0]!, centers[1]!)).toBeGreaterThan(1500);
    expect(distanceKm(centers[1]!, centers[2]!)).toBeGreaterThan(1500);
  });

  it('uses a fixed radius when one is chosen', () => {
    const fixed = createCircleGame({ ...pools, rounds: 3, target: 5, misses: 5, radiusKm: 250, placement: 'random' });
    let state = fixed.start(6);
    for (let r = 0; r < 3; r++) {
      expect(fixed.current(state)!.puzzle.radiusKm).toBe(250);
      expect(fixed.current(state)!.puzzle.inside.length).toBeGreaterThanOrEqual(5);
      state = fixed.nextRound(solve(state, fixed));
    }
  });

  it('lets the player place circles, rejects empty ones, and replays placements', () => {
    const custom = createCircleGame({ ...pools, rounds: 2, target: 5, misses: 5, radiusKm: 500, placement: 'custom' });
    let state = custom.start(1);
    expect(state.status).toBe('placing');
    expect(custom.current(state)).toBeNull();

    // Mid-Pacific holds no cities; the Rhine-Ruhr area holds plenty.
    expect(custom.place(state, [0, -150]).result).toBe('too-few');
    const placed = custom.place(state, [51.4567891, 7.0123456]);
    expect(placed.result).toBe('placed');
    state = placed.state;
    expect(custom.current(state)!.puzzle.center).toEqual([51.4568, 7.0123]);
    expect(custom.current(state)!.puzzle.radiusKm).toBe(500);
    expect(custom.preview([51.4568, 7.0123])).toEqual(custom.current(state)!.puzzle.inside);

    state = solve(state, custom);
    state = custom.nextRound(state);
    expect(state.status).toBe('placing');
    state = custom.place(state, [35.68, 139.69]).state; // Tokyo
    state = solve(state, custom);
    expect(state.status).toBe('over');
    expect(state.score).toBe(10);
    expect(state.moves.filter((m) => m.startsWith('@'))).toHaveLength(2);
    expect(replayCircle(custom, 1, state.moves).score).toBe(10);
  });

  it('keeps random region circles mostly inside the region', async () => {
    const europe = await circleCities({ ...DEFAULT_SETTINGS, region: 'Europe' });
    const europeIds = new Set(europe.centers.map((c) => c.id));
    for (const radiusKm of [0, 600]) {
      const g = createCircleGame({ ...europe, rounds: 3, target: 5, misses: 5, radiusKm, placement: 'random' });
      for (let seed = 1; seed <= 40; seed++) {
        let state = g.start(seed);
        for (let r = 0; r < 3; r++) {
          const top = g.top(g.current(state)!.puzzle);
          expect(top.filter((id) => europeIds.has(id)).length).toBeGreaterThanOrEqual(3);
          state = g.nextRound(solve(state, g));
        }
      }
    }
  });

  it('gives up a circle, keeping points, and replays the give-up', () => {
    let state = game.start(12);
    const [first] = game.top(game.current(state)!.puzzle);
    state = game.guess(state, first!).state;
    state = game.giveUp(state);
    expect(game.current(state)!.status).toBe('failed');
    expect(state.status).toBe('round-over');
    expect(state.score).toBe(1);
    expect(game.giveUp(state)).toBe(state);
    state = game.nextRound(state);
    state = solve(state);
    expect(replayCircle(game, 12, state.moves).score).toBe(6);
  });

  it('counts small cities too', async () => {
    const small = [...game.cities.values()].filter((c) => c.population < 200_000);
    expect(small.length).toBeGreaterThan(4000);
    expect([...game.cities.values()].find((c) => c.name === 'Prešov')).toBeDefined();
  });
});
