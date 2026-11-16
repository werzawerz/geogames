// Draws the map scenes on the home page's game cards from the real country
// outlines, ahead of time: the home page shouldn't load the ~740 KB of map shapes.
// Run with `npm run art:build -w @geogames/web`; the output is committed.
import { writeFileSync } from 'node:fs';
import {
  geoAzimuthalEqualArea,
  geoCentroid,
  geoCircle,
  geoDistance,
  geoInterpolate,
  geoMercator,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from 'd3-geo';
import { getCountry } from '@geogames/geodata';
import { loadWorldShapes } from '@geogames/geodata/shapes';
import { loadBlankAtlasShapes } from '@geogames/geodata/blank-atlas-shapes';
import { loadRivers } from '@geogames/geodata/rivers';

const WIDTH = 640;
const HEIGHT = 280;
const EARTH_KM = 6371;
const { countries, land } = await loadWorldShapes();

/** [lng, lat] of the places in the scenes. */
const PLACES = {
  rome: [12.4964, 41.9028],
  seoul: [126.978, 37.5665],
  tokyo: [139.6917, 35.6895],
  osaka: [135.5023, 34.6937],
  beijing: [116.4074, 39.9042],
  shanghai: [121.4737, 31.2304],
  newYork: [-74.006, 40.7128],
  boston: [-71.0589, 42.3601],
  philadelphia: [-75.1652, 39.9526],
  washington: [-77.0369, 38.9072],
  toronto: [-79.3832, 43.6532],
  rio: [-43.1729, -22.9068],
  bogota: [-74.0721, 4.711],
  delhi: [77.2167, 28.6667],
  athens: [23.749, 37.9534],
  paris: [2.3522, 48.8566],
  berlin: [13.405, 52.52],
  frankfurt: [8.6821, 50.1109],
} satisfies Record<string, [number, number]>;

/** Drops points that stray less than `tolerance` from the line between their neighbours (Douglas-Peucker). */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!;
  const [bx, by] = points[points.length - 1]!;
  const length = Math.hypot(bx - ax, by - ay);
  let furthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const away = length === 0 ? Math.hypot(x - ax, y - ay) : Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / length;
    if (away > furthest) {
      furthest = away;
      index = i;
    }
  }
  if (furthest <= tolerance) return [points[0]!, points[points.length - 1]!];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/** Whole units, simplified, relative moves, no specks: at card size, finer detail is only bytes. */
function compact(d: string | null): string {
  if (!d) return '';
  return d
    .split('M')
    .filter(Boolean)
    .flatMap((part) => {
      const closed = part.endsWith('Z');
      const raw = part.replace('Z', '').split('L').map((p) => p.split(',').map(Number) as [number, number]);
      // A closed ring has no natural ends, so it is split at its far point to keep its shape.
      const far = raw.reduce((best, p, i) => (Math.hypot(p[0] - raw[0]![0], p[1] - raw[0]![1]) > Math.hypot(raw[best]![0] - raw[0]![0], raw[best]![1] - raw[0]![1]) ? i : best), 0);
      const points = closed && far > 0
        ? [...simplify(raw.slice(0, far + 1), 1.4).slice(0, -1), ...simplify([...raw.slice(far), raw[0]!], 1.4).slice(0, -1)]
        : simplify(raw, 0.4);
      const rounded = points.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
      const kept = rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1]![0] || p[1] !== rounded[i - 1]![1]);
      const xs = kept.map((p) => p[0]);
      const ys = kept.map((p) => p[1]);
      if (closed && (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) < 16) return [];
      const steps = kept.slice(1).map((p, i) => `${p[0] - kept[i]![0]} ${p[1] - kept[i]![1]}`);
      return [`M${kept[0]![0]} ${kept[0]![1]}l${steps.join(' ').replace(/ -/g, '-')}${closed ? 'z' : ''}`];
    })
    .join('');
}

/** A projection that shows `focus` in the card, cropped to it. */
function framed(base: GeoProjection, focus: [number, number][], padding = 28): GeoProjection {
  const multiPoint: GeoPermissibleObjects = { type: 'MultiPoint', coordinates: focus };
  return base
    .fitExtent(
      [
        [padding, padding],
        [WIDTH - padding, HEIGHT - padding],
      ],
      multiPoint,
    )
    .clipExtent([
      [-4, -4],
      [WIDTH + 4, HEIGHT + 4],
    ]);
}

function scene(projection: GeoProjection) {
  const path = geoPath(projection);
  const shape = (id: string) => compact(path(countries.get(id)!));
  return {
    land: compact(path(land)),
    shape,
    line: (from: [number, number], to: [number, number]) =>
      compact(path({ type: 'LineString', coordinates: [from, to] })),
    circle: (center: [number, number], km: number) =>
      compact(path(geoCircle().center(center).radius((km / EARTH_KM) * (180 / Math.PI))())),
    projection,
    point: (lngLat: [number, number]) => projection(lngLat)!.map((n) => Math.round(n)) as [number, number],
    projection,
  };
}

const bounds = (...ids: string[]): [number, number][] =>
  ids.flatMap((id) => {
    const [[x0, y0], [x1, y1]] = geoPath().bounds(countries.get(id)!);
    return [
      [x0, y0],
      [x1, y1],
    ] as [number, number][];
  });

// Border Route: a real shortest route.
const route = scene(framed(geoMercator(), bounds('ESP', 'POL')));

// Great Circle: a line and the countries it really crosses (from great-circles.json).
const line = scene(framed(geoMercator(), [PLACES.delhi, PLACES.athens], 56));

// City Circle Arcade: circles shrinking around Seoul.
const arcade = scene(framed(geoMercator(), [[105, 22], [147, 48]], 12));

// City Circle: Free Play: a circle placed on the US east coast.
const free = scene(framed(geoMercator(), [[-86, 36], [-66, 46]], 16));

// Pin Drop: a pin and how far off it was.
const pin = scene(framed(geoMercator(), [[-92, 14], [-28, -32]], 14));

// Halfway: Paris and Berlin, the circle around their real midpoint, and Frankfurt inside it.
const halfway = scene(framed(geoMercator(), [[-3, 46], [18, 55]], 16));
const halfwayMid = geoInterpolate(PLACES.paris, PLACES.berlin)(0.5) as [number, number];

// Capitals: Italy and its capital.
const capital = scene(framed(geoMercator(), bounds('ITA'), 26));

// Mystery Country: guesses coloured by the game's own rule, around a hidden Chad.
const mystery = scene(framed(geoMercator(), [[-18, 37], [52, -35]], 12));
const target = getCountry('TCD')!;
const toneFor = (id: string) => {
  const guess = getCountry(id)!;
  const km = geoDistance([guess.latlng[1], guess.latlng[0]], [target.latlng[1], target.latlng[0]]) * EARTH_KM;
  return guess.borders.includes(target.id) || km < 1000 ? 'optimal' : km < 3000 ? 'near' : 'far';
};

// Blank Atlas: the Black Sea lit up on a map with no labels.
const atlas = scene(framed(geoMercator(), [[21, 48], [44, 39]], 16));
const outlines = await loadBlankAtlasShapes();

// Border Blitz: Germany lit up, some of its neighbours found, the rest still to name.
const blitz = scene(framed(geoMercator(), [[-1, 55.5], [21, 44]], 10));

// River Run: the Danube, two thirds drawn from its source.
const river = scene(framed(geoMercator(), [[6, 50], [30, 42]], 10));
const danube = (await loadRivers()).rivers.find((r) => r.id === 'danube')!.line;
const danubeDrawn = danube.slice(0, Math.round(danube.length * 0.65));

// Area: two countries at the same scale, so their sizes compare truly.
function sameScale(id: string, x: number) {
  const shape = countries.get(id)!;
  const [lng, lat] = geoCentroid(shape);
  const projection = geoAzimuthalEqualArea()
    .rotate([-lng, -lat])
    .scale(205)
    .translate([x, HEIGHT / 2]);
  return compact(geoPath(projection)(shape));
}

const art = {
  route: {
    land: route.land,
    countries: [
      { d: route.shape('ESP'), tone: 'start' },
      { d: route.shape('FRA'), tone: 'optimal' },
      { d: route.shape('DEU'), tone: 'optimal' },
      { d: route.shape('POL'), tone: 'end' },
    ],
  },
  line: {
    land: line.land,
    countries: ['PAK', 'AFG', 'IRN', 'TUR'].map((id) => ({ d: line.shape(id), tone: 'route' })),
    ends: [
      { d: line.shape('IND'), tone: 'start' },
      { d: line.shape('GRC'), tone: 'end' },
    ],
    path: line.line(PLACES.delhi, PLACES.athens),
    points: [line.point(PLACES.delhi), line.point(PLACES.athens)],
  },
  arcade: {
    land: arcade.land,
    rings: [1100, 700, 340].map((km) => arcade.circle(PLACES.seoul, km)),
    points: [PLACES.seoul, PLACES.tokyo, PLACES.osaka, PLACES.beijing, PLACES.shanghai].map(arcade.point),
  },
  free: {
    land: free.land,
    ring: free.circle(PLACES.newYork, 480),
    center: free.point(PLACES.newYork),
    points: [PLACES.boston, PLACES.philadelphia, PLACES.washington, PLACES.toronto].map(free.point),
  },
  pin: {
    land: pin.land,
    path: pin.line(PLACES.bogota, PLACES.rio),
    guess: pin.point(PLACES.bogota),
    target: pin.point(PLACES.rio),
  },
  halfway: {
    land: halfway.land,
    path: halfway.line(PLACES.paris, PLACES.berlin),
    ends: [halfway.point(PLACES.paris), halfway.point(PLACES.berlin)],
    ring: halfway.circle(halfwayMid, 200),
    answer: halfway.point(PLACES.frankfurt),
  },
  capital: {
    land: capital.land,
    country: capital.shape('ITA'),
    point: capital.point(PLACES.rome),
  },
  mystery: {
    land: mystery.land,
    guesses: ['ZAF', 'NGA', 'EGY', 'COD', 'DZA'].map((id) => ({ d: mystery.shape(id), tone: toneFor(id) })),
    target: mystery.shape(target.id),
    point: mystery.point([target.latlng[1], target.latlng[0]]),
  },
  blitz: {
    land: blitz.land,
    target: blitz.shape('DEU'),
    found: ['FRA', 'POL', 'AUT', 'NLD'].map(blitz.shape),
  },
  atlas: {
    land: atlas.land,
    sea: compact(geoPath(atlas.projection)(outlines['black-sea']!)),
    point: atlas.point([34.5, 43.2]),
  },
  river: {
    land: river.land,
    drawn: compact(geoPath(river.projection)({ type: 'LineString', coordinates: danubeDrawn })),
    source: river.point(danube[0]!),
    head: river.point(danubeDrawn.at(-1)!),
  },
  area: { left: sameScale('BRA', 180), right: sameScale('AUS', 460) },
};

const out = new URL('../src/games/card-art-data.json', import.meta.url);
const text = JSON.stringify(art);
writeFileSync(out, `${text}\n`);
console.log(`card-art-data.json: ${(text.length / 1024).toFixed(1)} KB`);
for (const [name, value] of Object.entries(art)) console.log(` ${name}: ${(JSON.stringify(value).length / 1024).toFixed(1)} KB`);
