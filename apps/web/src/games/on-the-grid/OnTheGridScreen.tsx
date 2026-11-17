import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { queryCountries } from '@geogames/geodata';
import { loadLandGrid, type LandGrid } from '@geogames/geodata/land-grid';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  GRID_MAX_LIVES,
  GRID_SKIP,
  arcadePools,
  compassPoint,
  createOnTheGrid,
  formatCoordinates,
  gridPlan,
  nearCity,
  replayOnTheGrid,
  towards,
  type CircleCity,
  type GridLines,
  type GridMark,
  type GridState,
  type OnTheGrid,
  type OnTheGridDefinition,
} from '@geogames/games';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import type { GameScreenProps } from '../types.ts';

const WORLD: GeoPermissibleObjects = { type: 'Sphere' };
/** Down to about 300 km across on a desktop map: enough to place a spot to a degree. */
const MAX_ZOOM = 40;
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const MARKS: Record<GridMark, string> = { flawless: '🟩', found: '🟨', lost: '🟥' };
/** Length of the arrow after a miss, in screen units. */
const ARROW = 46;
const TROPIC = 23.4365;

interface Line {
  kind: 'parallel' | 'meridian';
  /** Latitude of a parallel, longitude of a meridian. */
  value: number;
  label: string;
  /** [lng, lat] points, in order. */
  coordinates: [number, number][];
  major: boolean;
}

const parallel = (lat: number, label: string, major: boolean): Line => ({
  kind: 'parallel',
  value: lat,
  label,
  coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat] as [number, number]),
  major,
});
const meridian = (lng: number, label: string, major: boolean): Line => ({
  kind: 'meridian',
  value: lng,
  label,
  coordinates: Array.from({ length: 33 }, (_, i) => [lng, -80 + i * 5] as [number, number]),
  major,
});
const degrees = (v: number, pos: string, neg: string) => (v === 0 ? '0°' : `${Math.abs(v)}°${v < 0 ? neg : pos}`);

/** The lines a band draws: every 10°, or just the Equator, tropics and prime meridian, or none. */
function gridLines(kind: GridLines): Line[] {
  if (kind === 'none') return [];
  if (kind === 'key') {
    return [
      parallel(0, 'Equator', true),
      parallel(TROPIC, 'Tropic of Cancer', false),
      parallel(-TROPIC, 'Tropic of Capricorn', false),
      meridian(0, 'Prime meridian', true),
    ];
  }
  const lines: Line[] = [];
  for (let lat = -50; lat <= 80; lat += 10) lines.push(parallel(lat, degrees(lat, 'N', 'S'), lat === 0));
  for (let lng = -180; lng < 180; lng += 10) lines.push(meridian(lng, degrees(lng, 'E', 'W'), lng === 0));
  return lines;
}

/** The part of the map's 960 × 540 units that is on screen: more than the map when it is letterboxed, less when cropped. */
interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const FULL: View = { x0: 0, x1: 960, y0: 0, y1: 540 };
/** Labels keep this far (map units) from the edge of what's on screen. */
const EDGE = 16;
/** Room one label needs along a line (map units), so neighbours aren't named when they would run together. */
const LABEL_ROOM = 54;

function measure(frame: HTMLElement | null, slice: boolean): View {
  const box = frame?.querySelector('.world-map')?.getBoundingClientRect();
  if (!box || !box.width || !box.height) return FULL;
  const scale = (slice ? Math.max : Math.min)(box.width / 960, box.height / 540);
  const w = box.width / scale;
  const h = box.height / scale;
  return { x0: (960 - w) / 2, x1: (960 + w) / 2, y0: (540 - h) / 2, y1: (540 + h) / 2 };
}

/**
 * Where each line's label goes: at the edge of what's on screen, so it stays
 * readable when zoomed in (a parallel is named at its western-most visible
 * point, a meridian at its southern-most). Meridians crowd, so only every
 * second, third or sixth is named when the room between them is short.
 */
function placeLabels(lines: readonly Line[], toScreen: ToScreen, view: View) {
  const inView = (p: [number, number] | null): p is [number, number] =>
    !!p && p[0] >= view.x0 + EDGE && p[0] <= view.x1 - EDGE && p[1] >= view.y0 + EDGE && p[1] <= view.y1 - EDGE;
  const found: { line: Line; x: number; y: number; at: [number, number] }[] = [];
  for (const line of lines) {
    // Meridians run from lat -52 up: south of that the lines have nearly met.
    const at = line.kind === 'parallel'
      ? Array.from({ length: 357 }, (_, i) => [-178 + i, line.value] as [number, number])
      : Array.from({ length: 133 }, (_, i) => [line.value, -52 + i] as [number, number]);
    for (const point of at) {
      const p = toScreen(point);
      // A meridian cut off by the globe's rim near the top of the view would be named in a corner: skip it.
      if (inView(p) && (line.kind === 'parallel' || p[1] > (view.y0 + view.y1) / 2)) {
        found.push({ line, x: p[0], y: p[1], at: point });
        break;
      }
    }
  }
  const everyThird = (line: Line, at: [number, number]) => {
    const a = toScreen(at);
    const b = toScreen([at[0] + 10, at[1]]);
    const room = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
    const stride = [1, 2, 3, 6, 12, 36].find((n) => room * n >= LABEL_ROOM) ?? 36;
    return Math.round(line.value / 10) % stride === 0;
  };
  // 50°S and 180°W would meet in the corner, so the far-west meridian goes unnamed.
  return found.filter(({ line, at }) => !line.label.includes('°') || (line.kind === 'parallel' ? line.value !== -50 : line.value !== -180 && everyThird(line, at)));
}

/** Loads the map, the land points and the cities (all lazily), then plays. */
export function OnTheGridScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<OnTheGridDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; game: OnTheGrid; cities: readonly CircleCity[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadLandGrid(), arcadePools()]).then(
      ([shapes, grid, pools]) => !cancelled && setLoaded({ shapes, game: createOnTheGrid({ grid: grid as LandGrid, countries: queryCountries() }), cities: pools.cities }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <GridPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

function GridPlay({
  shapes,
  game,
  cities,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: OnTheGrid;
  cities: readonly CircleCity[];
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<GridState>(() => replayOnTheGrid(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const { level } = state;
  const playing = state.status === 'playing';
  const plan = gridPlan(level.number);
  const phone = usePhone();
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FULL);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const update = () => setView(measure(frame, phone));
    update();
    if (!frame || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [phone]);
  const lines = useMemo(() => gridLines(plan.lines), [plan.lines]);
  const last = level.clicks.at(-1);
  const countryName = game.countries.get(level.country)?.name ?? '';
  const spot = formatCoordinates(level.target);

  const overlay = useMemo(() => {
    const ring = playing ? null : circleShape(level.target, plan.radiusKm);
    return (projection: GeoProjection) => {
      const path = geoPath(projection);
      return (
        <>
          {lines.map((l) => (
            <path key={`${l.kind}${l.value}`} className={`grid-line${l.major ? ' grid-major' : ''}`} d={path({ type: 'LineString', coordinates: l.coordinates }) ?? ''} />
          ))}
          {ring && <path className="grid-ring" d={path(ring) ?? ''} />}
        </>
      );
    };
  }, [lines, playing, level.target, plan.radiusKm]);

  const markers = (toScreen: ToScreen) => {
    const labelled = placeLabels(lines, toScreen, view);
    const arrow = (() => {
      if (!playing || !last) return null;
      const from = toScreen([last.at[1], last.at[0]]);
      const ahead = toScreen((([lat, lng]) => [lng, lat] as [number, number])(towards(last, 600)));
      if (!from || !ahead) return null;
      const d = Math.hypot(ahead[0] - from[0], ahead[1] - from[1]) || 1;
      const ux = (ahead[0] - from[0]) / d;
      const uy = (ahead[1] - from[1]) / d;
      const tip: [number, number] = [from[0] + ux * ARROW, from[1] + uy * ARROW];
      const wing = (s: number): [number, number] => [tip[0] - ux * 9 + -uy * 6 * s, tip[1] - uy * 9 + ux * 6 * s];
      return <path className="grid-arrow" d={`M${from[0]} ${from[1]}L${tip[0]} ${tip[1]}M${wing(1)[0]} ${wing(1)[1]}L${tip[0]} ${tip[1]}L${wing(-1)[0]} ${wing(-1)[1]}`} />;
    })();
    const target = !playing ? toScreen([level.target[1], level.target[0]]) : null;
    return (
      <>
        {labelled.map(({ line, x, y }) => (
          <text key={`label-${line.kind}${line.value}`} className={`grid-label${line.major ? ' grid-label-major' : ''}`} x={x} y={y} dy={line.kind === 'parallel' ? -3 : -6} textAnchor={line.kind === 'parallel' ? 'start' : 'middle'}>
            {line.label}
          </text>
        ))}
        {level.clicks.map((c, i) => {
          const p = toScreen([c.at[1], c.at[0]]);
          return p ? (
            <g key={i} className="city-marker marker-outside">
              <circle cx={p[0]} cy={p[1]} r={5} />
            </g>
          ) : null;
        })}
        {arrow}
        {target && (
          <g className="city-marker marker-found">
            <circle cx={target[0]} cy={target[1]} r={6} />
            <text x={target[0] + 9} y={target[1]}>
              {spot}
            </text>
          </g>
        )}
      </>
    );
  };

  const click = (lng: number, lat: number) => setState((s) => game.click(s, lat, lng).state);
  const skip = () => setState((s) => game.skip(s));
  const next = () => setState((s) => game.nextLevel(s));
  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: endNote(state),
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  // A new level takes the focus off the button that started it, so a second Enter can't land on Skip.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (playing) wrapRef.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  // When a level ends, its button takes the focus, so Enter goes on (without scrolling the page).
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const skipped = level.status === 'lost' && state.moves.at(-1) === GRID_SKIP;
  const left = plan.clicks - level.clicks.length;
  const city = playing ? null : nearCity(level.target, level.country, cities);
  const note = `${spot} is in ${countryName}${city ? `, near ${city.name}` : ''}.`;

  return (
    <div className="route grid-game" ref={wrapRef} tabIndex={-1}>
      <div className="route-status">
        <span>
          Level <strong>{level.number}</strong>
        </span>
        <span className="lives" aria-label={`${state.lives} lives`}>
          {Array.from({ length: Math.max(state.lives, 1) }, (_, i) => (
            <span key={i} className={i < state.lives ? 'life' : 'life lost'} aria-hidden="true">
              ♥
            </span>
          ))}
        </span>
        <span>
          Click <strong>{Math.min(level.clicks.length + 1, plan.clicks)}</strong>/{plan.clicks}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="grid-prompt">
        Click <strong className="grid-coords">{spot}</strong>
      </p>

      <div ref={frameRef} className="grid-map">
      <WorldMap
        fit={phone ? 'slice' : 'meet'}
        shapes={shapes}
        frame={WORLD}
        borders={false}
        terrain
        maxZoom={MAX_ZOOM}
        overlay={overlay}
        markers={markers}
        onPick={playing ? ([lng, lat]) => click(lng, lat) : undefined}
        label={playing ? 'World map with no names: click the coordinates' : `World map: ${spot}`}
      />
      </div>

      {playing ? (
        <div className="grid-actions">
          <span className="grid-hint" role="status">
            {last ? (
              <>
                <strong>✗ {km.format(last.km)} km off</strong>, to the {compassPoint(last.bearing)}. {left === 1 ? 'Last click.' : `${left} clicks left.`}
              </>
            ) : (
              <span className="muted">Within {km.format(plan.radiusKm)} km finds it. You have {plan.clicks} clicks.{phone && ' Drag to pan.'}</span>
            )}
          </span>
          <button className="btn grid-skip" onClick={skip}>
            ⏭ Skip <span className="muted">−1 ♥</span>
          </button>
        </div>
      ) : (
        <div className={`grid-result ${level.status === 'cleared' ? 'solved' : 'failed'}`} role="status">
          <p className="grid-result-text">
            {level.status === 'cleared' ? (
              <>
                <strong>✓ Found it! +{level.points}</strong>
                {level.flawless && (
                  <>
                    {' '}
                    <span className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${GRID_MAX_LIVES}).`}</span>
                  </>
                )}
              </>
            ) : (
              <strong>{skipped ? 'Skipped: −1 ♥.' : '✗ Not found: −1 ♥.'}</strong>
            )}{' '}
            <span className="muted">{note}</span>
            {state.status === 'over' && <strong> Out of lives.</strong>}
          </p>
          <button ref={nextButton} className="btn btn-primary" onClick={state.status === 'over' ? finish : next}>
            {state.status === 'over' ? 'See final score' : 'Next level'}
          </button>
        </div>
      )}
    </div>
  );
}

const PHONE = '(max-width: 640px)';
/** A phone gets a taller map, cropped at the sides to fill it: drag to pan. */
function usePhone(): boolean {
  const query = typeof matchMedia === 'undefined' ? null : matchMedia(PHONE);
  const [phone, setPhone] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setPhone(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return phone;
}

/** The end-of-run line: how far it got, and how well. */
function endNote(state: GridState): string {
  const first = state.marks.filter((m) => m === 'flawless').length;
  const found = state.marks.filter((m) => m !== 'lost').length;
  const parts = [`You reached level ${state.level.number}.`];
  if (found) parts.push(`${first} first-click find${first === 1 ? '' : 's'} in ${found}${state.closestKm === null ? '' : `; closest ${km.format(state.closestKm)} km`}.`);
  return parts.join(' ');
}
