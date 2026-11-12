import { describe, expect, it } from 'vitest';
import { dataset, getCountry } from './index.ts';
import { cityIndex, loadCities, loadCityProper } from './cities.ts';
import { validateCities } from './validate.ts';

const all = await loadCities({ includeUncertain: true });
const byName = (name: string, countryId: string) => all.find((c) => c.name === name && c.countryId === countryId);

describe('cities', () => {
  it('uses English names where the UN data has pinyin, keeping it as an alias', () => {
    const keelung = byName('Keelung', 'TWN')!;
    expect(keelung.aliases).toContain('Jilong');
    expect(byName('Jilong', 'TWN')).toBeUndefined();
    expect(byName('Hsinchu', 'TWN')).toBeDefined();
  });

  it('passes integrity validation against the country dataset', () => {
    const result = validateCities({ ...cityIndex, cities: all }, dataset);
    expect(result.errors).toEqual([]);
  });

  it('loads every city once across the continent files', () => {
    const { major, ...continents } = cityIndex.files;
    expect(all).toHaveLength(Object.values(continents).reduce((a, b) => a + b, 0));
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    expect(all.every((c) => c.metrics.population!.value >= cityIndex.minPopulation)).toBe(true);
    expect(major).toBe(all.filter((c) => c.metrics.population!.value >= cityIndex.majorMinPopulation).length);
  });

  it('links every city to a known country', () => {
    expect(all.every((c) => getCountry(c.countryId))).toBe(true);
  });

  it('uses English names, but not former names', () => {
    expect(byName('Rome', 'ITA')?.localName).toBe('Roma');
    expect(byName('Cologne', 'DEU')).toBeDefined();
    expect(byName('Düsseldorf', 'DEU')).toBeDefined(); // UN wrote "Duesseldorf"
    expect(byName('Nuremberg', 'DEU')).toBeDefined(); // UN typo "Nurenberg"
    expect(byName('Mumbai', 'IND')?.aliases).toContain('Bombay');
    expect(byName('Kyiv', 'UKR')?.aliases).toContain('Kiev');
    expect(byName('Delhi', 'IND')?.capital).toBe(true); // New Delhi lies inside
    expect(all.find((c) => c.name === 'Cape Town' && c.countryId === 'IND')).toBeUndefined();
  });

  it('takes English spellings from Wikidata, but not its municipalities or districts', () => {
    expect(byName('Jeddah', 'SAU')?.aliases).toContain('Jiddah');
    expect(byName('Ghent', 'BEL')).toBeDefined();
    expect(byName('Dallas', 'USA')?.aliases).toContain('Dallas-Fort Worth');
    expect(byName('Venice', 'ITA')).toBeDefined();
    expect(byName('Turin', 'ITA')).toBeDefined(); // not Wikidata's "Torino"
    expect(byName('Madrid', 'ESP')).toBeDefined(); // not "Madrid city"
    expect(byName('Chongqing', 'CHN')).toBeDefined(); // not "Chongqing Shi"
    expect(byName('Ekurhuleni', 'ZAF')).toBeDefined(); // not its town Benoni
    expect(all.some((c) => /\s{2}/.test(c.name))).toBe(false);
  });

  it('has a city-proper dataset without suburbs in the figures', async () => {
    const { cities, tourismRank } = await loadCityProper();
    const pop = (name: string, countryId: string) => cities.find((c) => c[1] === name && c[2] === countryId)?.[3];
    const italy = cities.filter((c) => c[2] === 'ITA').slice(0, 6).map((c) => c[1]);
    expect(italy).toEqual(['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa']);
    expect(pop('Bergamo', 'ITA')).toBeLessThan(200_000);
    // Separate cities here, inside their metro areas in the main dataset.
    expect(pop('Yokohama', 'JPN')).toBeGreaterThan(3_000_000);
    expect(pop('Kyoto', 'JPN')).toBeGreaterThan(1_000_000);
    // Parts of cities are not cities.
    for (const part of ['Brooklyn', 'Pudong', 'Sadr City', 'Paris 15 Vaugirard']) expect(cities.some((c) => c[1] === part)).toBe(false);
    // Never above the metro area: GeoNames has Taipei at 7.9M and Weifang's whole prefecture.
    expect(pop('Taipei', 'TWN')).toBeLessThan(3_000_000);
    expect(pop('Weifang', 'CHN')).toBeLessThan(4_000_000);
    expect(pop('Wuzhong', 'CHN')).toBeLessThan(2_000_000);
    // Search still knows other names, and the well-known list applies.
    expect(cities.find((c) => c[1] === 'Bratislava')?.[6]).toContain('Pozsony');
    expect(cities.find((c) => c[1] === 'Mumbai')?.[6]).toContain('Bombay');
    expect(cities.find((c) => c[1] === 'Tokyo')?.[6] ?? []).not.toContain('Yokohama');
    expect(Object.keys(tourismRank).length).toBeGreaterThan(120);
    expect(new Set(cities.map((c) => c[0])).size).toBe(cities.length);
  });

  it('keeps only certain, recognizable cities by default', async () => {
    const pool = await loadCities({ minPopulation: 1_000_000 });
    expect(pool.length).toBeGreaterThan(400);
    expect(pool.every((c) => c.quality.recognizable && c.quality.plausibility !== 'low')).toBe(true);
    expect(pool.find((c) => c.name === 'Hajipur')).toBeUndefined();
    expect(pool.find((c) => c.name === 'Budapest')).toBeDefined();
  });

  it('serves small cities per continent and per country', async () => {
    const europe = await loadCities({ minPopulation: 100_000, continents: ['Europe'] });
    expect(europe.every((c) => getCountry(c.countryId)?.continent === 'Europe')).toBe(true);
    expect(europe.some((c) => c.name === 'Debrecen')).toBe(true);

    const hungary = await loadCities({ countries: ['HUN'] });
    expect(hungary.map((c) => c.name)).toEqual(expect.arrayContaining(['Budapest', 'Debrecen', 'Sopron']));
    expect(hungary.every((c) => c.countryId === 'HUN')).toBe(true);
  });

  it('uses the agglomerations people know for big cities', () => {
    const pop = (n: string, c: string) => byName(n, c)!.metrics.population!.value;
    expect(pop('Rome', 'ITA')).toBeGreaterThan(pop('Milan', 'ITA'));
    expect(pop('Milan', 'ITA')).toBeGreaterThan(pop('Naples', 'ITA'));
    expect(pop('Tokyo', 'JPN')).toBeGreaterThan(pop('Jakarta', 'IDN'));
    expect(pop('London', 'GBR')).toBeGreaterThan(pop('Manchester', 'GBR'));
    expect(byName('San Jose', 'USA')).toBeDefined();
    expect(byName('Tokyo', 'JPN')!.includes).toContain('Yokohama');
    expect(byName('Rome', 'ITA')!.metrics.population!.source).toBe('wup2018');
    // Small cities still come from WUP 2025.
    expect(byName('Debrecen', 'HUN')!.metrics.population!.source).toBe('wup');
  });
});
