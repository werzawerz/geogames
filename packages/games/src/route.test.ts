import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { routeCountries } from './pools.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import {
  EXTRA_GUESSES,
  HARD_MODE_GUESSES,
  buildBorderGraph,
  createRouteGame,
  distancesFrom,
  replayRoute,
  routeLevelPlan,
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
    // 10 points a route, times its level.
    expect(state.score).toBe(10 + 20 + 30 + 40 + 50);
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

  it('hard mode gives every route the same guesses, so the count reveals nothing', () => {
    const hard = createRouteGame({ countries: queryCountries(), rounds: 5, hard: true });
    expect(hard.guessLimit({ start: 'HUN', end: 'AUT', minimal: 1 })).toBe(HARD_MODE_GUESSES);
    expect(hard.guessLimit({ start: 'HUN', end: 'CHN', minimal: 7 })).toBe(HARD_MODE_GUESSES);
    // Far longer routes still can't become impossible.
    expect(hard.guessLimit({ start: 'HUN', end: 'CHN', minimal: 10 })).toBe(10 + EXTRA_GUESSES);
    expect(game.guessLimit({ start: 'HUN', end: 'AUT', minimal: 1 })).toBe(1 + EXTRA_GUESSES);

    // Detours run out at the fixed count, and the same puzzles come up as in easy mode.
    let state = hard.start(11);
    const { puzzle } = hard.current(state);
    expect(puzzle).toEqual(game.current(game.start(11)).puzzle);
    for (let i = 0; i < 40 && state.status === 'playing'; i++) {
      const round = hard.current(state);
      const detour = [...hard.frontier(round)].find((id) => hard.classify(puzzle, id) === 'far');
      if (!detour) return; // ran out of far-off countries; nothing more to assert
      state = hard.guess(state, detour).state;
    }
    expect(hard.current(state).guesses).toHaveLength(HARD_MODE_GUESSES);
    expect(hard.current(state).status).toBe('failed');
  });

  describe('as an arcade run of 20 levels', () => {
    const arcade = createRouteGame({ countries: routeCountries(), rounds: 20 });
    const info = new Map(routeCountries().map((c) => [c.id, c]));
    const isRemote = (id: string) => info.get(id)?.continent === 'Africa' || info.get(id)?.subregion === 'Caribbean';
    const playAll = (seed: number) => {
      let state = arcade.start(seed);
      for (;;) {
        for (const id of arcade.shortestRoute(arcade.current(state).puzzle).slice(1, -1)) state = arcade.guess(state, id).state;
        if (state.status === 'over') return state;
        state = arcade.nextRound(state);
      }
    };

    it('follows the level plans, on any seed', () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { rounds } = playAll(seed);
        expect(rounds).toHaveLength(20);
        rounds.forEach(({ puzzle }, i) => {
          const { between: [min, max], scope } = routeLevelPlan(i + 1);
          expect(puzzle.minimal, `seed ${seed} level ${i + 1}`).toBeGreaterThanOrEqual(min);
          expect(puzzle.minimal, `seed ${seed} level ${i + 1}`).toBeLessThanOrEqual(max);
          if (scope !== 'any') {
            expect(arcade.shortestRoute(puzzle).filter(isRemote), `seed ${seed} level ${i + 1}`).toEqual([]);
          }
        });
      }
    });

    it('never uses a start or goal twice in a run', () => {
      for (let seed = 1; seed <= 25; seed++) {
        const ends = playAll(seed).rounds.flatMap((r) => [r.puzzle.start, r.puzzle.end]);
        expect(new Set(ends).size).toBe(ends.length);
      }
    });

    it('brings in Africa and the Caribbean only from level 9', () => {
      const late = new Set<string>();
      for (let seed = 1; seed <= 25; seed++) {
        playAll(seed).rounds.slice(8).forEach((r) => [r.puzzle.start, r.puzzle.end].filter(isRemote).forEach((id) => late.add(id)));
      }
      expect(late.size).toBeGreaterThan(20);
    });

    it('ends with the highest score after level 20', () => {
      const state = playAll(3);
      expect(state.status).toBe('over');
      expect(state.score).toBe((10 * 20 * 21) / 2);
    });

    it('ends as soon as a route fails, keeping the points so far', () => {
      let state = arcade.start(5);
      for (const id of arcade.shortestRoute(arcade.current(state).puzzle).slice(1, -1)) state = arcade.guess(state, id).state;
      state = arcade.nextRound(state);
      const { puzzle } = arcade.current(state);
      while (state.status === 'playing') {
        const detour = [...arcade.frontier(arcade.current(state))].find((id) => arcade.classify(puzzle, id) === 'far');
        if (!detour) return;
        state = arcade.guess(state, detour).state;
      }
      expect(arcade.current(state).status).toBe('failed');
      expect(state.status).toBe('over');
      expect(state.score).toBe(10);
      expect(state.rounds).toHaveLength(2);
    });

    it('stays within hard mode\'s guesses, so the count never gives a route away', () => {
      const hard = createRouteGame({ countries: routeCountries(), rounds: 20, hard: true });
      for (let seed = 1; seed <= 25; seed++) {
        for (const { puzzle } of playAll(seed).rounds) expect(hard.guessLimit(puzzle)).toBe(HARD_MODE_GUESSES);
      }
    });
  });

  describe('hard mode: guesses off the route', () => {
    const hard = createRouteGame({ countries: queryCountries(), rounds: 5, hard: true });
    /** A country that doesn't border the route so far and isn't part of it. */
    const offRoute = (state: RouteGameState, skip: readonly string[] = []) => {
      const round = hard.current(state);
      const frontier = hard.frontier(round);
      return queryCountries().find(
        (c) =>
          hard.graph.has(c.id) &&
          !frontier.has(c.id) &&
          c.id !== round.puzzle.start &&
          c.id !== round.puzzle.end &&
          !round.guesses.includes(c.id) &&
          !skip.includes(c.id),
      )!.id;
    };

    it('cost a guess and stay off the route', () => {
      let state = hard.start(11);
      const miss = offRoute(state);
      const { state: next, result } = hard.guess(state, miss);
      state = next;
      expect(result).toBe('not-adjacent');
      expect(hard.current(state).misses).toEqual([miss]);
      expect(hard.current(state).guesses).toEqual([]);
      expect(state.moves).toEqual([miss]);
      // Doesn't open the way from there.
      expect(hard.frontier(hard.current(state)).has(miss)).toBe(false);
    });

    it('cost points when the route is solved', () => {
      let state = hard.start(11);
      const { puzzle } = hard.current(state);
      for (const miss of [offRoute(state), offRoute(state, [offRoute(state)])]) state = hard.guess(state, miss).state;
      for (const id of hard.shortestRoute(puzzle).slice(1, -1)) state = hard.guess(state, id).state;
      expect(hard.current(state).status).toBe('solved');
      expect(state.score).toBe(10 - 2 * 2);
    });

    it("aren't charged twice for the same country", () => {
      const first = hard.guess(hard.start(11), offRoute(hard.start(11)));
      const again = hard.guess(first.state, hard.current(first.state).misses[0]!);
      expect(again.result).toBe('repeat');
      expect(again.state).toBe(first.state);
    });

    it('can run out the guesses, and replay the same', () => {
      let state = hard.start(11);
      const tried: string[] = [];
      while (hard.current(state).status === 'playing') {
        const miss = offRoute(state, tried);
        tried.push(miss);
        state = hard.guess(state, miss).state;
      }
      expect(hard.current(state).status).toBe('failed');
      expect(tried).toHaveLength(hard.guessLimit(hard.current(state).puzzle));
      expect(state.score).toBe(0);
      const replayed = replayRoute(hard, 11, state.moves);
      expect(replayed.rounds.map((r) => r.status)).toEqual(state.rounds.map((r) => r.status));
      expect(replayed.rounds.at(-1)!.misses).toEqual(tried);
    });

    it('stay free in easy mode', () => {
      const state = game.start(11);
      const { state: next, result } = game.guess(state, 'AUS');
      expect(result).toBe('not-adjacent');
      expect(next).toBe(state);
    });
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
    let state: RouteGameState = { ...game.start(1), rounds: [{ puzzle, guesses: [], misses: [], status: 'playing', points: 0 }] };
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
