import type { Position } from 'geojson';
import type { CountryShape } from '@geogames/geodata/shapes';
import { bearingDegrees, compassPoint, distanceKm } from '@geogames/games';

/** A spot this close to the guessed country (km) is "just across the border", if the two touch. */
export const ACROSS_THE_BORDER_KM = 150;

const rounded = (km: number) => (km < 100 ? Math.max(10, Math.round(km / 10) * 10) : Math.round(km / 50) * 50);
const km = new Intl.NumberFormat('en');

/** Outline points, with long straight edges (a straight border) filled in every half degree or so. */
function outline(shape: CountryShape): Position[] {
  const { geometry } = shape;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const points: Position[] = [];
  for (const ring of polygons.flat()) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i]!;
      points.push(ring[i]!);
      const [x1, y1] = ring[i + 1] ?? ring[i]!;
      const steps = Math.min(200, Math.floor(Math.hypot(x1! - x0!, y1! - y0!) / 0.5));
      for (let k = 1; k < steps; k++) points.push([x0! + ((x1! - x0!) * k) / steps, y0! + ((y1! - y0!) * k) / steps]);
    }
  }
  return points;
}

/** The point of the country's outline nearest the spot, as [lat, lng], and how far it is. */
export function nearestOutlinePoint(shape: CountryShape, spot: readonly [number, number]): { at: [number, number]; km: number } {
  let best: { at: [number, number]; km: number } = { at: [spot[0], spot[1]], km: Infinity };
  for (const [lng, lat] of outline(shape)) {
    const d = distanceKm(spot, [lat!, lng!]);
    if (d < best.km) best = { at: [lat!, lng!], km: d };
  }
  return best;
}

/**
 * What a wrong guess teaches: which way the spot lies from the country named,
 * and how far, measured from the country's nearest edge (not its middle). A
 * neighbour of the answer is told so. `from` is the edge point when the shape
 * is missing (a country too small for the map): its middle instead.
 */
export function wrongGuessHint(opts: {
  name: string;
  shape: CountryShape | undefined;
  centre: readonly [number, number];
  spot: readonly [number, number];
  /** Whether the country named shares a land border with the answer. */
  neighbour: boolean;
}): string {
  const { name, shape, centre, spot, neighbour } = opts;
  const nearest = shape ? nearestOutlinePoint(shape, spot) : { at: [centre[0], centre[1]] as [number, number], km: distanceKm(spot, centre) };
  const way = compassPoint(bearingDegrees(nearest.at, spot));
  if (neighbour && nearest.km <= ACROSS_THE_BORDER_KM) return `${name}: close! The spot is just across the border, to the ${way}.`;
  const far = `about ${km.format(rounded(nearest.km))} km to the ${way}`;
  return neighbour ? `${name} is a neighbour: the spot is ${far}.` : `${name}: the spot is ${far}.`;
}
