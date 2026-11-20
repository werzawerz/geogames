import version from '../data/regions-version.json' with { type: 'json' };

/** One first-level division (a state, province or region) of a country. */
export interface RegionDivision {
  /** "DEU-Bayern": the country's id, then the source's name for it. Stable between builds. */
  id: string;
  /** The English name shown after the answer. */
  name: string;
  /** Other names it answers to: the local name, short forms, the old name. */
  aliases: string[];
  /** 0 to 1: how well known it is, taken from its size (the biggest is 1) and lifted for the famous ones. 0 for one never asked. */
  fame: number;
  /** Big enough to see on the map, and not disputed. Only targets are asked. */
  target: boolean;
  /** Polygons, each a list of rings (the outline, then holes), each ring a flat list of integers: the first point and then the steps between points, in 1/q degrees. */
  poly: number[][][];
}

export interface RegionCountry {
  /** ISO 3166-1 alpha-3. */
  id: string;
  name: string;
  /** 1: the countries everybody can place a few divisions of. 3: the ones few people know. */
  tier: 1 | 2 | 3;
  /** Integer steps in `poly` are in 1/q degrees. */
  q: number;
  divisions: RegionDivision[];
}

/** data/regions.json (scripts/build-regions.ts). */
export interface RegionData {
  generatedAt: string;
  countries: RegionCountry[];
}

/** When the divisions were built: part of the dataset version, so a server only replays runs made on the same ones. */
export const REGIONS_VERSION: string = version.generatedAt;

/** The divisions of Region Run, loaded only when it's played. */
export async function loadRegions(): Promise<RegionData> {
  const m = await import('../data/regions.json', { with: { type: 'json' } });
  return m.default as unknown as RegionData;
}

/** A division's shape as GeoJSON polygon coordinates ([lng, lat]). */
export function divisionCoordinates(country: Pick<RegionCountry, 'q'>, division: Pick<RegionDivision, 'poly'>): [number, number][][][] {
  return division.poly.map((rings) =>
    rings.map((flat) => {
      const ring: [number, number][] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        x += flat[i]!;
        y += flat[i + 1]!;
        ring.push([x / country.q, y / country.q]);
      }
      ring.push(ring[0]!);
      return ring;
    }),
  );
}
