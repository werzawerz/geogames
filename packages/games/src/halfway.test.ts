import { describe, expect, it } from 'vitest';
import { getGame } from './catalog.ts';
import { distanceKm, type CircleCity } from './circle.ts';
import {
  HALFWAY_AFRICA_SPACING,
  HALFWAY_KNOWN_POPULATION,
  HALFWAY_SUBREGION_MAX,
  FAMOUS_END_MIN_POPULATION,
  HALFWAY_MISSES,
  HALFWAY_PLANS,
  HALFWAY_SKIP,
  HALFWAY_SUBREGION_WINDOW,
  HALFWAY_MAX_LIVES,
  HALFWAY_START_LIVES,
  createHalfway,
  halfwayPlan,
  midpoint,
  replayHalfway,
  type HalfwayState,
} from './halfway.ts';
import { halfwayPools } from './pools.ts';
import { replayGame } from './replay.ts';
import { routeScopes } from './route.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const pools = await halfwayPools();
const { countries } = pools;
const game = createHalfway(pools);
const continent = new Map(countries.map((c) => [c.id, c.continent]));
const crowded = (c: CircleCity) => c.countryId === 'CHN' || c.countryId === 'IND';
const city = (id: string) => game.cities.get(id)!;

/** Clears `count` levels with the fair city nearest each midpoint: a run never ends by itself. */
const playPerfect = (seed: number, count = 20) => {
  let state = game.start(seed);
  const levels: HalfwayState['level'][] = [];
  while (levels.length < count) {
    levels.push(state.level);
    state = game.guess(state, state.level.fair[0]!).state;
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
};

/** A city on the far side of the world from the midpoint, not guessed yet. */
const farAway = (state: HalfwayState) =>
  [...game.cities.values()].find(
    (c) => distanceKm(c.latlng, state.level.midpoint) > 10_000 && !state.level.guesses.some((g) => g.id === c.id),
  )!.id;

/** Loses the level: three far guesses. */
const loseLevel = (state: HalfwayState) => {
  for (let i = 0; i < HALFWAY_MISSES; i++) state = game.guess(state, farAway(state)).state;
  return state;
};

describe('midpoint', () => {
  it('is halfway along the great circle, not on the flat map', () => {
    const paris = [48.86, 2.35] as const;
    const berlin = [52.52, 13.4] as const;
    const m = midpoint(paris, berlin);
    expect(distanceKm(m, paris)).toBeCloseTo(distanceKm(m, berlin), 6);
    expect(distanceKm(m, paris) * 2).toBeCloseTo(distanceKm(paris, berlin), 6);
    // London to Tokyo goes over the north: the midpoint is far north of both.
    const [lat] = midpoint([51.5, -0.13], [35.68, 139.69]);
    expect(lat).toBeGreaterThan(65);
    // Across the date line.
    const [, lng] = midpoint([0, 170], [0, -170]);
    expect(Math.abs(lng)).toBeCloseTo(180, 6);
  });
});

describe('halfway', () => {
  it('is deterministic for a seed', () => {
    expect(playPerfect(4).state).toEqual(playPerfect(4).state);
    expect(game.start(1).level).not.toEqual(game.start(2).level);
  });

  it('makes only fair levels: enough well-known cities near every midpoint', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { levels } = playPerfect(seed);
      for (const level of levels) {
        const plan = halfwayPlan(level.number);
        expect(level.radiusKm).toBe(plan.radiusKm);
        expect(level.fair.length).toBeGreaterThanOrEqual(plan.minKnown);
        expect(level.fair.filter((id) => pools.famous.has(id)).length).toBeGreaterThanOrEqual(plan.minFamous);
        // Well known: famous or 1M+, never only towns most players haven't heard of.
        for (const id of level.fair) {
          const c = city(id);
          const known = crowded(c) ? c.population >= plan.crowdedCountryMinPopulation : pools.famous.has(id) || c.population >= HALFWAY_KNOWN_POPULATION;
          expect(known, c.name).toBe(true);
        }
        for (const id of level.fair) expect(distanceKm(city(id).latlng, level.midpoint)).toBeLessThanOrEqual(level.radiusKm);
        const km = distanceKm(city(level.from).latlng, city(level.to).latlng);
        expect(km).toBeGreaterThanOrEqual(plan.separationKm[0]);
        expect(km).toBeLessThanOrEqual(plan.separationKm[1]);
      }
    }
  }, 60_000);

  it('starts with famous cities in well-known places, and never reuses one', () => {
    const { isRemote } = routeScopes(countries);
    for (let seed = 1; seed <= 40; seed++) {
      const { levels } = playPerfect(seed);
      const ends = levels.flatMap((l) => [l.from, l.to]);
      expect(new Set(ends).size).toBe(ends.length);
      for (const level of levels.slice(0, 5)) {
        const [a, b] = [city(level.from), city(level.to)];
        for (const c of [a, b]) {
          expect(pools.famous.has(c.id), c.name).toBe(true);
          expect(isRemote(c.countryId), c.name).toBe(false);
          if (crowded(c)) expect(c.population, c.name).toBeGreaterThanOrEqual(20_000_000);
        }
        expect(continent.get(a.countryId)).toBe(continent.get(b.countryId));
        // The cities that make an early level fair are well known too.
        for (const id of level.fair) {
          const c = city(id);
          const big = crowded(c) ? c.population >= 20_000_000 : pools.famous.has(id) || c.population >= 1_000_000;
          expect(big, c.name).toBe(true);
        }
      }
    }
  }, 60_000);

  it('varies the early pairs from run to run, in more than Europe and Asia', () => {
    const pairs = new Map<string, number>();
    const regions = new Set<string>();
    const seeds = 300;
    for (let seed = 1; seed <= seeds; seed++) {
      let state = game.start(seed);
      const seen = new Set<string>();
      for (let i = 0; i < 5; i++) {
        seen.add([state.level.from, state.level.to].sort().join('|'));
        regions.add(state.level.region);
        state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
      }
      for (const key of seen) pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    const most = Math.max(...pairs.values());
    expect(most / seeds).toBeLessThan(0.15);
    expect(pairs.size).toBeGreaterThan(150);
    expect([...regions].sort()).toEqual(expect.arrayContaining(['Asia', 'Europe', 'North America']));
  }, 60_000);

  it('keeps Africa in from level 11, but never two African midpoints close together', () => {
    let african = 0;
    let late = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { levels } = playPerfect(seed);
      levels.forEach((level, i) => {
        if (level.number <= 10) {
          // No African ends yet (a midpoint can still be near Cairo, between Europe and Arabia).
          for (const id of [level.from, level.to]) expect(continent.get(city(id).countryId), city(id).name).not.toBe('Africa');
          return;
        }
        late++;
        if (level.region !== 'Africa') return;
        african++;
        const before = levels.slice(Math.max(0, i - HALFWAY_AFRICA_SPACING + 1), i);
        expect(before.some((l) => l.region === 'Africa'), `seed ${seed} level ${level.number}`).toBe(false);
      });
    }
    expect(african / late).toBeGreaterThan(0.03);
    expect(african / late).toBeLessThan(0.25);
  }, 60_000);

  it('spreads a run: no subregion more than 4 times in 20 levels or twice in a row, and no end was an earlier answer', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { levels } = playPerfect(seed);
      const counts = new Map<string, number>();
      levels.forEach((level, i) => {
        counts.set(level.subregion, (counts.get(level.subregion) ?? 0) + 1);
        if (i > 0) expect(level.subregion, `seed ${seed} level ${level.number}`).not.toBe(levels[i - 1]!.subregion);
        const earlier = levels.slice(0, i);
        for (const id of [level.from, level.to]) {
          expect(earlier.some((l) => l.fair.includes(id) || l.from === id || l.to === id), `seed ${seed}: ${city(id).name}`).toBe(false);
        }
      });
      expect(Math.max(...counts.values()), `seed ${seed}`).toBeLessThanOrEqual(HALFWAY_SUBREGION_MAX);
    }
  }, 60_000);

  it('uses only well-known ends up to level 10: no satellites like Depok, no small resorts like Hạ Long', () => {
    const tooSmall = [...game.cities.values()].filter((c) => pools.famous.has(c.id) && c.population < FAMOUS_END_MIN_POPULATION).map((c) => c.id);
    expect(tooSmall.map((id) => city(id).name)).toContain('Hạ Long');
    const depok = [...game.cities.values()].find((c) => c.name === 'Depok')!.id;
    for (let seed = 1; seed <= 200; seed++) {
      let state = game.start(seed);
      while (state.level.number <= 10) {
        for (const id of [state.level.from, state.level.to]) {
          expect(id).not.toBe(depok);
          expect(tooSmall).not.toContain(id);
        }
        state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
      }
    }
  }, 60_000);

  it('never has more than 3 lives', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let state = game.start(seed);
      for (let i = 0; i < 25; i++) {
        expect(state.lives).toBeLessThanOrEqual(3);
        state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
      }
      expect(state.lives).toBeLessThanOrEqual(3);
    }
  });

  it('knows where territories are: Hong Kong is a famous end early, San Juan (Caribbean) only from level 11', () => {
    const ends = new Map<string, number[]>();
    for (let seed = 1; seed <= 300; seed++) {
      let state = game.start(seed);
      while (state.status !== 'over') {
        for (const id of [state.level.from, state.level.to]) ends.set(city(id).name, [...(ends.get(city(id).name) ?? []), state.level.number]);
        if (state.level.number >= 10) break;
        state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
      }
    }
    expect(Math.min(...(ends.get('Hong Kong') ?? [99]))).toBeLessThanOrEqual(5);
    expect(ends.get('San Juan') ?? []).toEqual([]);
    expect(continent.get(city([...game.cities.values()].find((c) => c.name === 'Hong Kong')!.id).countryId)).toBe('Asia');
  }, 60_000);

  it("doesn't repeat a level's answers", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { levels } = playPerfect(seed);
      for (let i = 0; i < levels.length; i++) {
        for (let j = 0; j < i; j++) {
          const [a, b] = [levels[i]!.fair, levels[j]!.fair];
          const shared = a.filter((id) => b.includes(id)).length;
          expect(shared, `seed ${seed}, levels ${j + 1} and ${i + 1}`).toBeLessThanOrEqual(Math.floor(Math.min(a.length, b.length) / 2));
        }
      }
    }
  }, 60_000);

  it('gets harder: smaller radius, then no line, then no names', () => {
    expect(halfwayPlan(1).radiusKm).toBeGreaterThan(halfwayPlan(10).radiusKm);
    expect(halfwayPlan(10).radiusKm).toBeGreaterThan(halfwayPlan(20).radiusKm);
    expect(halfwayPlan(1).showLine && halfwayPlan(1).showNames).toBe(true);
    expect(halfwayPlan(20).showLine || halfwayPlan(20).showNames).toBe(false);
  });

  it('scores by closeness, and a close first guess is flawless', () => {
    const start = game.start(7);
    const { state: near, result } = game.guess(start, start.level.fair[0]!);
    expect(result).toBe('inside');
    expect(near.status).toBe('level-over');
    const km = near.level.guesses[0]!.km;
    expect(near.level.points).toBe(Math.round(10 * (1 - (0.5 * km) / 300) * (near.level.flawless ? 1.5 : 1)));
    // A fair city far from the midpoint isn't flawless, and earns less.
    const edge = start.level.fair.findLast((id) => distanceKm(city(id).latlng, start.level.midpoint) > 100);
    if (edge) {
      const cleared = game.guess(start, edge).state;
      expect(cleared.level.flawless).toBe(false);
      expect(cleared.level.points).toBeLessThan(10);
      expect(cleared.level.points).toBeGreaterThanOrEqual(5);
      expect(cleared.marks).toEqual(['cleared']);
    }
  });

  it('gives a life back for a flawless level, up to the most', () => {
    let state = game.nextLevel(loseLevel(game.start(8)));
    expect(state.lives).toBe(HALFWAY_START_LIVES - 1);
    for (let i = 0; i < 10; i++) {
      const id = state.level.fair[0]!;
      const close = distanceKm(city(id).latlng, state.level.midpoint) <= state.level.radiusKm / 3;
      const before = state.lives;
      const firstTry = state.level.guesses.length === 0;
      state = game.guess(state, id).state;
      expect(state.level.flawless).toBe(close && firstTry);
      expect(state.lives).toBe(state.level.flawless ? Math.min(HALFWAY_MAX_LIVES, before + 1) : before);
      state = game.nextLevel(state);
    }
    expect(state.lives).toBeLessThanOrEqual(HALFWAY_MAX_LIVES);
  });

  it('lets two misses go free, and the third costs one life and ends the level', () => {
    let state = game.start(9);
    for (let i = 1; i < HALFWAY_MISSES; i++) {
      const { state: next, result } = game.guess(state, farAway(state));
      expect(result).toBe('outside');
      expect(next.lives).toBe(HALFWAY_START_LIVES);
      expect(next.status).toBe('playing');
      expect(game.missesLeft(next.level)).toBe(HALFWAY_MISSES - i);
      state = next;
    }
    state = game.guess(state, farAway(state)).state;
    expect(state.lives).toBe(HALFWAY_START_LIVES - 1);
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.level.points).toBe(0);
    expect(state.marks).toEqual(['lost']);
    // The level is over: no more guesses in it.
    expect(game.guess(state, state.level.fair[0]!).result).toBe('unknown');
    // One life per level at most, so the run lasts as many levels as lives.
    for (let i = 1; i < HALFWAY_START_LIVES; i++) state = loseLevel(game.nextLevel(state));
    expect(state.status).toBe('over');
    expect(state.level.number).toBe(HALFWAY_START_LIVES);
    expect(game.nextLevel(state)).toBe(state);
  });

  it('keeps making levels long after every end city has been used', () => {
    // About 1,000 cities can be an end late on: 300 levels use 600.
    const { levels } = playPerfect(3, 300);
    expect(levels.at(-1)!.number).toBe(300);
  }, 60_000);

  it('skips a level for a life, revealing it, and the skip replays', () => {
    const start = game.start(14);
    let state = game.skip(game.guess(start, farAway(start)).state);
    expect(state.lives).toBe(HALFWAY_START_LIVES - 1);
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.moves.at(-1)).toBe(HALFWAY_SKIP);
    expect(game.skip(state)).toBe(state);
    state = game.skip(game.nextLevel(state));
    state = game.skip(game.nextLevel(state));
    expect(state.status).toBe('over');
    expect(state.marks).toEqual(['lost', 'lost', 'lost']);
    expect(replayHalfway(game, 14, state.moves)).toEqual(state);
  });

  it('has no last level: a 60-level run holds the hardest band, stays fair and replays', async () => {
    const { state, levels } = playPerfect(15, 60);
    expect(levels).toHaveLength(60);
    expect(state.status).toBe('level-over');
    // Past 20 the radius keeps shrinking a little, then holds at the hardest band.
    const hardest = HALFWAY_PLANS.at(-1)!;
    expect(levels.at(-1)!.radiusKm).toBe(hardest.radiusKm);
    expect(levels[24]!.radiusKm).toBeGreaterThan(hardest.radiusKm);
    expect(halfwayPlan(1000)).toBe(hardest);
    expect(hardest.showNames || hardest.showLine).toBe(false);
    for (const level of levels) expect(level.fair.length).toBeGreaterThanOrEqual(halfwayPlan(level.number).minKnown);
    const ends = levels.flatMap((l) => [l.from, l.to]);
    expect(new Set(ends).size).toBe(ends.length);
    // The subregion cap holds in every 20 levels in a row.
    for (let i = 0; i + HALFWAY_SUBREGION_WINDOW <= levels.length; i++) {
      const counts = new Map<string, number>();
      for (const l of levels.slice(i, i + HALFWAY_SUBREGION_WINDOW)) counts.set(l.subregion, (counts.get(l.subregion) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(HALFWAY_SUBREGION_MAX);
    }
    let over = state;
    while (over.status !== 'over') over = loseLevel(game.nextLevel(over));
    expect(over.level.number).toBe(60 + HALFWAY_START_LIVES);
    expect(replayHalfway(game, 15, over.moves)).toEqual(over);
    const definition = getGame('halfway')!;
    expect(await replayGame(definition, normalizeSettings({}, definition), 15, over.moves)).toEqual({ score: over.score, finished: true });
  }, 60_000);

  it("doesn't charge for repeats, the two cities themselves, or unknown ids", () => {
    let state = game.start(10);
    const miss = farAway(state);
    state = game.guess(state, miss).state;
    expect(game.guess(state, miss)).toEqual({ state, result: 'repeat' });
    expect(game.guess(state, state.level.from)).toEqual({ state, result: 'end' });
    expect(game.guess(state, state.level.to)).toEqual({ state, result: 'end' });
    expect(game.guess(state, 'nowhere')).toEqual({ state, result: 'unknown' });
    // Clearing after a miss is not flawless.
    state = game.guess(state, state.level.fair[0]!).state;
    expect(state.level.flawless).toBe(false);
    expect(state.marks).toEqual(['missed']);
  });

  it('counts a hidden city as an ordinary far guess, so it gives nothing away', () => {
    let state = game.start(13);
    while (halfwayPlan(state.level.number).showNames) state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
    const { state: next, result } = game.guess(state, state.level.from);
    expect(result).toBe('outside');
    expect(game.missesLeft(next.level)).toBe(HALFWAY_MISSES - 1);
    expect(next.moves.at(-1)).toBe(state.level.from);
    expect(replayHalfway(game, 13, next.moves)).toEqual(next);
    // With names shown, it's refused for free.
    const first = game.start(13);
    expect(game.guess(first, first.level.to)).toEqual({ state: first, result: 'end' });
  });

  it('replays to the same result, and can be verified by a server', async () => {
    let state = game.start(11);
    for (let i = 0; i < 5; i++) {
      if (i % 2) state = game.guess(state, farAway(state)).state;
      state = game.nextLevel(game.guess(state, state.level.fair.at(-1)!).state);
    }
    state = game.nextLevel(game.skip(state));
    while (state.status !== 'over') state = game.nextLevel(loseLevel(state));
    expect(replayHalfway(game, 11, state.moves)).toEqual(state);

    const definition = getGame('halfway')!;
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 11, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(definition, settings, 11, state.moves.slice(0, 3))).toMatchObject({ finished: false });
    // A run only finishes when its lives are gone.
    const going = playPerfect(12).state;
    expect(await replayGame(definition, settings, 12, going.moves)).toEqual({ score: going.score, finished: false });
  }, 30_000);

  it('has no region to pick, and one leaderboard', () => {
    const definition = getGame('halfway')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
  });
});
