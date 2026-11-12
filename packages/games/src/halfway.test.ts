import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { getGame } from './catalog.ts';
import { distanceKm, type CircleCity } from './circle.ts';
import {
  HALFWAY_FAIR_CITIES,
  HALFWAY_LEVELS,
  HALFWAY_MAX_LIVES,
  HALFWAY_START_LIVES,
  createHalfway,
  halfwayPlan,
  midpoint,
  replayHalfway,
  type HalfwayState,
} from './halfway.ts';
import { arcadePools } from './pools.ts';
import { replayGame } from './replay.ts';
import { routeScopes } from './route.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const pools = await arcadePools();
const countries = queryCountries();
const game = createHalfway({ ...pools, countries });
const city = (id: string) => game.cities.get(id)!;

/** The fair city nearest the midpoint clears every level. */
const playPerfect = (seed: number) => {
  let state = game.start(seed);
  const levels: HalfwayState['level'][] = [];
  while (state.status !== 'over') {
    levels.push(state.level);
    state = game.nextLevel(game.guess(state, state.level.fair[0]!).state);
  }
  return { state, levels };
};

/** A city on the far side of the world from the midpoint, not guessed yet. */
const farAway = (state: HalfwayState) =>
  [...game.cities.values()].find(
    (c) => distanceKm(c.latlng, state.level.midpoint) > 10_000 && !state.level.guesses.some((g) => g.id === c.id),
  )!.id;

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
      const { state, levels } = playPerfect(seed);
      expect(state.completed, `seed ${seed}`).toBe(true);
      expect(levels).toHaveLength(HALFWAY_LEVELS);
      for (const level of levels) {
        const plan = halfwayPlan(level.number);
        expect(level.radiusKm).toBe(plan.radiusKm);
        expect(level.fair.length).toBeGreaterThanOrEqual(HALFWAY_FAIR_CITIES);
        for (const id of level.fair) expect(distanceKm(city(id).latlng, level.midpoint)).toBeLessThanOrEqual(level.radiusKm);
        const km = distanceKm(city(level.from).latlng, city(level.to).latlng);
        expect(km).toBeGreaterThanOrEqual(plan.separationKm[0]);
        expect(km).toBeLessThanOrEqual(plan.separationKm[1]);
      }
    }
  }, 60_000);

  it('starts with famous cities in well-known places, and never reuses one', () => {
    const { isRemote } = routeScopes(countries);
    const continent = new Map(countries.map((c) => [c.id, c.continent]));
    const crowded = (c: CircleCity) => c.countryId === 'CHN' || c.countryId === 'IND';
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
          const big = crowded(c) ? c.population >= 20_000_000 : pools.famous.has(id) || c.population >= 3_000_000;
          expect(big, c.name).toBe(true);
        }
      }
    }
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
    expect(near.status).toBe('level-clear');
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
    let state = game.start(8);
    state = game.guess(state, farAway(state)).state;
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

  it('costs a life for a guess outside the radius, and ends the run at none', () => {
    let state = game.start(9);
    for (let i = 1; i <= HALFWAY_START_LIVES; i++) {
      const { state: next, result } = game.guess(state, farAway(state));
      expect(result).toBe('outside');
      expect(next.lives).toBe(HALFWAY_START_LIVES - i);
      state = next;
    }
    expect(state.status).toBe('over');
    expect(state.level.status).toBe('lost');
    expect(state.marks).toEqual(['lost']);
    expect(state.completed).toBe(false);
    expect(game.guess(state, state.level.fair[0]!).result).toBe('unknown');
  });

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

  it('replays to the same result, and can be verified by a server', async () => {
    let state = game.start(11);
    for (let i = 0; i < 5; i++) {
      if (i % 2) state = game.guess(state, farAway(state)).state;
      state = game.nextLevel(game.guess(state, state.level.fair.at(-1)!).state);
    }
    while (state.status !== 'over') state = game.guess(state, farAway(state)).state;
    expect(replayHalfway(game, 11, state.moves)).toEqual(state);

    const definition = getGame('halfway')!;
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 11, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(definition, settings, 11, state.moves.slice(0, 3))).toMatchObject({ finished: false });
    const won = playPerfect(12).state;
    expect(await replayGame(definition, settings, 12, won.moves)).toEqual({ score: won.score, finished: true });
  }, 30_000);

  it('has no region to pick, and one leaderboard', () => {
    const definition = getGame('halfway')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
  });
});
