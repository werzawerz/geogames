import type { City } from './types.ts';

/**
 * Population thresholds games offer for cities (slider stops). The build
 * precomputes playable counts for each, so UIs can show them without loading data.
 */
export const CITY_SIZE_STOPS = [
  50_000, 100_000, 200_000, 300_000, 500_000, 750_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000,
] as const;

/** Whether a city is fit for games: verified, recognizable, and not a low-plausibility estimate. */
export function isPlayable(city: City): boolean {
  return city.quality.recognizable && city.quality.plausibility !== 'low';
}
