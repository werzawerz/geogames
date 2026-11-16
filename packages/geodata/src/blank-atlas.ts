// Separate entry point (`@geogames/geodata/blank-atlas`): the physical features
// of the Blank Atlas game (seas, ranges, deserts, lakes…), built from Natural
// Earth by scripts/build-blank-atlas.ts, loaded only when it's played. The
// outlines are a separate entry point (blank-atlas-shapes.ts), so a server
// replaying games never bundles them.

/** What a feature is, in a player's words. */
export type BlankAtlasKind =
  | 'sea'
  | 'gulf'
  | 'strait'
  | 'reef'
  | 'lake'
  | 'range'
  | 'desert'
  | 'plateau'
  | 'lowland'
  | 'valley'
  | 'delta'
  | 'coast'
  | 'peninsula'
  | 'island'
  | 'islands'
  | 'isthmus';

export interface BlankAtlasFeature {
  /** Slug of the name, e.g. "strait-of-gibraltar". */
  id: string;
  name: string;
  /** Other names that count: "Arabian Gulf", "Rockies", "Empty Quarter". */
  aliases: readonly string[];
  kind: BlankAtlasKind;
  /** 1 headline, 2 regional, 3 detailed: chosen by hand, it drives the game's ramp. */
  tier: 1 | 2 | 3;
  /** [lat, lng] of the feature's centre. */
  center: readonly [number, number];
  /** How far the feature reaches from its centre. */
  radiusKm: number;
  /** How far its centre is from the nearest coast on the game's map: an inland feature is framed to show one. */
  coastKm: number;
  /** [west, south, east, north] in degrees; west > east when it crosses the antimeridian. */
  bounds: readonly [number, number, number, number];
}

/** data/blank-atlas.json */
export interface BlankAtlasData {
  generatedAt: string;
  source: string;
  features: BlankAtlasFeature[];
}

export const BLANK_ATLAS_KIND_LABELS: Record<BlankAtlasKind, string> = {
  sea: 'Sea',
  gulf: 'Gulf or bay',
  strait: 'Strait or channel',
  reef: 'Reef',
  lake: 'Lake',
  range: 'Mountain range',
  desert: 'Desert',
  plateau: 'Plateau or highland',
  lowland: 'Plain or basin',
  valley: 'Valley',
  delta: 'Delta',
  coast: 'Coast',
  peninsula: 'Peninsula',
  island: 'Island',
  islands: 'Island group',
  isthmus: 'Isthmus',
};

/** Lakes big enough that the map always draws them as water, like the coast: they help you find your way inland. */
export const isContextLake = (f: Pick<BlankAtlasFeature, 'kind' | 'tier'>) => f.kind === 'lake' && f.tier <= 2;

/** The features' names and places: what the game engine (and a server replaying it) needs. */
export async function loadBlankAtlas(): Promise<BlankAtlasData> {
  const m = await import('../data/blank-atlas.json', { with: { type: 'json' } });
  return m.default as unknown as BlankAtlasData;
}
