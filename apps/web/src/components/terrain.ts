// Colour terrain for WorldMap's `terrain` prop: Natural Earth's shaded relief with
// water, stored in plain longitude/latitude tiles (scripts/build-terrain.ts). This
// reprojects the part a frame shows into the map's projection, as a picture drawn
// over the plain land and sea (it has both).
import type { GeoProjection } from 'd3-geo';
import { TERRAIN_BOUNDS, TERRAIN_PER_DEGREE, TERRAIN_TILE_DEGREES, type TerrainSource } from './terrain-bounds.ts';

// The picture the map draws. To switch, change both lines: Vite needs the glob's path
// written out, and only the tiles it names ship with the app (terrain.test.ts checks they match).
export const TERRAIN_SOURCE: TerrainSource = 'NE1_50M_SR_W';
const TILE_URLS = import.meta.glob<string>('../assets/terrain/NE1_50M_SR_W/*.jpg', { query: '?url', import: 'default', eager: true });
const tileUrl = (i: number) => Object.entries(TILE_URLS).find(([path]) => path.endsWith(`/${i}.jpg`))?.[1];
const TILES = 360 / TERRAIN_TILE_DEGREES;

interface Tile {
  /** RGB, three bytes a pixel: a quarter less than the canvas's RGBA. */
  data: Uint8Array;
  width: number;
  height: number;
}
/**
 * Decoded tiles, the most recently used last. A tile is about 9 MB decoded and a
 * frame needs one or two, so only a few are kept (a phone's memory is short).
 */
const tiles = new Map<number, Promise<Tile>>();
/** The same tiles once decoded, for drawing a frame at once (renderTerrainNow). */
const decoded = new Map<number, Tile>();
/** A phone keeps three (about 27 MB); a desktop keeps all six, so a new level needs no decoding. */
const KEEP_TILES = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches ? 3 : 6;

function loadTile(i: number): Promise<Tile> {
  const key = i;
  let tile = tiles.get(key);
  if (tile) {
    tiles.delete(key);
    tiles.set(key, tile);
  } else {
    tile = new Promise<Tile>((resolve, reject) => {
      const url = tileUrl(i);
      if (!url) return reject(new Error(`no terrain tile ${key}`));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
        const data = new Uint8Array(img.width * img.height * 3);
        for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
          data[q] = rgba[p]!;
          data[q + 1] = rgba[p + 1]!;
          data[q + 2] = rgba[p + 2]!;
        }
        const done = { data, width: img.width, height: img.height };
        if (tiles.has(key)) decoded.set(key, done);
        resolve(done);
      };
      img.onerror = () => reject(new Error(`terrain tile ${key} failed to load`));
      img.src = url;
    });
    tile.catch(() => tiles.delete(key));
    tiles.set(key, tile);
    for (const old of tiles.keys()) {
      if (tiles.size <= KEEP_TILES) break;
      tiles.delete(old);
      decoded.delete(old);
    }
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

/** Longitude and latitude per pixel, kept between frames of the same size (every level is), one pair per size. */
const coords = new Map<number, [Float32Array, Float32Array]>();
function buffers(size: number): [Float32Array, Float32Array] {
  let pair = coords.get(size);
  if (!pair) {
    if (coords.size >= 4) coords.clear();
    pair = [new Float32Array(size), new Float32Array(size)];
    coords.set(size, pair);
  }
  pair[0].fill(NaN);
  pair[1].fill(NaN);
  return pair;
}

const tileOf = (lngDeg: number) => Math.min(Math.floor((lngDeg + 180) / TERRAIN_TILE_DEGREES), TILES - 1);

/**
 * Draws the terrain for the map area [x0, y0]–[x1, y1] (map units) in the given
 * projection: a rotated Natural Earth one, as WorldMap makes. `density` is
 * pixels per map unit. Off the globe, and north or south of the picture, stays clear.
 */
export async function renderTerrain(
  projection: GeoProjection,
  extent: [[number, number], [number, number]],
  density: number,
): Promise<TerrainImage | null> {
  const frame = locate(projection, extent, density);
  if (!frame) return null;
  const loaded = new Map(await Promise.all([...frame.needed].map(async (i) => [i, await loadTile(i)] as const)));
  const canvas = paint(frame, loaded);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (!blob) return null;
  return image(URL.createObjectURL(blob), extent);
}

/**
 * The same, drawn right away as a data URL, when every tile it needs is already
 * decoded; undefined when one isn't (then use renderTerrain). Meant for small,
 * quick frames: it blocks while it draws.
 */
export function renderTerrainNow(
  projection: GeoProjection,
  extent: [[number, number], [number, number]],
  density: number,
): TerrainImage | null | undefined {
  const frame = locate(projection, extent, density);
  if (!frame) return null;
  const loaded = new Map<number, Tile>();
  for (const i of frame.needed) {
    const tile = decoded.get(i);
    if (!tile) return undefined;
    loaded.set(i, tile);
  }
  for (const i of frame.needed) loadTile(i); // mark them recently used
  return image(paint(frame, loaded).toDataURL('image/jpeg', 0.85), extent);
}

/**
 * Decodes the tiles the next frames may need while the player looks at this one, when
 * all of them fit in the cache (not on a phone), so a new level always draws at once.
 */
export function warmTerrain(): void {
  if (KEEP_TILES < TILES) return;
  const idle = (fn: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 200));
  const next = (i: number) => {
    if (i >= TILES) return;
    if (tiles.has(i)) return next(i + 1);
    idle(() => loadTile(i).then(() => next(i + 1), () => next(i + 1)));
  };
  next(0);
}

const image = (href: string, [[x0, y0], [x1, y1]]: [[number, number], [number, number]]): TerrainImage => ({
  href,
  x: x0,
  y: y0,
  width: x1 - x0,
  height: y1 - y0,
});

interface Frame {
  width: number;
  height: number;
  lng: Float32Array;
  lat: Float32Array;
  needed: Set<number>;
}

/** Each pixel's longitude and latitude, and the tiles they fall in; null if none is on the picture. */
function locate(
  projection: GeoProjection,
  [[x0, y0], [x1, y1]]: [[number, number], [number, number]],
  density: number,
): Frame | null {
  const k = projection.scale();
  const [tx, ty] = projection.translate();
  const lng0 = -projection.rotate()[0];
  const width = Math.round((x1 - x0) * density);
  const height = Math.round((y1 - y0) * density);
  const { north, south } = TERRAIN_BOUNDS;

  // Longitude and latitude (degrees) of each pixel, or NaN off the globe or off the picture.
  const [lng, lat] = buffers(width * height);
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
  return needed.size === 0 ? null : { width, height, lng, lat, needed };
}

function paint({ width, height, lng, lat }: Frame, loaded: Map<number, Tile>): HTMLCanvasElement {
  const { north } = TERRAIN_BOUNDS;
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
    const a = (cy * tile.width + cx) * 3;
    const b = a + 3;
    const c = a + tile.width * 3;
    const d = c + 3;
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
  return canvas;
}
