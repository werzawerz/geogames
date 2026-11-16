import { describe, expect, it } from 'vitest';
import type { CircleCity } from '@geogames/games';
import { placeNote } from './placeNote.ts';

const city = (name: string, latlng: [number, number], population: number): CircleCity => ({ id: name, name, countryId: 'BRA', latlng, population });

describe('placeNote', () => {
  const cities = [city('São Paulo', [-23.55, -46.63], 12_000_000), city('Tiny', [-23, -47], 10_000), city('Campinas', [-22.9, -47.06], 1_200_000)];
  it('names the nearest sizeable city', () => {
    expect(placeNote([-23, -47], 'Brazil', cities)).toBe('in Brazil, near Campinas');
  });
  it('leaves cities out when none is near', () => {
    expect(placeNote([-10, -60], 'Brazil', cities)).toBe('in Brazil');
  });
});
