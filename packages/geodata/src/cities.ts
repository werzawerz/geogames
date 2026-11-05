// Separate entry point (`@geogames/geodata/cities`) so apps load city data on demand.
// City files are split (see scripts/build-cities.ts): a query loads major.json when
// it only needs big cities, and the relevant continent files otherwise.
import index from '../data/cities/index.json' with { type: 'json' };
import { getCountry } from './index.ts';
import { isPlayable } from './city-rules.ts';
import { continentSlug, type City, type CityIndex, type CityProperData, type Continent, type CountryId, type SmallCity } from './types.ts';

export { CITY_SIZE_STOPS, isPlayable } from './city-rules.ts';

export const cityIndex = index as CityIndex;

/** Playable city count for a region ('world' or a continent) at a threshold in CITY_SIZE_STOPS. */
export function playableCityCount(region: Continent | 'world', minPopulation: number): number {
  const key = region === 'world' ? 'world' : continentSlug(region);
  return cityIndex.playableCounts[key]?.[String(minPopulation)] ?? 0;
}

type FileId = 'major' | ReturnType<typeof continentSlug>;

// Literal import paths so bundlers emit one lazy chunk per file. The JSON import
// attribute is required by Node (tests, a future server); the web app's Vite config
// strips it in dev, where JSON is served as a JS module that browsers would reject.
const FILES: Record<string, () => Promise<{ default: unknown }>> = {
  major: () => import('../data/cities/major.json', { with: { type: 'json' } }),
  africa: () => import('../data/cities/africa.json', { with: { type: 'json' } }),
  asia: () => import('../data/cities/asia.json', { with: { type: 'json' } }),
  europe: () => import('../data/cities/europe.json', { with: { type: 'json' } }),
  'north-america': () => import('../data/cities/north-america.json', { with: { type: 'json' } }),
  'south-america': () => import('../data/cities/south-america.json', { with: { type: 'json' } }),
  oceania: () => import('../data/cities/oceania.json', { with: { type: 'json' } }),
};

const cache = new Map<FileId, Promise<readonly City[]>>();

function loadFile(id: FileId): Promise<readonly City[]> {
  let file = cache.get(id);
  if (!file) {
    const loader = FILES[id];
    if (!loader) throw new Error(`no city file ${id}`);
    file = loader().then((m) => m.default as City[]);
    cache.set(id, file);
  }
  return file;
}

export interface CityQuery {
  minPopulation?: number;
  continents?: readonly Continent[];
  countries?: readonly CountryId[];
  /**
   * Include urban areas that failed verification or recognizability, or have a
   * low-plausibility estimate. Off by default: games should only show cities
   * players can reason about.
   */
  includeUncertain?: boolean;
}

/**
 * Playable cities too small for major.json, slimmed to name, country,
 * population and position (~100 KB gzipped). Together with major.json this
 * gives every playable city worldwide without loading the continent files.
 */
export async function loadSmallCities(): Promise<readonly SmallCity[]> {
  const m = await import('../data/cities/small-cities.json', { with: { type: 'json' } });
  return m.default as SmallCity[];
}

/** The city-proper dataset (GeoNames), loaded only when a game is played with it. */
export async function loadCityProper(): Promise<CityProperData> {
  const m = await import('../data/cities/city-proper.json', { with: { type: 'json' } });
  return m.default as unknown as CityProperData;
}

/** Loads exactly the city files the query needs and filters them. */
export async function loadCities(query: CityQuery = {}): Promise<City[]> {
  const { minPopulation = cityIndex.minPopulation, countries, includeUncertain = false } = query;
  const continents =
    query.continents ??
    (countries
      ? [...new Set(countries.map((id) => getCountry(id)?.continent).filter((c): c is Continent => !!c))]
      : undefined);

  let files: FileId[];
  if (minPopulation >= cityIndex.majorMinPopulation) files = ['major'];
  else if (continents) files = continents.map(continentSlug);
  else files = Object.keys(FILES).filter((f) => f !== 'major');

  const loaded = (await Promise.all(files.map(loadFile))).flat();
  return loaded.filter(
    (c) =>
      (c.metrics.population?.value ?? 0) >= minPopulation &&
      (!continents || continents.includes(getCountry(c.countryId)!.continent)) &&
      (!countries || countries.includes(c.countryId)) &&
      (includeUncertain || isPlayable(c)),
  );
}
