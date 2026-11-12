import data from '../data/countries.json' with { type: 'json' };
import type { Continent, Country, CountryId, Dataset, MetricId, Sovereignty } from './types.ts';

export type * from './types.ts';
export { METRICS, type MetricDefinition } from './metrics.ts';
export { EXCLAVES, FIXED_LINKS, TERRITORY_OWNERS, type Exclave } from './links.ts';

// The generated file is validated at build time; its inferred literal type is too wide to check against `Dataset`.
export const dataset = data as unknown as Dataset;
export const countries: readonly Country[] = dataset.countries;

const byId = new Map(countries.map((c) => [c.id, c]));

export function getCountry(id: CountryId): Country | undefined {
  return byId.get(id);
}

/** Entities treated as "countries" by default in games. */
export const SOVEREIGN: readonly Sovereignty[] = ['un-member', 'un-observer', 'partially-recognized'];

export interface CountryQuery {
  sovereignty?: readonly Sovereignty[];
  continents?: readonly Continent[];
  /** Only include countries that have all of these metrics. */
  requireMetrics?: readonly MetricId[];
}

export function queryCountries(query: CountryQuery = {}): Country[] {
  const { sovereignty = SOVEREIGN, continents, requireMetrics = [] } = query;
  return countries.filter(
    (c) =>
      sovereignty.includes(c.sovereignty) &&
      (!continents || continents.includes(c.continent)) &&
      requireMetrics.every((m) => c.metrics[m] !== undefined),
  );
}

export function metricValue(country: Country, metric: MetricId): number | undefined {
  return country.metrics[metric]?.value;
}

/**
 * How well-known each country is, 0..1: the average of its population and GDP
 * percentile ranks among `among` (population alone when GDP is missing, e.g.
 * Taiwan). Good enough to pick "easy" countries players are likely to know.
 */
export function countryProminence(among: readonly Country[]): Map<CountryId, number> {
  const percentile = (metric: MetricId) => {
    const ranked = among.filter((c) => c.metrics[metric]).sort((a, b) => a.metrics[metric]!.value - b.metrics[metric]!.value);
    return new Map(ranked.map((c, i) => [c.id, ranked.length > 1 ? i / (ranked.length - 1) : 1]));
  };
  const population = percentile('population');
  const gdp = percentile('gdp');
  return new Map(
    among.map((c) => {
      const p = population.get(c.id) ?? 0;
      const g = gdp.get(c.id);
      return [c.id, g === undefined ? p : (p + g) / 2];
    }),
  );
}
