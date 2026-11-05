import type { Continent } from '@geogames/geodata';
import { CITY_SIZE_STOPS, playableCityCount } from '@geogames/geodata/cities';
import type { GameDefinition } from './catalog.ts';

export type Region = 'world' | Continent;

export const REGIONS: readonly { id: Region; label: string }[] = [
  { id: 'world', label: 'Whole world' },
  { id: 'Africa', label: 'Africa' },
  { id: 'Asia', label: 'Asia' },
  { id: 'Europe', label: 'Europe' },
  { id: 'North America', label: 'North America' },
  { id: 'South America', label: 'South America' },
  { id: 'Oceania', label: 'Oceania' },
];

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: readonly { id: Difficulty; label: string; description: string }[] = [
  { id: 'easy', label: 'Easy', description: 'Well-known countries; wrong options from anywhere.' },
  { id: 'medium', label: 'Medium', description: 'All countries; wrong options from the same continent.' },
  { id: 'hard', label: 'Hard', description: 'All countries; wrong options from the same subregion.' },
];

/** Which population figures a city game uses. */
export type CityData = 'metro' | 'proper';

export const CITY_DATA: readonly { id: CityData; label: string; description: string }[] = [
  { id: 'metro', label: 'Metro areas', description: 'UN figures: big cities count with their urban area, as each country defines it.' },
  { id: 'proper', label: 'City proper', description: 'GeoNames figures: the city itself, without its suburbs, so Yokohama is not part of Tokyo.' },
];

/** Border Route: how much the map and the status line give away. */
export type RouteMode = 'easy' | 'hard';

export const ROUTE_MODES: readonly { id: RouteMode; label: string; description: string }[] = [
  { id: 'easy', label: 'Easy', description: 'The map shows every border, and you know how long the shortest route is.' },
  { id: 'hard', label: 'Hard', description: 'Only your countries show their borders, the shortest route stays secret until the end, and a country off your route costs a guess.' },
];

export type CirclePlacement = 'random' | 'custom';

/** City Circle radius slider range (km). A radius of 0 means "auto" (smallest that holds enough cities). */
export const CIRCLE_RADIUS = { min: 150, max: 1500, step: 50 } as const;

/**
 * Leaderboard bands for the radius: any slider value is allowed, but scores are
 * grouped so circles of similar size compete. `radius` represents the band
 * when settings are rebuilt from a leaderboard key.
 */
export const RADIUS_BANDS = [
  { id: 'small', label: 'Small', range: '150–350 km', max: 350, radius: 250 },
  { id: 'medium', label: 'Medium', range: '400–750 km', max: 750, radius: 500 },
  { id: 'large', label: 'Large', range: '800–1500 km', max: Infinity, radius: 1000 },
] as const;

export type RadiusBand = (typeof RADIUS_BANDS)[number]['id'] | 'auto';

export function radiusBand(radiusKm: number): RadiusBand {
  return radiusKm === 0 ? 'auto' : RADIUS_BANDS.find((b) => radiusKm <= b.max)!.id;
}
/** Radius for self-placed circles when none is chosen. */
export const CUSTOM_DEFAULT_RADIUS_KM = 500;

/** Player-chosen options for one game. Part of what a replay needs, next to seed and moves. */
export interface GameSettings {
  region: Region;
  /** Smallest city in play (city games only); one of CITY_SIZE_STOPS. */
  cityMinPopulation: number;
  /** Quiz games only. */
  difficulty: Difficulty;
  /** City Circle only: km within CIRCLE_RADIUS, or 0 for auto. */
  circleRadiusKm: number;
  /** City Circle only: random circles, or the player places each one. */
  circlePlacement: CirclePlacement;
  /** City Circle Arcade only: which population figures to play with. */
  cityData: CityData;
  /** Border Route only. */
  routeMode: RouteMode;
}

export const DEFAULT_CITY_MIN_POPULATION = 1_000_000;
export const DEFAULT_DIFFICULTY: Difficulty = 'medium';

export const DEFAULT_SETTINGS: GameSettings = {
  region: 'world',
  cityMinPopulation: DEFAULT_CITY_MIN_POPULATION,
  difficulty: DEFAULT_DIFFICULTY,
  circleRadiusKm: 0,
  circlePlacement: 'random',
  cityData: 'metro',
  routeMode: 'easy',
};

/** Below this many items a game repeats too quickly to be fun. */
export const MIN_POOL_SIZE = 10;

/** Which settings a game offers besides the region. */
export const usesCitySize = (game: GameDefinition) => game.kind === 'higher-lower' && game.subject === 'city';
export const usesDifficulty = (game: GameDefinition) => game.kind === 'quiz';
export const usesCircleOptions = (game: GameDefinition) => game.kind === 'circle';
export const usesCityData = (game: GameDefinition) => game.kind === 'circle-arcade';
export const usesRouteMode = (game: GameDefinition) => game.kind === 'route';
/** Arcade games follow a fixed progression around the world, so there's no region to pick. */
export const usesRegion = (game: GameDefinition) => !['circle-arcade', 'route', 'pin-drop', 'great-circle', 'mystery-country'].includes(game.kind);

/**
 * Smallest city size offered per region. World games stop at 300k: below that,
 * thousands of towns nobody outside their country could place. A single
 * continent can go to 100k; 50k is left for future per-country games.
 */
export function cityFloor(region: Region): number {
  return region === 'world' ? 300_000 : 100_000;
}

/** Slider stops for a region: at or above its floor, and leaving a playable pool. */
export function citySizeStops(region: Region): number[] {
  return CITY_SIZE_STOPS.filter((min) => min >= cityFloor(region) && playableCityCount(region, min) >= MIN_POOL_SIZE);
}

/** "300k", "1M", "2.5M" */
export function formatPopulationShort(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1000}k`;
}

/**
 * Snaps settings to what the game allows (e.g. a remembered city size the
 * region no longer offers). Settings a game doesn't use are reset to defaults.
 */
export function normalizeSettings(settings: Partial<GameSettings>, game: GameDefinition): GameSettings {
  const region = usesRegion(game) && REGIONS.some((r) => r.id === settings.region) ? settings.region! : DEFAULT_SETTINGS.region;
  const difficulty =
    usesDifficulty(game) && DIFFICULTIES.some((d) => d.id === settings.difficulty) ? settings.difficulty! : DEFAULT_DIFFICULTY;
  const circle = usesCircleOptions(game);
  const circlePlacement: CirclePlacement = circle && settings.circlePlacement === 'custom' ? 'custom' : 'random';
  const radiusWanted = circle ? (settings.circleRadiusKm ?? 0) : 0;
  const { min, max, step } = CIRCLE_RADIUS;
  let circleRadiusKm = radiusWanted > 0 ? Math.min(max, Math.max(min, Math.round(radiusWanted / step) * step)) : 0;
  // "Auto" picks a radius per random circle; a self-placed circle needs a real one.
  if (circlePlacement === 'custom' && circleRadiusKm === 0) circleRadiusKm = CUSTOM_DEFAULT_RADIUS_KM;
  const cityData: CityData = usesCityData(game) && settings.cityData === 'proper' ? 'proper' : 'metro';
  const routeMode: RouteMode = usesRouteMode(game) && settings.routeMode === 'hard' ? 'hard' : 'easy';
  const base = { region, difficulty, circleRadiusKm, circlePlacement, cityData, routeMode };
  if (!usesCitySize(game)) return { ...base, cityMinPopulation: DEFAULT_CITY_MIN_POPULATION };
  const stops = citySizeStops(region);
  const wanted = settings.cityMinPopulation ?? DEFAULT_CITY_MIN_POPULATION;
  // Nearest allowed stop at or below the wish, else the smallest allowed.
  const cityMinPopulation = [...stops].reverse().find((s) => s <= wanted) ?? stops[0] ?? DEFAULT_CITY_MIN_POPULATION;
  return { ...base, cityMinPopulation };
}

const slug = (region: Region) => region.toLowerCase().replace(/\s+/g, '-');

/**
 * Scores are only comparable within the same settings; this key separates
 * leaderboards. Defaults are left out of the key ("world", "europe",
 * "europe-100k", "asia-hard"), so scores saved before a setting existed stay
 * in the right bucket.
 */
export function variantKey(settings: GameSettings, game: GameDefinition): string {
  const parts = [slug(settings.region)];
  if (usesCitySize(game) && settings.cityMinPopulation !== DEFAULT_CITY_MIN_POPULATION) {
    parts.push(formatPopulationShort(settings.cityMinPopulation).toLowerCase());
  }
  if (usesDifficulty(game) && settings.difficulty !== DEFAULT_DIFFICULTY) parts.push(settings.difficulty);
  if (usesCircleOptions(game)) {
    const band = radiusBand(settings.circleRadiusKm);
    if (band !== 'auto') parts.push(band);
    if (settings.circlePlacement === 'custom') parts.push('custom');
  }
  if (usesCityData(game) && settings.cityData === 'proper') parts.push('proper');
  if (usesRouteMode(game) && settings.routeMode === 'hard') parts.push('hard');
  return parts.join('-');
}

export function settingsFromVariant(variant: string, game: GameDefinition): GameSettings {
  const region = REGIONS.find((r) => variant === slug(r.id) || variant.startsWith(`${slug(r.id)}-`))?.id ?? 'world';
  const rest = variant.slice(slug(region).length + 1).split('-');
  const cityMinPopulation =
    CITY_SIZE_STOPS.find((s) => rest.includes(formatPopulationShort(s).toLowerCase())) ?? DEFAULT_CITY_MIN_POPULATION;
  const difficulty = DIFFICULTIES.find((d) => rest.includes(d.id))?.id ?? DEFAULT_DIFFICULTY;
  const circleRadiusKm = RADIUS_BANDS.find((b) => rest.includes(b.id))?.radius ?? 0;
  const circlePlacement: CirclePlacement = rest.includes('custom') ? 'custom' : 'random';
  const cityData: CityData = rest.includes('proper') ? 'proper' : 'metro';
  const routeMode: RouteMode = rest.includes('hard') ? 'hard' : 'easy';
  return normalizeSettings({ region, cityMinPopulation, difficulty, circleRadiusKm, circlePlacement, cityData, routeMode }, game);
}

export function regionLabel(region: Region): string {
  return REGIONS.find((r) => r.id === region)?.label ?? region;
}

/** Short human description, e.g. "Europe · cities 100k+" or "Asia · Hard". */
export function describeSettings(settings: GameSettings, game: GameDefinition): string {
  if (!usesRegion(game)) {
    const mode = usesCityData(game) && settings.cityData === 'proper' ? ' · City proper' : usesRouteMode(game) && settings.routeMode === 'hard' ? ' · Hard' : '';
    return `Arcade${mode}`;
  }
  const parts = [regionLabel(settings.region)];
  if (usesCitySize(game)) parts.push(`cities ${formatPopulationShort(settings.cityMinPopulation)}+`);
  if (usesDifficulty(game)) parts.push(DIFFICULTIES.find((d) => d.id === settings.difficulty)!.label);
  if (usesCircleOptions(game)) {
    parts.push(settings.circleRadiusKm === 0 ? 'auto radius' : `radius ${settings.circleRadiusKm} km`);
    if (settings.circlePlacement === 'custom') parts.push('own circles');
  }
  return parts.join(' · ');
}
