import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { geoCentroid, geoNaturalEarth1, geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import type { CountryId } from '@geogames/geodata';
import type { WorldShapes } from '@geogames/geodata/shapes';
import { mainland } from './mainland.ts';

export type MapTone = 'start' | 'end' | 'optimal' | 'near' | 'far' | 'route';

export interface MapCountry {
  id: CountryId;
  tone: MapTone;
  label?: string;
}

const WIDTH = 960;
const HEIGHT = 540;
const PADDING = 48;
/** Caps zoom so neighbouring microstates don't fill the screen. */
const MAX_SCALE = 2600;

/** Label font size in map units; must match .map-label in styles.css (it grows on narrow screens). */
export const labelSize = () => (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches ? 30 : 13);

/**
 * Keeps the labels that don't overlap an earlier one; list the most important
 * first. `x` is the label's centre (`anchor: 'middle'`) or left edge (`'start'`).
 */
export function fitLabels<T extends { x: number; y: number; text: string }>(
  items: readonly T[],
  anchor: 'middle' | 'start',
): T[] {
  const size = labelSize();
  const boxes: { left: number; right: number; y: number }[] = [];
  return items.filter((item) => {
    const w = item.text.length * size * 0.6;
    const left = anchor === 'middle' ? item.x - w / 2 : item.x;
    const box = { left, right: left + w, y: item.y };
    const overlaps = boxes.some((b) => b.left < box.right && box.left < b.right && Math.abs(b.y - box.y) < size * 1.1);
    if (!overlaps) boxes.push(box);
    return !overlaps;
  });
}

/** Map coordinates → zoomed screen units, for things that should not grow with the zoom. */
export type ToScreen = (lngLat: [number, number]) => [number, number] | null;

/**
 * Positions labels at each country's mainland centre, skipping any that would
 * overlap one already placed. Later entries in `countries` win, so callers list
 * the most important (start, goal) last.
 */
function placeLabels(countries: readonly MapCountry[], shapes: WorldShapes, toScreen: ToScreen) {
  const candidates = [...countries].reverse().flatMap(({ id, label }) => {
    const shape = shapes.countries.get(id);
    const point = shape && label ? toScreen(geoCentroid(mainland(shape)) as [number, number]) : null;
    return point && label ? [{ id, text: label, x: point[0], y: point[1] }] : [];
  });
  return fitLabels(candidates, 'middle');
}

const MAX_ZOOM = 20;

/**
 * A political map: every country with its borders, the given `countries`
 * coloured and labelled. It is framed on `frame` (any GeoJSON) or else on the
 * `focus` countries' mainlands, and can be zoomed (wheel, pinch, buttons) and
 * panned. Countries outside `inPlay` are dimmed (e.g. outside the chosen region).
 *
 * Extra layers: `overlay` draws shapes (e.g. a circle) that zoom with the map;
 * `markers` draws dots and labels at a fixed size, positioned with `toScreen`.
 */
export function WorldMap({
  shapes,
  countries = [],
  focus = [],
  frame,
  inPlay,
  overlay,
  markers,
  onPick,
  label,
  borders = true,
  maxZoom = MAX_ZOOM,
}: {
  shapes: WorldShapes;
  countries?: readonly MapCountry[];
  focus?: readonly CountryId[];
  /** Framing shape; callers should memoize it. */
  frame?: GeoPermissibleObjects;
  inPlay?: ReadonlySet<CountryId>;
  overlay?: (projection: GeoProjection) => ReactNode;
  markers?: (toScreen: ToScreen) => ReactNode;
  /** Called with [lng, lat] when the map is clicked (not dragged); also shows a crosshair cursor. */
  onPick?: (lngLat: [number, number]) => void;
  label: string;
  /** False leaves out every border but those of `countries`: the others aren't in the page at all. */
  borders?: boolean;
  /** How far in the map zooms, compared to its starting view. */
  maxZoom?: number;
}) {
  const focusKey = focus.join(',');
  const projection = useMemo(() => {
    const features = focus.flatMap((id) => {
      const shape = shapes.countries.get(id);
      return shape ? [mainland(shape)] : [];
    });
    const collection = frame ?? { type: 'FeatureCollection' as const, features };
    // A sphere (whole world) has no centroid; centre on Greenwich then.
    const [lng = 0] = geoCentroid(collection).map((v) => (Number.isFinite(v) ? v : 0));
    const p = geoNaturalEarth1()
      .rotate([-lng, 0])
      .fitExtent(
        [
          [PADDING, PADDING],
          [WIDTH - PADDING, HEIGHT - PADDING],
        ],
        collection,
      );
    if (p.scale() > MAX_SCALE) {
      const center = geoCentroid(collection);
      p.scale(MAX_SCALE);
      const [x, y] = p(center)!;
      const [tx, ty] = p.translate();
      p.translate([tx + WIDTH / 2 - x, ty + HEIGHT / 2 - y]);
    }
    return p;
    // focusKey stands in for `focus` so an equal list doesn't re-frame the map.
  }, [shapes, focusKey, frame]);

  const path = useMemo(() => geoPath(projection), [projection]);
  const landPath = useMemo(() => path(shapes.land) ?? '', [path, shapes.land]);
  // Base layer of every country; only recomputed when the frame changes, never while zooming.
  const base = useMemo(
    () =>
      [...shapes.countries].map(([id, shape]) => (
        <path
          key={id}
          data-id={id}
          className={`map-country ${!inPlay || inPlay.has(id) ? 'tone-base' : 'tone-outside'}`}
          d={path(shape) ?? ''}
        />
      )),
    [shapes, path, inPlay],
  );

  // Zoom and pan: d3-zoom drives a transform on the geometry layer.
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  useEffect(() => {
    const svg = svgRef.current!;
    const behavior = zoom<SVGSVGElement, unknown>().on('zoom', (e: { transform: ZoomTransform }) =>
      setTransform(e.transform),
    );
    select(svg).call(behavior);
    zoomRef.current = behavior;
    return () => {
      select(svg).on('.zoom', null);
    };
  }, []);
  const applyZoom = (change: (behavior: ZoomBehavior<SVGSVGElement, unknown>, svg: SVGSVGElement) => void) => {
    if (svgRef.current && zoomRef.current) change(zoomRef.current, svgRef.current);
  };
  const resetZoom = () => applyZoom((behavior, svg) => select(svg).call(behavior.transform, zoomIdentity));

  // The whole globe is drawn (just cropped to the frame), so players may zoom out
  // until all of it fits and pan anywhere on it, for context around a circle or route.
  const minZoom = useMemo(() => {
    const [[x0, y0], [x1, y1]] = path.bounds({ type: 'Sphere' });
    return Math.min(1, WIDTH / (x1 - x0), HEIGHT / (y1 - y0));
  }, [path]);
  useEffect(() => {
    const [[x0, y0], [x1, y1]] = path.bounds({ type: 'Sphere' });
    applyZoom((behavior) => {
      behavior.scaleExtent([minZoom, maxZoom]).translateExtent([
        [Math.min(0, x0), Math.min(0, y0)],
        [Math.max(WIDTH, x1), Math.max(HEIGHT, y1)],
      ]);
    });
    // A new frame (next round) starts at its fitted view.
    resetZoom();
    // applyZoom and resetZoom only read refs, so they aren't dependencies.
  }, [path, minZoom, maxZoom]);

  const toScreen: ToScreen = (lngLat) => {
    const point = projection(lngLat);
    return point ? transform.apply(point) : null;
  };

  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    const matrix = e.currentTarget.getScreenCTM();
    if (!onPick || !matrix) return;
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    const lngLat = projection.invert?.(transform.invert([point.x, point.y]));
    if (lngLat) onPick([lngLat[0], lngLat[1]]);
  };

  return (
    <div className="map-frame">
      <svg
        ref={svgRef}
        className={`world-map${onPick ? ' pickable' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        onClick={onPick ? handleClick : undefined}
      >
        <rect className="map-sea" width={WIDTH} height={HEIGHT} />
        <g transform={transform.toString()}>
          <path className="map-land" d={landPath} />
          {borders && <g>{base}</g>}
          {countries.map(({ id, tone }) => {
            const shape = shapes.countries.get(id);
            return shape ? <path key={id} className={`map-country map-highlight tone-${tone}`} d={path(shape) ?? ''} /> : null;
          })}
          {overlay?.(projection)}
        </g>
        {placeLabels(countries, shapes, toScreen).map(({ id, text, x, y }) => (
          <text key={`label-${id}`} className="map-label" x={x} y={y}>
            {text}
          </text>
        ))}
        {markers?.(toScreen)}
      </svg>
      <div className="map-zoom" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => applyZoom((b, svg) => select(svg).call(b.scaleBy, 1.6))}>
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={transform.k <= minZoom + 1e-6}
          onClick={() => applyZoom((b, svg) => select(svg).call(b.scaleBy, 1 / 1.6))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          disabled={transform.k === 1 && transform.x === 0 && transform.y === 0}
          onClick={resetZoom}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
