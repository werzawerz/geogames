import { readFile } from 'node:fs/promises';
import { build, type Plugin } from 'esbuild';

/**
 * The server only replays games, so it needs far less of the data than the web
 * app: no translations, sources or search names. Stripping them keeps the bundle
 * under the deploy limit (5 MB by Supabase, 4 MB by our own build check). Only fields the game engines read may stay out
 * of this: `bundle.test.ts` checks that replays give the same scores.
 */
function slimCity(c: Record<string, any>) {
  return {
    id: c.id,
    name: c.name,
    countryId: c.countryId,
    capital: c.capital,
    latlng: c.latlng,
    quality: c.quality,
    metrics: { population: { value: c.metrics.population?.value } },
  };
}

function slim(file: string, data: any): unknown {
  if (/countries\.json$/.test(file)) {
    return {
      generatedAt: data.generatedAt,
      countries: data.countries.map((c: Record<string, any>) => ({
        id: c.id,
        iso2: c.iso2,
        name: c.name,
        capitals: c.capitals,
        borders: c.borders,
        continent: c.continent,
        subregion: c.subregion,
        sovereignty: c.sovereignty,
        metrics: Object.fromEntries(Object.entries(c.metrics).map(([k, m]) => [k, { value: (m as { value: number }).value }])),
      })),
    };
  }
  if (/great-circles\.json$/.test(file)) {
    const end = (c: Record<string, unknown>) => ({ id: c.id, countryId: c.countryId });
    return { puzzles: data.puzzles.map((p: Record<string, any>) => ({ ...p, from: end(p.from), to: end(p.to) })) };
  }
  if (/cities[\\/]index\.json$/.test(file)) return { ...data, sources: {} };
  if (/cities[\\/]small-cities\.json$/.test(file)) return data.map((row: unknown[]) => row.slice(0, 6));
  if (/cities[\\/]city-proper\.json$/.test(file)) return { tourismRank: data.tourismRank, cities: data.cities.map((row: unknown[]) => row.slice(0, 6)) };
  if (/cities[\\/][a-z-]+\.json$/.test(file)) return data.map(slimCity);
  // River Run scores a guess by how much of the river was drawn, which the client logs: no lines needed.
  if (/rivers\.json$/.test(file)) {
    // The anchor stays: the four names offered from half drawn are picked around it, and a typed one of them scores as a pick.
    const keep = ({ id, name, tier, continent, anchor }: Record<string, unknown>) => ({ id, name, tier, continent, anchor });
    return { ...data, rivers: data.rivers.map(keep) };
  }
  // Native Tongue scores by which country was asked, so only which names make a puzzle and their script matter, not the names.
  if (/native-names.json$/.test(file)) {
    return { ...data, names: data.names.map(({ id, script, looksEnglish }: Record<string, unknown>) => ({ id, script, looksEnglish })) };
  }
  // Supply Chain scores by which producers lead which commodity: ids, kind, tier and output, never the names, units or sources.
  if (/supply-chain.json$/.test(file)) {
    return {
      version: data.version,
      commodities: data.commodities.map(({ id, kind, tier, producers }: Record<string, any>) => ({ id, kind, tier, producers: producers.map(({ id, value, share }: Record<string, unknown>) => ({ id, value, share })) })),
    };
  }
  // Blank Atlas replays need only what each feature is, where, and what it's part of; never names or outlines.
  if (/blank-atlas\.json$/.test(file)) {
    return {
      generatedAt: data.generatedAt,
      features: data.features.map((f: Record<string, unknown>) => ({ id: f.id, kind: f.kind, tier: f.tier, center: f.center, related: f.related })),
    };
  }
  return data;
}

/** The per-region city lists, the bulk of the data: shipped as rows, not objects, to stay under the deploy limit. */
const CITY_LIST = /cities[\\/](?!index|small-cities|city-proper)[a-z-]+\.json$/;

/** One city as a row: [id, name, countryId, capital, lat, lng, plausibility, verified, recognizable, population]. */
const cityRow = (c: ReturnType<typeof slimCity>) => [
  c.id,
  c.name,
  c.countryId,
  c.capital,
  c.latlng[0],
  c.latlng[1],
  c.quality.plausibility,
  c.quality.verified,
  c.quality.recognizable,
  c.metrics.population.value,
];

/** Turns rows back into the objects slimCity makes, in the bundle at load time. */
const CITY_FROM_ROW =
  '([id,name,countryId,capital,lat,lng,plausibility,verified,recognizable,value])=>' +
  '({id,name,countryId,capital,latlng:[lat,lng],quality:{plausibility,verified,recognizable},metrics:{population:{value}}})';

/** Loads data files as slimmed JSON text: much quicker for a function's cold start than object literals. */
const slimData: Plugin = {
  name: 'slim-data',
  setup(b) {
    b.onLoad({ filter: /geodata[\\/]data[\\/].*\.json$/ }, async ({ path }) => {
      const data = slim(path, JSON.parse(await readFile(path, 'utf8')));
      if (CITY_LIST.test(path)) {
        const rows = JSON.stringify(JSON.stringify((data as ReturnType<typeof slimCity>[]).map(cityRow)));
        return { contents: `export default JSON.parse(${rows}).map(${CITY_FROM_ROW});`, loader: 'js' };
      }
      return { contents: `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});`, loader: 'js' };
    });
  },
};

/** Bundles an entry point into one file for the server's runtime. */
export async function bundle(entry: string, outfile: string): Promise<number> {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['import', 'module', 'default'],
    target: 'es2022',
    minify: true,
    banner: { js: '// @ts-nocheck\n// Generated by apps/api/scripts/build.ts. Do not edit.' },
    plugins: [slimData],
    metafile: true,
  });
  return Object.values(result.metafile.outputs)[0]!.bytes;
}
