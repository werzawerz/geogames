import type { CountryId } from './types.ts';
import version from '../data/land-grid-version.json' with { type: 'json' };

/** data/land-grid.json (scripts/build-land-grid.ts): the whole-degree points that lie inside a country. */
export interface LandGrid {
  generatedAt: string;
  /** Country ids; a cell's last number indexes this. */
  countries: CountryId[];
  /** [lat, lng, country index] for each whole-degree point on land. */
  cells: [number, number, number][];
}

/** When the grid was built: part of the dataset version, so a server only replays runs made on the same targets. */
export const LAND_GRID_VERSION: string = version.generatedAt;

/** The land points of On the Grid, loaded only when it's played. */
export async function loadLandGrid(): Promise<LandGrid> {
  const m = await import('../data/land-grid.json', { with: { type: 'json' } });
  return m.default as unknown as LandGrid;
}
