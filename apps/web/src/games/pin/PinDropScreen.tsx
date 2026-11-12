import { useEffect, useMemo, useState } from 'react';
import { geoPath, type GeoProjection } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import { PIN_BUDGET_KM, PIN_BULLSEYE_KM, arcadePools, createPinDrop, replayPinDrop, type PinDrop, type PinDropDefinition, type PinState } from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';

const WHOLE_WORLD: GeoPermissibleObjects = { type: 'Sphere' };
/** From the whole world down to about 700 km across: a country and its borders still show, to steer by. */
const MAX_ZOOM = 60;
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/** One mark per city: 🎯 a bullseye, then 🟩 under 500 km, 🟧 under 1,500 km, 🟥 further. */
const distanceEmoji = (distance: number) =>
  distance <= PIN_BULLSEYE_KM ? '🎯' : distance < 500 ? '🟩' : distance < 1500 ? '🟧' : '🟥';

/** Loads map shapes and the cities (both lazily), then plays. */
export function PinDropScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<PinDropDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; game: PinDrop } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), arcadePools()]).then(
      ([shapes, pools]) => !cancelled && setLoaded({ shapes, game: createPinDrop(pools) }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <PinPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

function PinPlay({
  shapes,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: PinDrop;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<PinState>(() => replayPinDrop(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const city = game.cities.get(state.city)!;
  const country = getCountry(city.countryId)!;
  const { last } = state;
  const placing = state.status === 'placing';

  const overlay = useMemo(() => {
    if (!last) return undefined;
    const line: GeoPermissibleObjects = {
      type: 'LineString',
      coordinates: [
        [last.at[1], last.at[0]],
        [city.latlng[1], city.latlng[0]],
      ],
    };
    return (projection: GeoProjection) => <path className="pin-line" d={geoPath(projection)(line) ?? ''} />;
  }, [last, city]);

  const markers = (toScreen: ToScreen) => {
    if (!last) return null;
    const guess = toScreen([last.at[1], last.at[0]]);
    const actual = toScreen([city.latlng[1], city.latlng[0]]);
    return (
      <>
        {guess && <circle className="pin-guess" cx={guess[0]} cy={guess[1]} r={5} />}
        {actual && (
          <g className="city-marker marker-found">
            <circle cx={actual[0]} cy={actual[1]} r={5} />
            <text x={actual[0] + 8} y={actual[1]}>
              {city.name}
            </text>
          </g>
        )}
      </>
    );
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: state.completed ? 'You pinned every city!' : `You reached city ${state.level}.`,
      completed: state.completed,
      shareLine: state.distances.map(distanceEmoji).join(''),
    });

  return (
    <div className="route pin-game">
      <div className="route-status">
        <span>
          City <strong>{state.level}</strong>
        </span>
        <span>
          Budget <strong className="pin-budget">{km.format(state.budgetKm)}</strong> km left of {km.format(PIN_BUDGET_KM)}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="circle-prompt pin-prompt">
        {placing ? 'Where is ' : ''}
        <strong>{city.name}</strong>, <Flag iso2={country.iso2} className="suggestion-flag" /> {country.name}
        {placing ? '? Click the map.' : ''}
      </p>

      <WorldMap
        shapes={shapes}
        frame={WHOLE_WORLD}
        maxZoom={MAX_ZOOM}
        overlay={overlay}
        markers={markers}
        onPick={placing ? ([lng, lat]) => setState(game.place(state, lat, lng)) : undefined}
        label="World map: click where the city is"
      />

      {placing ? (
        <p className="route-message" role="status">
          The closer the better. Your distance off comes out of the budget; zoom in for a precise pin.
        </p>
      ) : (
        <div className={`route-summary ${state.status === 'over' ? 'failed' : 'solved'}`} role="status">
          <p className="route-summary-title">
            {km.format(last!.km)} km off · +{last!.points}
          </p>
          {state.status === 'over' && <p className="muted">That's your budget gone.</p>}
          {state.status === 'over' ? (
            <button className="btn btn-primary btn-lg" onClick={finish} autoFocus>
              See final score
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => setState(game.next(state))} autoFocus>
              Next city
            </button>
          )}
        </div>
      )}
    </div>
  );
}
