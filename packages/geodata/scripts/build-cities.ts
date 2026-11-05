/**
 * Builds data/cities/. Run after build-countries.ts (cities link to country ids).
 *
 *   node scripts/build-cities.ts            fetch sources (cached in .cache/) and build
 *   node scripts/build-cities.ts --offline  build from the cache only
 *
 * Two UN sources:
 * - Cities of 300k+ come from World Urbanization Prospects 2018 (its 2025
 *   projection), where each country defines its agglomerations the way its own
 *   statistics office does. These are the figures people know: Rome 4.3M ahead
 *   of Naples 2.2M, London 9.8M. (Snapshot: data/sources/wup2018-cities-300k.csv.)
 * - Smaller cities, down to 50k, come from WUP 2025, which measures every city
 *   as its continuous dense urban area (Degree of Urbanisation). Its big-city
 *   figures are consistent but often surprising (Naples ahead of Rome, Jakarta
 *   ahead of Tokyo), so they're not used above 300k.
 * GeoNames confirms names and positions: a GeoNames city with a matching name
 * must lie within MATCH_RADIUS_KM. data/city-overrides.json renames or excludes
 * WUP 2025 entries the check can't settle.
 *
 * Output is split so apps load only what a game needs:
 *   major.json         every city with MAJOR_MIN_POPULATION+ (world games)
 *   small-cities.json  playable cities below that, slimmed to [id, name, country, pop, lat, lng],
 *                      so world-wide games can use small cities without loading every continent
 *   <continent>.json   every city of one continent, down to MIN_POPULATION
 *   index.json         sources, thresholds and file sizes
 * City files hold one city per line so dataset updates diff readably.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { City, CityDataset, CityIndex, CityProperData, Continent, Dataset, SmallCity, Source, SourceId } from '../src/types.ts';
import { continentSlug } from '../src/types.ts';
import { CITY_SIZE_STOPS, isPlayable } from '../src/city-rules.ts';
import { validateCities } from '../src/validate.ts';
import { csvRecords } from './lib/csv.ts';
import { CACHE, OFFLINE, ROOT, cachedFile, readJson, round } from './lib/fetch.ts';
import { unzipEntry } from './lib/zip.ts';

const OUT_DIR = join(ROOT, 'data', 'cities');
const SCHEMA_VERSION = 2;
const YEAR = '2025';
/** WUP's own floor is 50k; we keep everything for country-level games. */
const MIN_POPULATION = 50_000;
/** WUP 2018 agglomerations cover cities from this size up; WUP 2025 fills in below. */
const AGGLOMERATION_MIN_POPULATION = 300_000;
const MAJOR_MIN_POPULATION = AGGLOMERATION_MIN_POPULATION;
/** A smaller WUP 2025 city this close to an agglomeration's centre is the same place. */
const DUPLICATE_RADIUS_KM = 8;
const MATCH_RADIUS_KM = 50;
/**
 * A verified non-capital is "recognizable" when GeoNames knows it as a sizeable
 * place in its own right: 200k+ people, at least RECOGNIZABLE_RATIO of the urban
 * area's population, or a first-level admin seat (state or province capital).
 * The vast rural-density clusters the UN method finds (e.g. "Hajipur", 9.9M)
 * are named after towns GeoNames counts at only 1-5% of that.
 */
const RECOGNIZABLE_MIN = 200_000;
/** At most this many included cities are listed per urban area. */
const MAX_INCLUDES = 4;
/**
 * GeoNames cities this big that have no urban area of their own were merged by
 * the UN into a neighbour (San Jose into "San Francisco"); their names become
 * aliases of that urban area so players can still type them.
 */
const ABSORBED_MIN_POPULATION = 250_000;
/** WUP 2018 names that need fixing: typos, or no good form in the data. */
const WUP2018_NAME_FIXES: Record<string, string> = {
  Nurenberg: 'Nuremberg',
  Teeside: 'Teesside',
  'Muenster (Westfalen)': 'Münster',
  'Erduosi (Ordoss)': 'Ordos',
  'Southampton/Portsmouth (South Hampshire)': 'Southampton–Portsmouth',
  'Basilan City (including City of Isabela)': 'Isabela City',
  'Gaza (incl. Ash Shati Camp)': 'Gaza',
  // Romanised or local forms where English has its own name.
  Taibei: 'Taipei',
  Xinbei: 'New Taipei',
  Gaoxiong: 'Kaohsiung',
  'Hà Noi': 'Hanoi',
  Haerbin: 'Harbin',
  Venezia: 'Venice',
  Genève: 'Geneva',
  Sevilla: 'Seville',
  Tanger: 'Tangier',
  'Ad-Dammam': 'Dammam',
  'Bruxelles-Brussel': 'Brussels',
  'Pôrto Alegre': 'Porto Alegre',
  'Ribeirão  Preto': 'Ribeirão Preto',
  'Kitakyushu-Fukuoka M.M.A.': 'Fukuoka–Kitakyushu',
  'Shizuoka-Hamamatsu M.M.A.': 'Shizuoka–Hamamatsu',
  'Göteborg': 'Gothenburg',
  // US urbanized areas are named after all their main cities; the first is the one people say.
  'New York-Newark': 'New York',
  'Los Angeles-Long Beach-Santa Ana': 'Los Angeles',
  'San Francisco-Oakland': 'San Francisco',
  'Phoenix-Mesa': 'Phoenix',
  'Denver-Aurora': 'Denver',
  'Tampa-St. Petersburg': 'Tampa',
};

/**
 * WUP 2018 names whose parentheses hold a former name or a region, not the
 * English name, so the main name is shown ("Mumbai (Bombay)"). The
 * parenthesised form stays an alias.
 */
const KEEP_MAIN_NAME = new Set([
  'Chennai', 'Guwahati', 'Kochi', 'Kolkata', 'Kozhikode', 'Mumbai', 'Pune', 'Thoothukkudi', 'Varanasi',
  'Makassar', 'Kraków', 'Kyiv', 'Ürümqi', 'Durban', 'East London', 'Pietermaritzburg', 'Port Elizabeth',
  'Al Obeid', 'Port Sudan', 'Birmingham', 'Stoke-on-Trent', 'Teeside',
]);

/** "Düsseldorf" as the UN wrote it in ASCII: "Duesseldorf". */
const asciiGerman = (s: string) =>
  s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');

/** How far an agglomeration reaches from its centre, growing with its size (Tokyo ~45 km). */
const agglomerationReachKm = (population: number) => 8 + 6 * Math.sqrt(population / 1_000_000);
const RECOGNIZABLE_RATIO = 0.15;

const WUP_URL =
  'https://population.un.org/wup/assets/Download/Cities/WUP2025-DB-DEGURBA-Cities-Population-Surface-Data.csv.gz';
// cities5000 so the small towns behind 50k+ urban areas can be matched too.
const GEONAMES_CITIES_URL = 'https://download.geonames.org/export/dump/cities5000.zip';
const GEONAMES_ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';

/**
 * Languages whose city names become search aliases (Pozsony, Nagyvárad, Bécs).
 * They come from Wikidata labels of settlements, matched by GeoNames ID or,
 * when Wikidata links another GeoNames entry (Timișoara), by English name nearby.
 */
const ALIAS_LANGUAGES = ['hu'];
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
/** Settlements Wikidata counts at least this big (city proper, so below our 50k urban areas). */
const WIKIDATA_MIN_POPULATION = 40_000;
const WIKIDATA_MATCH_KM = 25;
const WIKIDATA_BATCH = 300;

/**
 * Japan's Major Metropolitan Areas (M.M.A.) span several cities, wider than
 * other agglomerations of their size (Kyoto is in Osaka's, 43 km out).
 */
const MMA_REACH_FACTOR = 2;

/**
 * The city-proper dataset comes from GeoNames, whose figures are for the city
 * itself (Bergamo 120k, where the UN's agglomeration has 900k). Its entries
 * that aren't whole cities are dropped: these feature codes are city sections
 * and abandoned, historical or destroyed places.
 */
const PROPER_SKIP_CODES = new Set(['PPLX', 'PPLQ', 'PPLH', 'PPLW', 'PPLL']);
/** How far a place counts as near a much bigger one, where it could be just a district of it. */
const properReachKm = (population: number) => 12 + 5 * Math.sqrt(population / 1_000_000);
const PROPER_HOST_RATIO = 3;
/**
 * Cities that are a first-level region of their own: places in the same region
 * nearby are parts of the city (Pudong in Shanghai, Üsküdar in Istanbul).
 */
const REGION_CITIES = new Set(
  [
    'Shanghai', 'Beijing', 'Tianjin', 'Chongqing', 'Seoul', 'Tokyo', 'Mexico City', 'Istanbul', 'Ankara', 'Izmir', 'Bursa',
    'Lagos', 'Luanda', 'Kinshasa', 'Abidjan', 'Bogotá', 'Baghdad', 'Delhi', 'Moscow', 'Saint Petersburg', 'Berlin', 'Vienna',
    'Budapest', 'Bangkok', 'Kuala Lumpur', 'Jakarta', 'Ho Chi Minh City', 'Hanoi', 'Taipei', 'Cairo', 'Kampala', 'Nairobi',
    'Santo Domingo', 'Caracas', 'Kabul',
  ].map(spelling),
);
/** City-states: every other place in them is a part of the one city. */
const CITY_STATES = new Set(['HK', 'MO', 'SG']);
/** Wikidata types that mean a part of a city, for places near a much bigger one. */
const DISTRICT_TYPE =
  /^(borough of New York City|city district|urban district|municipal arrondissement of France|district of (Turkey|China|Taiwan|Madrid|Barcelona)|subdistrict in China|neighbou?rhood|quarter of |suburb$|special ward|ward of |planning area|territorial demarcation of Mexico City|Ortsteil|area of London|kecamatan|kelurahan|kapanewon)/i;
/** City parts that neither rule above catches. */
const DISTRICT_NAME = /^(Paris|Marseille|Lyon) \d|^Delegación |^Quận /;
const DISTRICTS = new Set(['Brooklyn', 'Queens', 'Manhattan', 'The Bronx', 'Staten Island', 'Soweto', 'Sadr City']);
/**
 * Big GeoNames entries with no UN metro figure to cap them, found by comparing
 * with Wikidata. Not cities: a part of one, a duplicate or a whole district
 * under a town's name ("iso:name").
 */
const PROPER_DROP = new Set([
  'GN:Camayenne', 'PH:Budta', 'PH:Malingao', 'IN:Kallakurichi', 'IN:Nowrangapur', 'IN:Pimpri', 'IN:Kanayannur',
  'MY:Kampung Baru Subang', 'CN:Wanxian', 'JP:Aihara', 'KH:Takeo',
]);
/** Figures for a whole district or province under a city's name, replaced with Wikidata's. */
const PROPER_POPULATION: Record<string, number> = {
  'CN:Wuzhong': 1_380_000,
  'KE:Kakamega': 90_000,
  'PK:Bannu': 60_000,
  'PK:Arif Wala': 100_000,
  'PK:Dera Ismail Khan': 110_000,
  'PK:Muzaffarabad': 150_000,
};

const SOURCES: Partial<Record<SourceId, Source>> = {
  wup2018: {
    name: 'United Nations, DESA, Population Division (2018). World Urbanization Prospects: The 2018 Revision',
    url: 'https://population.un.org/wup/',
    license: 'CC BY 3.0 IGO',
  },
  wup: {
    name: 'United Nations, DESA, Population Division (2025). World Urbanization Prospects: The 2025 Revision',
    url: 'https://population.un.org/wup/',
    license: 'CC BY 3.0 IGO',
  },
  geonames: {
    name: 'GeoNames (cities5000, admin1 codes)',
    url: 'https://www.geonames.org',
    license: 'CC BY 4.0',
  },
  wikidata: {
    name: 'Wikidata (city names in other languages)',
    url: 'https://www.wikidata.org',
    license: 'CC0 1.0',
  },
  euromonitor: {
    name: 'Euromonitor International, Top 100 City Destinations (international arrivals), via ooaworld.com',
    url: 'https://www.ooaworld.com/world-most-visited-cities-top-100-most-visited-places-in-the-world/',
    license: 'Ranking used as facts; snapshot in data/sources/euromonitor-top-cities.csv',
  },
  manual: {
    name: 'Manual overrides (packages/geodata/data/city-overrides.json)',
    url: '',
    license: 'Various, cited per entry',
  },
};

interface CityOverride {
  /** Why this override exists; required so every manual decision is explained. */
  reason: string;
  name?: string;
  exclude?: boolean;
  /** Treat as verified without a GeoNames name match (e.g. a twin city). */
  verified?: boolean;
  /** Well-known city whose GeoNames figure is too small to qualify on its own. */
  recognizable?: boolean;
  capital?: boolean;
  geonamesId?: number;
}

interface GeoNamesCity {
  id: number;
  name: string;
  names: Set<string>;
  lat: number;
  lng: number;
  iso2: string;
  admin1: string;
  population: number;
  /** PPLA = seat of a first-level admin division, PPLC = national capital. */
  featureCode: string;
}

/**
 * Names Wikidata's English label would make worse: a local form where English
 * has its own (Siracusa), a typo (Mogi-Gaucu) or a doubtful transliteration.
 */
const KEEP_UN_NAME = new Set(['Syracuse', 'Mogi Guaçu', 'Lechang', 'Qotur', 'Qurghontepa', 'Shakar Garh']);

/** Spelling key for comparing names: no accents, case, punctuation or German "ue" for "ü". */
function spelling(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Whether a Wikidata label is just the English form of a city's name, safe to
 * show instead: a respelling (Jiddah → Jeddah, Gent → Ghent, Can Tho → Cần Thơ)
 * or one city of a joint name (Dallas-Fort Worth → Dallas, Elx / Elche →
 * Elche). Wikidata often links a GeoNames place to its municipality, district
 * or seat town, so anything else is refused: "Madrid city", "Jilin City",
 * "Victoria de Durango", Liuyang → Guankou. Real English names that differ
 * more (Göteborg → Gothenburg) are in WUP2018_NAME_FIXES.
 */
function isEnglishForm(city: Pick<City, 'name'>, en: string): boolean {
  if (/[,()]/.test(en)) return false; // disambiguated: "Washington, D.C."
  if (/\s{2}|\b[A-Z]{2,}\b/.test(en)) return false; // garbled: "Turnu-  Severin", "AIN Taoujdate"
  if (KEEP_UN_NAME.has(city.name)) return false;
  const old = spelling(city.name);
  const next = spelling(en);
  if (next !== old && next.includes(old)) return false; // words added: "Seongnam-si", "Hong Kong Island"
  const parts = city.name.split(/\s*[-–/]\s*/);
  if (parts.length > 1 && parts.some((p) => spelling(p) === next)) return true;
  const d = editDistance(old, next);
  return d <= 2 && d <= old.length / 4;
}

const normalizeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(city|district|municipality)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "Wien (Vienna)" -> { english: "Vienna", local: "Wien" }; "Minneapolis [Saint Paul]" -> twin-city parts. */
function splitName(raw: string): { english: string; local: string | null; parts: string[] } {
  const paren = raw.match(/^(.*?)\s*\((.+)\)$/);
  const english = paren ? paren[2]!.trim() : raw.replace(/\s*\[(.+)\]$/, '–$1');
  const local = paren ? paren[1]!.trim() : null;
  const parts = [raw, english, local ?? '', ...raw.split(/\s*[-–/[\]()]\s*/)].filter(Boolean);
  return { english, local, parts };
}

function parseGeoNames(text: string): Map<string, GeoNamesCity[]> {
  const byCountry = new Map<string, GeoNamesCity[]>();
  for (const line of text.split('\n')) {
    const r = line.split('\t');
    if (r.length < 19) continue;
    const city: GeoNamesCity = {
      id: Number(r[0]),
      name: r[1]!,
      names: new Set([r[1]!, r[2]!, ...r[3]!.split(',')].filter(Boolean).map(normalizeName)),
      lat: Number(r[4]),
      lng: Number(r[5]),
      iso2: r[8]!,
      admin1: r[10]!,
      population: Number(r[14]),
      featureCode: r[7]!,
    };
    const list = byCountry.get(city.iso2) ?? [];
    list.push(city);
    byCountry.set(city.iso2, list);
  }
  return byCountry;
}

async function main() {
  const countries = await readJson<Dataset>(join(ROOT, 'data', 'countries.json'));
  const countryById = new Map(countries.countries.map((c) => [c.id, c]));
  const countryByNumeric = new Map(countries.countries.filter((c) => c.isoNumeric).map((c) => [Number(c.isoNumeric), c]));
  const overrides = (await readJson<{ cities: Record<string, CityOverride> }>(join(ROOT, 'data', 'city-overrides.json')))
    .cities;

  const wupCsv = gunzipSync(await cachedFile('wup2025-cities.csv.gz', WUP_URL)).toString('utf8');
  const agglomerationCsv = await readFile(join(ROOT, 'data', 'sources', 'wup2018-cities-300k.csv'), 'utf8');
  const geonames = parseGeoNames(
    unzipEntry(await cachedFile('geonames-cities5000.zip', GEONAMES_CITIES_URL), 'cities5000.txt').toString('utf8'),
  );
  const admin1Names = new Map(
    (await cachedFile('geonames-admin1.txt', GEONAMES_ADMIN1_URL))
      .toString('utf8')
      .split('\n')
      .map((l) => l.split('\t'))
      .map((r) => [r[0]!, r[1]!] as const),
  );
  const admin1Of = (g: GeoNamesCity | undefined) => (g ? (admin1Names.get(`${g.iso2}.${g.admin1}`) ?? null) : null);

  /** The biggest GeoNames place near [lat, lng] carrying one of `names`. */
  const findPlace = (iso2: string, lat: number, lng: number, names: readonly string[]) => {
    const wanted = new Set(names.map(normalizeName).filter(Boolean));
    return (geonames.get(iso2) ?? [])
      .filter((g) => distanceKm(lat, lng, g.lat, g.lng) <= MATCH_RADIUS_KM && [...wanted].some((n) => g.names.has(n)))
      .sort((a, b) => b.population - a.population)[0];
  };

  // 1. Agglomerations of 300k+ from WUP 2018: the figures people know (Rome 4.3M > Naples 2.2M).
  const agglomerations: City[] = [];
  /** Cities named by hand (WUP2018_NAME_FIXES, city overrides): Wikidata doesn't rename them. */
  const manualNames = new Set<string>();
  for (const r of csvRecords(agglomerationCsv)) {
    const population = Number(r.pop_2025);
    const country = countryByNumeric.get(Number(r.country_code));
    if (!country) throw new Error(`WUP 2018 ${r.name}: unknown country ${r.country_code} (${r.country})`);
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    // "Guangzhou, Guangdong" → Guangzhou; "Roma (Rome)" / "Birmingham (West Midlands)" → whichever GeoNames knows.
    const base = r.name!.replace(/,.*$/, '').trim();
    const paren = base.match(/^(.*?)\s*\((.+)\)$/);
    const outside = paren ? paren[1]!.trim() : base;
    const inside = paren ? paren[2]!.trim() : null;
    const hyphenParts = outside.split(/\s*[-–]\s*/).filter((p) => p !== outside);
    const match = findPlace(country.iso2, lat, lng, [outside, ...(inside ? [inside] : []), ...hyphenParts]);
    // Display name: usually the English form in parentheses ("Roma (Rome)"), except where the
    // parentheses hold a former name or a region ("Mumbai (Bombay)", "Birmingham (West Midlands)").
    // German names the UN wrote in ASCII get their umlauts back ("Duesseldorf"); typos are fixed.
    if (WUP2018_NAME_FIXES[base] ?? WUP2018_NAME_FIXES[outside]) manualNames.add(`wup18-${r.city_code}`);
    const name =
      WUP2018_NAME_FIXES[base] ??
      WUP2018_NAME_FIXES[outside] ??
      (inside && !KEEP_MAIN_NAME.has(outside)
        ? inside
        : match && asciiGerman(match.name) === outside
          ? match.name
          : outside);
    // A capital if the national capital lies inside the area (New Delhi in Delhi).
    const reach = agglomerationReachKm(population);
    const capital =
      match?.featureCode === 'PPLC' ||
      (geonames.get(country.iso2) ?? []).some((g) => g.featureCode === 'PPLC' && distanceKm(lat, lng, g.lat, g.lng) <= reach) ||
      country.capitals.some((cap) => [name, outside, inside, ...hyphenParts].some((n) => n && normalizeName(n) === normalizeName(cap)));
    agglomerations.push({
      id: `wup18-${r.city_code}`,
      name,
      localName: name !== outside ? outside : null,
      aliases: [...new Set([outside, inside, base, match?.name, ...hyphenParts].filter((n): n is string => !!n && n !== name))],
      includes: [],
      countryId: country.id,
      admin1: admin1Of(match),
      capital,
      latlng: [round(lat, 4), round(lng, 4)],
      geonamesId: match?.id ?? null,
      // Official agglomerations, each defined by its own country's statistics office.
      quality: { plausibility: 'high', verified: Boolean(match), recognizable: true },
      metrics: {
        population: { value: population, year: Number(YEAR), source: 'wup2018', note: 'WUP 2018 projection for 2025' },
      },
    });
  }

  // 2. Smaller cities from WUP 2025, which goes down to 50k with one definition everywhere.
  const degurba: City[] = [];
  const unverified: City[] = [];
  for (const r of csvRecords(wupCsv)) {
    if (r.Year !== YEAR) continue;
    const population = Math.round(Number(r.Pop) * 1000);
    if (population < MIN_POPULATION || population >= AGGLOMERATION_MIN_POPULATION) continue;

    const id = `wup-${r.City_Code}`;
    const override = overrides[id];
    if (override?.exclude) continue;

    const country = countryById.get(r.ISO3_Code!);
    if (!country) throw new Error(`${id} ${r.City_Name}: unknown country ${r.ISO3_Code}`);

    const lat = Number(r.PWCent_Latitude);
    const lng = Number(r.PWCent_Longitude);
    const { english, local, parts } = splitName(r.City_Name!);
    const nearby = (geonames.get(country.iso2) ?? []).filter((g) => distanceKm(lat, lng, g.lat, g.lng) <= MATCH_RADIUS_KM);
    const match = override?.geonamesId ? nearby.find((g) => g.id === override.geonamesId) : findPlace(country.iso2, lat, lng, parts);
    const verified = Boolean(match) || override?.verified === true;

    if (override?.name) manualNames.add(id);
    const name = override?.name ?? english;
    const capital = override?.capital ?? r.Capital === '1';
    const area = Number(r.AREA_km2);
    const known = match
      ? match.population >= RECOGNIZABLE_MIN ||
        match.population >= population * RECOGNIZABLE_RATIO ||
        match.featureCode === 'PPLA' ||
        match.featureCode === 'PPLC'
      : false;
    const city: City = {
      id,
      name,
      localName: local && local !== name ? local : null,
      // Every form of the UN name ("Kyiv (Kiev)" → Kyiv, Kiev) and GeoNames' name.
      // (GeoNames' other-language names were tried: mostly codes and garbled
      // transliterations, so typo-tolerant search covers spelling variants instead.)
      aliases: [...new Set([local, r.City_Name, match?.name, ...parts].filter((n): n is string => !!n && n !== name))],
      includes: [],
      countryId: country.id,
      admin1: admin1Of(match),
      capital,
      latlng: [round(lat, 4), round(lng, 4)],
      geonamesId: match?.id ?? null,
      quality: {
        plausibility: r.Pop_plausibility!.toLowerCase() as City['quality']['plausibility'],
        verified,
        recognizable: verified && (capital || known || override?.recognizable === true),
      },
      metrics: {
        population: { value: population, year: Number(YEAR), source: 'wup' },
        area: { value: round(area, 1), year: Number(YEAR), source: 'wup' },
        populationDensity: { value: round(population / area, 1), year: Number(YEAR), source: 'wup' },
      },
    };
    degurba.push(city);
    if (!verified) unverified.push(city);
  }

  // 3. Drop small cities that duplicate an agglomeration: same GeoNames place,
  //    same name nearby, or sitting on its centre.
  const agglomerationPlaces = new Set(agglomerations.map((a) => a.geonamesId).filter((id) => id !== null));
  const byCountry = new Map<string, City[]>();
  for (const a of agglomerations) byCountry.set(a.countryId, [...(byCountry.get(a.countryId) ?? []), a]);
  const duplicates: string[] = [];
  const small = degurba.filter((c) => {
    const twin =
      (c.geonamesId !== null && agglomerationPlaces.has(c.geonamesId)) ||
      (byCountry.get(c.countryId) ?? []).some((a) => {
        const d = distanceKm(a.latlng[0], a.latlng[1], c.latlng[0], c.latlng[1]);
        const sameName = [a.name, ...a.aliases].some((n) => normalizeName(n) === normalizeName(c.name));
        return d <= DUPLICATE_RADIUS_KM || (sameName && d <= MATCH_RADIUS_KM);
      });
    if (twin) duplicates.push(`${c.name} (${c.countryId})`);
    return !twin;
  });
  console.log(`agglomerations (WUP 2018): ${agglomerations.length}; smaller cities (WUP 2025): ${small.length}; dropped as duplicates: ${duplicates.length}`);

  const cities = [...agglomerations, ...small].sort((a, b) => b.metrics.population!.value - a.metrics.population!.value);

  // 4. Big GeoNames cities inside an agglomeration but without an entry of their
  //    own (Yokohama in Tokyo) become aliases, and are listed as "included".
  const matched = new Set(cities.map((c) => c.geonamesId).filter((id): id is number => id !== null));
  const hostOf = new Map(cities.filter((c) => c.geonamesId !== null).map((c) => [c.geonamesId!, c]));
  let absorbed = 0;
  for (const host of agglomerations) {
    const country = countryById.get(host.countryId)!;
    const mma = [host.name, ...host.aliases].some((n) => n.includes('M.M.A.'));
    const reach = agglomerationReachKm(host.metrics.population!.value) * (mma ? MMA_REACH_FACTOR : 1);
    const inside = (geonames.get(country.iso2) ?? [])
      .filter(
        (p) =>
          p.population >= ABSORBED_MIN_POPULATION &&
          !matched.has(p.id) &&
          distanceKm(host.latlng[0], host.latlng[1], p.lat, p.lng) <= reach &&
          !host.aliases.includes(p.name) &&
          !normalizeName(host.name).includes(normalizeName(p.name)),
      )
      .sort((a, b) => b.population - a.population);
    for (const p of inside) {
      matched.add(p.id);
      hostOf.set(p.id, host);
      host.aliases.push(p.name);
      absorbed++;
    }
    // City districts (PPLX: Hamburg-Wandsbek, Tokyo's wards) stay aliases only.
    host.includes = inside.filter((p) => p.featureCode !== 'PPLX').map((p) => p.name).slice(0, MAX_INCLUDES);
  }
  console.log(`cities absorbed into agglomerations (aliases): ${absorbed}`);

  // 5. Names from Wikidata. Each city's own settlement (by GeoNames ID or, when
  //    Wikidata links another GeoNames entry, by name nearby) gives its English
  //    name ("Taibei" → Taipei, "Toluca de Lerdo" → Toluca); the old name stays
  //    an alias. Labels in ALIAS_LANGUAGES (Pozsony, Ungvár) become aliases, also
  //    from places absorbed into an agglomeration.
  const properPlaces = [...geonames.values()]
    .flat()
    .filter((g) => g.population >= MIN_POPULATION && !PROPER_SKIP_CODES.has(g.featureCode))
    .sort((a, b) => b.population - a.population);
  const english = await wikidataEnglish([
    ...new Set([...cities.map((c) => c.geonamesId).filter((g): g is number => g !== null), ...properPlaces.map((g) => g.id)]),
  ]);
  const places = await wikidataPlaces();
  const byGeonames = new Map(places.flatMap((p) => p.geonames.map((g) => [g, p] as const)));
  const byEnglish = new Map<string, WikidataPlace[]>();
  for (const place of places) {
    const key = normalizeName(place.en);
    byEnglish.set(key, [...(byEnglish.get(key) ?? []), place]);
  }
  const ownPlace = (city: City): WikidataPlace | undefined =>
    (city.geonamesId !== null ? byGeonames.get(city.geonamesId) : undefined) ??
    [city.name, ...city.aliases]
      .flatMap((n) => byEnglish.get(normalizeName(n)) ?? [])
      .map((place) => ({ place, km: distanceKm(city.latlng[0], city.latlng[1], place.lat, place.lng) }))
      .filter((m) => m.km <= WIKIDATA_MATCH_KM)
      .sort((a, b) => a.km - b.km)[0]?.place;

  const renamed: string[] = [];
  let translated = 0;
  const addNames = (city: City, names: readonly string[]) => {
    for (const label of names) {
      if ([city.name, ...city.aliases].some((n) => normalizeName(n) === normalizeName(label))) continue;
      city.aliases.push(label);
      translated++;
    }
  };
  for (const city of cities) {
    const place = ownPlace(city);
    const en = (city.geonamesId !== null ? english.get(city.geonamesId) : undefined) ?? place?.en;
    if (en && !manualNames.has(city.id) && en !== city.name && isEnglishForm(city, en)) {
      renamed.push(`${city.name} → ${en}`);
      if (!city.aliases.includes(city.name)) city.aliases.unshift(city.name);
      city.aliases = city.aliases.filter((a) => a !== en);
      city.localName ??= city.name;
      city.name = en;
    }
    if (place) addNames(city, place.labels);
  }
  for (const [geonamesId, host] of hostOf) {
    if (geonamesId === host.geonamesId) continue;
    const place = byGeonames.get(geonamesId);
    if (place) addNames(host, [place.en, ...place.labels]);
  }
  console.log(`English names from Wikidata: ${renamed.length} renamed, e.g. ${renamed.slice(0, 12).join('; ')}`);
  await writeFile(join(CACHE, 'renamed-cities.txt'), renamed.join('\n') + '\n');
  console.log(`names in ${ALIAS_LANGUAGES.join(', ')} added as aliases: ${translated}`);

  // 6. The most visited cities (Euromonitor): what "well known" means in the
  //    arcade. A ranked place inside an agglomeration (Kyoto in Osaka) ranks it.
  const tourismCsv = await readFile(join(ROOT, 'data', 'sources', 'euromonitor-top-cities.csv'), 'utf8');
  const tourismRows = [...csvRecords(tourismCsv)];
  const rankTourism = (pool: readonly Pick<City, 'id' | 'name' | 'countryId' | 'aliases'>[]) => {
    const ranks: Record<string, number> = {};
    const missing: string[] = [];
    for (const r of tourismRows) {
      // "Fukuoka–Kitakyushu" is the metro area's name; in a city-proper list it's Fukuoka.
      const keys = [r.city!, r.city!.split('–')[0]!].map(normalizeName);
      const candidates = pool.filter((c) => c.countryId === r.country);
      const city =
        candidates.find((c) => keys.includes(normalizeName(c.name))) ??
        candidates.find((c) => c.aliases.some((a) => keys.includes(normalizeName(a))));
      if (city) ranks[city.id] = Math.min(ranks[city.id] ?? Infinity, Number(r.rank));
      else missing.push(`${r.city} (${r.country})`);
    }
    return { ranks, missing };
  };
  const { ranks: tourism, missing: unranked } = rankTourism(cities.filter(isPlayable));
  console.log(`most visited cities matched: ${Object.keys(tourism).length}; not in the game: ${unranked.join(', ')}`);

  // 7. The city-proper dataset: GeoNames places as whole cities, for comparing
  //    with the metro figures above. Parts of cities are dropped, and no city
  //    exceeds its own metro area: GeoNames' Chinese figures are often the whole
  //    prefecture (Weifang 9.4M), a few are plain wrong (Taipei 7.9M).
  const metroOf = new Map(agglomerations.filter((c) => c.geonamesId !== null).map((c) => [c.geonamesId!, c]));
  const ownCity = new Map(cities.filter((c) => c.geonamesId !== null).map((c) => [c.geonamesId!, c]));
  const countryByIso = new Map(countries.countries.map((c) => [c.iso2, c]));
  const hosts = new Map<number, GeoNamesCity>();
  for (const place of properPlaces) {
    const host = properPlaces.find(
      (h) =>
        h.iso2 === place.iso2 &&
        h.population >= place.population * PROPER_HOST_RATIO &&
        distanceKm(h.lat, h.lng, place.lat, place.lng) <= properReachKm(h.population),
    );
    if (host) hosts.set(place.id, host);
  }
  const types = await wikidataTypes([...hosts.keys()]);
  const isCityPart = (place: GeoNamesCity) => {
    if (DISTRICT_NAME.test(place.name)) return true;
    const host = hosts.get(place.id);
    if (!host) return false;
    return (
      CITY_STATES.has(place.iso2) ||
      DISTRICTS.has(place.name) ||
      (REGION_CITIES.has(spelling(host.name)) && host.admin1 === place.admin1) ||
      // China's cities are all in the UN's list, so one that isn't is a district of its neighbour.
      (place.iso2 === 'CN' && !metroOf.has(place.id)) ||
      (types.get(place.id) ?? []).some((t) => DISTRICT_TYPE.test(t))
    );
  };
  const placeNames = new Map<string, Map<string, number>>();
  for (const list of geonames.values()) {
    for (const g of list) {
      const names = placeNames.get(g.iso2) ?? new Map<string, number>();
      names.set(normalizeName(g.name), g.id);
      placeNames.set(g.iso2, names);
    }
  }
  const proper = properPlaces.flatMap((g) => {
    const country = countryByIso.get(g.iso2);
    const key = `${g.iso2}:${g.name}`;
    if (!country || isCityPart(g) || PROPER_DROP.has(key)) return [];
    const metro = metroOf.get(g.id);
    const population = PROPER_POPULATION[key] ?? Math.min(g.population, metro?.metrics.population!.value ?? Infinity);
    if (population < MIN_POPULATION) return [];
    // The English name the metro entry settled on (Roma → Rome, Köln → Cologne), unless it
    // names the whole area ("Fukuoka–Kitakyushu"); otherwise Wikidata's respelling.
    const en = english.get(g.id);
    const name =
      metro?.localName && !/[–/]/.test(metro.name) ? metro.name : en && isEnglishForm(g, en) ? en : g.name.replace(/-si$/, '');
    const own = ownCity.get(g.id);
    const labels = byGeonames.get(g.id)?.labels ?? [];
    // A metro entry's aliases also hold the places it absorbed; those are cities of their own here.
    const others = placeNames.get(g.iso2)!;
    const aliases = [...new Set([g.name, own?.name, en, ...(own?.aliases ?? []), ...labels])].filter(
      (a): a is string =>
        !!a && a !== name && a.length > 2 && !/[,()]/.test(a) && (others.get(normalizeName(a)) ?? g.id) === g.id,
    );
    return [{ id: `gn-${g.id}`, name, countryId: country.id, aliases, population, lat: g.lat, lng: g.lng }];
  });
  proper.sort((a, b) => b.population - a.population);
  const { ranks: properRanks, missing: properMissing } = rankTourism(proper);
  console.log(
    `city proper: ${proper.length} cities (${properPlaces.length - proper.length} parts of cities or too small dropped); most visited matched: ${Object.keys(properRanks).length}; not in it: ${properMissing.join(', ')}`,
  );
  const cityProper: CityProperData = {
    tourismRank: Object.fromEntries(Object.entries(properRanks).sort((a, b) => a[1] - b[1])),
    cities: proper.map((c) => {
      const row: SmallCity = [c.id, c.name, c.countryId, c.population, round(c.lat, 4), round(c.lng, 4)];
      if (c.aliases.length) row[6] = c.aliases;
      return row;
    }),
  };

  const unusedOverrides = Object.keys(overrides).filter((id) => !overrides[id]!.exclude && !cities.some((c) => c.id === id));
  if (unusedOverrides.length) console.log(`overrides for cities now covered by WUP 2018 (unused): ${unusedOverrides.length}`);

  const dataset: CityDataset = { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sources: SOURCES, cities };
  const { errors, warnings } = validateCities(dataset, countries);
  if (warnings.length) console.warn(`warn: ${warnings.length} validation warnings, e.g. ${warnings.slice(0, 3).join('; ')}`);
  if (errors.length) {
    errors.forEach((e) => console.error(`error: ${e}`));
    process.exit(1);
  }

  await writeFiles(dataset, countries, tourism, cityProper);
  console.log(`unverified small cities (excluded from games by default): ${unverified.length}`);
  console.log(`wrote ${cities.length} cities (>= ${MIN_POPULATION.toLocaleString('en')}) to ${OUT_DIR}`);
}

/**
 * Runs a query on the Wikidata Query Service. It times out under load (an
 * HTTP 504, or an error appended to a cut-off response), so it retries.
 */
async function sparql<T>(query: string, attempts = 3): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(WIKIDATA_SPARQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          'User-Agent': 'GeoGames data build (geography games)',
        },
        body: 'query=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${WIKIDATA_SPARQL} -> HTTP ${res.status}`);
      return ((await res.json()) as { results: { bindings: T[] } }).results.bindings;
    } catch (e) {
      if (attempt >= attempts) throw e;
      console.log(`  wikidata attempt ${attempt} failed (${(e as Error).message.slice(0, 60)}), retrying`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/**
 * English Wikidata labels of the places with these GeoNames IDs, queried in
 * batches and cached in .cache/ like the other sources.
 */
async function wikidataEnglish(geonamesIds: readonly number[]): Promise<Map<number, string>> {
  const file = join(CACHE, 'wikidata-english.json');
  if (OFFLINE) {
    if (!existsSync(file)) throw new Error(`--offline: missing cache file ${file}`);
    return new Map(Object.entries(JSON.parse(await readFile(file, 'utf8')) as Record<string, string>).map(([g, en]) => [Number(g), en]));
  }
  console.log(`fetch ${WIKIDATA_SPARQL} (English names of ${geonamesIds.length} places)`);
  const english: Record<string, string> = {};
  for (let i = 0; i < geonamesIds.length; i += WIKIDATA_BATCH) {
    const values = geonamesIds.slice(i, i + WIKIDATA_BATCH).map((id) => `"${id}"`).join(' ');
    const query = `SELECT ?g ?en WHERE { VALUES ?g { ${values} } ?item wdt:P1566 ?g . ?item rdfs:label ?en FILTER(LANG(?en) = "en") }`;
    const bindings = await sparql<{ g: { value: string }; en: { value: string } }>(query);
    // A GeoNames ID linked from several items (a city and its municipality) keeps the first label.
    for (const { g, en } of bindings) english[g.value] ??= en.value;
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(english));
  return new Map(Object.entries(english).map(([g, en]) => [Number(g), en]));
}

/** Wikidata's "instance of" labels of the places with these GeoNames IDs, cached in .cache/ like the other sources. */
async function wikidataTypes(geonamesIds: readonly number[]): Promise<Map<number, string[]>> {
  const file = join(CACHE, 'wikidata-place-types.json');
  let types: Record<string, string[]> = {};
  if (OFFLINE) {
    if (!existsSync(file)) throw new Error(`--offline: missing cache file ${file}`);
    types = JSON.parse(await readFile(file, 'utf8')) as Record<string, string[]>;
  } else {
    console.log(`fetch ${WIKIDATA_SPARQL} (types of ${geonamesIds.length} places)`);
    for (let i = 0; i < geonamesIds.length; i += WIKIDATA_BATCH) {
      const values = geonamesIds.slice(i, i + WIKIDATA_BATCH).map((id) => `"${id}"`).join(' ');
      const query = `SELECT ?g ?label WHERE { VALUES ?g { ${values} } ?item wdt:P1566 ?g ; wdt:P31 ?t . ?t rdfs:label ?label FILTER(LANG(?label) = "en") }`;
      for (const { g, label } of await sparql<{ g: { value: string }; label: { value: string } }>(query)) {
        (types[g.value] ??= []).push(label.value);
      }
    }
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(types));
  }
  return new Map(Object.entries(types).map(([g, labels]) => [Number(g), labels]));
}

interface WikidataPlace {
  en: string;
  /** Labels in ALIAS_LANGUAGES. */
  labels: string[];
  lat: number;
  lng: number;
  geonames: number[];
}

/**
 * Settlements on Wikidata with an English label and one in ALIAS_LANGUAGES
 * (all settlements of this size in one query exceed Wikidata's 60 s limit),
 * cached in .cache/ like the other sources (--offline reads the cache only).
 */
async function wikidataPlaces(): Promise<WikidataPlace[]> {
  const file = join(CACHE, `wikidata-places-${ALIAS_LANGUAGES.join('-')}.json`);
  if (OFFLINE) {
    if (!existsSync(file)) throw new Error(`--offline: missing cache file ${file}`);
    return JSON.parse(await readFile(file, 'utf8')) as WikidataPlace[];
  }
  console.log(`fetch ${WIKIDATA_SPARQL}`);
  const langs = ALIAS_LANGUAGES.map((l) => JSON.stringify(l)).join(', ');
  // One row per label × GeoNames ID; grouped here, as GROUP BY on the server times out.
  const query = `SELECT ?item ?en ?coord ?label ?g WHERE {
    ?item wdt:P1082 ?pop . FILTER(?pop >= ${WIKIDATA_MIN_POPULATION})
    ?item wdt:P625 ?coord .
    ?item rdfs:label ?en FILTER(LANG(?en) = "en")
    ?item rdfs:label ?label FILTER(LANG(?label) IN (${langs}))
    OPTIONAL { ?item wdt:P1566 ?g }
  }`;
  type Value = { value: string };
  let bindings: { item: Value; en: Value; coord: Value; label: Value; g?: Value }[];
  try {
    bindings = await sparql(query);
  } catch (e) {
    // This one big query often hits Wikidata's time limit; these names hardly change between builds.
    if (!existsSync(file)) throw e;
    console.warn(`warn: wikidata settlements query failed (${(e as Error).message.slice(0, 60)}), using ${file}`);
    return JSON.parse(await readFile(file, 'utf8')) as WikidataPlace[];
  }
  const byItem = new Map<string, WikidataPlace>();
  for (const b of bindings) {
    const point = /Point\(([-\d.e]+) ([-\d.e]+)\)/.exec(b.coord.value);
    if (!point) continue; // coordinates on another globe
    let place = byItem.get(b.item.value);
    if (!place) {
      place = { en: b.en.value, labels: [], lat: Number(point[2]), lng: Number(point[1]), geonames: [] };
      byItem.set(b.item.value, place);
    }
    if (!place.labels.includes(b.label.value)) place.labels.push(b.label.value);
    const g = b.g ? Number(b.g.value) : NaN;
    if (Number.isInteger(g) && !place.geonames.includes(g)) place.geonames.push(g);
  }
  const places = [...byItem.values()];
  console.log(`wikidata settlements with ${ALIAS_LANGUAGES.join(', ')} names: ${places.length}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(places));
  return places;
}

const toLines = (cities: City[]) => `[\n${cities.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`;

async function writeFiles(dataset: CityDataset, countries: Dataset, tourism: Record<string, number>, cityProper: CityProperData) {
  const continentOf = new Map(countries.countries.map((c) => [c.id, c.continent]));
  const byContinent = new Map<Continent, City[]>();
  for (const city of dataset.cities) {
    const continent = continentOf.get(city.countryId)!;
    const list = byContinent.get(continent) ?? [];
    list.push(city);
    byContinent.set(continent, list);
  }
  const major = dataset.cities.filter((c) => c.metrics.population!.value >= MAJOR_MIN_POPULATION);

  // Write everything first and only then drop stale files, so a running dev
  // server never sees the folder half-empty.
  await mkdir(OUT_DIR, { recursive: true });
  const written = new Set<string>();
  const write = async (file: string, content: string) => {
    await writeFile(join(OUT_DIR, file), content);
    written.add(file);
  };
  await write('major.json', toLines(major));
  const small = dataset.cities
    .filter((c) => isPlayable(c) && c.metrics.population!.value < MAJOR_MIN_POPULATION)
    .map((c): SmallCity => {
      const row: SmallCity = [c.id, c.name, c.countryId, c.metrics.population!.value, c.latlng[0], c.latlng[1]];
      if (c.aliases.length) row[6] = c.aliases;
      return row;
    });
  await write('small-cities.json', JSON.stringify(small) + '\n');
  await write('city-proper.json', JSON.stringify(cityProper) + '\n');
  for (const [continent, list] of byContinent) {
    await write(`${continentSlug(continent)}.json`, toLines(list));
  }

  const counts = (list: City[]) =>
    Object.fromEntries(
      CITY_SIZE_STOPS.map((min) => [min, list.filter((c) => isPlayable(c) && c.metrics.population!.value >= min).length]),
    );
  const index: CityIndex = {
    schemaVersion: dataset.schemaVersion,
    generatedAt: dataset.generatedAt,
    sources: dataset.sources,
    minPopulation: MIN_POPULATION,
    majorMinPopulation: MAJOR_MIN_POPULATION,
    files: {
      major: major.length,
      ...Object.fromEntries([...byContinent].map(([c, list]) => [continentSlug(c), list.length])),
    },
    playableCounts: {
      world: counts(dataset.cities),
      ...Object.fromEntries([...byContinent].map(([c, list]) => [continentSlug(c), counts(list)])),
    },
    tourismRank: Object.fromEntries(Object.entries(tourism).sort((a, b) => a[1] - b[1])),
  };
  await write('index.json', JSON.stringify(index, null, 2) + '\n');
  for (const f of await readdir(OUT_DIR)) if (!written.has(f)) await rm(join(OUT_DIR, f));
}

await main();
