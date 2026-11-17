import { describe, expect, it } from 'vitest';
import { GAMES, getGame, type HigherLowerDefinition } from './catalog.ts';
import { createHigherLowerGame } from './higher-lower.ts';
import { continentOf, loadPool, poolSizes } from './pools.ts';
import {
  DEFAULT_SETTINGS,
  MIN_POOL_SIZE,
  REGIONS,
  citySizeStops,
  hasSettings,
  normalizeSettings,
  settingsFromVariant,
  variantKey,
} from './settings.ts';

const cityGame = getGame('higher-lower-city-population') as HigherLowerDefinition;
const higherLower = GAMES.filter((g): g is HigherLowerDefinition => g.kind === 'higher-lower' && g.status === 'live');

describe('game pools', () => {
  it.each(higherLower)('$id has a playable world pool', async (game) => {
    const pool = await loadPool(game);
    const engine = createHigherLowerGame({ metric: game.metric, pool });
    expect(engine.pool.length).toBeGreaterThan(150);
    const state = engine.start(1);
    expect(state.current.id).not.toBe(state.challenger.id);
  });

  it('filters by continent and city size', async () => {
    const pool = await loadPool(cityGame, { ...DEFAULT_SETTINGS, region: 'Europe', cityMinPopulation: 100_000 });
    expect(pool.every((c) => continentOf(c) === 'Europe')).toBe(true);
    expect(pool.every((c) => c.metrics.population!.value >= 100_000)).toBe(true);
    expect(pool.some((c) => c.name === 'Debrecen')).toBe(true);
  });

  it('reports sizes that match the loaded pools', async () => {
    for (const settings of [DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, region: 'Europe' as const, cityMinPopulation: 200_000 }]) {
      const sizes = poolSizes(cityGame, settings);
      expect(sizes[settings.region]).toBe((await loadPool(cityGame, settings)).length);
    }
    const countryGame = getGame('higher-lower-population') as HigherLowerDefinition;
    expect(poolSizes(countryGame).Europe).toBe((await loadPool(countryGame, { ...DEFAULT_SETTINGS, region: 'Europe' })).length);
  });
});

describe('settings', () => {
  it('knows which games have settings to change', () => {
    const without = GAMES.filter((g) => !hasSettings(g)).map((g) => g.id).sort();
    expect(without).toEqual(['blank-atlas', 'border-blitz', 'clockwork', 'great-circle', 'halfway', 'mystery-country', 'native-tongue', 'pin-drop', 'river-run', 'supply-chain']);
    for (const id of ['capitals', 'city-circle', 'city-circle-arcade', 'border-route', 'higher-lower-population']) expect(hasSettings(getGame(id)!), id).toBe(true);
  });

  const capitals = getGame('capitals')!;
  const countryGame = getGame('higher-lower-population')!;

  it('never offers world cities below 300k, or a stop with too few cities', () => {
    expect(Math.min(...citySizeStops('world'))).toBe(300_000);
    expect(Math.min(...citySizeStops('Europe'))).toBe(100_000);
    for (const r of REGIONS) {
      for (const min of citySizeStops(r.id)) {
        const settings = { ...DEFAULT_SETTINGS, region: r.id, cityMinPopulation: min };
        expect(poolSizes(cityGame, settings)[r.id]).toBeGreaterThanOrEqual(MIN_POOL_SIZE);
      }
    }
  });

  it('snaps disallowed values and resets settings a game does not use', () => {
    expect(normalizeSettings({ region: 'world', cityMinPopulation: 50_000 }, cityGame).cityMinPopulation).toBe(300_000);
    expect(normalizeSettings({ region: 'Europe', cityMinPopulation: 400_000 }, cityGame).cityMinPopulation).toBe(300_000);
    expect(normalizeSettings({}, cityGame)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ difficulty: 'hard' }, cityGame).difficulty).toBe('medium');
    expect(normalizeSettings({ difficulty: 'hard' }, capitals).difficulty).toBe('hard');
    const circle = getGame('city-circle')!;
    expect(normalizeSettings({ circleRadiusKm: 437 }, circle).circleRadiusKm).toBe(450);
    expect(normalizeSettings({ circleRadiusKm: 5000 }, circle).circleRadiusKm).toBe(1500);
    expect(normalizeSettings({ circleRadiusKm: 0, circlePlacement: 'custom' }, circle).circleRadiusKm).toBe(500);
  });

  it('keeps legacy variant keys and round-trips new ones', () => {
    expect(variantKey(DEFAULT_SETTINGS, cityGame)).toBe('world');
    expect(variantKey({ ...DEFAULT_SETTINGS, region: 'Europe', difficulty: 'hard' }, countryGame)).toBe('europe');
    const city = { ...DEFAULT_SETTINGS, region: 'North America' as const, cityMinPopulation: 200_000 };
    expect(variantKey(city, cityGame)).toBe('north-america-200k');
    expect(settingsFromVariant('north-america-200k', cityGame)).toEqual(city);
    const quiz = { ...DEFAULT_SETTINGS, region: 'Asia' as const, difficulty: 'easy' as const };
    expect(variantKey(quiz, capitals)).toBe('asia-easy');
    expect(settingsFromVariant('asia-easy', capitals)).toEqual(quiz);
    const circle = getGame('city-circle')!;
    expect(variantKey({ ...DEFAULT_SETTINGS, circleRadiusKm: 650, circlePlacement: 'custom' }, circle)).toBe('world-medium-custom');
    expect(variantKey({ ...DEFAULT_SETTINGS, circleRadiusKm: 350 }, circle)).toBe('world-small');
    expect(settingsFromVariant('europe-large', circle)).toMatchObject({ region: 'Europe', circleRadiusKm: 1000 });
    for (const r of REGIONS) {
      const key = variantKey({ ...DEFAULT_SETTINGS, region: r.id }, countryGame);
      expect(settingsFromVariant(key, countryGame).region).toBe(r.id);
    }
  });
});
