// Builds the Blank Atlas data from Natural Earth's 1:10m physical layers (public domain):
//
//   data/blank-atlas.json         names, aliases, kinds, tiers and where each feature is:
//                                 all the game engine (and the server) needs
//   data/blank-atlas-shapes.json  simplified outlines, only for drawing (web only)
//
//   node scripts/build-blank-atlas.ts [--offline]
//
// The features and their tiers are picked by hand in blank-atlas-features.ts.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geoArea, geoBounds, geoCentroid, geoDistance } from 'd3-geo';
import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { BLANK_ATLAS_ROWS, type BlankAtlasLayer } from './blank-atlas-features.ts';
import { cachedJson, ROOT, round } from './lib/fetch.ts';
import { loadWorldShapes } from '../src/shapes.ts';
import { isContextLake, type BlankAtlasData, type BlankAtlasFeature, type BlankAtlasKind } from '../src/blank-atlas.ts';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
const LAYERS: Record<BlankAtlasLayer, string> = {
  region: 'ne_10m_geography_regions_polys',
  marine: 'ne_10m_geography_marine_polys',
  lake: 'ne_10m_lakes',
};
const EARTH_KM = 6371;

interface NeFeature {
  properties: Record<string, unknown>;
  geometry: Polygon | MultiPolygon;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Natural Earth's feature class, in words a player reads ("Range/mtn" → mountain range). */
function kindOf(layer: BlankAtlasLayer, featurecla: string): BlankAtlasKind {
  const c = featurecla.toLowerCase();
  if (layer === 'lake') return 'lake';
  if (layer === 'marine') {
    if (c === 'lagoon') return 'lake';
    if (c === 'reef') return 'reef';
    if (c === 'strait' || c === 'channel' || c === 'sound' || c === 'fjord') return 'strait';
    if (c === 'gulf' || c === 'bay') return 'gulf';
    return 'sea';
  }
  if (c.startsWith('range')) return 'range';
  if (c === 'desert') return 'desert';
  if (c === 'plateau') return 'plateau';
  if (c === 'isthmus') return 'isthmus';
  if (c.startsWith('pen')) return 'peninsula';
  if (c === 'island') return 'island';
  if (c === 'island group') return 'islands';
  if (c === 'delta') return 'delta';
  if (c === 'coast') return 'coast';
  if (c === 'gorge' || c === 'valley') return 'valley';
  return 'lowland';
}

/** Douglas–Peucker on one ring, in degrees. */
function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a] as [number, number];
    const [bx, by] = points[b] as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i] as [number, number];
      const d = Math.abs(dy * x - dx * y + bx * ay - by * ax) / len;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A ring simplified and rounded to 0.01° (about 1 km); tiny islands keep a rough outline rather than vanish. */
function simplifyRing(ring: Position[], tolerance: number): Position[] {
  // A closed ring starts and ends on the same point, which gives Douglas–Peucker no line to measure
  // from: split it at the point farthest from the start, and simplify each half.
  const [x0, y0] = ring[0] as [number, number];
  let far = 1;
  ring.forEach(([x, y], i) => {
    if (Math.hypot(x! - x0, y! - y0) > Math.hypot(ring[far]![0]! - x0, ring[far]![1]! - y0)) far = i;
  });
  let out = [...simplifyLine(ring.slice(0, far + 1), tolerance), ...simplifyLine(ring.slice(far), tolerance).slice(1)];
  if (out.length < 4) {
    const n = ring.length - 1;
    out = [ring[0]!, ring[Math.floor(n / 3)]!, ring[Math.floor((2 * n) / 3)]!, ring[0]!];
  }
  const rounded = out.map(([x, y]) => [round(x!, 2), round(y!, 2)]);
  return rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1]![0] || p[1] !== rounded[i - 1]![1]);
}

/** d3 wants outer rings clockwise; one that covers more than half the globe is the wrong way round. */
function rewind(polygon: Position[][]): Position[][] {
  const g: Polygon = { type: 'Polygon', coordinates: polygon };
  return geoArea(g) > 2 * Math.PI ? polygon.map((r) => [...r].reverse()) : polygon;
}

const polygonsOf = (g: Polygon | MultiPolygon): Position[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

async function main() {
  const layers = Object.fromEntries(
    await Promise.all(
      (Object.entries(LAYERS) as [BlankAtlasLayer, string][]).map(async ([layer, file]) => {
        const data = await cachedJson<{ features: NeFeature[] }>(`${file}.geojson`, `${NE}/${file}.geojson`);
        return [layer, data.features] as const;
      }),
    ),
  ) as Record<BlankAtlasLayer, NeFeature[]>;

  const features: BlankAtlasFeature[] = [];
  const shapes: Record<string, Geometry> = {};
  const problems: string[] = [];
  for (const [layer, neNames, name, tier, aliases = []] of BLANK_ATLAS_ROWS) {
    const wanted = new Set(neNames.split('|').map(key));
    const found = layers[layer].filter((f) => wanted.has(key(String(f.properties.NAME ?? f.properties.name ?? ''))));
    if (found.length === 0) {
      problems.push(`${layer}: ${neNames} not found`);
      continue;
    }
    const raw: MultiPolygon = { type: 'MultiPolygon', coordinates: found.flatMap((f) => polygonsOf(f.geometry)).map(rewind) };
    const center = geoCentroid(raw) as [number, number];
    // How far the feature reaches from its centre, for framing it.
    const radiusKm = Math.max(...raw.coordinates.flat(2).map((p) => geoDistance(center, p as [number, number]) * EARTH_KM));
    const tolerance = Math.min(0.15, Math.max(0.005, radiusKm / 111 / 120));
    const coordinates = raw.coordinates
      .map((polygon) => rewind(polygon.map((ring) => simplifyRing(ring, tolerance))))
      .filter((polygon) => polygon[0]!.length >= 4);
    const id = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (shapes[id]) problems.push(`duplicate id ${id}`);
    const featurecla = String(found[0]!.properties.FEATURECLA ?? found[0]!.properties.featurecla);
    const [[west, south], [east, north]] = geoBounds(raw);
    features.push({
      id,
      name,
      aliases: aliases.filter((a) => a !== name),
      // Natural Earth files the Iberian Peninsula as a plateau and Labrador as an island.
      kind: / Peninsula$/.test(name) ? 'peninsula' : kindOf(layer, featurecla),
      tier,
      center: [round(center[1], 2), round(center[0], 2)],
      radiusKm: Math.round(radiusKm),
      coastKm: 0,
      bounds: [round(west, 2), round(south, 2), round(east, 2), round(north, 2)],
    });
    shapes[id] = coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0]! } : { type: 'MultiPolygon', coordinates };
  }
  if (problems.length) throw new Error(problems.join('\n'));

  // Every shore the game's map draws: the 1:50m coast (the Caspian included) and the big lakes,
  // which the screen draws as water. An inland feature is framed to show one, so you can find your way.
  const { land } = await loadWorldShapes();
  const shore = [
    ...land.geometry.coordinates.flat(2),
    ...features.filter(isContextLake).flatMap((f) => polygonsOf(shapes[f.id] as Polygon | MultiPolygon).flat(2)),
  ] as [number, number][];
  for (const f of features) {
    const center: [number, number] = [f.center[1], f.center[0]];
    let nearest = Infinity;
    for (const p of shore) nearest = Math.min(nearest, geoDistance(center, p));
    f.coastKm = Math.round(nearest * EARTH_KM);
  }

  const data: BlankAtlasData = {
    generatedAt: new Date().toISOString(),
    source: 'Natural Earth 1:10m physical vectors (public domain), v5.1.2',
    features,
  };
  await writeFile(join(ROOT, 'data', 'blank-atlas.json'), JSON.stringify(data, null, 1) + '\n');
  await writeFile(join(ROOT, 'data', 'blank-atlas-shapes.json'), JSON.stringify(shapes));
  const byTier = [1, 2, 3].map((t) => features.filter((f) => f.tier === t).length);
  console.log(`blank-atlas: ${features.length} features (tiers ${byTier.join('/')})`);
}

await main();
