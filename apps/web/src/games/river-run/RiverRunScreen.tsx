import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import { loadRivers, type River } from '@geogames/geodata/rivers';
import {
  RIVER_RUN_CHOICE_SHARE,
  RIVER_RUN_FLAWLESS_SHARE,
  RIVER_RUN_MAX_LIVES,
  RIVER_RUN_MISSES,
  createRiverRun,
  destination,
  replayRiverRun,
  riverChoices,
  riverRunPlan,
  type RiverGuessResult,
  type RiverRun,
  type RiverRunDefinition,
  type RiverRunMark,
  type RiverRunState,
} from '@geogames/games';
import { SearchInput, type SearchItem } from '../../components/SearchInput.tsx';
import { normalize } from '../../components/search.ts';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import type { GameScreenProps } from '../types.ts';
import { riverQuery } from './riverQuery.ts';

const MAX_ZOOM = 20;
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
/** The map never gets shorter than this, however little room is left. */
const MIN_MAP_HEIGHT = 180;
const MARKS: Record<RiverRunMark, string> = { flawless: '🎯', cleared: '🟦', missed: '🟧', lost: '🟥' };

/** Loads map shapes and the rivers (both lazily), then plays. */
export function RiverRunScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<RiverRunDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; rivers: Map<string, River>; game: RiverRun } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadRivers()]).then(
      ([shapes, data]) =>
        !cancelled && setLoaded({ shapes, rivers: new Map(data.rivers.map((r) => [r.id, r])), game: createRiverRun(data) }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <RiverRunPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

type Pos = [number, number];

/** Rough km between two [lng, lat] points: plenty for pacing the line evenly. */
const stepKm = (a: Pos, b: Pos) => Math.hypot((b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), b[1] - a[1]) * 111;

/** The river's first `share` (0–1) by length, ending exactly at that point. */
function drawnPart(line: readonly Pos[], share: number): Pos[] {
  const steps = line.slice(1).map((p, i) => stepKm(line[i]!, p));
  let left = share * steps.reduce((a, b) => a + b, 0);
  const out: Pos[] = [line[0]!];
  for (let i = 0; i < steps.length; i++) {
    const [a, b] = [line[i]!, line[i + 1]!];
    if (left >= steps[i]!) {
      out.push(b);
      left -= steps[i]!;
      continue;
    }
    const t = steps[i]! > 0 ? left / steps[i]! : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    break;
  }
  return out;
}

/**
 * Frames the river with its middle off centre, by a different amount each
 * level, and never tighter than the band's view: the frame alone shouldn't
 * say how long the river is or where it runs.
 */
function frameFor(river: River, seed: number, level: number): GeoPermissibleObjects {
  const lngs = river.line.map((p) => p[0]);
  const lats = river.line.map((p) => p[1]);
  const middle: [number, number] = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  const spanKm = Math.max(stepKm([Math.min(...lngs), middle[0]], [Math.max(...lngs), middle[0]]), (Math.max(...lats) - Math.min(...lats)) * 111);
  const radius = Math.max(riverRunPlan(level).viewKm / 2, spanKm * 0.65);
  const bearing = ((seed * 7 + level * 137) % 360) * (Math.PI / 180);
  return circleShape(destination(middle, radius * 0.2, bearing), radius);
}

function messageFor(result: RiverGuessResult, name: string | undefined, state: RiverRunState): string | null {
  switch (result) {
    case 'right':
      return null;
    case 'wrong': {
      const off = `Not the ${name}: it’s drawn in grey where it really runs.`;
      if (state.lostBy === 'pick') return `${off} A wrong pick: −1 ♥`;
      if (state.level.status === 'lost') return `${off} That’s ${RIVER_RUN_MISSES} misses: −1 ♥`;
      const left = RIVER_RUN_MISSES - 1 - state.level.guesses.length;
      return left > 0 ? `${off} ${left} more free ${left === 1 ? 'miss' : 'misses'}.` : `${off} One more miss costs a life.`;
    }
    case 'repeat':
      return 'Already tried.';
    case 'unknown':
      return 'That’s not one of the rivers. Try another name: it doesn’t count as a miss.';
  }
}

function RiverRunPlay({
  shapes,
  rivers,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  rivers: Map<string, River>;
  game: RiverRun;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<RiverRunState>(() => replayRiverRun(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const { level } = state;
  const playing = state.status === 'playing';
  const river = rivers.get(level.river)!;

  // The clock: how much of the river is drawn. A resumed level picks up where its last guess was.
  const [share, setShare] = useState(() => level.guesses.at(-1)?.share ?? 0);
  const clock = useRef({ start: 0, from: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!playing) return;
    setMessage(null);
    const from = stateRef.current.level.guesses.at(-1)?.share ?? 0;
    clock.current = { start: performance.now(), from };
    setShare(from);
    let frame = requestAnimationFrame(function tick(now) {
      const drawn = Math.min(1, clock.current.from + (now - clock.current.start) / (level.seconds * 1000));
      setShare(drawn);
      if (drawn >= 1) setState((s) => game.timeout(s));
      else frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // A new level (or the end of one) restarts the clock; guesses don't.
  }, [level.number, playing, level.seconds, game]);
  const shareNow = () => Math.min(1, clock.current.from + (performance.now() - clock.current.start) / (level.seconds * 1000));

  const searchItems = useMemo<SearchItem[]>(
    () => [...rivers.values()].map((r) => ({ id: r.id, label: r.name, aliases: r.aliases, weight: 5 - r.tier })),
    [rivers],
  );
  const names = useMemo(() => new Set([...rivers.values()].flatMap((r) => [r.name, ...r.aliases].map(normalize))), [rivers]);
  const exclude = useMemo(() => new Set(level.guesses.map((g) => g.id)), [level.guesses]);
  const frame = useMemo(() => frameFor(river, seed, level.number), [river, seed, level.number]);

  const shown = playing ? drawnPart(river.line, share) : river.line;
  const wrong = level.guesses.filter((g) => g.id !== level.river).map((g) => rivers.get(g.id)!);
  const overlay = (projection: GeoProjection) => {
    const path = geoPath(projection);
    return (
      <>
        {wrong.map((r) => (
          <path key={r.id} className="river-wrong" d={path({ type: 'LineString', coordinates: r.line }) ?? ''} />
        ))}
        <path className={`river-line${playing ? '' : ` river-${level.status}`}`} d={path({ type: 'LineString', coordinates: shown }) ?? ''} />
      </>
    );
  };
  const markers = (toScreen: ToScreen) => {
    const source = toScreen(river.line[0]!);
    const head = toScreen(shown.at(-1)!);
    const label = playing ? null : toScreen(river.line[Math.floor(river.line.length / 2)]!);
    return (
      <>
        {source && <circle className="river-source" cx={source[0]} cy={source[1]} r={4} />}
        {head && <circle className="river-head" cx={head[0]} cy={head[1]} r={playing ? 6 : 5} />}
        {label && (
          <text className="map-label river-label" x={label[0]} y={label[1] - 12}>
            {river.name}
          </text>
        )}
      </>
    );
  };

  const guess = (id: string, picked = false) => {
    const { state: next, result } = game.guess(state, id, shareNow(), picked);
    setMessage(messageFor(result, rivers.get(id)?.name, next));
    setState(next);
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  const misses = level.guesses.filter((g) => g.id !== level.river).length;
  const named = level.guesses.at(-1);
  const choicesOpen = playing && share >= RIVER_RUN_CHOICE_SHARE;
  const choices = useMemo(() => riverChoices([...rivers.values()], level.river, level.number, seed), [rivers, level.river, level.number, seed]);

  // Keys 1–4 pick an option once they're shown; digits never start a river's name.
  useEffect(() => {
    if (!choicesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        guess(choices[n - 1]!, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The map takes what height is left, so the question, map and answer fit with no scrolling.
  const mapBox = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState<{ height: number; tall: boolean } | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (!mapBox.current || !below.current) return;
      const top = mapBox.current.getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - top - below.current.offsetHeight - 24;
      const width = mapBox.current.offsetWidth;
      const height = Math.round(Math.max(MIN_MAP_HEIGHT, Math.min(room, width * 0.9)));
      setMapSize({ height, tall: width / height < 960 / 540 });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(below.current!);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  // Enter continues once a level ends; focused without scrolling the map away.
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const next = (
    <button ref={nextButton} className="btn btn-primary btn-lg" onClick={() => setState(game.nextLevel(state))}>
      Next level
    </button>
  );
  const facts = `${river.name}, about ${km.format(river.lengthKm)} km long.`;
  const lostTitle =
    state.lostBy === 'skip'
      ? 'Skipped: −1 ♥'
      : state.lostBy === 'timeout'
        ? 'It reached its end unnamed: −1 ♥'
        : state.lostBy === 'pick'
          ? 'A wrong pick: −1 ♥'
          : `${RIVER_RUN_MISSES} misses: −1 ♥`;
  const tier = riverRunPlan(level.number).tier;

  return (
    <div className="route river-run">
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
        <span aria-label={`${misses} of ${RIVER_RUN_MISSES} misses`}>
          Misses <strong className="river-misses">{misses}</strong>/{RIVER_RUN_MISSES}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="river-progress" role="progressbar" aria-label="River drawn" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <span style={{ width: `${(playing ? share : 1) * 100}%` }} />
      </div>
      <p className="route-hint muted">
        {tier >= 3
          ? 'A tributary or a river with a misleading start. Name it before it reaches its end.'
          : 'Name the river before it reaches the sea. The earlier, the more points.'}
      </p>

      <div ref={mapBox} className="river-map" style={mapSize ? { height: mapSize.height } : undefined}>
        <WorldMap
          shapes={shapes}
          frame={frame}
          borders={false}
          terrain
          fit={mapSize?.tall ? 'slice' : 'meet'}
          maxZoom={MAX_ZOOM}
          overlay={overlay}
          markers={markers}
          label="Map: a river drawing itself"
        />
      </div>

      <div ref={below} className="river-below">
        {playing ? (
          <>
            <SearchInput
              items={searchItems}
              exclude={exclude}
              onPick={(id) => guess(id)}
              onNoMatch={() => setMessage(messageFor('unknown', undefined, state))}
              placeholder="Type a river…"
              label="Name the river"
              cleanQuery={(text) => riverQuery(text, names)}
              exactOnly
              focusWithoutScroll
            />
            {choicesOpen && (
              <div className="river-choices" role="group" aria-label="Or pick one, for half the points">
                {choices.map((id, i) => (
                  <button key={id} className="btn river-choice" disabled={exclude.has(id)} onClick={() => guess(id, true)}>
                    <span className="river-choice-key" aria-hidden="true">
                      {i + 1}
                    </span>
                    {rivers.get(id)!.name}
                  </button>
                ))}
              </div>
            )}
            <p className="route-message" role="status">
              {message ??
                (choicesOpen
                  ? 'Half drawn: it’s one of these four, for half the points, picked or typed. A wrong one of the four costs a life.'
                  : `Name it on your first try before it’s ${RIVER_RUN_FLAWLESS_SHARE * 100}% drawn for a flawless level. ${RIVER_RUN_MISSES - 1} misses are free; the third costs a life.`)}
            </p>
            <div className="arcade-actions">
              <button className="btn" onClick={() => setState(game.skip(state))}>
                ⏭ Skip <span className="muted">−1 ♥</span>
              </button>
            </div>
          </>
        ) : level.status === 'cleared' ? (
          <div className="route-summary solved" role="status">
            <p className="route-summary-title">
              The {river.name}, with {Math.round(named!.share * 100)}% drawn{named!.picked ? ' (picked: half points)' : ''}! +{level.points}
            </p>
            {level.flawless && (
              <p className="river-flawless">
                <span aria-hidden="true">🎯</span> {state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${RIVER_RUN_MAX_LIVES} at most).`}
              </p>
            )}
            <p className="muted">About {km.format(river.lengthKm)} km long.</p>
            {next}
          </div>
        ) : (
          <div className="route-summary failed" role="status">
            <p className="route-summary-title">{lostTitle}</p>
            {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
            {message && (state.lostBy === 'misses' || state.lostBy === 'pick') && <p className="muted">{message}</p>}
            <p className="muted">It was the {facts}</p>
            {state.status === 'over' ? (
              <button ref={nextButton} className="btn btn-primary btn-lg" onClick={finish}>
                See final score
              </button>
            ) : (
              next
            )}
          </div>
        )}

        {level.guesses.length > 0 && (
          <ol className="halfway-guesses" aria-label="Your guesses">
            {level.guesses.map((g) => (
              <li key={g.id} className={g.id === level.river ? 'guess-in' : 'guess-out'}>
                <span aria-hidden="true">{g.id === level.river ? '✓' : '✗'}</span> {rivers.get(g.id)!.name}{' '}
                <span className="muted">at {Math.round(g.share * 100)}%</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
