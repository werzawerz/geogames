import type { CountryId } from './types.ts';

/**
 * Fixed road or rail links between countries without a land border, which
 * map games treat as borders: you can drive from one to the other.
 */
export const FIXED_LINKS: readonly (readonly [CountryId, CountryId, string])[] = [
  ['DNK', 'SWE', 'Øresund Bridge'],
  ['GBR', 'FRA', 'Channel Tunnel'],
  ['BHR', 'SAU', 'King Fahd Causeway'],
  ['SGP', 'MYS', 'Johor–Singapore Causeway'],
];

/**
 * Who runs each territory that has a land border; the country data has no
 * owner field. Western Sahara is left out: who it belongs to is disputed.
 */
export const TERRITORY_OWNERS: Readonly<Record<CountryId, CountryId>> = {
  GUF: 'FRA',
  GIB: 'GBR',
  HKG: 'CHN',
  MAC: 'CHN',
  MAF: 'FRA',
  SXM: 'NLD',
};

/**
 * Parts of a country cut off from the rest of it by land. Its `borders` are
 * the countries the exclave touches; `mainlandToo` lists those the main part
 * borders as well. Every other border of the country belongs to the main part.
 * Crossing the country means staying inside one part: Poland → Russia → Finland
 * is not a route, since Poland only touches Kaliningrad.
 */
export interface Exclave {
  country: CountryId;
  name: string;
  borders: readonly CountryId[];
  mainlandToo?: readonly CountryId[];
}

export const EXCLAVES: readonly Exclave[] = [
  { country: 'RUS', name: 'Kaliningrad', borders: ['POL', 'LTU'] },
  { country: 'AZE', name: 'Nakhchivan', borders: ['ARM', 'IRN', 'TUR'], mainlandToo: ['ARM', 'IRN'] },
  { country: 'AGO', name: 'Cabinda', borders: ['COG', 'COD'], mainlandToo: ['COD'] },
  { country: 'ESP', name: 'Ceuta and Melilla', borders: ['MAR'] },
];
