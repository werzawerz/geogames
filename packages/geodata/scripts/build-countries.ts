/**
 * Builds data/countries.json from upstream sources.
 *
 *   node scripts/build-countries.ts            fetch sources (cached in .cache/) and build
 *   node scripts/build-countries.ts --offline  build from the cache only
 *
 * Identity, names and geography come from mledoze/countries (pinned tag);
 * statistics come from the World Bank API (most recent non-empty value);
 * data/overrides.json patches gaps with cited manual values.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Continent,
  Country,
  CountryId,
  Dataset,
  MetricId,
  Source,
  SourceId,
  Sovereignty,
} from '../src/types.ts';
import { validateDataset } from '../src/validate.ts';
import { ROOT, cachedJson, readJson, round } from './lib/fetch.ts';

const OUT = join(ROOT, 'data', 'countries.json');

const SCHEMA_VERSION = 1;
const MLEDOZE_TAG = 'v4.1.1';

const SOURCES: Partial<Record<SourceId, Source>> = {
  mledoze: {
    name: `mledoze/countries ${MLEDOZE_TAG}`,
    url: 'https://github.com/mledoze/countries',
    license: 'ODbL-1.0',
  },
  worldbank: {
    name: 'World Bank, World Development Indicators',
    url: 'https://data.worldbank.org',
    license: 'CC BY 4.0',
  },
  manual: {
    name: 'Manual overrides (packages/geodata/data/overrides.json)',
    url: '',
    license: 'Various, cited per value',
  },
};

const WORLD_BANK_INDICATORS: Partial<Record<MetricId, string>> = {
  population: 'SP.POP.TOTL',
  gdp: 'NY.GDP.MKTP.CD',
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  lifeExpectancy: 'SP.DYN.LE00.IN',
};

// --- upstream shapes (only the fields we read) ---------------------------

interface MledozeCountry {
  name: { common: string; official: string; native?: Record<string, { common: string; official: string }> };
  tld?: string[];
  cca2: string;
  ccn3: string;
  cca3: string;
  unMember: boolean;
  currencies?: Record<string, { name: string; symbol?: string }>;
  capital?: string[];
  altSpellings?: string[];
  region: string;
  subregion?: string;
  languages?: Record<string, string>;
  translations?: Record<string, { common: string; official: string }>;
  latlng: [number, number];
  landlocked: boolean;
  borders?: string[];
  area: number;
}

interface WorldBankRow {
  countryiso3code: string;
  date: string;
  value: number | null;
}

interface ManualMetric {
  value: number;
  year: number | null;
  note: string;
}

interface Overrides {
  idAliases: Record<string, CountryId>;
  sovereignty: Record<CountryId, Sovereignty>;
  metrics: Record<CountryId, Partial<Record<MetricId, ManualMetric>>>;
  /** Replaces upstream capitals; the first is shown, all are accepted as answers. */
  capitals: Record<CountryId, { capitals: string[]; reason: string }>;
}

// --- fetching -----------------------------------------------------------

async function fetchWorldBank(indicator: string): Promise<Map<string, WorldBankRow>> {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&mrnev=1`;
  const [meta, rows] = await cachedJson<[unknown, WorldBankRow[] | null]>(`wb-${indicator}.json`, url);
  if (!rows) throw new Error(`World Bank ${indicator}: empty response ${JSON.stringify(meta)}`);
  return new Map(rows.filter((r) => r.value !== null).map((r) => [r.countryiso3code, r]));
}

// --- normalization ------------------------------------------------------

function continentOf(c: MledozeCountry): Continent {
  switch (c.region) {
    case 'Americas':
      return c.subregion === 'South America' ? 'South America' : 'North America';
    case 'Antarctic':
      return 'Antarctica';
    case 'Africa':
    case 'Asia':
    case 'Europe':
    case 'Oceania':
      return c.region;
    default:
      throw new Error(`${c.cca3}: unknown region ${c.region}`);
  }
}

const isCode = (s: string) => /^[A-Z]{2,3}$/.test(s);

function aliasesOf(c: MledozeCountry): string[] {
  const names = [
    ...(c.altSpellings ?? []),
    ...Object.values(c.name.native ?? {}).flatMap((n) => [n.common, n.official]),
    c.name.official,
  ];
  return [...new Set(names)].filter((n) => n !== c.name.common && !isCode(n));
}

function normalize(c: MledozeCountry, overrides: Overrides): Country {
  const alias = (code: string) => overrides.idAliases[code] ?? code;
  const id = alias(c.cca3);
  return {
    id,
    iso2: c.cca2,
    isoNumeric: c.ccn3 || null,
    name: c.name.common,
    officialName: c.name.official,
    aliases: aliasesOf(c),
    translations: Object.fromEntries(Object.entries(c.translations ?? {}).map(([lang, t]) => [lang, t.common])),
    capitals: overrides.capitals[id]?.capitals ?? c.capital ?? [],
    continent: continentOf(c),
    region: c.region,
    subregion: c.subregion || null,
    sovereignty: overrides.sovereignty[id] ?? (c.unMember ? 'un-member' : 'territory'),
    latlng: c.latlng,
    landlocked: c.landlocked,
    borders: (c.borders ?? []).map(alias),
    currencies: Object.entries(c.currencies ?? {}).map(([code, cur]) => ({
      code,
      name: cur.name,
      symbol: cur.symbol ?? null,
    })),
    languages: Object.entries(c.languages ?? {}).map(([code, name]) => ({ code, name })),
    tld: c.tld ?? [],
    metrics: c.area > 0 ? { area: { value: c.area, year: null, source: 'mledoze' } } : {},
  };
}

async function main() {
  const overrides = await readJson<Overrides>(join(ROOT, 'data', 'overrides.json'));
  const upstream = await cachedJson<MledozeCountry[]>(
    `mledoze-${MLEDOZE_TAG}.json`,
    `https://raw.githubusercontent.com/mledoze/countries/${MLEDOZE_TAG}/countries.json`,
  );

  const countries = upstream.map((c) => normalize(c, overrides)).sort((a, b) => a.id.localeCompare(b.id));

  for (const [metric, indicator] of Object.entries(WORLD_BANK_INDICATORS) as [MetricId, string][]) {
    const rows = await fetchWorldBank(indicator);
    for (const country of countries) {
      const row = rows.get(country.id);
      if (row && row.value !== null) {
        country.metrics[metric] = {
          value: metric === 'population' ? row.value : round(row.value, 2),
          year: Number(row.date),
          source: 'worldbank',
        };
      }
    }
  }

  for (const country of countries) {
    const manual = Object.entries(overrides.metrics[country.id] ?? {}) as [MetricId, ManualMetric][];
    for (const [metric, v] of manual) {
      country.metrics[metric] = { value: v.value, year: v.year, source: 'manual', note: v.note };
    }
    const { population, area } = country.metrics;
    if (population && area) {
      country.metrics.populationDensity = {
        value: round(population.value / area.value, 2),
        year: population.year,
        source: population.source,
        note: 'Derived: population / area',
      };
    }
  }

  const dataset: Dataset = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sources: SOURCES,
    countries,
  };

  const { errors, warnings } = validateDataset(dataset);
  warnings.forEach((w) => console.warn(`warn: ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`error: ${e}`));
    process.exit(1);
  }

  await writeFile(OUT, JSON.stringify(dataset, null, 1) + '\n');
  const sovereign = countries.filter((c) => c.sovereignty !== 'territory').length;
  console.log(`wrote ${countries.length} entries (${sovereign} sovereign) to ${OUT}`);
}

await main();
