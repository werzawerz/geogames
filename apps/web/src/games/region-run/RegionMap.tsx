import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { geoArea, geoPath } from 'd3-geo';
import { divisionCoordinates, type RegionCountry } from '@geogames/geodata/regions';
import { REGION_MAP, REGION_MAP_TALL, regionProjection } from '@geogames/geodata/regions-map';
/** A lit division smaller than this (map units squared) gets a ring round it, or a phone screen would lose it. */
const RING_BELOW = 1800;

export type DivisionTone = 'lit' | 'wrong' | 'answer';

interface Shape {
  id: string;
  d: string;
  /** Where a ring or a name goes: the middle of the division's biggest piece. */
  at: [number, number] | null;
  area: number;
}

/**
 * A country's divisions as plain shapes: no names, no labels, no capitals, and
 * the lit one is told apart by colour alone. Every division is in the page
 * whether or not it is the answer, so nothing in the markup tells them apart
 * before the level ends. Zooms and pans (wheel, pinch, buttons).
 */
/** A phone-width screen gets the tall map. */
const TALL = '(max-width: 640px)';
function useTall(): boolean {
  const [tall, setTall] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(TALL).matches);
  useEffect(() => {
    const query = matchMedia(TALL);
    const change = () => setTall(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return tall;
}

export function RegionMap({
  country,
  tones,
  nameOf,
  label,
}: {
  country: RegionCountry;
  /** Divisions to colour: the lit one, wrong guesses, the revealed answer. */
  tones: ReadonlyMap<string, DivisionTone>;
  /** The names to write on the map: only ever the answer, once it is revealed. */
  nameOf?: ReadonlyMap<string, string>;
  label: string;
}) {
  const frame = useTall() ? REGION_MAP_TALL : REGION_MAP;
  const { width: WIDTH, height: HEIGHT } = frame;
  const shapes = useMemo<Shape[]>(() => {
    const parts = country.divisions.map((d) => ({ d, polygons: divisionCoordinates(country, d) }));
    const all = {
      type: 'FeatureCollection' as const,
      features: parts.map(({ polygons }) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiPolygon' as const, coordinates: polygons } })),
    };
    const path = geoPath(regionProjection(country.id, all, frame));
    return parts.map(({ d, polygons }) => {
      const biggest = polygons.reduce((a, b) => (geoArea({ type: 'Polygon', coordinates: b }) > geoArea({ type: 'Polygon', coordinates: a }) ? b : a));
      const at = path.centroid({ type: 'Polygon', coordinates: biggest });
      return {
        id: d.id,
        d: path({ type: 'MultiPolygon', coordinates: polygons }) ?? '',
        at: Number.isFinite(at[0]) ? (at as [number, number]) : null,
        area: path.area({ type: 'MultiPolygon', coordinates: polygons }),
      };
    });
  }, [country, frame]);

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  useEffect(() => {
    const svg = svgRef.current!;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on('zoom', (e: { transform: ZoomTransform }) => setTransform(e.transform));
    select(svg).call(behavior);
    zoomRef.current = behavior;
    return () => {
      select(svg).on('.zoom', null);
    };
  }, [WIDTH, HEIGHT]);
  // Each country starts at its whole view.
  useEffect(() => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  }, [country.id, frame]);
  const by = (change: (b: ZoomBehavior<SVGSVGElement, unknown>, svg: SVGSVGElement) => void) => {
    if (svgRef.current && zoomRef.current) change(zoomRef.current, svgRef.current);
  };

  const lit = shapes.find((s) => tones.get(s.id) === 'lit');
  const toScreen = (p: [number, number]) => transform.apply(p);
  const named = shapes.filter((s) => nameOf?.has(s.id) && s.at);

  return (
    <div className="map-frame">
      <svg ref={svgRef} className="world-map region-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
        <rect className="map-sea" width={WIDTH} height={HEIGHT} />
        <g transform={transform.toString()}>
          {shapes.map((s) => {
            const tone = tones.get(s.id);
            return <path key={s.id} className={`map-country ${tone ? `region-${tone}` : 'tone-base'}`} d={s.d} />;
          })}
        </g>
        {lit?.at && lit.area < RING_BELOW && (
          <circle className="region-ring" cx={toScreen(lit.at)[0]} cy={toScreen(lit.at)[1]} r={Math.max(16, Math.sqrt(lit.area) * transform.k * 0.8 + 8)} />
        )}
        {named.map((s) => {
          const [x, y] = toScreen(s.at!);
          return (
            <text key={s.id} className="region-name" x={x} y={y}>
              {nameOf!.get(s.id)}
            </text>
          );
        })}
      </svg>
      <div className="map-zoom" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => by((b, svg) => select(svg).call(b.scaleBy, 1.6))}>
          +
        </button>
        <button type="button" aria-label="Zoom out" disabled={transform.k <= 1 + 1e-6} onClick={() => by((b, svg) => select(svg).call(b.scaleBy, 1 / 1.6))}>
          −
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          disabled={transform.k === 1 && transform.x === 0 && transform.y === 0}
          onClick={() => by((b, svg) => select(svg).call(b.transform, zoomIdentity))}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
