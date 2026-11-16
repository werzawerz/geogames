import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERRAIN_SOURCES } from './terrain-bounds.ts';

// terrain.ts can't be imported here (import.meta.glob is Vite's), so its source is read as text.
const source = readFileSync(new URL('./terrain.ts', import.meta.url), 'utf8');

describe('terrain', () => {
  it('ships the tiles of the source it draws, and only those', () => {
    const chosen = /export const TERRAIN_SOURCE: TerrainSource = '([^']+)'/.exec(source)?.[1];
    expect(TERRAIN_SOURCES).toContain(chosen);
    const globs = [...source.matchAll(/import\.meta\.glob<string>\('([^']+)'/g)].map((m) => m[1]);
    expect(globs).toEqual([`../assets/terrain/${chosen}/*.jpg`]);
  });
});
