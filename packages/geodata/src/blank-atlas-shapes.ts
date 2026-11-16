// Separate entry point (`@geogames/geodata/blank-atlas-shapes`): the outlines of the
// Blank Atlas features, only for drawing them. Kept apart from blank-atlas.ts so
// the server, which only replays games, never bundles them.
import type { Geometry } from 'geojson';

/** Outlines by feature id, only for drawing them. */
export async function loadBlankAtlasShapes(): Promise<Readonly<Record<string, Geometry>>> {
  const m = await import('../data/blank-atlas-shapes.json', { with: { type: 'json' } });
  return m.default as unknown as Record<string, Geometry>;
}
