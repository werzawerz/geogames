import { distanceKm, type CircleCity } from '@geogames/games';

/** A city this near the spot is worth naming. */
export const NEAR_CITY_KM = 250;
/** Small cities would only add noise to the line. */
const MIN_POPULATION = 300_000;

/**
 * What's there, for the reveal: "in Brazil, near São Paulo". The nearest
 * sizeable city within NEAR_CITY_KM is named; a spot near none is just "in Brazil".
 */
export function placeNote(spot: readonly [number, number], countryName: string, cities: readonly CircleCity[]): string {
  let best: { city: CircleCity; km: number } | null = null;
  for (const city of cities) {
    if (city.population < MIN_POPULATION) continue;
    const km = distanceKm(spot, city.latlng);
    if (km <= NEAR_CITY_KM && (!best || km < best.km)) best = { city, km };
  }
  return best ? `in ${countryName}, near ${best.city.name}` : `in ${countryName}`;
}
