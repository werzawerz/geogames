import { useEffect, useMemo, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import type { CityId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  CIRCLE_MIN_POPULATION,
  circleCities,
  createCircleGame,
  formatPopulationShort,
  type CircleCity,
  type CircleDefinition,
  type CircleGame,
  type CircleGameState,
  type CircleGuessResult,
  type CirclePuzzle,
  type Region,
} from '@geogames/games';
import { SearchInput } from '../../components/SearchInput.tsx';
import { cityItems } from '../../components/searchItems.ts';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import { CityMarkers, GuessTable, circleShape, compact, guessMarker, includesTitle, type CityMarker } from './shared.tsx';
import type { GameScreenProps } from '../types.ts';

const cutoff = formatPopulationShort(CIRCLE_MIN_POPULATION);

interface Loaded {
  shapes: WorldShapes;
  game: CircleGame;
}

/** Loads map shapes and the city pool (both lazily), then plays. */
export function CircleScreen({ game: definition, settings, seed, onGameOver }: GameScreenProps<CircleDefinition>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), circleCities(settings)]).then(
      ([shapes, pools]) => {
        if (cancelled) return;
        const { rounds, target, misses } = definition;
        const game = createCircleGame({
          ...pools,
          rounds,
          target,
          misses,
          radiusKm: settings.circleRadiusKm,
          placement: settings.circlePlacement,
        });
        setLoaded({ shapes, game });
      },
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [definition, settings]);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <CirclePlay {...loaded} seed={seed} region={settings.region} onGameOver={onGameOver} />;
}

const MESSAGES: Record<CircleGuessResult, (city: CircleCity | undefined, rank: number | null) => string> = {
  found: (c, rank) => `${c?.name} is #${rank}!`,
  'in-circle': (c, rank) => `${c?.name} is inside, but only #${rank}.`,
  outside: (c) => `${c?.name} is outside the circle.`,
  repeat: () => 'Already guessed.',
  unknown: () => 'No such city in the game.',
};

function CirclePlay({
  shapes,
  game,
  seed,
  region,
  onGameOver,
}: Loaded & { seed: number; region: Region; onGameOver: GameScreenProps['onGameOver'] }) {
  const [state, setState] = useState<CircleGameState>(() => game.start(seed));
  const round = game.current(state);
  const number = state.status === 'placing' ? state.rounds.length + 1 : state.rounds.length;

  return (
    <div className="route circle-game">
      <div className="route-status">
        <span>
          Circle <strong>{number}</strong> of {game.rounds}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>
      {round ? (
        <CircleRoundView
          key={state.rounds.length}
          shapes={shapes}
          game={game}
          state={state}
          setState={setState}
          puzzle={round.puzzle}
          onGameOver={onGameOver}
        />
      ) : (
        <PlaceCircle
          shapes={shapes}
          game={game}
          region={region}
          onPlace={(center) => {
            const placed = game.place(state, center);
            if (placed.result === 'placed') setState(placed.state);
          }}
        />
      )}
    </div>
  );
}

/**
 * Box around the bulk of a region's cities: the outer 5% on each axis is
 * trimmed, so outliers (Russia's Siberian cities count as "Europe") don't
 * stretch the map across a continent.
 */
function regionFrame(cities: readonly CircleCity[]): GeoPermissibleObjects {
  const quantile = (values: number[], p: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;
  const lng = cities.map((c) => c.latlng[1]);
  const lat = cities.map((c) => c.latlng[0]);
  const [west, east] = [quantile([...lng], 0.05), quantile([...lng], 0.95)];
  const [south, north] = [quantile([...lat], 0.05), quantile([...lat], 0.95)];
  return {
    type: 'MultiPoint',
    coordinates: [
      [west, south],
      [west, north],
      [east, south],
      [east, north],
    ],
  };
}

/** Custom placement: click the map to preview a circle, then confirm it. */
function PlaceCircle({
  shapes,
  game,
  region,
  onPlace,
}: {
  shapes: WorldShapes;
  game: CircleGame;
  region: Region;
  onPlace(center: [number, number]): void;
}) {
  const [center, setCenter] = useState<[number, number] | null>(null);
  const inside = useMemo(() => (center ? game.preview(center) : []), [game, center]);
  const enough = inside.length >= game.target;

  const frame = useMemo<GeoPermissibleObjects>(
    () => (region === 'world' ? { type: 'Sphere' } : regionFrame(game.centers)),
    [region, game],
  );
  const preview = useMemo(() => (center ? circleShape(center, game.customRadius) : null), [center, game.customRadius]);

  const overlay = (projection: GeoProjection) =>
    preview && <path className={`circle-area${enough ? '' : ' circle-too-few'}`} d={geoPath(projection)(preview) ?? ''} />;

  return (
    <>
      <p className="circle-prompt">
        Click the map to place your circle <span className="muted">(radius {game.customRadius} km)</span>
      </p>
      <WorldMap
        shapes={shapes}
        frame={frame}
        overlay={overlay}
        onPick={([lng, lat]) => setCenter([lat, lng])}
        label="Click to place your circle"
      />
      <div className="place-bar" role="status">
        {center ? (
          <>
            <span>
              {inside.length} {inside.length === 1 ? 'city' : 'cities'} of {cutoff}+ inside
              {!enough && <span className="muted"> · need at least {game.target}</span>}
            </span>
            <button className="btn btn-primary btn-lg" disabled={!enough} onClick={() => onPlace(center)}>
              Play this circle
            </button>
          </>
        ) : (
          <span className="muted">Pick a spot: busy regions make tougher circles.</span>
        )}
      </div>
    </>
  );
}

function CircleRoundView({
  shapes,
  game,
  state,
  setState,
  puzzle,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: CircleGame;
  state: CircleGameState;
  setState(state: CircleGameState): void;
  puzzle: CirclePuzzle;
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const round = game.current(state)!;
  const playing = state.status === 'playing';
  const top = game.top(puzzle);

  const searchItems = useMemo(() => cityItems(game.cities.values()), [game]);
  const exclude = useMemo(() => new Set(round.guesses), [round.guesses]);
  const circle = useMemo(() => circleShape(puzzle.center, puzzle.radiusKm), [puzzle]);

  const guess = (id: CityId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(MESSAGES[result](game.cities.get(id), game.rankOf(puzzle, id)));
    setState(next);
  };

  // Dots: guesses, plus (after the round) the top cities that were missed.
  const revealed = playing ? [] : top.filter((id) => !round.guesses.includes(id));
  const markers: CityMarker[] = [
    ...round.guesses.map((id) => guessMarker(puzzle, game.target, id)),
    ...revealed.map((id) => ({ id, tone: 'missed' as const })),
  ];

  // The circle zooms with the map; dots and labels stay readable at any zoom.
  const overlay = (projection: GeoProjection) => <path className="circle-area" d={geoPath(projection)(circle) ?? ''} />;
  const drawMarkers = (toScreen: ToScreen) => (
    <CityMarkers markers={markers} cities={game.cities} puzzle={puzzle} target={game.target} toScreen={toScreen} />
  );

  const missesLeft = game.misses - round.misses;

  return (
    <>
      <p className="circle-prompt">
        Name the <strong>{game.target}</strong> most populous cities inside the circle
        <span className="muted"> (radius {puzzle.radiusKm} km)</span>
      </p>

      <WorldMap
        shapes={shapes}
        frame={circle}
        overlay={overlay}
        markers={drawMarkers}
        label="Map with the circle to search"
      />

      <ol className="rank-slots" aria-label="Top cities">
        {top.map((id, i) => {
          const city = game.cities.get(id)!;
          const found = round.guesses.includes(id);
          const shown = found || !playing;
          return (
            <li key={id} className={found ? 'slot-found' : shown ? 'slot-missed' : ''}>
              <span className="slot-rank">{i + 1}</span>
              {shown ? (
                <>
                  <span className="slot-name" title={includesTitle(city)}>
                    {city.name}
                    {city.includes?.length ? <span className="slot-incl"> +{city.includes.length}</span> : null}
                  </span>
                  <span className="slot-pop">{compact.format(city.population)}</span>
                </>
              ) : (
                <span className="slot-name muted">?</span>
              )}
            </li>
          );
        })}
      </ol>

      {playing ? (
        <>
          <SearchInput
            items={searchItems}
            exclude={exclude}
            onPick={guess}
            onNoMatch={() => setMessage(MESSAGES.unknown(undefined, null))}
            placeholder="Type a city…"
            label="Guess a city"
          />
          <p className="route-message" role="status">
            {message ?? `Every city of ${cutoff}+ counts. Big cities count with their metro area (UN data).`}{' '}
            <span className="muted">
              {missesLeft} {missesLeft === 1 ? 'miss' : 'misses'} left
            </span>
          </p>
          <button className="btn give-up" onClick={() => setState(game.giveUp(state))}>
            Give up this circle
          </button>
        </>
      ) : (
        <div className={`route-summary ${round.status === 'solved' ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">
            {round.status === 'solved' ? `All ${game.target} found!` : `${round.found} of ${game.target} found`}
          </p>
          <button
            className="btn btn-primary btn-lg"
            autoFocus
            onClick={() =>
              state.status === 'over' ? onGameOver({ score: state.score, moves: state.moves }) : setState(game.nextRound(state))
            }
          >
            {state.status === 'over'
              ? 'See final score'
              : game.placement === 'custom'
                ? 'Place the next circle'
                : 'Next circle'}
          </button>
        </div>
      )}

      <GuessTable cities={game.cities} puzzle={puzzle} target={game.target} guesses={round.guesses} />
    </>
  );
}
