import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { loadNativeNames } from '@geogames/geodata/native-names';
import { tonguePool } from '@geogames/games';
import { buildIndex, search } from './search.ts';
import { blockShownNames, englishCountryItems } from './searchItems.ts';

const { names } = await loadNativeNames();
const countries = queryCountries();
const shown = names.map((n) => n.name);
const items = englishCountryItems(countries.map((c) => c.id), shown);
const index = buildIndex(items);
const block = blockShownNames(shown);

describe("Native Tongue's search", () => {
  it('never turns the name on screen into its country, typed or pasted', () => {
    const pool = tonguePool(names, countries);
    expect(pool.length).toBeGreaterThan(90);
    for (const n of pool) {
      // What the screen sends on to the search: the shown name is blocked outright...
      const hits = search(index, block(n.name), new Set(), 8);
      expect(hits.map((h) => h.item.id), `${n.id} ${n.name}`).not.toContain(n.id);
      // ...and without the block, the aliases of other languages are gone, so only a close English spelling could.
      expect(items.find((i) => i.id === n.id)!.aliases ?? [], n.id).not.toContain(n.name);
    }
  });

  it('keeps the English names, official names and nicknames', () => {
    const top = (text: string) => search(index, text, new Set(), 3).map((h) => h.item.id);
    expect(top('Germany')[0]).toBe('DEU');
    expect(top('Ivory Coast')[0]).toBe('CIV');
    expect(top('Burma')[0]).toBe('MMR');
    expect(top('Holland')[0]).toBe('NLD');
  });

  it('offers both Congos, and neither answers to the other\'s own name', () => {
    const ids = search(index, 'Congo', new Set(), 8).map((h) => h.item.id);
    expect(ids).toEqual(expect.arrayContaining(['COD', 'COG']));
    expect(search(index, block('République du Congo'), new Set(), 8)).toEqual([]);
  });
});
