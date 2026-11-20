import { geoAlbersUsa, geoBounds, geoConicEqualArea, geoMercator, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';

export interface RegionFrame {
  width: number;
  height: number;
  /** Room round the country. */
  padding: number;
}

/** The map's units on a wide screen. What the build counts as "big enough to see" is measured on this. */
export const REGION_MAP: RegionFrame = { width: 960, height: 540, padding: 40 };
/** On a phone the map is taller than wide, to use the screen under the question. */
export const REGION_MAP_TALL: RegionFrame = { width: 640, height: 720, padding: 32 };

/**
 * The projection that frames a country in the map. Build and screen both use it,
 * so what the build counts as "big enough to see" is what the player sees.
 */
export function regionProjection(countryId: string, shape: GeoPermissibleObjects, frame: RegionFrame = REGION_MAP): GeoProjection {
  const { width, height, padding } = frame;
  const extent: [[number, number], [number, number]] = [
    [padding, padding],
    [width - padding, height - padding],
  ];
  // Alaska and Hawaii come as insets, as on any map of the United States.
  if (countryId === 'USA') return geoAlbersUsa().fitExtent(extent, shape);
  const [[w, s], [e, n]] = geoBounds(shape);
  const lng = w <= e ? (w + e) / 2 : (w + e + 360) / 2;
  const lat = (s + n) / 2;
  // Near the equator a conic map bends for nothing.
  const base = Math.abs(lat) < 10 ? geoMercator().rotate([-lng, 0]) : geoConicEqualArea().rotate([-lng, 0]).center([0, lat]).parallels([s + (n - s) / 6, n - (n - s) / 6]);
  return base.fitExtent(extent, shape);
}
