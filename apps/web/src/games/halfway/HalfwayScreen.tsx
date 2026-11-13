import { useEffect, useMemo, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { getCountry, type CityId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  HALFWAY_MAX_LIVES,
  HALFWAY_MISSES,
  HALFWAY_SKIP,
  createHalfway,
  destination,
  distanceKm,
  halfwayPlan,
  halfwayPools,
  replayHalfway,
  type CircleCity,
  type Halfway,
  type HalfwayDefinition,
  type HalfwayGuessResult,
  type HalfwayMark,
  type HalfwayState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { cityItems } from '../../components/searchItems.ts';
import { WorldMap, labelSize, type ToScreen } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import type { GameScreenProps } from '../types.ts';

const MAX_ZOOM = 40;
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
/** Gap between a city's dot and its label, in map units. */
const LABEL_OFFSET = 10;
/** How many of the cities near the midpoint to show after a level. */
const SHOWN_NEARBY = 3;

const MARKS: Record<HalfwayMark, string> = { flawless: '🎯', cleared: '🟩', missed: '🟧', lost: '🟥' };

/** Loads map shapes and the cities (both lazily), then plays. */
export function HalfwayScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<HalfwayDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; game: Halfway } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), halfwayPools()]).then(
      ([shapes, pools]) => !cancelled && setLoaded({ shapes, game: createHalfway(pools) }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <HalfwayPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

function messageFor(result: HalfwayGuessResult, city: CircleCity | undefined, state: HalfwayState): string | null {
  const guess = state.level.guesses.at(-1);
  switch (result) {
    case 'inside':
      return null;
    case 'outside': {
      const off = `${city?.name} is ${km.format(guess!.km)} km from the midpoint: further than ${state.level.radiusKm} km.`;
      if (state.level.status === 'lost') return `${off} That’s ${HALFWAY_MISSES} misses: −1 ♥`;
      const left = HALFWAY_MISSES - 1 - state.level.guesses.filter((g) => g.km > state.level.radiusKm).length;
      return left > 0 ? `${off} ${left} more free ${left === 1 ? 'miss' : 'misses'}.` : `${off} One more miss costs a life.`;
    }
    case 'repeat':
      return 'Already tried.';
    case 'end':
      return 'That’s one of the two cities. Name one between them.';
    case 'unknown':
      return 'No such city in the game.';
  }
}

/**
 * Frames the two cities with the midpoint off centre, by a different amount
 * each level: a map centred on the midpoint would point straight at the answer.
 */
function frameFor(from: CircleCity, to: CircleCity, middle: readonly [number, number], seed: number, level: number) {
  const apart = distanceKm(from.latlng, to.latlng);
  const bearing = ((seed * 7 + level * 137) % 360) * (Math.PI / 180);
  const center = destination(middle, apart * 0.15, bearing);
  return circleShape(center, Math.max(700, apart * 0.7));
}

interface Mark {
  id: CityId;
  tone: 'end' | 'found' | 'outside' | 'nearby';
  text?: string;
}

function HalfwayPlay({
  shapes,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: Halfway;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<HalfwayState>(() => replayHalfway(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const { level } = state;
  const plan = halfwayPlan(level.number);
  const playing = state.status === 'playing';
  const from = game.cities.get(level.from)!;
  const to = game.cities.get(level.to)!;
  const showNames = plan.showNames || !playing;

  useEffect(() => setMessage(null), [level.number]);

  const searchItems = useMemo(() => cityItems(game.cities.values()), [game]);
  // While the names are hidden the two cities stay in the search, so it doesn't tell you who they are.
  const exclude = useMemo(
    () => new Set([...(plan.showNames ? [level.from, level.to] : []), ...level.guesses.map((g) => g.id)]),
    [level, plan.showNames],
  );
  const frame = useMemo<GeoPermissibleObjects>(
    () => frameFor(from, to, level.midpoint, seed, level.number),
    [from, to, level.midpoint, seed, level.number],
  );

  // The line, and after the level the radius around the midpoint. Never the midpoint while playing.
  const overlay = useMemo(() => {
    const line: GeoPermissibleObjects = {
      type: 'LineString',
      coordinates: [
        [from.latlng[1], from.latlng[0]],
        [to.latlng[1], to.latlng[0]],
      ],
    };
    const area = circleShape(level.midpoint, level.radiusKm);
    return (projection: GeoProjection) => {
      const path = geoPath(projection);
      return (
        <>
          {!playing && <path className="circle-area" d={path(area) ?? ''} />}
          {(plan.showLine || !playing) && <path className="gc-line" d={path(line) ?? ''} />}
        </>
      );
    };
  }, [from, to, level.midpoint, level.radiusKm, playing, plan.showLine]);

  const nearby = playing ? [] : level.fair.filter((id) => !level.guesses.some((g) => g.id === id)).slice(0, SHOWN_NEARBY);
  const marks: Mark[] = [
    { id: level.from, tone: 'end', text: showNames ? from.name : undefined },
    { id: level.to, tone: 'end', text: showNames ? to.name : undefined },
    // Closest guess first: its label wins when labels would overlap.
    ...[...level.guesses].sort((a, b) => a.km - b.km).map((g): Mark => ({
      id: g.id,
      tone: g.km <= level.radiusKm ? 'found' : 'outside',
      text: `${game.cities.get(g.id)!.name} · ${km.format(g.km)} km`,
    })),
    ...nearby.map((id): Mark => ({ id, tone: 'nearby', text: game.cities.get(id)!.name })),
  ];

  const markers = (toScreen: ToScreen) => {
    const placed = marks.flatMap((m) => {
      const city = game.cities.get(m.id)!;
      const point = toScreen([city.latlng[1], city.latlng[0]]);
      return point ? [{ ...m, key: `${m.tone}-${m.id}`, x: point[0], y: point[1] }] : [];
    });
    const middle = playing ? null : toScreen([level.midpoint[1], level.midpoint[0]]);
    const labels = placeLabels(placed, middle);
    return (
      <>
        {middle && (
          <path
            className="halfway-mid"
            d={`M${middle[0] - 9} ${middle[1] - 9}l18 18M${middle[0] - 9} ${middle[1] + 9}l18-18`}
          />
        )}
        {placed.map(({ key, tone, x, y }) => (
          <g key={key} className={`city-marker marker-${tone}`} transform={`translate(${x},${y})`}>
            <circle r={tone === 'nearby' ? 4 : 6} />
          </g>
        ))}
        {labels.map(({ key, tone, text, x, y, anchor }) => (
          <g key={`label-${key}`} className={`city-marker marker-${tone}`}>
            <text x={x} y={y} textAnchor={anchor}>
              {text}
            </text>
          </g>
        ))}
      </>
    );
  };

  const guess = (id: CityId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, game.cities.get(id), next));
    setState(next);
  };

  const skip = () => {
    setMessage(null);
    setState(game.skip(state));
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  const end = (city: CircleCity, tone: 'start' | 'end') => (
    <span className={`route-end tone-${tone}`}>
      {showNames ? (
        <>
          <Flag iso2={getCountry(city.countryId)!.iso2} className="end-flag" />
          {city.name}
        </>
      ) : (
        '?'
      )}
    </span>
  );

  const last = level.guesses.at(-1);
  const misses = level.guesses.filter((g) => g.km > level.radiusKm).length;
  const skipped = level.status === 'lost' && state.moves.at(-1) === HALFWAY_SKIP;
  const next = (
    <button className="btn btn-primary btn-lg" autoFocus onClick={() => setState(game.nextLevel(state))}>
      Next level
    </button>
  );
  const nearbyText = nearby.map((id) => game.cities.get(id)!.name).join(', ');

  return (
    <div className="route halfway-game">
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
          Within <strong>{level.radiusKm}</strong> km
        </span>
        <span aria-label={`${misses} of ${HALFWAY_MISSES} misses`}>
          Misses <strong className="halfway-misses">{misses}</strong>/{HALFWAY_MISSES}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="route-ends">
        {end(from, 'start')}
        <span className="route-arrow" aria-hidden="true">
          ↔
        </span>
        {end(to, 'end')}
      </div>
      <p className="route-hint muted">
        {showNames
          ? `Name a city within ${level.radiusKm} km of the point halfway between them.`
          : `Name a city within ${level.radiusKm} km of the point halfway between the two dots.`}
      </p>

      <WorldMap
        shapes={shapes}
        frame={frame}
        borders={false}
        maxZoom={MAX_ZOOM}
        overlay={overlay}
        markers={markers}
        label={showNames ? `Map: ${from.name} and ${to.name}` : 'Map: two unnamed cities'}
      />

      {playing ? (
        <>
          <SearchInput
            items={searchItems}
            exclude={exclude}
            onPick={guess}
            onNoMatch={() => setMessage(messageFor('unknown', undefined, state))}
            placeholder="Type a city…"
            label="Guess a city"
          />
          <p className="route-message" role="status">
            {message ??
              `Halfway along the shortest route around the globe, so it can look off-centre on the map. ${HALFWAY_MISSES - 1} misses are free; the ${HALFWAY_MISSES === 3 ? 'third' : 'next'} costs a life.`}
          </p>
          <div className="arcade-actions">
            <button className="btn" onClick={skip}>
              ⏭ Skip <span className="muted">−1 ♥</span>
            </button>
          </div>
        </>
      ) : level.status === 'cleared' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">
            {game.cities.get(last!.id)!.name} is {km.format(last!.km)} km from the midpoint! +{level.points}
          </p>
          {level.flawless && (
            <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${HALFWAY_MAX_LIVES} at most).`}</p>
          )}
          {nearbyText && <p className="muted">Also close: {nearbyText}.</p>}
          {next}
        </div>
      ) : (
        <div className="route-summary failed" role="status">
          <p className="route-summary-title">{skipped ? 'Skipped: −1 ♥' : `${HALFWAY_MISSES} misses: −1 ♥`}</p>
          {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
          {message && !skipped && <p className="muted">{message}</p>}
          {nearbyText && <p className="muted">You could have said: {nearbyText}.</p>}
          {state.status === 'over' ? (
            <button className="btn btn-primary btn-lg" autoFocus onClick={finish}>
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
            <li key={g.id} className={g.km <= level.radiusKm ? 'guess-in' : 'guess-out'}>
              {game.cities.get(g.id)!.name} <span className="muted">{km.format(g.km)} km</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Places every label (none is dropped: each dot needs its name), trying right,
 * left, above and below its dot, so it covers neither another label, a dot nor
 * the midpoint's ×. Earlier marks get the best places.
 */
export function placeLabels<T extends { key: string; x: number; y: number; text?: string }>(
  marks: readonly T[],
  middle: readonly [number, number] | null,
): (T & { text: string; anchor: 'start' | 'end' | 'middle' })[] {
  const size = labelSize();
  const half = size * 0.55;
  const dot = size * 0.5;
  const taken: Box[] = marks.map(({ x, y }) => ({ left: x - dot, right: x + dot, top: y - dot, bottom: y + dot }));
  if (middle) taken.push({ left: middle[0] - 12, right: middle[0] + 12, top: middle[1] - 12, bottom: middle[1] + 12 });
  return marks.flatMap((m, i) => {
    if (!m.text) return [];
    const w = m.text.length * size * 0.6;
    const options = [
      { x: m.x + LABEL_OFFSET, y: m.y, anchor: 'start' as const, box: { left: m.x + LABEL_OFFSET, right: m.x + LABEL_OFFSET + w } },
      { x: m.x - LABEL_OFFSET, y: m.y, anchor: 'end' as const, box: { left: m.x - LABEL_OFFSET - w, right: m.x - LABEL_OFFSET } },
      { x: m.x, y: m.y - size * 1.2, anchor: 'middle' as const, box: { left: m.x - w / 2, right: m.x + w / 2 } },
      { x: m.x, y: m.y + size * 1.2, anchor: 'middle' as const, box: { left: m.x - w / 2, right: m.x + w / 2 } },
    ].map((o) => ({ ...o, box: { ...o.box, top: o.y - half, bottom: o.y + half } }));
    const others = taken.filter((_, j) => j !== i);
    const best = options.find((o) => !others.some((b) => overlaps(o.box, b))) ?? options[0]!;
    taken.push(best.box);
    return [{ ...m, text: m.text, x: best.x, y: best.y, anchor: best.anchor }];
  });
}
