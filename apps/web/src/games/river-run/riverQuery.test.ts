import { describe, expect, it } from 'vitest';
import { loadRivers } from '@geogames/geodata/rivers';
import { buildIndex, exactMatch, normalize, search } from '../../components/search.ts';
import { riverQuery } from './riverQuery.ts';

const { rivers } = await loadRivers();
const items = rivers.map((r) => ({ id: r.id, label: r.name, aliases: r.aliases }));
const index = buildIndex(items);
const names = new Set(items.flatMap((i) => [i.label, ...i.aliases].map(normalize)));
const resolve = (text: string) => exactMatch(index, riverQuery(text, names))?.id;

describe('river names as players type them', () => {
  it('ignores a leading or trailing River, Rio, Río, Fleuve, Fluss or Reka', () => {
    expect(resolve('Volga River')).toBe('volga');
    expect(resolve('Nile River')).toBe('nile');
    expect(resolve('River Ganges')).toBe('ganges');
    expect(resolve('Zaire River')).toBe('congo');
    expect(resolve('Rio Grande River')).toBe('rio-grande');
    expect(resolve('Ob River')).toBe('ob');
    expect(resolve('river thames')).toBe('thames');
    expect(resolve('Río Paraná')).toBe('parana');
    expect(resolve('Fleuve Congo')).toBe('congo');
    expect(resolve('Donau Fluss')).toBe('danube');
    expect(resolve('Reka Volga')).toBe('volga');
  });

  it('keeps the word when it is part of the name', () => {
    expect(resolve('Rio Grande')).toBe('rio-grande');
    expect(resolve('Rio Negro')).toBe('rio-negro');
    expect(resolve('Red River')).toBe('red-vietnam');
    expect(riverQuery('Rio Grande', names)).toBe('Rio Grande');
  });

  it('still suggests while a name is half typed', () => {
    expect(search(index, riverQuery('Rio Gra', names), new Set(), 5).map((h) => h.item.id)).toContain('rio-grande');
    expect(search(index, riverQuery('River Gan', names), new Set(), 5).map((h) => h.item.id)).toContain('ganges');
  });
});
