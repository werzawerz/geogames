import { useEffect, useMemo, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { getCountry, queryCountries, type CountryId, type GreatCircleCity } from '@geogames/geodata';
import { loadGreatCircles } from '@geogames/geodata/cities';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  GC_MAX_LIVES,
  createGreatCircle,
  type GreatCircle,
  type GreatCircleDefinition,
  type GreatCircleGuessResult,
  type GreatCircleState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry, type ToScreen } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';

const name = (id: CountryId) => getCountry(id)?.name ?? id;
const MAP_MAX_ZOOM = 60;

/** Loads map shapes and the lines (both lazily), then plays. */
export function GreatCircleScreen({ game: definition, seed, onGameOver }: GameScreenProps<GreatCircleDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; game: GreatCircle } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadGreatCircles()]).then(
      ([shapes, { puzzles }]) =>
        !cancelled && setLoaded({ shapes, game: createGreatCircle({ puzzles, countries: queryCountries(), rounds: definition.rounds }) }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [definition.rounds]);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <GreatCirclePlay {...loaded} rounds={definition.rounds} seed={seed} onGameOver={onGameOver} />;
}

function messageFor(result: GreatCircleGuessResult, id: CountryId, points: number): string {
  switch (result) {
    case 'found':
      return `${name(id)} is on the line! +${points}`;
    case 'wrong':
      return `The line doesn't cross ${name(id)}. −1 ♥`;
    case 'repeat':
      return 'Already tried.';
    case 'endpoint':
      return 'That’s where the line starts or ends.';
    case 'unknown':
      return "That country isn't in this game.";
  }
}

function GreatCirclePlay({
  shapes,
  game,
  rounds,
  seed,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: GreatCircle;
  rounds: number;
  seed: number;
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<GreatCircleState>(() => game.start(seed));
  const [message, setMessage] = useState<string | null>(null);
  const { puzzle, level } = state;
  const playing = state.status === 'playing';

  useEffect(() => setMessage(null), [level]);

  const items = useMemo(() => countryItems(queryCountries().map((c) => c.id)), []);
  const exclude = useMemo(
    () => new Set([puzzle.from.countryId, puzzle.to.countryId, ...state.found, ...state.skipped, ...state.wrong]),
    [puzzle, state.found, state.skipped, state.wrong],
  );

  const line = useMemo<GeoPermissibleObjects>(
    () => ({
      type: 'LineString',
      coordinates: [
        [puzzle.from.latlng[1], puzzle.from.latlng[0]],
        [puzzle.to.latlng[1], puzzle.to.latlng[0]],
      ],
    }),
    [puzzle],
  );
  const overlay = useMemo(() => (projection: GeoProjection) => <path className="gc-line" d={geoPath(projection)(line) ?? ''} />, [line]);

  const revealed = (id: CountryId) => state.found.includes(id) || state.skipped.includes(id) || !playing;
  const mapCountries: MapCountry[] = [
    ...puzzle.via.filter(revealed).map((id): MapCountry => ({ id, tone: state.found.includes(id) ? 'optimal' : 'route', label: name(id) })),
    { id: puzzle.from.countryId, tone: 'start' },
    { id: puzzle.to.countryId, tone: 'end' },
  ];

  const endMarker = (city: GreatCircleCity, toScreen: ToScreen) => {
    const point = toScreen([city.latlng[1], city.latlng[0]]);
    return point ? (
      <g key={city.id} className="city-marker marker-found">
        <circle cx={point[0]} cy={point[1]} r={5} />
        <text x={point[0] + 8} y={point[1]}>
          {city.name}
        </text>
      </g>
    ) : null;
  };

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, id, next.score - state.score));
    setState(next);
  };

  const skip = () => {
    const [country] = game.remaining(state);
    setMessage(country ? `That was ${name(country)}. −1 ♥` : null);
    setState(game.skip(state));
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: state.completed ? `You crossed all ${rounds} lines!` : `You reached level ${level} of ${rounds}.`,
    });

  const end = (city: GreatCircleCity, tone: 'start' | 'end') => (
    <span className={`route-end tone-${tone}`}>
      <Flag iso2={getCountry(city.countryId)!.iso2} className="end-flag" />
      {city.name}
    </span>
  );

  return (
    <div className="route gc-game">
      <div className="route-status">
        <span>
          Level <strong>{level}</strong> of {rounds}
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

      <div className="route-ends">
        {end(puzzle.from, 'start')}
        <span className="route-arrow" aria-hidden="true">
          →
        </span>
        {end(puzzle.to, 'end')}
      </div>
      <p className="route-hint muted">
        The line crosses <strong>{puzzle.via.length}</strong> {puzzle.via.length === 1 ? 'country' : 'countries'} on the way
      </p>

      <WorldMap
        shapes={shapes}
        countries={mapCountries}
        frame={line}
        overlay={overlay}
        markers={(toScreen) => (
          <>
            {endMarker(puzzle.from, toScreen)}
            {endMarker(puzzle.to, toScreen)}
          </>
        )}
        maxZoom={MAP_MAX_ZOOM}
        borders={false}
        label="Map with a straight line between two cities"
      />

      <ol className="rank-slots gc-slots" aria-label="Countries along the line">
        {puzzle.via.map((id, i) => (
          <li key={id} className={state.found.includes(id) ? 'slot-found' : revealed(id) ? 'slot-missed' : ''}>
            <span className="slot-rank">{i + 1}</span>
            {revealed(id) ? (
              <span className="slot-name">
                <Flag iso2={getCountry(id)!.iso2} className="suggestion-flag" /> {name(id)}
              </span>
            ) : (
              <span className="slot-name muted">?</span>
            )}
          </li>
        ))}
      </ol>

      {playing ? (
        <>
          <SearchInput
            key={level}
            items={items}
            exclude={exclude}
            onPick={guess}
            onNoMatch={() => setMessage('No such country.')}
            placeholder="Type a country…"
            label="Name a country the line crosses"
          />
          <p className="route-message" role="status">
            {message ?? 'Name them in any order. A wrong country costs a life.'}
          </p>
          <div className="row">
            <button className="btn" onClick={skip}>
              ⏭ Skip country <span className="muted">−1 ♥</span>
            </button>
          </div>
        </>
      ) : state.status === 'level-clear' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">Level {level} cleared!</p>
          {state.bonusLife && <p className="bonus-life">{state.lives >= GC_MAX_LIVES ? 'Perfect level! Lives are full.' : 'Perfect level! +1 ♥'}</p>}
          {message && <p className="muted">{message}</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={() => setState(game.nextLevel(state))}>
            Next level
          </button>
        </div>
      ) : (
        <div className={`route-summary ${state.completed ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">{state.completed ? `All ${rounds} levels cleared!` : 'Out of lives'}</p>
          {message && <p className="muted">{message}</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={finish}>
            See final score
          </button>
        </div>
      )}
    </div>
  );
}
