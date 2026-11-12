import { geoCentroid, geoCircle, geoDistance, type GeoPermissibleObjects } from 'd3-geo';
import { getCountry, type CountryId } from '@geogames/geodata';
import type { CountryShape, WorldShapes } from '@geogames/geodata/shapes';
import { mainland } from '../../components/mainland.ts';

type Point = [number, number];

const DEGREES = 180 / Math.PI;
/** Vertices this close (in degrees) count as on the shared border. */
const TOUCHING = 0.3;
/** Never larger than this, unless the borders themselves need more. */
const MAX_RADIUS = 60;

/** Every vertex of every outer ring, as [lng, lat]. */
function vertices(shape: CountryShape): Point[] {
  const { geometry } = shape;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((rings) => rings[0]!.map((p) => [p[0]!, p[1]!] as Point));
}

/** A quick flat distance in degrees, good enough to tell touching points apart. */
function near(a: Point, b: Point): number {
  const dLng = Math.abs(a[0] - b[0]) % 360;
  return Math.hypot(Math.min(dLng, 360 - dLng) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]);
}

/**
 * Points of `target` on its border with `neighbour`. Countries joined by a
 * bridge or tunnel (France and the UK) share no border: then the target's
 * point nearest to the neighbour stands in.
 */
export function borderPoints(target: Point[], neighbour: Point[]): Point[] {
  // The neighbour's vertices in a grid of TOUCHING-sized cells, so each target vertex checks only its own cell and the next ones.
  const cell = (v: number) => Math.floor(v / TOUCHING);
  const grid = new Map<string, Point[]>();
  for (const q of neighbour) {
    const key = `${cell(q[0])},${cell(q[1])}`;
    const list = grid.get(key);
    if (list) list.push(q);
    else grid.set(key, [q]);
  }
  const touches = (p: Point) => {
    const [x, y] = [cell(p[0]), cell(p[1])];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) if (grid.get(`${x + dx},${y + dy}`)?.some((q) => near(p, q) <= TOUCHING)) return true;
    }
    return false;
  };
  const touching = target.filter(touches);
  if (touching.length > 0) return touching;
  let best = target[0]!;
  let bestKm = Infinity;
  for (const p of target) {
    for (const q of neighbour) {
      const d = near(p, q);
      if (d < bestKm) [best, bestKm] = [p, d];
    }
  }
  return [best];
}

export interface Frame {
  centre: Point;
  /** Degrees. */
  radius: number;
}

/**
 * A circle around the country's main landmass that also takes in its border
 * with every neighbour, so naming one always lights up something in view
 * (Papua New Guinea for Indonesia, whose largest island is Borneo).
 */
export function frameFor(shapes: WorldShapes, id: CountryId, neighbours: readonly CountryId[]): Frame {
  const shape = shapes.countries.get(id);
  if (!shape) {
    const [lat, lng] = getCountry(id)!.latlng;
    return { centre: [lng, lat], radius: 6 };
  }
  const all = vertices(shape);
  const points: Point[] = mainland(shape).geometry.coordinates[0]!.map((p) => [p[0]!, p[1]!]);
  for (const n of neighbours) {
    const other = shapes.countries.get(n);
    const latlng = getCountry(n)?.latlng;
    const theirs = other ? vertices(other) : latlng ? [[latlng[1], latlng[0]] as Point] : [];
    if (theirs.length > 0) points.push(...borderPoints(all, theirs));
  }
  const centre = geoCentroid({ type: 'MultiPoint', coordinates: points }) as Point;
  const reach = Math.max(...points.map((p) => geoDistance(centre, p) * DEGREES));
  // Room around it for context, but always enough for the borders themselves.
  return { centre, radius: Math.max(reach + 2, Math.min(MAX_RADIUS, reach * 1.6 + 3)) };
}

export const frameShape = ({ centre, radius }: Frame): GeoPermissibleObjects => geoCircle().center(centre).radius(radius)();
