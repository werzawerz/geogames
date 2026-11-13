import { describe, expect, it } from 'vitest';
import { arcadePools } from '@geogames/games';
import { queryCountries } from '@geogames/geodata';
import { buildIndex, editDistance, exactMatch, search } from './search.ts';
import { cityItems, countryItems } from './searchItems.ts';

const cities = buildIndex(cityItems((await arcadePools()).cities));
const countries = buildIndex(countryItems(queryCountries().map((c) => c.id)));
const none = new Set<string>();
const top = (index: typeof cities, text: string, n = 8) =>
  search(index, text, none, n).map((h) => `${h.item.label}|${h.item.detail ?? ''}${h.via ? `|${h.via}` : ''}`);

describe('search', () => {
  it('measures edits including swapped letters', () => {
    expect(editDistance('kyev', 'kiev', 2)).toBe(1);
    expect(editDistance('amstredam', 'amsterdam', 2)).toBe(1);
    expect(editDistance('paris', 'tokyo', 2)).toBe(3);
  });

  it('finds a city absorbed into a bigger urban area by its own name', () => {
    expect(top(cities, 'Yokohama', 1)[0]).toBe('Tokyo|Japan|Yokohama');
  });

  it('narrows by a country written after the city', () => {
    for (const q of ['San Jose USA', 'San Jose, United States', 'san jose us', 'San Jose, America']) {
      expect(top(cities, q, 3)[0], q).toBe('San Jose|United States');
    }
    expect(top(cities, 'San Jose Costa Rica', 1)[0]).toBe('San José|Costa Rica');
    expect(top(cities, 'london canada', 1)[0]).toBe('London|Canada');
  });

  it('puts bigger cities first among equal matches', () => {
    const weights = search(cities, 'San Jos', none, 8).map((h) => h.item.weight ?? 0);
    expect(weights.slice(0, 3)).toEqual([...weights.slice(0, 3)].sort((a, b) => b - a));
    expect(top(cities, 'London', 1)[0]).toBe('London|United Kingdom');
  });

  it('tolerates misspellings and old spellings', () => {
    expect(top(cities, 'Kiev', 1)[0]).toMatch(/^Kyiv\|Ukraine/);
    expect(top(cities, 'Kyev', 3).map((h) => h.split('|')[0])).toContain('Kyiv');
    expect(top(cities, 'Amstredam', 1)[0]).toMatch(/^Amsterdam/);
    expect(top(cities, 'Barcelna', 1)[0]).toMatch(/^Barcelona/);
    // Short queries stay strict: no typo matches for three letters.
    expect(top(cities, 'Rom', 3).every((h) => h.toLowerCase().includes('rom'))).toBe(true);
  });

  it('finds cities by their Hungarian names', () => {
    expect(top(cities, 'Pozsony', 1)[0]).toBe('Bratislava|Slovakia|Pozsony');
    expect(top(cities, 'Ungvár', 1)[0]).toBe('Uzhhorod|Ukraine|Ungvár');
    expect(top(cities, 'nagyvarad', 1)[0]).toBe('Oradea|Romania|Nagyvárad');
    expect(top(cities, 'Becs', 1)[0]).toBe('Vienna|Austria|Bécs');
    expect(exactMatch(cities, 'Temesvár')?.label).toBe('Timișoara');
  });

  it('matches countries in other languages', () => {
    expect(top(countries, 'Deutschland', 1)[0]).toMatch(/^Germany/);
    expect(top(countries, 'Magyarorszag', 1)[0]).toMatch(/^Hungary/);
  });

  it('resolves an exact name with a country suffix, but not an ambiguous one', () => {
    expect(exactMatch(cities, 'Hyderabad')).toBeNull();
    expect(exactMatch(cities, 'Hyderabad, Pakistan')?.detail).toBe('Pakistan');
    expect(exactMatch(cities, 'Kiev')?.label).toBe('Kyiv');
  });

  it('puts exact names and short forms above prefix and fuzzy matches', () => {
    const resolve = (text: string) => (exactMatch(countries, text) ?? search(countries, text, none, 1)[0]?.item)?.label;
    expect(resolve('UK')).toBe('United Kingdom');
    expect(resolve('US')).toBe('United States');
    expect(resolve('UAE')).toBe('United Arab Emirates');
    expect(resolve('DRC')).toBe('DR Congo');
    expect(resolve('North Kor')).toBe('North Korea');
    expect(resolve('South Kor')).toBe('South Korea');
    expect(top(countries, 'UK', 1)[0]).toMatch(/^United Kingdom/);
  });

  it('resolves every country by its own name, multi-word ones included', () => {
    for (const c of queryCountries()) {
      const resolved = exactMatch(countries, c.name) ?? search(countries, c.name, none, 1)[0]?.item;
      expect(resolved?.id, c.name).toBe(c.id);
    }
  });
});
