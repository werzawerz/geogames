import { describe, expect, it } from 'vitest';
import { geoArea, geoContains } from 'd3-geo';
import { queryCountries } from './index.ts';
import { loadWorldShapes } from './shapes.ts';

describe('world shapes', async () => {
  const shapes = await loadWorldShapes();

  it('has an outline for every sovereign country with land borders', () => {
    const missing = queryCountries()
      .filter((c) => c.borders.length > 0 && !shapes.countries.has(c.id))
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('maps Kosovo by name and merges Somaliland into Somalia', () => {
    expect(shapes.countries.get('XKX')).toBeDefined();
    expect(shapes.countries.get('SOM')?.geometry.type).toBe('MultiPolygon');
  });

  it('provides a land silhouette', () => {
    expect(shapes.land.geometry.coordinates.length).toBeGreaterThan(100);
  });

  it('draws Western Sahara as the whole territory south of 27°40′N, not just east of the berm', () => {
    const morocco = shapes.countries.get('MAR')!;
    const westernSahara = shapes.countries.get('ESH')!;
    const km2 = (f: typeof morocco) => geoArea(f) * 6371 ** 2;
    expect(km2(westernSahara)).toBeGreaterThan(240_000); // real: ~266,000 km²
    expect(geoContains(westernSahara, [-13.2, 27.15])).toBe(true); // Laayoune
    expect(geoContains(morocco, [-13.2, 27.15])).toBe(false);
    expect(geoContains(morocco, [-6.84, 34.02])).toBe(true); // Rabat
  });
});
