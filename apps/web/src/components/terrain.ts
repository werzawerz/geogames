// Colour terrain for WorldMap's `terrain` prop: Natural Earth's shaded relief with
// water, stored in plain longitude/latitude tiles (scripts/build-terrain.ts). This
// reprojects the part a frame shows into the map's projection, as a picture drawn
// over the plain land and sea (it has both).
import type { GeoProjection } from 'd3-geo';
import { TERRAIN_BOUNDS, TERRAIN_PER_DEGREE, TERRAIN_SOURCE, TERRAIN_TILE_DEGREES, type TerrainSource } from './terrain-bounds.ts';

const TILE_URLS = import.meta.glob<string>('../assets/terrain/*/*.jpg', { query: '?url', import: 'default', eager: true });
const tileUrl = (source: TerrainSource, i: number) =>
  Object.entries(TILE_URLS).find(([path]) => path.endsWith(`/${source}/${i}.jpg`))?.[1];
const TILES = 360 / TERRAIN_TILE_DEGREES;

interface Tile {
  /** RGBA, as the canvas decodes it. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
const tiles = new Map<string, Promise<Tile>>();

/** A tile's pixels, decoded once and kept: a frame usually needs only one or two. */
function loadTile(source: TerrainSource, i: number): Promise<Tile> {
  const key = `${source}/${i}`;
  let tile = tiles.get(key);
  if (!tile) {
    tile = new Promise<Tile>((resolve, reject) => {
      const url = tileUrl(source, i);
      if (!url) return reject(new Error(`no terrain tile ${key}`));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        resolve({ data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width, height: img.height });
      };
      img.onerror = () => reject(new Error(`terrain tile ${key} failed to load`));
      img.src = url;
    });
    tile.catch(() => tiles.delete(key));
    tiles.set(key, tile);
  }
  return tile;
}

// d3's Natural Earth projection (geoNaturalEarth1Raw): x = λ·xFactor(φ), y = yOf(φ).
const xFactor = (p: number) => {
  const p2 = p * p;
  const p4 = p2 * p2;
  return 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4));
};
const yOf = (p: number) => {
  const p2 = p * p;
  return p * (1.007226 + p2 * (0.015085 + p2 * p2 * (-0.044475 + 0.028874 * p2 - 0.005916 * p2 * p2)));
};
const dyOf = (p: number) => {
  const p2 = p * p;
  return 1.007226 + p2 * (0.045255 + p2 * p2 * (-0.311325 + 0.259866 * p2 - 0.065076 * p2 * p2));
};
const Y_MAX = yOf(Math.PI / 2);
/** Latitude (radians) for a raw y, by Newton's method. */
function latitudeOf(y: number): number {
  let p = y;
  for (let i = 0; i < 25; i++) {
    const step = (yOf(p) - y) / dyOf(p);
    p -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  return p;
}

export interface TerrainImage {
  href: string;
  /** Where the picture sits, in the map's (unzoomed) units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const tileOf = (lngDeg: number) => Math.min(Math.floor((lngDeg + 180) / TERRAIN_TILE_DEGREES), TILES - 1);

/**
 * Draws the terrain for the map area [x0, y0]–[x1, y1] (map units) in the given
 * projection: a rotated Natural Earth one, as WorldMap makes. `density` is
 * pixels per map unit. Off the globe, and north or south of the picture, stays clear.
 */
export async function renderTerrain(
  projection: GeoProjection,
  [[x0, y0], [x1, y1]]: [[number, number], [number, number]],
  density: number,
  source: TerrainSource = TERRAIN_SOURCE,
): Promise<TerrainImage | null> {
  const k = projection.scale();
  const [tx, ty] = projection.translate();
  const lng0 = -projection.rotate()[0];
  const width = Math.round((x1 - x0) * density);
  const height = Math.round((y1 - y0) * density);
  const { north, south } = TERRAIN_BOUNDS;

  // Longitude and latitude (degrees) of each pixel, or NaN off the globe or off the picture.
  const lng = new Float32Array(width * height).fill(NaN);
  const lat = new Float32Array(width * height).fill(NaN);
  const needed = new Set<number>();
  for (let row = 0; row < height; row++) {
    const y = (ty - (y0 + (row + 0.5) / density)) / k;
    if (Math.abs(y) > Y_MAX) continue;
    const phi = latitudeOf(y);
    const latDeg = (phi * 180) / Math.PI;
    if (latDeg > north || latDeg < south) continue;
    const f = xFactor(phi);
    for (let col = 0; col < width; col++) {
      const lambda = (x0 + (col + 0.5) / density - tx) / k / f;
      if (Math.abs(lambda) > Math.PI) continue;
      const lngDeg = ((((lambda * 180) / Math.PI + lng0 + 180) % 360) + 360) % 360 - 180;
      const p = row * width + col;
      lng[p] = lngDeg;
      lat[p] = latDeg;
      needed.add(tileOf(lngDeg));
    }
  }
  if (needed.size === 0) return null;
  const loaded = new Map(await Promise.all([...needed].map(async (i) => [i, await loadTile(source, i)] as const)));

  const out = new ImageData(width, height);
  for (let p = 0; p < lng.length; p++) {
    const lngDeg = lng[p]!;
    if (Number.isNaN(lngDeg)) continue;
    const i = tileOf(lngDeg);
    const tile = loaded.get(i)!;
    // Bilinear, inside the tile.
    const fx = Math.min(tile.width - 1.001, Math.max(0, (lngDeg + 180 - i * TERRAIN_TILE_DEGREES) * TERRAIN_PER_DEGREE - 0.5));
    const fy = Math.min(tile.height - 1.001, Math.max(0, (north - lat[p]!) * TERRAIN_PER_DEGREE - 0.5));
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    const ax = fx - cx;
    const ay = fy - cy;
    const a = (cy * tile.width + cx) * 4;
    const b = a + 4;
    const c = a + tile.width * 4;
    const d = c + 4;
    const src = tile.data;
    const o = p * 4;
    for (let ch = 0; ch < 3; ch++) {
      out.data[o + ch] = (src[a + ch]! * (1 - ax) + src[b + ch]! * ax) * (1 - ay) + (src[c + ch]! * (1 - ax) + src[d + ch]! * ax) * ay;
    }
    out.data[o + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) return null;
  return { href: URL.createObjectURL(blob), x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
