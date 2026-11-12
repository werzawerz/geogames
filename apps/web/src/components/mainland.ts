import { geoArea } from 'd3-geo';
import type { Feature, Polygon } from 'geojson';
import type { CountryShape } from '@geogames/geodata/shapes';

/**
 * The largest polygon of a country. Used for framing and labels so overseas
 * parts (French Guiana, Alaska's Aleutians) don't drag the view across the globe.
 */
export function mainland(shape: CountryShape): Feature<Polygon> {
  const { geometry } = shape;
  if (geometry.type === 'Polygon') return { type: 'Feature', properties: {}, geometry };
  const polygons = geometry.coordinates.map(
    (coordinates): Feature<Polygon> => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }),
  );
  return polygons.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
}
