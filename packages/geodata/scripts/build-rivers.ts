// Builds data/rivers.json for River Run: whole named rivers, each one line
// from its source to its mouth (or, for a tributary, to where it joins).
//
//   node scripts/build-rivers.ts [--offline]
//
// Source: Natural Earth 1:10m rivers_lake_centerlines (public domain). Natural
// Earth cuts a river into pieces, sometimes under local names (Jinsha for the
// upper Yangtze, Firat for the Euphrates), so every river here is listed by
// hand with the pieces that make it up, as "name#rivernum" (rivernum alone
// isn't unique: the Garonne and the Drau share one). Only rivers whose course
// and name look right to a geography fan are listed. Lengths are the usual
// published figures (Wikipedia, for the course drawn), checked below against
// the drawn line, which comes out a little shorter for being simplified.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RiverData, RiverTier } from '../src/rivers.ts';
import { ROOT, cachedJson, round } from './lib/fetch.ts';

const SOURCE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson';
/** Pieces of one river further apart than this are a mistake in the list, not a lake to cross. */
const MAX_GAP_KM = 150;
/** Douglas-Peucker tolerance, in degrees: about 2 km, finer than a pixel at the closest view. */
const TOLERANCE = 0.02;
/** A drawn line this much shorter or longer than the published length means the pieces are wrong. */
const LENGTH_RATIO: readonly [number, number] = [0.5, 1.3];

type Continent = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania';
type Pos = [number, number]; // [lng, lat]

interface Listed {
  id: string;
  name: string;
  tier: RiverTier;
  continent: Continent;
  lengthKm: number;
  parts: string[];
  aliases?: string[];
  /** Pieces that start at these points aren't this river, though Natural Earth files them under it. */
  drop?: Pos[];
  /** Only the pieces that run between these points: the main course through a maze of delta arms. */
  only?: [Pos, Pos][];
  /** Natural Earth draws this one from the mouth up. */
  flip?: boolean;
}

const r = (
  id: string,
  name: string,
  tier: RiverTier,
  continent: Continent,
  lengthKm: number,
  parts: string[],
  extra: Pick<Listed, 'aliases' | 'flip' | 'drop' | 'only'> = {},
): Listed => ({ id, name, tier, continent, lengthKm, parts, ...extra });

const [AF, AS, EU, NA, SA, OC] = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'] as const;

/**
 * Tier 1: the truly great rivers. 2: well-known regional rivers (and famous short ones, like the Thames).
 * 3: tributaries, and rivers whose start misleads. 4: rivers with little around them to place them by
 * (deep in the Amazon or Siberia), for the deepest band only.
 */
const RIVERS: Listed[] = [
  r('nile', 'Nile', 1, AF, 6650, ['Kagera#6', 'Victoria Nile#5', 'Albert Nile#9', 'Mountain Nile#14', 'White Nile#16', 'White Nile#17', 'Nile#4']),
  r('amazon', 'Amazon', 1, SA, 6400, ['Ucayali#10', 'Amazonas#2'], {
    flip: true,
    aliases: ['Amazonas', 'Solimões'],
    drop: [[-54.321, -2.19], [-54.144, -2.245]] /* a side channel by Santarém */,
  }),
  r('mississippi', 'Mississippi', 1, NA, 3730, ['Mississippi#156', 'Mississippi#3'], {
    drop: [[-89.27, 29.202], [-89.257, 29.155]] /* delta arms: the line ends at Southwest Pass */,
  }),
  r('danube', 'Danube', 1, EU, 2850, ['Danube#25', 'Danube#38'], { aliases: ['Donau', 'Duna', 'Dunărea', 'Dunav'] }),
  r('rhine', 'Rhine', 1, EU, 1230, ['Rhein#105', 'Rhein#140', 'Rhine#150', 'Waal#151'], { aliases: ['Rhein', 'Rhin', 'Rijn'] }),
  r('volga', 'Volga', 1, EU, 3530, ['Volga#68']),
  r('yangtze', 'Yangtze', 1, AS, 6300, ['Tongtian#13', 'Yangtze#15', 'Yangtze#18', 'Yangtze#1'], { aliases: ['Chang Jiang', 'Yangtse'] }),
  r('yellow', 'Yellow River', 1, AS, 5464, ['Huang#66', 'Yellow#95'], { aliases: ['Huang He', 'Huang Ho', 'Huang', 'Yellow'] }),
  r('ganges', 'Ganges', 1, AS, 2525, ['Ganges#55'], { aliases: ['Ganga'], only: [[[79.84, 30.89], [89.09, 23.98]], [[89.09, 23.98], [90.01, 22.49]]] }),
  r('indus', 'Indus', 1, AS, 3180, ['Indus#56'], {
    only: [
      [[79.735, 32.444], [79.43, 32.745]],
      [[79.437, 32.738], [72.782, 34.623]],
      [[72.782, 34.623], [72.707, 34.086]],
      [[72.707, 34.086], [67.664, 24.106]],
      [[67.664, 24.106], [67.532, 24.06]],
    ] /* the main channel through the delta */,
  }),
  r('mekong', 'Mekong', 1, AS, 4909, ['Mekong#40', 'Mekong#46'], { aliases: ['Lancang'] }),
  r('thames', 'Thames', 2, EU, 346, ['Thames#302']),
  r('seine', 'Seine', 2, EU, 777, ['Seine#129']),
  r('colorado', 'Colorado', 1, NA, 2330, ['Colorado#163']),
  r('rio-grande', 'Rio Grande', 1, NA, 3051, ['Rio Grande#110'], { aliases: ['Río Bravo', 'Rio Bravo'] }),
  r('tigris', 'Tigris', 1, AS, 1850, ['Dicle#120', 'Tigris#135'], { aliases: ['Dicle', 'Dijlah'] }),
  r('euphrates', 'Euphrates', 1, AS, 2800, ['Firat#65', 'Al Furat#69', 'Euphrates#62'], { aliases: ['Fırat', 'Firat', 'Al-Furat'] }),
  r('murray', 'Murray', 2, OC, 2508, ['Murray#97', 'Murray#54']),

  r('missouri', 'Missouri', 1, NA, 3767, ['Missouri#8']),
  r('congo', 'Congo', 1, AF, 4700, ['Lualaba#37', 'Congo#41', 'Congo#43', 'Congo#45'], { aliases: ['Zaire', 'Lualaba'] }),
  r('niger', 'Niger', 2, AF, 4180, ['Niger#59']),
  r('zambezi', 'Zambezi', 2, AF, 2574, ['Zambezi#70'], { aliases: ['Zambesi'] }),
  r('orange', 'Orange', 2, AF, 2200, ['Orange#222', 'Orange#98'], { aliases: ['Gariep', 'Senqu'] }),
  r('limpopo', 'Limpopo', 2, AF, 1750, ['Limpopo#336']),
  r('senegal', 'Senegal', 2, AF, 1086, ['Sénégal#132'], { aliases: ['Sénégal'] }),
  r('volta', 'Volta', 2, AF, 1500, ['Black Volta#175', 'Volta#176']),
  r('loire', 'Loire', 2, EU, 1006, ['Loire#178']),
  r('elbe', 'Elbe', 2, EU, 1094, ['Elbe#160'], { aliases: ['Labe'] }),
  r('vistula', 'Vistula', 2, EU, 1047, ['Vistula#166'], { aliases: ['Wisła', 'Wisla'] }),
  r('oder', 'Oder', 2, EU, 840, ['Oder#130'], { aliases: ['Odra'] }),
  r('po', 'Po', 2, EU, 652, ['Po#219']),
  r('rhone', 'Rhône', 2, EU, 813, ['Rhône#255'], { aliases: ['Rhone'] }),
  r('ebro', 'Ebro', 2, EU, 910, ['Ebro#155']),
  r('tagus', 'Tagus', 2, EU, 1007, ['Tagus#198', 'Tajo#165'], { aliases: ['Tajo', 'Tejo'] }),
  r('douro', 'Douro', 2, EU, 897, ['Duero#304'], { aliases: ['Duero'] }),
  r('dnieper', 'Dnieper', 2, EU, 2201, ['Dnieper#116'], { aliases: ['Dnipro', 'Dnepr'] }),
  r('don', 'Don', 2, EU, 1870, ['Don#277'], { flip: true }),
  r('dniester', 'Dniester', 2, EU, 1362, ['Dniester#231'], { aliases: ['Dnister', 'Nistru'] }),
  r('pechora', 'Pechora', 2, EU, 1809, ['Pechora#122'], { flip: true, only: [[[52.818, 67.69], [59.287, 62.057]], [[54.207, 68.209], [52.818, 67.69]]] /* to Pechora Bay */ }),
  r('northern-dvina', 'Northern Dvina', 2, EU, 744, ['Severnaya Dvina#136'], { aliases: ['Severnaya Dvina'] }),
  r('garonne', 'Garonne', 2, EU, 529, ['Garonne#303']),
  r('shannon', 'Shannon', 2, EU, 360, ['Shannon#668']),
  r('tiber', 'Tiber', 2, EU, 406, ['Tiber#443'], { aliases: ['Tevere'] }),
  r('daugava', 'Daugava', 2, EU, 1020, ['Zapadnaya Dvina#182'], { aliases: ['Western Dvina', 'Zapadnaya Dvina'] }),
  r('weser', 'Weser', 2, EU, 744, ['Weser#563']),
  r('ural', 'Ural', 2, AS, 2428, ['Ural#111']),
  r('ob', 'Ob', 2, AS, 3650, ['Ob#114', 'Ob#24'], { flip: true, drop: [[67.431, 66.672]] /* a side arm: the line ends where the Gulf of Ob begins */ }),
  r('yenisey', 'Yenisey', 2, AS, 3487, ['Verkhniy Yenisey#145', 'Yenisey#113'], { flip: true, aliases: ['Yenisei', 'Enisei'] }),
  r('lena', 'Lena', 2, AS, 4400, ['Lena#12'], { flip: true }),
  r('amur', 'Amur', 2, AS, 2824, ['Amur#93', 'Amur#72'], { flip: true, aliases: ['Heilong Jiang', 'Heilongjiang'] }),
  r('kolyma', 'Kolyma', 2, AS, 2129, ['Kolyma#124'], { flip: true }),
  r('irrawaddy', 'Irrawaddy', 2, AS, 2170, ['Irrawaddy#138'], { aliases: ['Ayeyarwady'] }),
  r('salween', 'Salween', 2, AS, 2815, ['Nu#134', 'Nu#146', 'Salween#153'], { aliases: ['Thanlwin', 'Nu'] }),
  r('brahmaputra', 'Brahmaputra', 2, AS, 2900, ['Brahmaputra#42', 'Dihang#47', 'Brahmaputra#51'], {
    drop: [[89.755, 24.274]] /* the Old Brahmaputra: the line ends near the Padma and Meghna */, aliases: ['Yarlung Tsangpo', 'Yarlung Zangbo', 'Jamuna'] }),
  r('red-vietnam', 'Red River', 2, AS, 1149, ['Red#306'], { flip: true, aliases: ['Hong', 'Sông Hồng', 'Red'] }),
  r('godavari', 'Godavari', 2, AS, 1465, ['Godävari#179']),
  r('krishna', 'Krishna', 2, AS, 1400, ['Krishna#279']),
  r('narmada', 'Narmada', 2, AS, 1312, ['Narmada#308'], { aliases: ['Narbada'] }),
  r('amu-darya', 'Amu Darya', 2, AS, 2540, ['Panj#195', 'Amu  Darya#199'], { aliases: ['Oxus', 'Amudarya'] }),
  r('orinoco', 'Orinoco', 2, SA, 2140, ['Orinoco#75']),
  r('parana', 'Paraná', 2, SA, 4880, ['Paranaíba#108', 'Paraná#99', 'Paraná#36'], { aliases: ['Parana'], drop: [[-55.08, -14.32]] /* the Paraguay */ }),
  r('sao-francisco', 'São Francisco', 2, SA, 2830, ['São  Francisco#104'], { aliases: ['Sao Francisco'] }),
  r('magdalena', 'Magdalena', 2, SA, 1528, ['Magdalena#126']),
  r('uruguay', 'Uruguay', 2, SA, 1838, ['Uruguay#293']),
  r('tocantins', 'Tocantins', 2, SA, 2450, ['Tocantins#115', 'Tocantins#335'], { flip: true }),
  r('mackenzie', 'Mackenzie', 2, NA, 1738, ['Mackenzie#34']),
  r('yukon', 'Yukon', 2, NA, 3190, ['Yukon#53']),
  r('columbia', 'Columbia', 2, NA, 2000, ['Columbia#64']),
  r('fraser', 'Fraser', 2, NA, 1375, ['Fraser#187']),
  r('hudson', 'Hudson', 2, NA, 507, ['Hudson#326']),
  r('sacramento', 'Sacramento', 2, NA, 719, ['Sacramento#167']),

  r('inn', 'Inn', 3, EU, 518, ['Inn#718']),
  r('main', 'Main', 3, EU, 527, ['Main#721']),
  r('mosel', 'Moselle', 3, EU, 544, ['Mosel#534'], { aliases: ['Mosel'] }),
  r('sava', 'Sava', 3, EU, 990, ['eu:Sava#40306700', 'Sava#494']),
  r('drava', 'Drava', 3, EU, 710, ['Drau#303', 'Mur#208@16.878,46.314'], { aliases: ['Drau'], drop: [[-18.17, 64.91]] /* a Drau in Iceland */ }),
  r('kama', 'Kama', 3, EU, 1805, ['Kama#699']),
  r('desna', 'Desna', 4, EU, 1130, ['Desna#465']),
  r('warta', 'Warta', 3, EU, 808, ['Warta#720']),
  r('bug', 'Bug', 4, EU, 774, ['Bug#732'], { aliases: ['Western Bug', 'Bug River'] }),
  r('ohio', 'Ohio', 3, NA, 1579, ['Ohio#92']),
  r('tennessee', 'Tennessee', 3, NA, 1049, ['Tennessee#169']),
  r('arkansas', 'Arkansas', 3, NA, 2364, ['Arkansas#131']),
  r('snake', 'Snake', 3, NA, 1735, ['Snake#103', 'Columbia#103']),
  r('yellowstone', 'Yellowstone', 3, NA, 1114, ['Yellowstone#396']),
  r('peace', 'Peace', 3, NA, 1923, ['Peace#33']),
  r('athabasca', 'Athabasca', 3, NA, 1231, ['Athabasca#173']),
  r('liard', 'Liard', 4, NA, 1115, ['Liard#281']),
  r('north-saskatchewan', 'North Saskatchewan', 3, NA, 1287, ['North Saskatchewan#117']),
  r('gila', 'Gila', 3, NA, 1044, ['Gila#334']),
  r('pecos', 'Pecos', 3, NA, 1490, ['Pecos#415']),
  r('green', 'Green', 3, NA, 1170, ['Green#413']),
  r('madeira', 'Madeira', 3, SA, 1450, ['Madeira#91']),
  r('rio-negro', 'Rio Negro', 3, SA, 2250, ['Negro#78'], { aliases: ['Negro', 'Río Negro'] }),
  r('xingu', 'Xingu', 3, SA, 2640, ['Xingu#197']),
  r('tapajos', 'Tapajós', 3, SA, 1992, ['Tapajós#200'], { aliases: ['Tapajos'] }),
  r('purus', 'Purus', 4, SA, 3211, ['Purús#289'], { aliases: ['Purús'] }),
  r('jurua', 'Juruá', 4, SA, 3283, ['Juruá#435'], { aliases: ['Jurua'] }),
  r('maranon', 'Marañón', 3, SA, 1737, ['Marañón#183'], { aliases: ['Maranon'] }),
  r('japura', 'Japurá', 4, SA, 2816, ['Caquetá#184', 'Japurá#204'], { aliases: ['Caquetá', 'Japura', 'Caqueta'] }),
  r('araguaia', 'Araguaia', 3, SA, 2627, ['Araguaia#100']),
  r('pilcomayo', 'Pilcomayo', 4, SA, 1100, ['Pilcomayo#294']),
  r('blue-nile', 'Blue Nile', 3, AF, 1450, ['Blue Nile#85', 'Blue Nile#73'], { aliases: ['Abay', 'Abbay'] }),
  r('kasai', 'Kasai', 3, AF, 2153, ['Kasai#81'], { aliases: ['Kassai', 'Cassai'] }),
  r('angara', 'Angara', 3, AS, 1779, ['Angara#28', 'Angara#32'], { drop: [[106.497, 52.383]] /* not across Lake Baikal: it starts at its outlet */ }),
  r('irtysh', 'Irtysh', 3, AS, 4248, ['Ertis#29', 'Irtysh#30', 'Irtysh#44'], { aliases: ['Ertis'] }),
  r('aldan', 'Aldan', 4, AS, 2273, ['Aldan#102']),
  r('vilyuy', 'Vilyuy', 4, AS, 2650, ['Vilyuy#269'], { flip: true, aliases: ['Viliui', 'Vilyui'] }),
  r('songhua', 'Songhua', 4, AS, 1434, ['Di’er Songhua#646', 'Sungari#366'], { aliases: ['Sungari', 'Songhua Jiang'] }),
  r('han', 'Han', 4, AS, 1532, ['Han#270'], { aliases: ['Han Shui', 'Hanjiang'] }),
  r('jialing', 'Jialing', 4, AS, 1119, ['Jialing#538']),
  r('yamuna', 'Yamuna', 3, AS, 1376, ['Yamuna#307'], { aliases: ['Jumna'] }),
  r('sutlej', 'Sutlej', 3, AS, 1450, ['Sutlej#258']),
  r('chenab', 'Chenab', 3, AS, 974, ['Chenab#315']),
  r('jhelum', 'Jhelum', 3, AS, 725, ['Jhelum#371']),
  r('syr-darya', 'Syr Darya', 3, AS, 2212, ['Syr  Darya#170'], { aliases: ['Jaxartes', 'Syrdarya'] }),
  r('darling', 'Darling', 3, OC, 1472, ['Darling#86']),
];

interface Feature {
  properties: { name: string | null; name_en: string | null; name_alt: string | null; rivernum: number };
  geometry: { type: 'LineString'; coordinates: Pos[] } | { type: 'MultiLineString'; coordinates: Pos[][] } | null;
}

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function km(a: Pos, b: Pos): number {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}
const lineKm = (line: readonly Pos[]) => line.slice(1).reduce((sum, p, i) => sum + km(line[i]!, p), 0);

/**
 * The pieces a "name#rivernum" entry stands for. "eu:" takes them from the
 * European supplement (smaller rivers and upper courses); "@lng,lat" keeps
 * only the rest of each piece from the point nearest there (the Drava's lower
 * course, which Natural Earth files on the end of the Mur).
 */
function piecesFor(part: string): Pos[][] {
  const [source, spec] = part.startsWith('eu:') ? [europe, part.slice(3)] : [main, part];
  const [ref = '', at] = spec.split('@');
  const [name, num] = ref.split('#');
  const from = at?.split(',').map(Number) as Pos | undefined;
  const pieces = source.features
    .filter((f) => f.geometry && f.properties.rivernum === Number(num))
    .filter((f) => [f.properties.name, f.properties.name_en, f.properties.name_alt].includes(name!))
    .flatMap((f) => (f.geometry!.type === 'LineString' ? [f.geometry!.coordinates as Pos[]] : (f.geometry!.coordinates as Pos[][])));
  if (pieces.length === 0) throw new Error(`no pieces for ${part}`);
  if (!from) return pieces;
  return pieces.map((piece) => {
    const nearest = piece.reduce((best, p, i) => (km(p, from) < km(piece[best]!, from) ? i : best), 0);
    return piece.slice(nearest);
  });
}

interface Edge {
  a: number;
  b: number;
  line: Pos[];
  km: number;
}

/**
 * Joins the pieces into the river's longest course: the pieces are edges
 * between their end points, small gaps (a lake, a missing stretch) are bridged,
 * and the longest path through them (side channels and delta arms drop out)
 * becomes the river. Returns it as drawn, plus how much of it was drawn in the
 * direction it's walked, which tells which end is the source.
 */
function longestCourse(pieces: Pos[][]): { line: Pos[]; forwardShare: number; gaps: number[] } {
  const nodes: Pos[] = [];
  const nodeAt = (p: Pos) => {
    let i = nodes.findIndex((n) => km(n, p) < 0.5);
    if (i < 0) i = nodes.push(p) - 1;
    return i;
  };
  const edges: Edge[] = pieces.map((line) => ({ a: nodeAt(line[0]!), b: nodeAt(line.at(-1)!), line, km: lineKm(line) }));
  // Bridges between parts that don't touch: always the closest pair of ends of two separate parts.
  const gaps: number[] = [];
  for (;;) {
    const part = components(nodes.length, edges);
    if (new Set(part).size === 1) break;
    let best: { i: number; j: number; d: number } | null = null;
    for (let i = 0; i < nodes.length; i++)
      for (let j = 0; j < nodes.length; j++)
        if (part[i] !== part[j]) {
          const d = km(nodes[i]!, nodes[j]!);
          if (!best || d < best.d) best = { i, j, d };
        }
    if (!best || best.d > MAX_GAP_KM) throw new Error(`gap of ${best ? Math.round(best.d) : '?'} km`);
    gaps.push(Math.round(best.d));
    edges.push({ a: best.i, b: best.j, line: [nodes[best.i]!, nodes[best.j]!], km: best.d });
  }
  const far = (from: number) => {
    const dist = new Array<number>(nodes.length).fill(Infinity);
    const via = new Array<{ edge: Edge; from: number } | null>(nodes.length).fill(null);
    dist[from] = 0;
    const open = new Set([from]);
    while (open.size) {
      const u = [...open].reduce((x, y) => (dist[x]! <= dist[y]! ? x : y));
      open.delete(u);
      for (const e of edges) {
        const v = e.a === u ? e.b : e.b === u ? e.a : -1;
        if (v >= 0 && dist[u]! + e.km < dist[v]!) {
          dist[v] = dist[u]! + e.km;
          via[v] = { edge: e, from: u };
          open.add(v);
        }
      }
    }
    const end = dist.reduce((best, d, i) => (d > dist[best]! ? i : best), from);
    return { end, via };
  };
  const start = far(0).end;
  const { end, via } = far(start);
  // Walk back from the far end, then reverse: the line runs start → end.
  const steps: { edge: Edge; forward: boolean }[] = [];
  for (let n = end; n !== start; n = via[n]!.from) steps.push({ edge: via[n]!.edge, forward: via[n]!.edge.a === via[n]!.from });
  steps.reverse();
  const line: Pos[] = [];
  let forwardKm = 0;
  let totalKm = 0;
  for (const { edge, forward } of steps) {
    line.push(...(forward ? edge.line : [...edge.line].reverse()));
    if (pieces.includes(edge.line)) {
      totalKm += edge.km;
      if (forward) forwardKm += edge.km;
    }
  }
  return { line, forwardShare: forwardKm / totalKm, gaps };
}

function components(count: number, edges: readonly Edge[]): number[] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (const e of edges) parent[root(e.a)] = root(e.b);
  return parent.map((_, i) => root(i));
}

/** How far a line that doubles back runs on past its end (a delta arm walked up again): see doublesBack. */
const DOUBLE_BACK_KM = 40;
/** A meander near the mouth (the Sava by Belgrade) may wander this much further out. */
const DOUBLE_BACK_SLACK_KM = 15;

/**
 * Whether the line comes within DOUBLE_BACK_KM of its end, leaves again and
 * comes back: the longest path went down one delta arm and up another. Returns
 * where it first passed the end, or null. (Also in the games package tests.)
 */
export function doublesBack(line: readonly Pos[]): string | null {
  const end = line.at(-1)!;
  let near = -1;
  for (let i = 0; i < line.length; i++) {
    const d = km(line[i]!, end);
    if (near < 0 && d <= DOUBLE_BACK_KM) near = i;
    else if (near >= 0 && d > DOUBLE_BACK_KM + DOUBLE_BACK_SLACK_KM) return `point ${near} of ${line.length}`;
  }
  return null;
}

/** Douglas-Peucker in degrees, plenty for drawing. */
function simplify(line: readonly Pos[]): Pos[] {
  if (line.length < 3) return [...line];
  const [a, b] = [line[0]!, line.at(-1)!];
  let [index, max] = [0, 0];
  for (let i = 1; i < line.length - 1; i++) {
    const d = offLine(line[i]!, a, b);
    if (d > max) [index, max] = [i, d];
  }
  if (max <= TOLERANCE) return [a, b];
  return [...simplify(line.slice(0, index + 1)).slice(0, -1), ...simplify(line.slice(index))];
}
function offLine(p: Pos, a: Pos, b: Pos): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

const main = await cachedJson<{ features: Feature[] }>('ne_10m_rivers_lake_centerlines.geojson', SOURCE);
const europe = await cachedJson<{ features: Feature[] }>('ne_10m_rivers_europe.geojson', SOURCE.replace('lake_centerlines', 'europe'));
const ids = new Set<string>();
const rivers: RiverData['rivers'] = [];
const problems: string[] = [];
for (const river of RIVERS) {
  if (ids.has(river.id)) throw new Error(`duplicate ${river.id}`);
  ids.add(river.id);
  let course: ReturnType<typeof longestCourse>;
  try {
    const pieces = river.parts.flatMap((p) => piecesFor(p));
    const near = (a: Pos, b: Pos) => km(a, b) < 5;
    const kept = pieces.filter(
      (piece) =>
        lineKm(piece) >= 5 &&
        !river.drop?.some((p) => near(p, piece[0]!)) &&
        (!river.only || river.only.some(([a, b]) => near(a, piece[0]!) && near(b, piece.at(-1)!))),
    );
    course = longestCourse(kept);
  } catch (e) {
    problems.push(`${river.id}: ${(e as Error).message}`);
    continue;
  }
  const { line, forwardShare, gaps } = course;
  // Natural Earth mostly draws rivers downstream; the listed flips are the exceptions.
  const downstream = forwardShare >= 0.5 !== !!river.flip ? line : [...line].reverse();
  const drawn = simplify(downstream).map(([lng, lat]): Pos => [round(lng, 2), round(lat, 2)]);
  const ratio = lineKm(downstream) / river.lengthKm;
  const fmt = (p: Pos) => `${p[1].toFixed(1)},${p[0].toFixed(1)}`;
  console.log(
    `${river.id.padEnd(20)} ${String(Math.round(lineKm(downstream))).padStart(5)} km / ${river.lengthKm} (${ratio.toFixed(2)}) ` +
      `fwd ${forwardShare.toFixed(2)} source ${fmt(drawn[0]!)} → mouth ${fmt(drawn.at(-1)!)} ${drawn.length} pts${gaps.length ? ` gaps ${gaps.join(',')}` : ''}`,
  );
  if (ratio < LENGTH_RATIO[0] || ratio > LENGTH_RATIO[1]) problems.push(`${river.id}: drawn ${ratio.toFixed(2)} × its length`);
  const back = doublesBack(drawn);
  if (back) problems.push(`${river.id}: passes its mouth and comes back (${back})`);
  rivers.push({
    id: river.id,
    name: river.name,
    aliases: river.aliases ?? [],
    tier: river.tier,
    continent: river.continent,
    lengthKm: river.lengthKm,
    anchor: drawn[Math.floor(drawn.length / 2)]!,
    line: drawn,
  });
}
if (problems.length) throw new Error(problems.join('\n'));

const data: RiverData = { generatedAt: new Date().toISOString().slice(0, 10), source: 'Natural Earth 1:10m rivers (public domain)', rivers };
await writeFile(join(ROOT, 'data', 'rivers.json'), JSON.stringify(data));
// Small, so the replay code can read the version without loading the rivers.
await writeFile(join(ROOT, 'data', 'rivers-version.json'), JSON.stringify({ generatedAt: data.generatedAt }) + '\n');
console.log(`${rivers.length} rivers`);
