import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry, queryCountries, type CountryId } from '@geogames/geodata';
import { loadLandGrid, type LandGrid } from '@geogames/geodata/land-grid';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  GRID_MAX_LIVES,
  GRID_SKIP,
  arcadePools,
  createOnTheGrid,
  formatCoordinates,
  gridPlan,
  nearCity,
  replayOnTheGrid,
  type CircleCity,
  type GridGuessResult,
  type GridMark,
  type GridState,
  type OnTheGrid,
  type OnTheGridDefinition,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { mainland } from '../../components/mainland.ts';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry, type ToScreen } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';
import { wrongGuessHint } from './hint.ts';

const WORLD: GeoPermissibleObjects = { type: 'Sphere' };
const MARKS: Record<GridMark, string> = { flawless: '🎯', cleared: '🟩', missed: '🟧', lost: '🟥' };

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

function messageFor(result: GridGuessResult, id: CountryId): string | null {
  const name = getCountry(id)?.name ?? id;
  if (result === 'repeat') return `You’ve tried ${name} already.`;
  if (result === 'unknown') return 'That isn’t a country in this game.';
  return null;
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
  const [message, setMessage] = useState<string | null>(null);
  const { level } = state;
  const plan = gridPlan(level.number);
  const playing = state.status === 'playing';
  const answer = getCountry(level.country)!;
  const spot = formatCoordinates(level.target);
  // Every country is offered alike: no order that leans towards the answer (all weigh the same, so they sort by name).
  const items = useMemo(() => countryItems(game.countries.keys()).map((i) => ({ ...i, weight: 0 })), [game]);
  const exclude = useMemo(() => new Set<string>(level.guesses), [level.guesses]);
  const wrong = level.guesses.filter((g) => g !== level.country);
  const misses = level.status === 'cleared' ? level.guesses.length - 1 : level.guesses.length;
  useEffect(() => setMessage(null), [level.number]);

  // The question's map is the whole world, blind. The reveal zooms to the answer and the point.
  const revealFrame = useMemo<GeoPermissibleObjects>(() => {
    const shape = shapes.countries.get(level.country);
    const point = { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [level.target[1], level.target[0]] } };
    return shape ? { type: 'FeatureCollection', features: [mainland(shape), point] } : point;
  }, [shapes, level.country, level.target]);
  const showMap = !plan.mapHidden || !playing;

  // What the player has earned: the countries they named, in red. Never a name, border or marker of the answer's.
  const mapCountries = useMemo<MapCountry[]>(
    () => [...wrong.map((id) => ({ id, tone: 'far' as const })), ...(playing ? [] : [{ id: level.country, tone: 'optimal' as const }])],
    [wrong, playing, level.country],
  );

  const hints = wrong.map((id) => {
    const c = getCountry(id)!;
    return {
      id,
      iso2: c.iso2,
      text: wrongGuessHint({ name: c.name, shape: shapes.countries.get(id), centre: c.latlng, spot: level.target, neighbour: answer.borders.includes(id) }),
    };
  });

  const markers = (toScreen: ToScreen) => {
    if (playing) return null;
    const at = toScreen([level.target[1], level.target[0]]);
    if (!at) return null;
    return (
      <g className="city-marker marker-found">
        <circle cx={at[0]} cy={at[1]} r={6} />
        <text x={at[0] + 9} y={at[1]}>
          {spot}
        </text>
      </g>
    );
  };

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, id));
    setState(next);
  };
  const skip = () => {
    setMessage(null);
    setState(game.skip(state));
  };
  const next = () => setState(game.nextLevel(state));
  const finish = () => {
    const first = state.marks.filter((m) => m === 'flawless').length;
    const found = state.marks.filter((m) => m !== 'lost').length;
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.${found ? ` ${first} first-guess find${first === 1 ? '' : 's'} in ${found}.` : ''}`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });
  };

  // When a level ends, its button takes the focus, so Enter goes on; a new level focuses the input, never Skip.
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const skipped = level.status === 'lost' && state.moves.at(-1) === GRID_SKIP;
  const city = playing ? null : nearCity(level.target, level.country, cities);
  const note = `${spot} is in ${answer.name}${city ? `, near ${city.name}` : ''}.`;
  const left = plan.misses - level.guesses.length;
  const hintList =
    hints.length > 0 ? (
      <ul className="grid-hints" aria-label="Your wrong guesses, and where the spot is from each">
        {hints.map((h) => (
          <li key={h.id}>
            <Flag iso2={h.iso2} className="suggestion-flag" /> {h.text}
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className={`route grid-game${playing ? '' : ' done'}${showMap ? '' : ' no-map'}`}>
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
        <span aria-label={`${misses} of ${plan.misses} misses`}>
          Misses <strong className="grid-misses">{misses}</strong>/{plan.misses}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="grid-prompt">
        Which country is at <strong className="grid-coords">{spot}</strong>?
      </p>

      {showMap && (
        <WorldMap
          key={playing ? 'blind' : 'reveal'}
          shapes={shapes}
          frame={playing ? WORLD : revealFrame}
          countries={mapCountries}
          borders={false}
          terrain
          markers={markers}
          label={playing ? 'Blind world map: no borders, names or marks. Place the coordinates yourself.' : `World map: ${answer.name}`}
        />
      )}

      {playing ? (
        <>
          <div className="grid-input">
            <SearchInput
              key={level.number}
              items={items}
              exclude={exclude}
              onPick={guess}
              onNoMatch={() => setMessage('Not one of the countries. Pick one from the list.')}
              placeholder="Which country is it?"
              label="Name the country"
              focusWithoutScroll
            />
            <button type="button" className="btn grid-skip" onClick={skip}>
              ⏭ Skip <span className="muted">−1 ♥</span>
            </button>
          </div>
          <p className="route-message" role="status">
            {message ?? (wrong.length ? (left === 1 ? 'One more miss costs a life.' : `${left - 1} more free ${left === 2 ? 'miss' : 'misses'}.`) : plan.mapHidden ? 'No map this time: coordinates and memory only.' : 'Use the blind map to place the coordinates, then name the country.')}
          </p>
          {hintList}
        </>
      ) : (
        <div className={`route-summary ${level.status === 'cleared' ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">
            {level.status === 'cleared' ? (
              <>
                <Flag iso2={answer.iso2} className="suggestion-flag" /> {answer.name}! +{level.points}
              </>
            ) : skipped ? (
              'Skipped: −1 ♥'
            ) : plan.misses === 1 ? (
              'A miss: −1 ♥'
            ) : (
              `${plan.misses} misses: −1 ♥`
            )}
          </p>
          <p>{note}</p>
          {level.flawless && <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${GRID_MAX_LIVES} at most).`}</p>}
          {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
          <button ref={nextButton} className="btn btn-primary btn-lg" onClick={state.status === 'over' ? finish : next}>
            {state.status === 'over' ? 'See final score' : 'Next level'}
          </button>
        </div>
      )}
    </div>
  );
}
