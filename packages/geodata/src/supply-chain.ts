export interface Producer {
  /** The country's ISO 3166-1 alpha-3 id. */
  id: string;
  /** Output in the commodity's unit (the average of three years for farm goods). */
  value: number;
  /** Share of the world's output, 0..1. */
  share: number;
}

export interface Commodity {
  id: string;
  kind: 'farm' | 'mine' | 'energy';
  /** Reads after "the most": "coffee", "cow’s milk". */
  name: string;
  /** 1: famous leaders, 2: players have to know who really makes it, 3: niche. */
  tier: 1 | 2 | 3;
  unit: string;
  /** Key into SupplyChainData.sources. */
  source: 'faostat' | 'usgs' | 'eia';
  /** "2024", or "average of 2022 to 2024". */
  year: string;
  /** The ten biggest, biggest first. */
  producers: Producer[];
  /** Countries whose output the source withholds; none of them is a big producer. */
  withheld?: string[];
}

/** data/supply-chain.json (scripts/build-supply-chain.ts). */
export interface SupplyChainData {
  /** Hash of the commodities and their ranks: part of the dataset version. */
  version: string;
  sources: Record<string, { name: string; url: string; licence: string; year: string }>;
  commodities: Commodity[];
}

import versionFile from '../data/supply-chain-version.json' with { type: 'json' };

/** Changes when a rebuild changes which countries lead which commodity, so a server only replays runs made on the same data. */
export const SUPPLY_CHAIN_VERSION: string = versionFile.version;

/** The commodities of Supply Chain, loaded only when it's played. */
export async function loadSupplyChain(): Promise<SupplyChainData> {
  const m = await import('../data/supply-chain.json', {
    with: { type: 'json' },
  });
  return m.default as unknown as SupplyChainData;
}
