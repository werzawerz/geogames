/** ISO 3166-1 alpha-3 code. Kosovo uses the widely adopted user-assigned code `XKX`. */
export type CountryId = string;

export type Continent =
  | 'Africa'
  | 'Antarctica'
  | 'Asia'
  | 'Europe'
  | 'North America'
  | 'Oceania'
  | 'South America';

/**
 * Political status, used to decide which entries a game includes by default.
 * - `un-member`: UN member state
 * - `un-observer`: UN observer state (Vatican City, Palestine)
 * - `partially-recognized`: de facto sovereign, limited recognition (Kosovo, Taiwan)
 * - `territory`: dependency, special region or uninhabited territory
 */
export type Sovereignty = 'un-member' | 'un-observer' | 'partially-recognized' | 'territory';

export type SourceId = 'mledoze' | 'worldbank' | 'wup' | 'wup2018' | 'geonames' | 'wikidata' | 'euromonitor' | 'manual';

export interface Source {
  name: string;
  url: string;
  license: string;
}

export type MetricId =
  | 'population'
  | 'area'
  | 'populationDensity'
  | 'gdp'
  | 'gdpPerCapita'
  | 'lifeExpectancy';

/** A single numeric fact, always with provenance so stale or manual values stay traceable. */
export interface MetricValue {
  value: number;
  year: number | null;
  source: SourceId;
  /** Free-text citation, required for `manual` values. */
  note?: string;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string | null;
}

export interface Language {
  code: string;
  name: string;
}

export interface Country {
  id: CountryId;
  iso2: string;
  isoNumeric: string | null;
  name: string;
  officialName: string;
  /** Alternative spellings and native names, for answer matching in typing games. */
  aliases: string[];
  /** Common name keyed by ISO 639-3 language code (e.g. `deu`, `hun`). */
  translations: Record<string, string>;
  capitals: string[];
  continent: Continent;
  /** UN geoscheme region, e.g. "Europe", "Americas". */
  region: string;
  subregion: string | null;
  sovereignty: Sovereignty;
  /** Approximate centroid as [lat, lng]. */
  latlng: [number, number];
  landlocked: boolean;
  borders: CountryId[];
  currencies: Currency[];
  languages: Language[];
  tld: string[];
  metrics: Partial<Record<MetricId, MetricValue>>;
}

export interface Dataset {
  schemaVersion: number;
  generatedAt: string;
  sources: Partial<Record<SourceId, Source>>;
  countries: Country[];
}

/** `wup-<City_Code>`, stable across WUP 2025 data updates. */
export type CityId = string;

export type CityMetricId = Extract<MetricId, 'population' | 'area' | 'populationDensity'>;

export interface City {
  id: CityId;
  /** English display name. */
  name: string;
  /** Name as published by the UN when it differs (often the native form, e.g. "Wien"). */
  localName: string | null;
  aliases: string[];
  /**
   * Other big cities that are part of this urban area, biggest first ("Essen"
   * includes Duisburg, Bochum, Gelsenkirchen). Explains why an area is bigger
   * than its namesake; each also works as an alias.
   */
  includes: string[];
  countryId: CountryId;
  /** First-level region (state, province), from GeoNames. */
  admin1: string | null;
  capital: boolean;
  /** Population-weighted centroid as [lat, lng]. */
  latlng: [number, number];
  geonamesId: number | null;
  quality: {
    /** The UN's own plausibility rating for the population estimate. */
    plausibility: 'high' | 'moderate' | 'low';
    /** A GeoNames place with a matching name lies within the urban area (or a manual check confirmed it). */
    verified: boolean;
    /**
     * Players will likely know it: a capital, or a place GeoNames counts at
     * 200k+ itself. Filters out vast rural-density clusters named after a small town.
     */
    recognizable: boolean;
  };
  /**
   * Figures refer to the whole urban area under the UN "Degree of Urbanisation"
   * definition, not the administrative city proper.
   */
  metrics: Partial<Record<CityMetricId, MetricValue>>;
}

export interface CityDataset {
  schemaVersion: number;
  generatedAt: string;
  sources: Partial<Record<SourceId, Source>>;
  cities: City[];
}

/** A playable city below the major threshold, slimmed: [id, name, countryId, population, lat, lng]. */
export type SmallCity = [CityId, string, CountryId, number, number, number, string[]?];

/**
 * data/cities/city-proper.json: cities as their own administrative area rather
 * than metro area, for players to compare with the main dataset. Ids are "gn-<GeoNames id>".
 */
export interface CityProperData {
  /** Rank among the world's most visited cities, by city id; only ranked cities. */
  tourismRank: Record<CityId, number>;
  cities: SmallCity[];
}

/** data/cities/index.json: metadata for the split city files. */
export interface CityIndex {
  schemaVersion: number;
  generatedAt: string;
  sources: Partial<Record<SourceId, Source>>;
  /** Smallest city in any file. */
  minPopulation: number;
  /** major.json holds every city at or above this. */
  majorMinPopulation: number;
  /** City count per file (`major` or a continent slug). */
  files: Record<string, number>;
  /** Playable cities at each CITY_SIZE_STOPS threshold, keyed by `world` or continent slug, then threshold. */
  playableCounts: Record<string, Record<string, number>>;
  /** Rank among the world's most visited cities (Euromonitor), by city id; only ranked cities. */
  tourismRank: Record<CityId, number>;
}

/** File name for a continent's city file: "North America" -> "north-america". */
export function continentSlug(continent: Continent): string {
  return continent.toLowerCase().replace(/\s+/g, '-');
}
