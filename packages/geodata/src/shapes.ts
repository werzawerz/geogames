// Separate entry point (`@geogames/geodata/shapes`): country outlines for map games.
// Natural Earth 1:50m via the world-atlas package (public domain geometry, ISC
// package), loaded lazily because it's ~740 KB of TopoJSON.
import { feature, merge } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { countries } from './index.ts';
import type { CountryId } from './types.ts';

export type CountryShape = Feature<Polygon | MultiPolygon, { id: CountryId }>;

export interface WorldShapes {
  /** Outline per country id; countries too small for 1:50m (e.g. Tuvalu) are missing. */
  countries: Map<CountryId, CountryShape>;
  /** All land as one shape, without borders: context that doesn't give answers away. */
  land: Feature<MultiPolygon>;
}

// Natural Earth shapes without an ISO numeric code, mapped by name. Breakaway
// regions are drawn as part of the UN member state they belong to.
const BY_NAME: Record<string, CountryId> = {
  Kosovo: 'XKX',
  Somaliland: 'SOM',
  'N. Cyprus': 'CYP',
};

/**
 * Natural Earth draws Western Sahara by control on the ground: "Morocco" covers
 * the area west of the berm (the sand wall), "W. Sahara" only the strip east of
 * it. Our border data, like most maps, treats Western Sahara as the whole
 * territory south of 27°40′N. So the two shapes are merged (dropping the berm
 * line) and split again along that parallel.
 */
const MOROCCO_WESTERN_SAHARA_BORDER_LAT = 27 + 40 / 60;

let cached: Promise<WorldShapes> | undefined;

export function loadWorldShapes(): Promise<WorldShapes> {
  cached ??= import('world-atlas/countries-50m.json', { with: { type: 'json' } }).then((m) => build(m.default as unknown as Topology));
  return cached;
}

/**
 * Clips a ring to one side of a parallel (Sutherland–Hodgman). Fine for rings
 * that cross the parallel twice, as Morocco + Western Sahara does; returns null
 * when nothing is left.
 */
function clipRing(ring: Position[], lat: number, keep: 'north' | 'south'): Position[] | null {
  const inside = (p: Position) => (keep === 'north' ? p[1]! >= lat : p[1]! <= lat);
  const cross = (a: Position, b: Position): Position => {
    const t = (lat - a[1]!) / (b[1]! - a[1]!);
    return [a[0]! + t * (b[0]! - a[0]!), lat];
  };
  const out: Position[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) out.push(cross(a, b));
  }
  if (out.length < 3) return null;
  out.push(out[0]!);
  return out;
}

function splitAtParallel(geometry: Polygon | MultiPolygon, lat: number): { north: MultiPolygon; south: MultiPolygon } {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const side = (keep: 'north' | 'south'): MultiPolygon => ({
    type: 'MultiPolygon',
    // Outer rings only: these polygons have no holes.
    coordinates: polygons.flatMap((p) => {
      const ring = clipRing(p[0]!, lat, keep);
      return ring ? [[ring]] : [];
    }),
  });
  return { north: side('north'), south: side('south') };
}

function build(topology: Topology): WorldShapes {
  const objects = topology.objects as { countries: GeometryCollection<{ name: string }>; land: GeometryCollection };
  const byNumeric = new Map(countries.filter((c) => c.isoNumeric).map((c) => [c.isoNumeric!, c.id]));

  const groups = new Map<CountryId, GeometryCollection['geometries']>();
  for (const geometry of objects.countries.geometries) {
    const name = (geometry.properties as { name?: string } | undefined)?.name ?? '';
    const id = byNumeric.get(String(geometry.id)) ?? BY_NAME[name];
    if (!id) continue;
    groups.set(id, [...(groups.get(id) ?? []), geometry]);
  }

  const shapes = new Map<CountryId, CountryShape>();
  for (const [id, geometries] of groups) {
    const geometry =
      geometries.length === 1
        ? (feature(topology, geometries[0]!) as Feature<Polygon | MultiPolygon>).geometry
        : merge(topology, geometries as Parameters<typeof merge>[1]);
    shapes.set(id, { type: 'Feature', properties: { id }, geometry });
  }

  const morocco = groups.get('MAR');
  const westernSahara = groups.get('ESH');
  if (morocco && westernSahara) {
    const both = merge(topology, [...morocco, ...westernSahara] as Parameters<typeof merge>[1]);
    const { north, south } = splitAtParallel(both, MOROCCO_WESTERN_SAHARA_BORDER_LAT);
    shapes.set('MAR', { type: 'Feature', properties: { id: 'MAR' }, geometry: north });
    shapes.set('ESH', { type: 'Feature', properties: { id: 'ESH' }, geometry: south });
  }

  const land = feature(topology, objects.land) as unknown as { features: Feature<MultiPolygon>[] } | Feature<MultiPolygon>;
  return {
    countries: shapes,
    land: 'features' in land ? land.features[0]! : land,
  };
}
