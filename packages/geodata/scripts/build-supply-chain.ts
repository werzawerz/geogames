// Builds data/supply-chain.json for Supply Chain: the world's top producers of farm goods, minerals and energy.
//
//   node scripts/build-supply-chain.ts --faostat <csv> --eia <INTL.txt> [--usgs <dir>] [--check]
//
// Sources (all downloaded by hand or by this script's usgs step; none is a dependency):
// - FAOSTAT "Production_Crops_Livestock_E_All_Data_(Normalized).csv", from
//   https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip
//   (UN FAO, CC BY 4.0). Production in tonnes, the average of 2022-2024, so one bad harvest doesn't decide.
// - EIA international data bulk file https://www.eia.gov/opendata/bulk/INTL.zip (US Energy Information
//   Administration, US public domain). Annual series, 2024.
// - USGS Mineral Commodity Summaries 2026, one PDF per commodity,
//   https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-<slug>.pdf (US public domain). The "World Mine
//   Production" table, 2024 column. The PDFs are read with xpdf's `pdftotext -table`, which glues footnote
//   marks onto numbers, so every commodity's rows are summed and compared with the table's world total,
//   and any that disagree need a hand fix below (with the reason). Pass --usgs <dir> to read PDFs saved
//   there as <slug>.pdf, or leave it out to download them into .cache.
//
// Every figure is read from these tables; none is typed in. Only the choice of commodities, their names,
// tiers and the footnote fixes are by hand.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT, CACHE } from './lib/fetch.ts';
import type { Commodity, Producer, SupplyChainData } from '../src/supply-chain.ts';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FAO_FILE = arg('--faostat');
const EIA_FILE = arg('--eia');
const USGS_DIR = arg('--usgs');

const countries: {
  id: string;
  iso2: string;
  isoNumeric: string | null;
  name: string;
  officialName: string;
  aliases: string[];
  sovereignty: string;
}[] = JSON.parse(await readFile(join(ROOT, 'data', 'countries.json'), 'utf8')).countries;
// Dependencies (New Caledonia, Hong Kong) are ranked too, so a dependency that out-produces a country is never
// skipped over; the game only asks for ranks that stop above the first of them (see supplyAnswers).
const byNumeric = new Map(countries.filter((c) => c.isoNumeric).map((c) => [String(Number(c.isoNumeric)), c.id]));
const ids = new Set(countries.map((c) => c.id));

const TOP = 10;
const FAO_YEARS = [2022, 2023, 2024];
const ENERGY_YEAR = 2024;

/** Tier 1: a famous good with famous leaders. 2: players have to know who really makes it. 3: niche or regional. */
type Tier = 1 | 2 | 3;

// ---- Farm goods: FAOSTAT item codes (Production_Crops_Livestock_E_ItemCodes.csv) ----------------------
// [id, FAO item code, name as shown, tier]. The name reads after "the most": "Which countries make the most ___?"
const FARM: [string, number, string, Tier][] = [
  ['coffee', 656, 'coffee', 1],
  ['cocoa', 661, 'cocoa beans', 2],
  ['rice', 27, 'rice', 1],
  ['wheat', 15, 'wheat', 1],
  ['maize', 56, 'maize (corn)', 1],
  ['soya', 236, 'soya beans', 1],
  ['bananas', 486, 'bananas', 1],
  ['tea', 667, 'tea', 1],
  ['sugar-cane', 156, 'sugar cane', 1],
  ['potatoes', 116, 'potatoes', 1],
  ['grapes', 560, 'grapes', 1],
  ['olives', 260, 'olives', 1],
  ['apples', 515, 'apples', 1],
  ['oranges', 490, 'oranges', 1],
  ['beef', 867, 'beef', 1],
  ['chicken', 1058, 'chicken meat', 1],
  ['pork', 1035, 'pork', 1],
  ['cow-milk', 882, 'cow’s milk', 1],
  ['tobacco', 826, 'tobacco', 1],
  ['cotton', 328, 'cotton (unginned)', 1],
  ['eggs', 1062, 'hen eggs', 2],
  ['rubber', 836, 'natural rubber', 2],
  ['palm-oil', 254, 'oil palm fruit (palm oil)', 2],
  ['honey', 1182, 'honey', 2],
  ['barley', 44, 'barley', 2],
  ['sunflower', 267, 'sunflower seeds', 2],
  ['rapeseed', 270, 'rapeseed (canola)', 2],
  ['groundnuts', 242, 'groundnuts (peanuts)', 2],
  ['cassava', 125, 'cassava', 2],
  ['sorghum', 83, 'sorghum', 2],
  ['sheep-meat', 977, 'mutton and lamb', 2],
  ['tomatoes', 388, 'tomatoes', 2],
  ['mangoes', 571, 'mangoes', 2],
  ['pineapples', 574, 'pineapples', 2],
  ['coconuts', 249, 'coconuts', 2],
  ['cashews', 217, 'cashew nuts', 2],
  ['dates', 577, 'dates', 2],
  ['avocados', 572, 'avocados', 2],
  ['lemons', 497, 'lemons and limes', 2],
  ['almonds', 221, 'almonds', 2],
  ['walnuts', 222, 'walnuts', 2],
  ['pistachios', 223, 'pistachios', 2],
  ['hazelnuts', 225, 'hazelnuts', 2],
  ['strawberries', 544, 'strawberries', 2],
  ['onions', 403, 'dry onions', 2],

  ['vanilla', 692, 'vanilla', 3],
  ['cloves', 698, 'cloves', 3],
  ['cinnamon', 693, 'cinnamon and cassia', 3],
  ['ginger', 720, 'ginger', 3],
  ['nutmeg', 702, 'cardamom and nutmeg', 3],
  ['quinoa', 92, 'quinoa', 3],
  ['brazil-nuts', 216, 'Brazil nuts', 3],
  ['wool', 987, 'wool', 3],
  ['figs', 569, 'figs', 3],
  ['kiwi', 592, 'kiwi fruit', 3],
  ['blueberries', 552, 'blueberries', 3],
  ['lentils', 201, 'lentils', 3],
  ['chickpeas', 191, 'chickpeas', 3],
  ['sesame', 289, 'sesame seeds', 3],
  ['rye', 71, 'rye', 3],
  ['oats', 75, 'oats', 3],
  ['millet', 79, 'millet', 3],
  ['papayas', 600, 'papayas', 3],
  ['mushrooms', 449, 'mushrooms and truffles', 3],
  ['cherries', 531, 'cherries', 3],
  ['peaches', 534, 'peaches and nectarines', 3],
];

/**
 * FAOSTAT figures left out by hand, as `item code:country`. FAOSTAT flags many figures as imputed (I), including
 * China's for most goods, so the flag can't be the test; these are the ones that are plainly wrong.
 * - Central African Republic coffee (656): FAOSTAT has about 310 thousand tonnes (10th in the world, 2.8%); national and
 *   ICO figures are about 10 thousand tonnes. The 2024 figure is imputed from an earlier year that looks like a unit error.
 */
const BOGUS = new Set(['656:CAF']);

/** Farm goods that are animal products, or tapped: "produce" rather than "grow". */
const ANIMAL = new Set(['beef', 'chicken', 'pork', 'cow-milk', 'eggs', 'honey', 'sheep-meat', 'wool', 'rubber']);

// ---- Minerals: USGS MCS 2026 slugs ----------------------------------------------------------------
interface Mineral {
  id: string;
  slug: string;
  name: string;
  tier: Tier;
  unit: string;
  /** Hand fixes: country id → value, where `pdftotext` glued a footnote mark onto the number. */
  fix?: Record<string, number>;
  /** The world total, where a footnote mark is glued onto it. */
  total?: number;
  /** Which value column (0-based) holds 2024, where the table has several (crude steel is the third). */
  col?: number;
}
const MINE: Mineral[] = [
  // Argentina and Chile carry footnote 5 (read as 513,800 and 548,900), and the total footnote 8; the rows then sum to the total.
  {
    id: 'lithium',
    slug: 'lithium',
    name: 'lithium',
    tier: 2,
    unit: 'tonnes of lithium content',
    fix: { ARG: 13800, CHL: 48900 },
    total: 222000,
  },
  {
    id: 'cobalt',
    slug: 'cobalt',
    name: 'cobalt',
    tier: 2,
    unit: 'tonnes of cobalt content',
  },
  {
    id: 'copper',
    slug: 'copper',
    name: 'copper',
    tier: 1,
    unit: 'thousand tonnes of copper content',
  },
  {
    id: 'nickel',
    slug: 'nickel',
    name: 'nickel',
    tier: 2,
    unit: 'tonnes of nickel content',
  },
  {
    id: 'iron-ore',
    slug: 'iron-ore',
    name: 'iron ore',
    tier: 1,
    unit: 'thousand tonnes of usable ore',
  },
  {
    id: 'bauxite',
    slug: 'bauxite-alumina',
    name: 'bauxite (aluminium ore)',
    tier: 2,
    unit: 'thousand tonnes',
  },
  { id: 'gold', slug: 'gold', name: 'gold', tier: 1, unit: 'tonnes' },
  { id: 'silver', slug: 'silver', name: 'silver', tier: 2, unit: 'tonnes' },
  // Footnotes 11 and 12 are glued to the United States, Madagascar, Malaysia, Thailand and Vietnam; with them off the rows sum to the 380,000 total.
  {
    id: 'rare-earths',
    slug: 'rare-earths',
    name: 'rare earths',
    tier: 2,
    unit: 'tonnes of rare-earth oxide',
    fix: { USA: 45500, MMR: 27000, MDG: 1400, MYS: 140, THA: 2100, VNM: 300 },
  },
  {
    id: 'graphite',
    slug: 'graphite',
    name: 'natural graphite',
    tier: 3,
    unit: 'tonnes',
  },
  {
    id: 'tin',
    slug: 'tin',
    name: 'tin',
    tier: 3,
    unit: 'tonnes of tin content',
  },
  {
    id: 'zinc',
    slug: 'zinc',
    name: 'zinc',
    tier: 2,
    unit: 'thousand tonnes of zinc content',
  },
  {
    id: 'lead',
    slug: 'lead',
    name: 'lead',
    tier: 3,
    unit: 'thousand tonnes of lead content',
  },
  {
    id: 'manganese',
    slug: 'manganese',
    name: 'manganese',
    tier: 3,
    unit: 'thousand tonnes of manganese content',
  },
  {
    id: 'tungsten',
    slug: 'tungsten',
    name: 'tungsten',
    tier: 3,
    unit: 'tonnes of tungsten content',
  },
  // Footnote 5 is glued to the United States and Canada (540,400 and 510,600); the rows then sum to the 275,000 total.
  {
    id: 'salt',
    slug: 'salt',
    name: 'salt',
    tier: 2,
    unit: 'thousand tonnes',
    fix: { USA: 40400, CAN: 10600 },
  },
  {
    id: 'potash',
    slug: 'potash',
    name: 'potash (fertiliser)',
    tier: 3,
    unit: 'thousand tonnes of K2O',
  },
  {
    id: 'phosphate',
    slug: 'phosphate',
    name: 'phosphate rock',
    tier: 3,
    unit: 'thousand tonnes',
  },
  {
    id: 'sulfur',
    slug: 'sulfur',
    name: 'sulphur',
    tier: 3,
    unit: 'thousand tonnes',
  },
  {
    id: 'molybdenum',
    slug: 'molybdenum',
    name: 'molybdenum',
    tier: 3,
    unit: 'tonnes of molybdenum content',
  },
  {
    id: 'chromium',
    slug: 'chromium',
    name: 'chromium (chromite)',
    tier: 3,
    unit: 'thousand tonnes',
  },
  {
    id: 'vanadium',
    slug: 'vanadium',
    name: 'vanadium',
    tier: 3,
    unit: 'tonnes of vanadium content',
  },
  {
    id: 'niobium',
    slug: 'niobium',
    name: 'niobium',
    tier: 3,
    unit: 'tonnes of niobium content',
  },
  {
    id: 'antimony',
    slug: 'antimony',
    name: 'antimony',
    tier: 3,
    unit: 'tonnes of antimony content',
  },
  {
    id: 'diamonds',
    slug: 'diamond',
    name: 'industrial diamonds',
    tier: 3,
    unit: 'million carats',
  },
  {
    id: 'aluminium',
    slug: 'aluminum',
    name: 'aluminium',
    tier: 2,
    unit: 'thousand tonnes (smelter)',
  },
  {
    id: 'steel',
    slug: 'iron-steel',
    name: 'crude steel',
    tier: 1,
    unit: 'million tonnes',
    col: 2,
  },
  // The table's row reads "United States (includes Puerto Rico)", which the label reader splits; 85,000 is its 2024 figure.
  {
    id: 'cement',
    slug: 'cement',
    name: 'cement',
    tier: 2,
    unit: 'thousand tonnes',
    fix: { USA: 85000 },
  },
];

// ---- Energy: EIA international series --------------------------------------------------------------
// [id, product-activity, unit code, name, tier, unit]
// [id, product-activity, EIA unit code, name, tier, verb, unit shown, divisor from the EIA unit]
// Conversions: thousand barrels a day / 1000 = million barrels a day; EIA's own billion cubic metres series is
// used for gas; thousand short tons / 1000 = million short tons; billion kilowatt-hours are terawatt-hours.
const ENERGY: [string, string, string, string, Tier, string, string, number][] = [
  ['oil', '57-1', 'TBPD', 'crude oil', 1, 'produce', 'million barrels a day', 1000],
  ['gas', '26-1', 'BCM', 'natural gas', 1, 'produce', 'billion cubic metres', 1],
  ['coal', '7-1', 'TST', 'coal', 1, 'mine', 'million short tons', 1000],
  ['hydro', '33-12', 'BKWH', 'hydroelectric power', 2, 'generate', 'terawatt-hours', 1],
  ['wind', '37-12', 'BKWH', 'wind power', 2, 'generate', 'terawatt-hours', 1],
  ['solar', '36-12', 'BKWH', 'solar power', 2, 'generate', 'terawatt-hours', 1],
  ['nuclear', '27-12', 'BKWH', 'nuclear power', 2, 'generate', 'terawatt-hours', 1],
  ['geothermal', '35-12', 'BKWH', 'geothermal power', 3, 'generate', 'terawatt-hours', 1],
];

const SOURCES = {
  faostat: {
    name: 'FAOSTAT (UN FAO)',
    url: 'https://www.fao.org/faostat/en/#data/QCL',
    licence: 'CC BY 4.0',
    year: '2022–24 average',
  },
  usgs: {
    name: 'USGS Mineral Commodity Summaries 2026',
    url: 'https://pubs.usgs.gov/periodicals/mcs2026/',
    licence: 'US public domain',
    year: '2024',
  },
  eia: {
    name: 'EIA (US Energy Information Administration)',
    url: 'https://www.eia.gov/international/data/world',
    licence: 'US public domain',
    year: '2024',
  },
};

/** Rows under this share of the world are left out: they are noise (Madagascar's pistachios), not producers. */
const MIN_LISTED_SHARE = 0.005;

/** The ten biggest, with shares of `world` (same unit as `values`); `divisor` converts the figures to the unit shown. */
function toProducers(values: Map<string, number>, world: number, divisor = 1, decimals = 2): Producer[] {
  const k = 10 ** decimals;
  return [...values]
    .filter(([id, v]) => ids.has(id) && v / world >= MIN_LISTED_SHARE)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP)
    .map(([id, value]) => ({
      id,
      value: Math.round((value / divisor) * k) / k,
      share: Math.round((value / world) * 10000) / 10000,
    }));
}

// ---- FAOSTAT ---------------------------------------------------------------------------------------
async function farm(): Promise<Commodity[]> {
  if (!FAO_FILE) throw new Error('--faostat <csv> needed');
  const wanted = new Map(FARM.map(([id, code, name, tier]) => [code, { id, name, tier }]));
  // item code → area key → year → tonnes. Element 5510 is production in tonnes; milk, eggs and meat all report it.
  const data = new Map<number, Map<string, Map<number, number>>>();
  const unmapped = new Map<string, number>();
  const rl = createInterface({
    input: createReadStream(FAO_FILE, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    // Cheap pre-filter: production in tonnes, one of the three years.
    if (!line.includes('"5510"') || !/"202[234]"/.test(line)) continue;
    const f = line.split('","').map((s) => s.replace(/^"|"$/g, ''));
    const [areaCode, m49, area, itemCode, , , elementCode, , , year, , value] = f;
    if (elementCode !== '5510') continue;
    const item = Number(itemCode);
    if (!wanted.has(item) || !FAO_YEARS.includes(Number(year)) || value === '') continue;
    const code = Number(areaCode);
    let key: string | undefined;
    if (code === 5000) key = 'WORLD';
    else if (code >= 5000)
      continue; // regions
    else if (code === 351)
      continue; // "China" as a whole, which already contains mainland China, Hong Kong, Macao and Taiwan
    else {
      key = byNumeric.get(String(Number((m49 ?? '').replace("'", ''))));
      if (!key) {
        unmapped.set(area!, (unmapped.get(area!) ?? 0) + 1);
        continue;
      }
    }
    if (BOGUS.has(`${item}:${key}`)) continue;
    const perArea = data.get(item) ?? new Map();
    data.set(item, perArea);
    const perYear = perArea.get(key) ?? new Map();
    perArea.set(key, perYear);
    perYear.set(Number(year), Number(value));
  }
  console.log('FAO areas not mapped to a country (dependencies and history, expected):', [...unmapped.keys()].join('; '));
  const out: Commodity[] = [];
  for (const [item, { id, name, tier }] of wanted) {
    const perArea = data.get(item);
    if (!perArea) {
      console.warn(`FAO: no data for ${id} (${item})`);
      continue;
    }
    // Three years or none: a country missing a year would be averaged down.
    const mean = (m: Map<number, number>) => (FAO_YEARS.every((y) => m.has(y)) ? FAO_YEARS.reduce((s, y) => s + m.get(y)!, 0) / FAO_YEARS.length : null);
    const world = mean(perArea.get('WORLD') ?? new Map());
    if (!world) {
      console.warn(`FAO: no world total for ${id}`);
      continue;
    }
    const values = new Map<string, number>();
    for (const [key, perYear] of perArea) {
      const v = key === 'WORLD' ? null : mean(perYear);
      if (v) values.set(key, v);
    }
    const big = Math.max(...values.values()) >= 1e6;
    out.push({
      id,
      kind: 'farm',
      verb: ANIMAL.has(id) ? 'produce' : 'grow',
      name,
      tier,
      // Tonnes → million (or thousand) tonnes, so the figures read at a glance.
      unit: big ? 'million tonnes' : 'thousand tonnes',
      source: 'faostat',
      year: SOURCES.faostat.year,
      producers: toProducers(values, world, big ? 1e6 : 1e3, 4),
    });
  }
  return out;
}

// ---- EIA -------------------------------------------------------------------------------------------
async function energy(): Promise<Commodity[]> {
  if (!EIA_FILE) throw new Error('--eia <INTL.txt> needed');
  const text = await readFile(EIA_FILE, 'utf8');
  const lines = text.split('\n');
  const out: Commodity[] = [];
  for (const [id, series, unitCode, name, tier, verb, unit, divisor] of ENERGY) {
    const prefix = `{"series_id":"INTL.${series}-`;
    const values = new Map<string, number>();
    let world = 0;
    for (const line of lines) {
      if (!line.startsWith(prefix)) continue;
      const m = line.match(/^\{"series_id":"INTL\.[\d-]+-([A-Z]+)-([A-Z]+)\.A"/);
      if (!m || m[2] !== unitCode) continue;
      const row = JSON.parse(line) as {
        data: [string, number | string | null][];
      };
      const v = Number(row.data.find(([y]) => y === String(ENERGY_YEAR))?.[1]);
      if (!Number.isFinite(v)) continue;
      if (m[1] === 'WORL') world = v;
      else if (ids.has(m[1]!)) values.set(m[1]!, v);
    }
    if (!world || !values.size) {
      console.warn(`EIA: no data for ${id} (${series} ${unitCode})`);
      continue;
    }
    out.push({
      id,
      kind: 'energy',
      verb,
      name,
      tier,
      unit,
      source: 'eia',
      year: SOURCES.eia.year,
      producers: toProducers(values, world, divisor, 2),
    });
  }
  return out;
}

// ---- USGS ------------------------------------------------------------------------------------------
/** Names the MCS tables use for countries, where the country list has another. */
const USGS_NAMES: Record<string, string> = {
  'Congo (Kinshasa)': 'COD',
  'Congo (Brazzaville)': 'COG',
  Burma: 'MMR',
  'Korea, North': 'PRK',
  'Korea, Republic of': 'KOR',
  'Korea, South': 'KOR',
  Turkey: 'TUR',
  Türkiye: 'TUR',
  Russia: 'RUS',
  Vietnam: 'VNM',
  Iran: 'IRN',
  Laos: 'LAO',
  Eswatini: 'SWZ',
  Czechia: 'CZE',
  'North Macedonia': 'MKD',
  'Cote d’Ivoire': 'CIV',
  "Cote d'Ivoire": 'CIV',
  'United States': 'USA',
  'United Kingdom': 'GBR',
};
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const byName = new Map<string, string>();
for (const c of countries) for (const n of [c.name, c.officialName, ...c.aliases]) byName.set(norm(n), c.id);
const usgsCountry = (label: string) => USGS_NAMES[label] ?? byName.get(norm(label));

const num = (t: string): number | null | undefined => {
  // "W" withheld, "--" zero, "NA"/"XX" not available: none is a number to rank by.
  if (t === 'W' || t === 'NA' || t === 'XX') return null;
  if (t === '--') return 0;
  const m = t.match(/^e?(\d[\d,]*(?:\.\d+)?)$/);
  return m ? Number(m[1]!.replace(/,/g, '')) : undefined;
};

async function pdf(slug: string): Promise<string> {
  let file = USGS_DIR ? join(USGS_DIR, `${slug}.pdf`) : join(CACHE, 'usgs', `${slug}.pdf`);
  if (!existsSync(file)) {
    if (USGS_DIR) throw new Error(`missing ${file}`);
    const url = `https://pubs.usgs.gov/periodicals/mcs2026/mcs2026-${slug}.pdf`;
    console.log(`fetch ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    await mkdir(join(CACHE, 'usgs'), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return execFileSync('pdftotext', ['-table', file, '-'], {
    encoding: 'utf8',
    maxBuffer: 1e8,
  })
    .split(String.fromCharCode(13))
    .join('');
}

/** The value cells of a table row: what follows the label, or the next line when the label's own line holds only the year header. */
function cells(lines: string[], i: number, rest: string): string[] {
  const own = rest.split(/\s+/).filter(Boolean);
  // "United States1   2024" on one line, its figures on the next: the 2024 there is the column header, not a figure.
  if (own.length && own.every((t) => /^20(24|25)e?$/.test(t))) {
    const next = lines.slice(i + 1).find((l) => l.trim() !== '');
    return next && /^\s/.test(next) ? next.trim().split(/\s+/) : [];
  }
  return own;
}

/** Materials that are made, and minerals that are produced rather than mined. */
const MADE = new Set(['steel', 'aluminium', 'cement']);
const PRODUCED = new Set(['salt', 'potash', 'phosphate', 'sulfur']);

/**
 * The USGS tables give "thousand tonnes", "tonnes" and so on. This picks the unit that reads best for the biggest
 * producer (million tonnes from a million, thousand tonnes from ten thousand) and the divisor that converts the
 * table's figures to it. Carats are left as they are.
 */
function friendly(unit: string, biggest: number): { unit: string; divisor: number } {
  const m = unit.match(/^(thousand |million )?tonnes(.*)$/);
  if (!m) return { unit, divisor: 1 };
  const tonnes = biggest * (m[1] === 'thousand ' ? 1e3 : m[1] === 'million ' ? 1e6 : 1);
  const [name, divisor] = tonnes >= 1e6 ? ['million tonnes', 1e6] : tonnes >= 1e4 ? ['thousand tonnes', 1e3] : ['tonnes', 1];
  const own = m[1] === 'thousand ' ? 1e3 : m[1] === 'million ' ? 1e6 : 1;
  return { unit: name + m[2], divisor: divisor / own };
}

async function minerals(): Promise<Commodity[]> {
  const out: Commodity[] = [];
  for (const m of MINE) {
    const col = m.col ?? 0;
    const lines = (await pdf(m.slug)).split('\n');
    const start = lines.findIndex((l) => /^World .*Production/i.test(l) && !/Resources/.test(l));
    if (start < 0) throw new Error(`${m.slug}: no world production table`);
    const values = new Map<string, number>();
    const withheld: string[] = [];
    let total: number | null = null;
    let sum = 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^World total/i.test(line)) {
        const rest = line.replace(/^World total(?: \(rounded\))?\d*\s*/i, '');
        total = m.total ?? num(rest.split(/\s+/)[col]!) ?? null;
        break;
      }
      const row = line.match(/^([A-Z][A-Za-zÀ-ÿ.,()’' -]*?)(\d*)\s{2,}(\S.*)$/);
      if (!row) continue;
      const label = row[1]!.trim();
      const v = num(cells(lines, i, row[3]!)[col] ?? '');
      if (v === undefined) continue;
      if (/^Other/.test(label)) {
        sum += v ?? 0;
        continue;
      }
      const id = usgsCountry(label);
      if (!id) {
        if (!/^(Mine|World|Reserves|Production|Pig|Raw|Helium|Rare)/.test(label)) console.warn(`${m.id}: unmapped "${label}"`);
        continue;
      }
      if (v === null) {
        withheld.push(id);
        continue;
      }
      values.set(id, v);
    }
    for (const [id, v] of Object.entries(m.fix ?? {})) values.set(id, v);
    for (const v of values.values()) sum += v;
    if (!total) throw new Error(`${m.id}: no world total`);
    const off = Math.abs(sum - total) / total;
    if (off > 0.04)
      console.warn(
        `CHECK ${m.id}: rows sum to ${sum} but the world total is ${total} (${(off * 100).toFixed(1)}% off). withheld: ${withheld.join(',') || 'none'}`,
      );
    else console.log(`ok ${m.id}: sum ${sum} vs total ${total}${withheld.length ? ` withheld ${withheld.join(',')}` : ''}`);
    const shown = friendly(m.unit, Math.max(...values.values()));
    out.push({
      id: m.id,
      kind: 'mine',
      verb: MADE.has(m.id) ? 'make' : PRODUCED.has(m.id) ? 'produce' : 'mine',
      name: m.name,
      tier: m.tier,
      unit: shown.unit,
      source: 'usgs',
      year: SOURCES.usgs.year,
      producers: toProducers(values, total, shown.divisor, 2),
      ...(withheld.length ? { withheld } : {}),
    });
  }
  return out;
}

const commodities = [...(await farm()), ...(await minerals()), ...(await energy())];
if (process.argv.includes('--check')) {
  for (const c of commodities)
    console.log(
      c.id.padEnd(14),
      c.producers
        .slice(0, 6)
        .map((p) => `${p.id} ${(p.share * 100).toFixed(1)}%`)
        .join('  '),
    );
} else {
  const version = createHash('sha1')
    .update(JSON.stringify(commodities.map((c) => [c.id, c.producers.map((p) => p.id)])))
    .digest('hex')
    .slice(0, 8);
  const data: SupplyChainData = { version, sources: SOURCES, commodities };
  await writeFile(join(ROOT, 'data', 'supply-chain.json'), JSON.stringify(data) + '\n');
  await writeFile(join(ROOT, 'data', 'supply-chain-version.json'), JSON.stringify({ version }) + '\n');
  console.log(`wrote ${commodities.length} commodities, version ${version}`);
}
