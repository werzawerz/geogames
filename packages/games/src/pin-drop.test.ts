import { describe, expect, it } from 'vitest';
import { getGame } from './catalog.ts';
import type { CircleCity } from './circle.ts';
import { DAILY_GAMES, dailySeed } from './daily.ts';
import { PIN_BUDGET_KM, PIN_BULLSEYE_REFILL_KM, createPinDrop, pinPlan, replayPinDrop, type PinState } from './pin-drop.ts';
import { arcadePools } from './pools.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const pools = await arcadePools();
const pin = createPinDrop(pools);

describe('pin drop', () => {
  const target = (state: PinState) => pin.cities.get(state.city)!.latlng;

  it('pays by closeness, and takes the distance from the budget', () => {
    const start = pin.start(1);
    const [lat, lng] = target(start);
    // About 111 km north.
    const near = pin.place(start, lat + 1, lng);
    expect(near.last!.km).toBeGreaterThan(100);
    expect(near.last!.km).toBeLessThan(120);
    expect(near.last!.points).toBeGreaterThan(90);
    expect(near.budgetKm).toBeCloseTo(PIN_BUDGET_KM - near.last!.km, 3);
    // The far side of the world: nothing, and the run is over.
    const far = pin.place(start, -lat, lng > 0 ? lng - 180 : lng + 180);
    expect(far.last!.points).toBe(0);
    expect(far.status).toBe('over');
    expect(far.budgetKm).toBe(0);
  });

  it('gives budget back for a bullseye, up to the start', () => {
    let state = pin.start(2);
    const [lat, lng] = target(state);
    state = pin.place(state, lat, lng);
    expect(state.last!.points).toBe(100);
    expect(state.budgetKm).toBe(PIN_BUDGET_KM);
    state = pin.next(state);
    const off = pin.place(state, target(state)[0] + 10, target(state)[1]);
    state = pin.next(off);
    const bullseye = pin.place(state, target(state)[0], target(state)[1]);
    expect(bullseye.budgetKm).toBeCloseTo(off.budgetKm + PIN_BULLSEYE_REFILL_KM, 3);
  });

  it('starts with famous cities, never repeats, and pays more later', () => {
    let state = pin.start(3);
    const seen = new Set<string>();
    for (let level = 1; level <= 40; level++) {
      expect(seen.has(state.city)).toBe(false);
      seen.add(state.city);
      if (level <= 5) expect(pools.famous.has(state.city), pin.cities.get(state.city)!.name).toBe(true);
      else {
        const { population } = pin.cities.get(state.city)!;
        expect(pools.famous.has(state.city) || population >= pinPlan(level).minPopulation).toBe(true);
      }
      const [lat, lng] = target(state);
      state = pin.next(pin.place(state, lat, lng));
    }
    expect(pinPlan(40).multiplier).toBeGreaterThan(pinPlan(1).multiplier);
  });

  it('ignores a second pin and bad coordinates', () => {
    const start = pin.start(4);
    expect(pin.place(start, NaN, 0)).toBe(start);
    const placed = pin.place(start, 10, 10);
    expect(pin.place(placed, 20, 20)).toBe(placed);
  });

  it('replays to the same result, and can be verified by a server', async () => {
    let state = pin.start(5);
    for (let i = 0; i < 4; i++) {
      const [lat, lng] = target(state);
      state = pin.place(state, lat + 0.123456, lng - 0.5);
      state = pin.next(state);
    }
    state = pin.place(state, -target(state)[0], target(state)[1] > 0 ? target(state)[1] - 180 : target(state)[1] + 180);
    expect(state.status).toBe('over');
    expect(replayPinDrop(pin, 5, state.moves)).toEqual(state);

    const game = getGame('pin-drop')!;
    const settings = normalizeSettings({}, game);
    expect(await replayGame(game, settings, 5, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(game, settings, 5, state.moves.slice(0, 2))).toMatchObject({ finished: false });
  });

  it('has no region to pick, and one leaderboard', () => {
    const game = getGame('pin-drop')!;
    expect(usesRegion(game)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, game), game)).toBe('world');
  });

  /** The cities of a whole run, for many seeds. */
  const runs = (levels: number, seeds = 30) => {
    const all: { city: CircleCity; level: number }[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      let state = pin.start(seed);
      for (let level = 1; level <= levels; level++) {
        all.push({ city: pin.cities.get(state.city)!, level });
        state = pin.next(pin.place(state, ...(target(state) as [number, number])));
      }
    }
    return all;
  };
  const crowded = (c: CircleCity) => c.countryId === 'CHN' || c.countryId === 'IND';

  it('keeps all but the biggest Chinese and Indian cities out of the early levels', () => {
    for (const { city, level } of runs(40)) {
      if (crowded(city)) {
        expect(city.population, `${city.name} at level ${level}`).toBeGreaterThanOrEqual(pinPlan(level).crowdedCountryMinPopulation);
      }
    }
    const early = new Set(runs(5, 200).filter(({ city }) => crowded(city)).map(({ city }) => city.name));
    expect([...early].sort()).toEqual(['Beijing', 'Delhi', 'Mumbai', 'Shanghai']);
  }, 30_000);

  it('spreads cities over the world, even where China and India have the most', () => {
    const late = runs(60).filter(({ level }) => level >= 16);
    expect(late.filter(({ city }) => crowded(city)).length / late.length).toBeLessThan(0.1);
    expect(new Set(late.map(({ city }) => city.countryId)).size).toBeGreaterThan(70);
  }, 30_000);

  it('records how far off each pin was', () => {
    let state = pin.start(6);
    state = pin.next(pin.place(state, ...(target(state) as [number, number])));
    state = pin.place(state, target(state)[0] + 5, target(state)[1]);
    expect(state.distances).toHaveLength(2);
    expect(state.distances[0]).toBeLessThan(2);
    expect(state.distances[1]).toBeGreaterThan(500);
  });

  it('is a daily game', async () => {
    expect(DAILY_GAMES).toContain('pin-drop');
    expect(await dailySeed('pin-drop', '2026-11-05')).not.toBe(await dailySeed('border-route', '2026-11-05'));
  });
});
