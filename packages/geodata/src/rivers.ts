/** 1: the great rivers. 2: regional rivers. 3: tributaries and misleading starts. 4: hard to place, deepest band only. */
export type RiverTier = 1 | 2 | 3 | 4;

export interface River {
  id: string;
  name: string;
  /** Other names a player may type (Rhein, Huang He). */
  aliases: string[];
  tier: RiverTier;
  continent: 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania';
  /** The usual published length. */
  lengthKm: number;
  /** [lng, lat] from the source to the mouth (or where a tributary joins). */
  line: [number, number][];
  /** [lng, lat] halfway along the line: where the names offered from half drawn are picked around. */
  anchor: [number, number];
}

/** data/rivers.json (scripts/build-rivers.ts). */
export interface RiverData {
  generatedAt: string;
  source: string;
  rivers: River[];
}

import version from '../data/rivers-version.json' with { type: 'json' };

/** When the rivers were built: part of the dataset version, so a server only replays runs made on the same rivers. */
export const RIVERS_VERSION: string = version.generatedAt;

/** The rivers of River Run, loaded only when it's played. */
export async function loadRivers(): Promise<RiverData> {
  const m = await import('../data/rivers.json', { with: { type: 'json' } });
  return m.default as unknown as RiverData;
}
