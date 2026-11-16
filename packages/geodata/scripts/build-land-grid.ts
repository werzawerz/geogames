// Builds data/land-grid.json for On the Grid: every whole-degree point that
// falls inside a country, with the country it's in. The game picks its targets
// from these points, so a target is always on land and always has a label
// ("in Brazil"), and the server needs no map shapes to replay a run.
//
//   node scripts/build-land-grid.ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geoBounds, geoContains } from 'd3-geo';
import { loadWorldShapes } from '../src/shapes.ts';
import { ROOT } from './lib/fetch.ts';

const { countries } = await loadWorldShapes();
const ids = [...countries.keys()].sort();
const shapes = ids.map((id) => {
  const shape = countries.get(id)!;
  return { shape, bounds: geoBounds(shape) };
});

// Antarctica isn't a country here, and nobody can find 85°S anyway.
const LAT_MIN = -56;
const LAT_MAX = 80;

/**
 * Places where who owns the land is disputed: a target there would name a
 * country for a claim, so none is asked. [south, north, west, east].
 */
const DISPUTED: readonly [number, number, number, number][] = [
  [32.5, 37.2, 72.5, 80.8], // Kashmir and Aksai Chin
  [26.5, 29.8, 91.4, 97.6], // Arunachal Pradesh
  [44, 46.6, 32.4, 36.8], // Crimea
  [20.5, 27.8, -17.2, -8.6], // Western Sahara
  [42, 43.3, 20.5, 21.8], // Kosovo
];
const disputed = (lat: number, lng: number) => DISPUTED.some(([s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e);
/** A point this close (degrees) to another country's land, or a disputed place, is too near a border to say whose it is. */
const BORDER_DEG = 0.4;
const OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]];
const countryAt = (lat: number, lng: number) =>
  shapes.findIndex(({ shape, bounds: [[w, s], [e, n]] }) => {
    if (lat < s! || lat > n!) return false;
    const inLng = w! <= e! ? lng >= w! && lng <= e! : lng >= w! || lng <= e!;
    return inLng && geoContains(shape, [lng, lat]);
  });
const cells: [number, number, number][] = [];
for (let lat = LAT_MIN; lat <= LAT_MAX; lat++) {
  for (let lng = -180; lng < 180; lng++) {
    const index = countryAt(lat, lng);
    if (index < 0 || disputed(lat, lng)) continue;
    const nearOther = OFFSETS.some(([dy, dx]) => {
      const other = countryAt(lat + dy! * BORDER_DEG, lng + dx! * BORDER_DEG);
      return (other >= 0 && other !== index) || disputed(lat + dy! * BORDER_DEG, lng + dx! * BORDER_DEG);
    });
    if (!nearOther) cells.push([lat, lng, index]);
  }
}

// The rule for which points stay is part of the version: a changed rule changes the targets.
const generatedAt = `${new Date().toISOString().slice(0, 10)}+borders`;
await writeFile(join(ROOT, 'data', 'land-grid.json'), JSON.stringify({ generatedAt, countries: ids, cells }));
await writeFile(join(ROOT, 'data', 'land-grid-version.json'), JSON.stringify({ generatedAt }));
console.log(`${cells.length} land points in ${new Set(cells.map((c) => c[2])).size} countries`);
