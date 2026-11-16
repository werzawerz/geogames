// Shared by the terrain build (scripts/build-terrain.ts) and the map that draws it.

/**
 * Natural Earth's 1:50m colour rasters, both with shaded relief and water, neither
 * with drainages (rivers in the picture would spoil a river game):
 * - NE1_50M_SR_W: Natural Earth I, natural colours (green lowlands, tan deserts);
 * - HYP_50M_SR_W: hypsometric tints, coloured by height.
 */
export const TERRAIN_SOURCES = ['NE1_50M_SR_W', 'HYP_50M_SR_W'] as const;
export type TerrainSource = (typeof TERRAIN_SOURCES)[number];
/** The picture WorldMap's `terrain` draws: switching is this one line. */
export const TERRAIN_SOURCE: TerrainSource = 'NE1_50M_SR_W';

/** The latitudes the terrain picture covers: up to the pole (a tall phone map can show the Arctic), but not inland Antarctica. */
export const TERRAIN_BOUNDS = { north: 90, south: -66 } as const;
/** Pixels per degree: about 6 km a pixel. */
export const TERRAIN_PER_DEGREE = 18;
/** Each tile covers this many degrees of longitude, from 180°W, and every latitude in TERRAIN_BOUNDS. */
export const TERRAIN_TILE_DEGREES = 60;
