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
const cells: [number, number, number][] = [];
for (let lat = LAT_MIN; lat <= LAT_MAX; lat++) {
  for (let lng = -180; lng < 180; lng++) {
    const index = shapes.findIndex(({ shape, bounds: [[w, s], [e, n]] }) => {
      if (lat < s! || lat > n!) return false;
      const inLng = w! <= e! ? lng >= w! && lng <= e! : lng >= w! || lng <= e!;
      return inLng && geoContains(shape, [lng, lat]);
    });
    if (index >= 0) cells.push([lat, lng, index]);
  }
}

const generatedAt = new Date().toISOString().slice(0, 10);
await writeFile(join(ROOT, 'data', 'land-grid.json'), JSON.stringify({ generatedAt, countries: ids, cells }));
await writeFile(join(ROOT, 'data', 'land-grid-version.json'), JSON.stringify({ generatedAt }));
console.log(`${cells.length} land points in ${new Set(cells.map((c) => c[2])).size} countries`);
