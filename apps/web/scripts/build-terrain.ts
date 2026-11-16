// Builds the colour terrain under WorldMap (`terrain` prop) from Natural Earth's
// 1:50m colour rasters with shaded relief and water (public domain), one set of
// tiles per source in TERRAIN_SOURCES. The map draws TERRAIN_SOURCE (terrain.ts).
//
//   node apps/web/scripts/build-terrain.ts [--offline]
//
// The rasters stay in plain longitude/latitude (equirectangular): WorldMap turns
// its projection to centre each frame, so no single pre-projected picture could
// line up with every frame. The browser reprojects the part it shows instead
// (src/components/terrain.ts), which is quick because the picture is small.
//
// Output: src/assets/terrain/<source>/<n>.jpg, colour JPEG tiles of
// TERRAIN_TILE_DEGREES of longitude each, from 180°W.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { unzipEntry } from '../../../packages/geodata/scripts/lib/zip.ts';
import { TERRAIN_BOUNDS, TERRAIN_PER_DEGREE, TERRAIN_SOURCES, TERRAIN_TILE_DEGREES, type TerrainSource } from '../src/components/terrain-bounds.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '..', '.cache');
const ASSETS = join(HERE, '..', 'src', 'assets', 'terrain');
const QUALITY = 74;
/** Where each raster sits inside its zip. */
const ENTRY: Record<TerrainSource, string> = {
  NE1_50M_SR_W: 'NE1_50M_SR_W/NE1_50M_SR_W.tif',
  HYP_50M_SR_W: 'HYP_50M_SR_W.tif',
};

async function source(name: TerrainSource): Promise<Buffer> {
  const file = join(CACHE, `${name}.zip`);
  if (!process.argv.includes('--offline') || !existsSync(file)) {
    const url = `https://naciscdn.org/naturalearth/50m/raster/${name}.zip`;
    console.log(`fetch ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return unzipEntry(await readFile(file), ENTRY[name]);
}

async function build(name: TerrainSource) {
  const tif = sharp(await source(name), { limitInputPixels: false }).removeAlpha().toColourspace('srgb');
  const { width = 0 } = await tif.metadata();
  // The source covers the whole globe, 180°W–180°E and 90°N–90°S.
  const perDegree = width / 360;
  const { north, south } = TERRAIN_BOUNDS;
  const size = { width: 360 * TERRAIN_PER_DEGREE, height: Math.round((north - south) * TERRAIN_PER_DEGREE) };
  const pixels = await tif
    .extract({ left: 0, top: Math.round((90 - north) * perDegree), width, height: Math.round((north - south) * perDegree) })
    .resize(size.width, size.height, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  // Tiles: a frame decodes only the one or two it shows, which keeps a phone's memory free.
  const dir = join(ASSETS, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const tileWidth = TERRAIN_TILE_DEGREES * TERRAIN_PER_DEGREE;
  let bytes = 0;
  for (let i = 0; i * TERRAIN_TILE_DEGREES < 360; i++) {
    const tile = await sharp(pixels, { raw: { ...size, channels: 3 } })
      .extract({ left: i * tileWidth, top: 0, width: tileWidth, height: size.height })
      .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    await writeFile(join(dir, `${i}.jpg`), tile);
    bytes += tile.length;
  }
  console.log(`${name}: ${size.width}×${size.height} in ${360 / TERRAIN_TILE_DEGREES} tiles, ${(bytes / 1024).toFixed(0)} KB`);
}

for (const name of TERRAIN_SOURCES) await build(name);
