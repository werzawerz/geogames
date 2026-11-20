// Builds data/regions.json for Region Run: each listed country cut into its
// first-level divisions (states, provinces, regions), as plain shapes.
//
//   node scripts/build-regions.ts [--offline]
//
// Source: Natural Earth 1:10m admin_1_states_provinces (public domain). Natural
// Earth's names are a mix of local and English ones and a few countries are cut
// finer than people know them (Italy in provinces, Spain in provinces, France in
// departments), so each country below says what to keep, what to rename and, for
// those three, which divisions to dissolve into the regions players know.
//
// A division is a target only if it is big enough to see on the map and not in
// dispute. Everything else is still drawn (a map with holes would show the
// answer's neighbours) and still answers to its name.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geoArea, geoBounds, geoCentroid, geoPath } from 'd3-geo';
import type { RegionCountry, RegionData, RegionDivision } from '../src/regions.ts';
import { regionProjection } from '../src/regions-map.ts';
import { ROOT, cachedJson, round } from './lib/fetch.ts';

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
/** A target covers at least this many square map units of the 960 × 540 map: about 20 × 20. */
const MIN_TARGET_UNITS = 450;
/** Tolerance of the simplification, in map units. */
const TOLERANCE_UNITS = 0.45;
/** Polygons (islands) smaller than this share of their country are dropped, unless they're all of a division. */
const MIN_POLYGON_SHARE = 0.00004;

type Pos = [number, number];
type Ring = Pos[];
type Poly = Ring[];

interface Props {
  name: string | null;
  name_en: string | null;
  name_alt: string | null;
  name_local: string | null;
  postal: string | null;
  type_en: string | null;
  region: string | null;
  adm0_a3: string;
  [key: string]: unknown;
}
interface NeFeature {
  properties: Props;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Poly | Poly[] };
}

interface Config {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Keep only polygons whose centre lies in [west, south, east, north]: drops far-off islands and territories. */
  clip?: [number, number, number, number];
  /** Dissolve the source's divisions by its `region` field, naming each group with `names`. */
  group?: boolean;
  /** Source name (or region, when grouped) → shown name and other names it answers to. Null drops it. */
  names?: Record<string, string[] | null>;
  /** Drawn and named, but never asked. */
  noTarget?: string[];
  /** Divisions players know better than their size says. */
  famous?: string[];
}

const C = (id: string, name: string, tier: 1 | 2 | 3, rest: Partial<Config> = {}): Config => ({ id, name, tier, ...rest });

const COUNTRIES: Config[] = [
  C('USA', 'United States', 1, {
    names: { 'District of Columbia': null },
    famous: ['New York', 'Florida', 'Hawaii', 'Illinois', 'Pennsylvania', 'Washington', 'Georgia', 'Louisiana', 'Massachusetts', 'Ohio', 'Michigan', 'Virginia'],
  }),
  C('CAN', 'Canada', 1, { famous: ['Nova Scotia', 'Yukon', 'Nunavut', 'Northwest Territories', 'Newfoundland and Labrador'] }),
  C('AUS', 'Australia', 1, {
    clip: [112, -45, 155, -9],
    names: {
      'Jervis Bay Territory': null, 'Lord Howe Island': null, 'Macquarie Island': null,
      'New South Wales': ['New South Wales', 'NSW'],
      Queensland: ['Queensland', 'Qld'],
      Victoria: ['Victoria', 'Vic'],
      Tasmania: ['Tasmania', 'Tas'],
      'South Australia': ['South Australia', 'SA'],
      'Western Australia': ['Western Australia', 'WA'],
      'Northern Territory': ['Northern Territory', 'NT'],
      'Australian Capital Territory': ['Australian Capital Territory', 'ACT', 'Canberra'],
    },
    famous: ['Tasmania', 'Victoria', 'Northern Territory', 'South Australia'],
  }),
  C('DEU', 'Germany', 1, { famous: ['Saxony', 'Hesse', 'Brandenburg', 'Saarland', 'Thuringia'] }),

  C('BRA', 'Brazil', 2, { famous: ['Bahia', 'Rio de Janeiro', 'Minas Gerais', 'Pernambuco', 'Amazonas'], names: { 'Distrito Federal': ['Federal District', 'Distrito Federal', 'Brasília'] } }),
  C('FRA', 'France', 2, {
    group: true,
    clip: [-6, 41, 10, 51.5],
    names: {
      'Guyane française': null, Martinique: null, Guadeloupe: null, 'Réunion': null, Mayotte: null,
      Bretagne: ['Brittany', 'Bretagne'],
      Normandie: ['Normandy', 'Normandie'],
      Corse: ['Corsica', 'Corse'],
      'Bourgogne-Franche-Comté': ['Burgundy-Franche-Comté', 'Bourgogne-Franche-Comté', 'Burgundy'],
      "Provence-Alpes-Côte-d'Azur": ["Provence-Alpes-Côte d'Azur", 'PACA', 'Provence', 'Côte d’Azur'],
      'Île-de-France': ['Île-de-France', 'Ile de France', 'Paris region'],
      'Grand Est': ['Grand Est', 'Alsace', 'Lorraine'],
      'Nouvelle-Aquitaine': ['Nouvelle-Aquitaine', 'Aquitaine'],
      Occitanie: ['Occitania', 'Occitanie'],
    },
    famous: ['Brittany', 'Normandy', 'Corsica', 'Île-de-France', 'Provence-Alpes-Côte d’Azur'],
  }),
  C('ITA', 'Italy', 2, {
    group: true,
    names: {
      "Valle d'Aosta": ['Aosta Valley', "Valle d'Aosta", 'Aosta'],
      Piemonte: ['Piedmont', 'Piemonte'],
      Lombardia: ['Lombardy', 'Lombardia'],
      'Trentino-Alto Adige': ['Trentino-Alto Adige', 'Trentino', 'South Tyrol', 'Südtirol'],
      Liguria: ['Liguria'],
      'Emilia-Romagna': ['Emilia-Romagna', 'Emilia'],
      Marche: ['Marche', 'The Marches'],
      Veneto: ['Veneto'],
      'Friuli-Venezia Giulia': ['Friuli-Venezia Giulia', 'Friuli'],
      Abruzzo: ['Abruzzo', 'Abruzzi'],
      Molise: ['Molise'],
      Apulia: ['Apulia', 'Puglia'],
      Basilicata: ['Basilicata', 'Lucania'],
      Calabria: ['Calabria'],
      Campania: ['Campania'],
      Lazio: ['Lazio', 'Latium'],
      Toscana: ['Tuscany', 'Toscana'],
      Sicily: ['Sicily', 'Sicilia'],
      Sardegna: ['Sardinia', 'Sardegna'],
      Umbria: ['Umbria'],
    },
    famous: ['Tuscany', 'Sicily', 'Sardinia', 'Lombardy', 'Lazio', 'Veneto', 'Piedmont', 'Campania'],
  }),
  C('ESP', 'Spain', 2, {
    group: true,
    clip: [-10, 35.5, 4.6, 44],
    names: {
      Ceuta: null, Melilla: null, 'Canary Is.': null,
      'Foral de Navarra': ['Navarre', 'Navarra'],
      'País Vasco': ['Basque Country', 'País Vasco', 'Euskadi'],
      Aragón: ['Aragon', 'Aragón'],
      Cataluña: ['Catalonia', 'Cataluña', 'Catalunya'],
      Extremadura: ['Extremadura'],
      Andalucía: ['Andalusia', 'Andalucía'],
      Galicia: ['Galicia'],
      'Castilla y León': ['Castile and León', 'Castilla y León', 'Castile and Leon'],
      Valenciana: ['Valencian Community', 'Valencia', 'Comunidad Valenciana'],
      Murcia: ['Murcia', 'Region of Murcia'],
      Asturias: ['Asturias'],
      Cantabria: ['Cantabria'],
      'Islas Baleares': ['Balearic Islands', 'Baleares', 'Islas Baleares'],
      'La Rioja': ['La Rioja', 'Rioja'],
      'Castilla-La Mancha': ['Castilla-La Mancha', 'Castile-La Mancha', 'La Mancha'],
      Madrid: ['Community of Madrid', 'Madrid'],
    },
    famous: ['Catalonia', 'Andalusia', 'Basque Country', 'Galicia', 'Community of Madrid', 'Balearic Islands'],
  }),
  C('MEX', 'Mexico', 2, {
    names: { 'Distrito Federal': ['Mexico City', 'Ciudad de México', 'CDMX', 'Distrito Federal'], 'México': ['State of Mexico', 'Estado de México', 'Edomex'] },
    famous: ['Yucatán', 'Jalisco', 'Quintana Roo', 'Baja California', 'Veracruz'],
  }),
  C('IND', 'India', 2, {
    // India's own map shows these; the claims are disputed, so they are drawn but never asked.
    noTarget: ['Jammu and Kashmir', 'Ladakh', 'Arunachal Pradesh'],
    names: { 'Andaman and Nicobar': ['Andaman and Nicobar Islands', 'Andaman and Nicobar', 'Andaman'], Delhi: ['Delhi', 'New Delhi', 'NCT of Delhi'] },
    famous: ['Kerala', 'Goa', 'West Bengal', 'Tamil Nadu', 'Punjab', 'Gujarat', 'Rajasthan', 'Maharashtra', 'Uttar Pradesh', 'Karnataka'],
  }),
  C('JPN', 'Japan', 2, { clip: [129, 30, 146, 46], famous: ['Hokkaidō', 'Okinawa', 'Tokyo', 'Ōsaka', 'Kyōto', 'Hiroshima', 'Nagano'] }),
  C('CHN', 'China', 2, {
    names: { 'Paracel Islands': null, 'Inner Mongol': ['Inner Mongolia', 'Nei Mongol', 'Inner Mongol'], Xizang: ['Tibet', 'Xizang'] },
    famous: ['Tibet', 'Xinjiang', 'Inner Mongolia', 'Sichuan', 'Guangdong', 'Yunnan', 'Hainan', 'Heilongjiang'],
  }),

  C('ARG', 'Argentina', 3, { clip: [-76, -56, -52, -21], names: { 'Ciudad de Buenos Aires': null, 'Buenos Aires': ['Buenos Aires Province', 'Buenos Aires', 'Provincia de Buenos Aires'] }, famous: ['Buenos Aires', 'Patagonia', 'Mendoza', 'Tierra del Fuego', 'Córdoba'] }),
  C('TUR', 'Turkey', 3, { famous: ['Istanbul', 'Ankara', 'Izmir', 'Antalya'] }),
  C('POL', 'Poland', 3, { names: { Podkarpackie: ['Subcarpathian', 'Podkarpackie'], Podlaskie: ['Podlaskie', 'Podlachian'] }, famous: ['Masovian', 'Lesser Poland', 'Pomeranian', 'Greater Poland', 'Silesian'] }),
  C('IDN', 'Indonesia', 3, {
    names: {
      'Jakarta Raya': ['Jakarta', 'Jakarta Raya', 'DKI Jakarta', 'Djakarta'],
      Yogyakarta: ['Yogyakarta', 'Daerah Istimewa Yogyakarta', 'Jogja'],
      'Sulawesi Barat': ['West Sulawesi', 'Sulawesi Barat', 'Sulbar'],
    },
    famous: ['Bali', 'Jakarta', 'Papua', 'Yogyakarta'],
  }),
  C('COL', 'Colombia', 3, { clip: [-80, -5, -66, 14] }),
  C('PER', 'Peru', 3, { names: { 'Lima Province': null, Cusco: ['Cusco', 'Cuzco', 'Qosqo'], Callao: null } }),
  C('ZAF', 'South Africa', 3, { clip: [15, -36, 34, -21], names: { 'Free State': ['Free State', 'Orange Free State', 'Vrystaat'] } }),
  C('IRN', 'Iran', 3, {}),
  C('SWE', 'Sweden', 3, { famous: ['Skåne', 'Gotland', 'Stockholm', 'Lapland'] }),
  C('NLD', 'Netherlands', 3, { clip: [3, 50.5, 7.5, 54], famous: ['Friesland', 'North Holland', 'South Holland', 'Zeeland', 'Limburg'] }),
  C('CHE', 'Switzerland', 3, {}),
  C('AUT', 'Austria', 3, {}),
  C('KOR', 'South Korea', 3, {}),
  C('NGA', 'Nigeria', 3, { famous: ['Lagos', 'Kano', 'Rivers', 'Kaduna', 'Borno'] }),
  C('EGY', 'Egypt', 3, {}),
];

/** What the country calls its divisions, for the line after an answer ("Bavaria is a state of Germany"). */
const UNITS: Record<string, string> = {
  USA: 'state', CAN: 'province or territory', AUS: 'state or territory', DEU: 'state', BRA: 'state', FRA: 'region', ITA: 'region',
  ESP: 'autonomous community', MEX: 'state', IND: 'state or territory', JPN: 'prefecture', CHN: 'province', ARG: 'province',
  TUR: 'province', POL: 'voivodeship', IDN: 'province', COL: 'department', PER: 'department', ZAF: 'province', IRN: 'province',
  SWE: 'county', NLD: 'province', CHE: 'canton', AUT: 'state', KOR: 'province', NGA: 'state', EGY: 'governorate',
};

// ---- geometry -----------------------------------------------------------------------------------

const polygonsOf = (f: NeFeature): Poly[] => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Poly] : (f.geometry.coordinates as Poly[]));

/** Planar signed area of a ring in degrees: positive when counter-clockwise (y up). */
function planarArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return a / 2;
}

const key = (p: Pos) => `${p[0]},${p[1]}`;

/** Merges the polygons of several divisions into one, by cancelling the edges two of them share. */
function dissolve(polys: Poly[]): Poly[] {
  // Exteriors counter-clockwise, holes clockwise, so a shared edge runs one way in one and back in the other.
  const edges = new Map<string, Pos[]>();
  const add = (a: Pos, b: Pos) => {
    const back = edges.get(key(b));
    const i = back?.findIndex((q) => key(q) === key(a)) ?? -1;
    if (back && i >= 0) {
      back.splice(i, 1);
      if (!back.length) edges.delete(key(b));
      return;
    }
    edges.set(key(a), [...(edges.get(key(a)) ?? []), b]);
  };
  for (const poly of polys) {
    poly.forEach((ring, k) => {
      const ccw = planarArea(ring) > 0;
      const oriented = (k === 0) === ccw ? ring : [...ring].reverse();
      for (let i = 0; i < oriented.length - 1; i++) add(oriented[i]!, oriented[i + 1]!);
    });
  }
  const rings: Ring[] = [];
  while (edges.size) {
    const [startKey, outs] = edges.entries().next().value as [string, Pos[]];
    const start = startKey.split(',').map(Number) as Pos;
    const ring: Ring = [start];
    let at = start;
    for (;;) {
      const options = edges.get(key(at));
      if (!options?.length) break;
      const next = options.shift()!;
      if (!options.length) edges.delete(key(at));
      ring.push(next);
      at = next;
      if (key(at) === startKey) break;
    }
    void outs;
    if (ring.length > 3) rings.push(ring);
  }
  const outers = rings.filter((r) => planarArea(r) > 0);
  const holes = rings.filter((r) => planarArea(r) < 0);
  const inside = (p: Pos, ring: Ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return outers.map((outer) => [outer, ...holes.filter((h) => inside(h[0]!, outer))]);
}

/** Douglas-Peucker on a ring held as an open list; keeps the ends. */
function simplify(points: Pos[], tolerance: number): Pos[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = tolerance;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A ring simplified, split at its two farthest-apart vertices so a closed loop keeps its shape. */
function simplifyRing(ring: Ring, tolerance: number): Ring | null {
  const open = ring.slice(0, -1);
  if (open.length < 4) return null;
  let far = 1;
  let best = 0;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i]![0] - open[0]![0], open[i]![1] - open[0]![1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(open.slice(0, far + 1), tolerance);
  const b = simplify([...open.slice(far), open[0]!], tolerance);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? [...out, out[0]!] : null;
}

/** d3's polygons run clockwise (exterior) on the sphere; rewinds from the counter-clockwise the source uses. */
const rewind = (poly: Poly): Poly => poly.map((ring, k) => ((planarArea(ring) > 0) === (k === 0) ? [...ring].reverse() : ring));

/** The middle of a polygon's outline box, in degrees (planar: the polygon may not be wound the way d3 wants yet). */
const centre = (poly: Poly): Pos => {
  const xs = poly[0]!.map((p) => p[0]);
  const ys = poly[0]!.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/** A ring as one flat list of integers: the first point, then the steps from each point to the next. */
function encode(ring: Ring, q: number): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring.slice(0, -1)) {
    const nx = Math.round(lng * q);
    const ny = Math.round(lat * q);
    out.push(nx - x, ny - y);
    x = nx;
    y = ny;
  }
  return out;
}

// ---- names --------------------------------------------------------------------------------------

const LATIN = /^[\p{Script=Latin}\d\s'’.\-–()/]+$/u;
const noPrefecture = (s: string) => s.replace(/ (Prefecture|Province|Region|Governorate|Voivodeship|County|State)$/i, '');

/** Other names the source gives (`name_alt`, separated by bars), the plausible ones only. */
function altNames(p: Props): string[] {
  const postal = /^(USA|CAN)$/.test(p.adm0_a3) ? p.postal : null;
  // Poland and Indonesia are known by their own names for the divisions, which the source keeps in name_alt.
  const own = /^(POL|IDN)$/.test(p.adm0_a3) ? (p.name_alt ?? '').split('|').slice(0, 2) : [];
  return [p.name_local, postal, ...own].filter((s): s is string => !!s && LATIN.test(s) && s.length <= 28);
}

// ---- build --------------------------------------------------------------------------------------

const all = await cachedJson<{ features: NeFeature[] }>('ne-admin1.geojson', SOURCE);
const countries: RegionCountry[] = [];

for (const config of COUNTRIES) {
  const features = all.features.filter((f) => f.properties.adm0_a3 === config.id);
  if (!features.length) throw new Error(`${config.id}: no features`);
  const inClip = (poly: Poly) => {
    if (!config.clip) return true;
    const [lng, lat] = centre(poly);
    const [w, s, e, n] = config.clip;
    return lng >= w && lng <= e && lat >= s && lat <= n;
  };

  // One entry per division: its shown name, other names, and polygons.
  const raw: { name: string; aliases: string[]; polys: Poly[]; key: string }[] = [];
  if (config.group) {
    const groups = new Map<string, Poly[]>();
    for (const f of features) {
      const g = f.properties.region ?? '';
      groups.set(g, [...(groups.get(g) ?? []), ...polygonsOf(f)]);
    }
    for (const [g, polys] of groups) {
      const names = config.names?.[g];
      if (names === null) continue;
      // A group the table doesn't rename keeps the source's name.
      raw.push({ name: names?.[0] ?? g, aliases: names?.slice(1) ?? [], polys: dissolve(polys), key: g });
    }
  } else {
    for (const f of features) {
      const p = f.properties;
      if (!p.name && !p.name_en) continue;
      const names = config.names?.[p.name ?? ''];
      if (names === null) continue;
      const base = noPrefecture(p.name_en ?? p.name!);
      const shown = names?.[0] ?? base;
      const aliases = names ? names.slice(1) : [p.name!, ...altNames(p)];
      raw.push({ name: shown, aliases: [...aliases, ...(names ? [] : [])], polys: polygonsOf(f), key: p.name ?? shown });
    }
  }

  // Cut to the clip, and drop specks.
  const total = raw.reduce((sum, d) => sum + d.polys.reduce((s, p) => s + geoArea({ type: 'Polygon', coordinates: rewind(p) }), 0), 0);
  const kept = raw.flatMap((d) => {
    const inside = d.polys.filter(inClip);
    if (!inside.length) return [];
    const big = inside.filter((p) => geoArea({ type: 'Polygon', coordinates: rewind(p) }) >= total * MIN_POLYGON_SHARE);
    const polys = (big.length ? big : [inside.reduce((a, b) => (geoArea({ type: 'Polygon', coordinates: rewind(b) }) > geoArea({ type: 'Polygon', coordinates: rewind(a) }) ? b : a))]).map(rewind);
    return [{ ...d, polys }];
  });
  if (kept.length < 5) throw new Error(`${config.id}: only ${kept.length} divisions`);

  // Names must be told apart: a name another division here uses is no alias.
  const labels = new Set(kept.map((d) => d.name.toLowerCase()));
  // An alias two divisions share (Jawa, Rhio) names neither: it's dropped from both.
  const aliasCount = new Map<string, number>();
  for (const d of kept) for (const a of new Set(d.aliases.map((x) => x.toLowerCase()))) aliasCount.set(a, (aliasCount.get(a) ?? 0) + 1);
  const dup = kept.map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) console.warn(`${config.id}: DUPLICATE names ${dup.join(', ')}`);

  // The map's frame decides what is big enough to see.
  const collection = { type: 'FeatureCollection' as const, features: kept.map((d) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiPolygon' as const, coordinates: d.polys } })) };
  const projection = regionProjection(config.id, collection);
  const path = geoPath(projection);
  const units = kept.map((d) => path.area({ type: 'MultiPolygon', coordinates: d.polys }));

  const [[w, s], [e, n]] = geoBounds(collection);
  const lngSpan = (e >= w ? e - w : e + 360 - w) * Math.cos((((s + n) / 2) * Math.PI) / 180);
  const q = Math.max(lngSpan, n - s) < 14 ? 1000 : 100;
  const tolerance = (Math.max(lngSpan, n - s) / 860) * TOLERANCE_UNITS;

  const targetable = kept.map((d, i) => units[i]! >= MIN_TARGET_UNITS && !config.noTarget?.includes(d.name));
  // Fame is the share of the country's targets a division is bigger than; the well-known ones are lifted.
  const order = kept.map((_, i) => i).filter((i) => targetable[i]).sort((a, b) => units[a]! - units[b]!);
  const fameOf = (i: number) => (order.length > 1 ? order.indexOf(i) / (order.length - 1) : 1);

  const divisions: RegionDivision[] = kept.map((d, i) => {
    const famous = config.famous?.includes(d.name) ?? false;
    const poly = d.polys.flatMap((p) => {
      const rings = p.map((r) => simplifyRing(r, tolerance)).filter((r): r is Ring => !!r);
      return rings.length ? [rings.map((r) => encode(r, q))] : [];
    });
    return {
      id: `${config.id}-${d.key.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      name: d.name,
      aliases: [...new Set(d.aliases.filter((a) => a && !labels.has(a.toLowerCase()) && a !== d.name && aliasCount.get(a.toLowerCase()) === 1))].slice(0, 6),
      fame: targetable[i] ? round(famous ? Math.max(0.8, fameOf(i)) : fameOf(i), 3) : 0,
      target: targetable[i]!,
      poly,
    };
  });
  const ids = divisions.map((d) => d.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${config.id}: duplicate ids`);
  console.log(`${config.id}: ${divisions.length} divisions, ${divisions.filter((d) => d.target).length} targets, q=${q}`);
  countries.push({ id: config.id, name: config.name, tier: config.tier, unit: UNITS[config.id]!, q, divisions });
}

const data: RegionData = { generatedAt: new Date().toISOString().slice(0, 10), countries };
const json = JSON.stringify(data);
await writeFile(join(ROOT, 'data', 'regions.json'), json);
await writeFile(join(ROOT, 'data', 'regions-version.json'), JSON.stringify({ generatedAt: data.generatedAt + '+ne-admin1.2' }));
console.log(`regions.json: ${(json.length / 1024).toFixed(0)} KB`);
void geoCentroid;
