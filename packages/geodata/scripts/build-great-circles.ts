// Builds data/great-circles.json: straight lines (the shortest path on the globe)
// between two cities, each with the countries it crosses, for the Great Circle game.
//
//   node scripts/build-great-circles.ts
//
// Computed here rather than in the game, so neither the browser nor the server has
// to trace lines through country outlines, and so unfair lines can be left out.
// Same inputs give the same output: the generator has a fixed seed.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadWorldShapes } from '../src/shapes.ts';
import { queryCountries } from '../src/index.ts';
import type { City, CityIndex, CountryId, GreatCircleData, GreatCirclePuzzle } from '../src/types.ts';
import { ROOT } from './lib/fetch.ts';

const SEED = 20261105;
const EARTH_KM = 6371;
const STEP_KM = 10;
/** Line lengths worth playing. */
const MIN_LINE_KM = 400;
const MAX_LINE_KM = 7500;
/**
 * A country the line crosses for less than this isn't asked: clipping a corner
 * isn't something a player can be expected to see. Such lines are left out.
 */
const MIN_CROSSING_KM = 70;
/** Countries in between, and how many lines to keep of each. */
const MAX_VIA = 7;
const PER_VIA_COUNT = 600;
const MAX_SAME_ROUTE = 3;
const MAX_TRIES = 25_000;
/** Big Chinese and Indian cities are hard to place early on, unless they're huge. */
const CROWDED_COUNTRIES = new Set(['CHN', 'IND']);
const CROWDED_EASY_MIN_POPULATION = 20_000_000;

type Point = readonly [number, number]; // [lat, lng]

interface Part {
  id: CountryId;
  /** [minLng, minLat, maxLng, maxLat] */
  box: readonly [number, number, number, number];
  rings: readonly (readonly (readonly number[])[])[];
}

/** Even-odd ray casting: outer rings and holes both just flip the answer. */
function contains(part: Part, lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = part.box;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  let inside = false;
  for (const ring of part.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const toVector = ([lat, lng]: Point) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))] as const;

function angleBetween(a: Point, b: Point): number {
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  return Math.acos(Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz)));
}

/** Points along the shortest path, by spherical interpolation. */
function* along(a: Point, b: Point, angle: number): Generator<Point> {
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  const steps = Math.max(1, Math.ceil((angle * EARTH_KM) / STEP_KM));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const f = Math.sin((1 - t) * angle) / Math.sin(angle);
    const g = Math.sin(t * angle) / Math.sin(angle);
    const x = f * ax + g * bx;
    const y = f * ay + g * by;
    const z = f * az + g * bz;
    yield [deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))];
  }
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shapes = await loadWorldShapes();
const parts: Part[] = [];
for (const [id, shape] of shapes.countries) {
  const { geometry } = shape;
  for (const rings of geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]) {
    let [minLng, minLat, maxLng, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) {
      for (const [lng, lat] of ring as [number, number][]) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
    parts.push({ id, box: [minLng, minLat, maxLng, maxLat], rings });
  }
}

const countryAt = (lng: number, lat: number, hint: Part | null) => {
  if (hint && contains(hint, lng, lat)) return hint;
  return parts.find((p) => contains(p, lng, lat)) ?? null;
};

const sovereign = new Set(queryCountries().map((c) => c.id));

/** The countries a line crosses in order, or null when it isn't a fair question. */
function crossings(a: { latlng: Point; countryId: CountryId }, b: { latlng: Point; countryId: CountryId }): CountryId[] | null {
  const angle = angleBetween(a.latlng, b.latlng);
  const runs: { id: CountryId; km: number }[] = [];
  let hint: Part | null = null;
  for (const [lat, lng] of along(a.latlng, b.latlng, angle)) {
    hint = countryAt(lng, lat, hint);
    if (!hint) continue; // Over the sea: the next land continues the line.
    const last = runs[runs.length - 1];
    if (last?.id === hint.id) last.km += STEP_KM;
    else runs.push({ id: hint.id, km: STEP_KM });
  }
  // Coastal cities can sit just off their outline, so the ends are checked by what's nearest to them.
  if (runs[0]?.id !== a.countryId || runs[runs.length - 1]?.id !== b.countryId) return null;
  const middle = runs.slice(1, -1);
  // Entering a country twice (a bay, a border wiggle) makes "in between" ambiguous.
  if (new Set(runs.map((r) => r.id)).size !== runs.length) return null;
  if (middle.some((r) => r.km < MIN_CROSSING_KM || !sovereign.has(r.id))) return null;
  return middle.map((r) => r.id);
}

const dataDir = join(ROOT, 'data');
const major = JSON.parse(await readFile(join(dataDir, 'cities', 'major.json'), 'utf8')) as City[];
const index = JSON.parse(await readFile(join(dataDir, 'cities', 'index.json'), 'utf8')) as CityIndex;
const isFamous = (c: City) => index.tourismRank[c.id] !== undefined;
const population = (c: City) => c.metrics.population!.value;
const cities = major.filter((c) => sovereign.has(c.countryId) && (isFamous(c) || population(c) >= 1_000_000));
const isEasy = (c: City) => isFamous(c) && (!CROWDED_COUNTRIES.has(c.countryId) || population(c) >= CROWDED_EASY_MIN_POPULATION);

const byCountry = new Map<CountryId, City[]>();
for (const c of cities) byCountry.set(c.countryId, [...(byCountry.get(c.countryId) ?? []), c]);
const countryIds = [...byCountry.keys()];

const random = mulberry32(SEED);
const pickFrom = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
/** Country first, then a city in it, so countries with the most big cities don't take over. */
const pickCity = () => pickFrom(byCountry.get(pickFrom(countryIds))!);
const easyCities = cities.filter(isEasy);
const pickEasyCity = () => pickFrom(easyCities);

const puzzles: GreatCirclePuzzle[] = [];
const kept = new Map<number, number>();
const sameRoute = new Map<string, number>();
const started = Date.now();
let tries = 0;
for (; tries < MAX_TRIES; tries++) {
  if (tries % 5000 === 0) console.log(`  ${tries} tries, ${puzzles.length} lines, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  // Half the tries from well-known cities, as early levels need many of those.
  const [a, b] = tries % 2 === 0 ? [pickEasyCity(), pickEasyCity()] : [pickCity(), pickCity()];
  if (a.countryId === b.countryId) continue;
  const km = angleBetween(a.latlng, b.latlng) * EARTH_KM;
  if (km < MIN_LINE_KM || km > MAX_LINE_KM) continue;
  const via = crossings(a, b);
  if (!via || via.length === 0 || via.length > MAX_VIA) continue;
  if ((kept.get(via.length) ?? 0) >= PER_VIA_COUNT) continue;
  const route = [a.countryId, ...via, b.countryId].join('>');
  if ((sameRoute.get(route) ?? 0) >= MAX_SAME_ROUTE) continue;
  sameRoute.set(route, (sameRoute.get(route) ?? 0) + 1);
  kept.set(via.length, (kept.get(via.length) ?? 0) + 1);
  puzzles.push({
    from: { id: a.id, name: a.name, countryId: a.countryId, latlng: a.latlng },
    to: { id: b.id, name: b.name, countryId: b.countryId, latlng: b.latlng },
    via,
    easy: isEasy(a) && isEasy(b),
  });
  if (kept.size === MAX_VIA && [...kept.values()].every((n) => n >= PER_VIA_COUNT)) break;
}

const data: GreatCircleData = { puzzles };
await writeFile(join(dataDir, 'great-circles.json'), JSON.stringify(data) + '\n');
console.log(`great circles: ${puzzles.length} lines from ${tries} tries in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`by countries in between: ${[...kept].sort((x, y) => x[0] - y[0]).map(([n, c]) => `${n}: ${c}`).join(', ')}; easy: ${puzzles.filter((p) => p.easy).length}`);
