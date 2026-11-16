import { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { queryCountries } from '@geogames/geodata';
import { loadLandGrid, type LandGrid } from '@geogames/geodata/land-grid';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  GRID_CLICKS,
  GRID_MAX_LIVES,
  GRID_SKIP,
  arcadePools,
  compassPoint,
  createOnTheGrid,
  formatCoordinates,
  gridPlan,
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
import { placeNote } from './placeNote.ts';

const WORLD: GeoPermissibleObjects = { type: 'Sphere' };
/** Down to about 300 km across on a desktop map: enough to place a spot to a degree. */
const MAX_ZOOM = 40;
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const MARKS: Record<GridMark, string> = { flawless: '🟩', found: '🟨', lost: '🟥' };
/** Length of the arrow after a miss, in screen units. */
const ARROW = 46;
const TROPIC = 23.4365;

interface Line {
  /** [lng, lat] points, in order. */
  coordinates: [number, number][];
  label: string;
  /** Where the label sits. */
  at: [number, number];
  major: boolean;
  /** False draws the line without its label. */
  named?: boolean;
}

const parallel = (lat: number, label: string, major: boolean): Line => ({
  coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat] as [number, number]),
  label,
  at: [-176, lat],
  major,
});
const meridian = (lng: number, label: string, major: boolean): Line => ({
  coordinates: Array.from({ length: 29 }, (_, i) => [lng, -80 + i * 5] as [number, number]),
  label,
  at: [lng, -52],
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
  // Meridians crowd towards the poles: every third one is named.
  for (let lng = -180; lng < 180; lng += 10) lines.push({ ...meridian(lng, degrees(lng, 'E', 'W'), lng === 0), named: lng % 30 === 0 });
  return lines;
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
            <path key={`${l.coordinates[0]!.join()}-${l.label}`} className={`grid-line${l.major ? ' grid-major' : ''}`} d={path({ type: 'LineString', coordinates: l.coordinates }) ?? ''} />
          ))}
          {ring && <path className="grid-ring" d={path(ring) ?? ''} />}
        </>
      );
    };
  }, [lines, playing, level.target, plan.radiusKm]);

  const markers = (toScreen: ToScreen) => {
    const view = (p: [number, number] | null) => (p && p[0] > 0 && p[0] < 960 && p[1] > 0 && p[1] < 540 ? p : null);
    const labelled = lines.filter((l) => l.named !== false).flatMap((l) => {
      const p = view(toScreen(l.at));
      return p ? [{ ...l, x: p[0], y: p[1] }] : [];
    });
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
        {labelled.map((l) => (
          <text key={`${l.coordinates[0]!.join()}-${l.label}`} className={`grid-label${l.major ? ' grid-label-major' : ''}`} x={l.x} y={l.y}>
            {l.label}
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
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  // When a level ends, its button takes the focus, so Enter goes on (without scrolling the page).
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const skipped = level.status === 'lost' && state.moves.at(-1) === GRID_SKIP;
  const left = GRID_CLICKS - level.clicks.length;
  const note = `${spot} is ${placeNote(level.target, countryName, cities)}.`;

  return (
    <div className="route grid-game">
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
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="grid-prompt">
        Click <strong className="grid-coords">{spot}</strong>
      </p>

      <WorldMap
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

      {playing ? (
        <div className="grid-actions">
          <span className="grid-hint" role="status">
            {last ? (
              <>
                <strong>✗ {km.format(last.km)} km off</strong>, to the {compassPoint(last.bearing)}. {left === 1 ? 'Last click.' : `${left} clicks left.`}
              </>
            ) : (
              <span className="muted">Within {km.format(plan.radiusKm)} km finds it. You have {GRID_CLICKS} clicks.</span>
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
