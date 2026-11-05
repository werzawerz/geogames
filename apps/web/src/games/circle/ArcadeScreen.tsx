import { useEffect, useMemo, useState } from 'react';
import { geoPath, type GeoProjection } from 'd3-geo';
import { getCountry, type CityId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  HINT_COST,
  MAX_LIVES,
  arcadePools,
  createCircleArcade,
  hintText,
  replayCircleArcade,
  type ArcadeGuessResult,
  type ArcadeState,
  type CircleArcade,
  type CircleArcadeDefinition,
  type CircleCity,
  type CityData,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { cityItems } from '../../components/searchItems.ts';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';
import { CityMarkers, GuessTable, circleShape, compact, guessMarker, includesTitle, type CityMarker } from './shared.tsx';

/** Loads map shapes and the city pool (both lazily), then plays. */
export function ArcadeScreen({ settings, seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<CircleArcadeDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; game: CircleArcade } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), arcadePools(settings)]).then(
      ([shapes, pools]) => !cancelled && setLoaded({ shapes, game: createCircleArcade(pools) }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [settings]);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <ArcadePlay {...loaded} cityData={settings.cityData} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

const MESSAGES: Record<ArcadeGuessResult, (city: CircleCity | undefined, rank: number | null, points: number) => string> = {
  found: (c, rank, points) => `${c?.name} is #${rank}! +${points}`,
  'in-circle': (c, rank) => `${c?.name} is inside, but only #${rank}.`,
  outside: (c) => `${c?.name} is outside the circle.`,
  repeat: () => 'Already guessed.',
  unknown: () => 'No such city in the game.',
};

function ArcadePlay({
  shapes,
  game,
  cityData,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: CircleArcade;
  cityData: CityData;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<ArcadeState>(() => replayCircleArcade(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const { level } = state;
  const { puzzle, target } = level;
  const playing = state.status === 'playing';
  const top = game.top(level);

  useEffect(() => setMessage(null), [level.number]);

  const searchItems = useMemo(() => cityItems(game.cities.values()), [game]);
  const exclude = useMemo(() => new Set([...level.guesses, ...level.skipped]), [level.guesses, level.skipped]);
  const circle = useMemo(() => circleShape(puzzle.center, puzzle.radiusKm), [puzzle]);

  const guess = (id: CityId) => {
    const pointsIfFound = game.cityPoints(level, id);
    const { state: next, result } = game.guess(state, id);
    setMessage(MESSAGES[result](game.cities.get(id), game.rankOf(level, id), pointsIfFound));
    setState(next);
  };
  const skip = () => {
    const [best] = game.remaining(level);
    setMessage(best ? `Skipped: it was ${game.cities.get(best)!.name}. −1 ♥` : null);
    setState(game.skip(state));
  };
  const hint = () => {
    setMessage(null);
    setState(game.hint(state));
  };

  const hintTarget = game.hintTarget(level);
  // What the next hint costs: half of that city's full value.
  const hintCost = Math.round(10 * level.number * HINT_COST);
  const canHint = state.hintsLeft > 0 && hintTarget !== null;

  const missed = playing ? [] : game.remaining(level);
  const markers: CityMarker[] = [
    ...level.guesses.map((id) => guessMarker(puzzle, target, id)),
    ...level.skipped.map((id) => ({ id, tone: 'skipped' as const })),
    ...missed.map((id) => ({ id, tone: 'missed' as const })),
  ];
  const overlay = (projection: GeoProjection) => <path className="circle-area" d={geoPath(projection)(circle) ?? ''} />;
  const drawMarkers = (toScreen: ToScreen) => (
    <CityMarkers markers={markers} cities={game.cities} puzzle={puzzle} target={target} toScreen={toScreen} />
  );

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number} and cleared ${state.cleared} ${state.cleared === 1 ? 'circle' : 'circles'}.`,
    });

  return (
    <div className="route circle-game arcade">
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

      <p className="circle-prompt">
        Name the top <strong>{target}</strong> cities inside the circle
        <span className="muted"> (radius {puzzle.radiusKm} km)</span>
      </p>

      <WorldMap shapes={shapes} frame={circle} overlay={overlay} markers={drawMarkers} label="Map with the circle to search" />

      <ol className="rank-slots" aria-label="Top cities">
        {top.map((id, i) => {
          const city = game.cities.get(id)!;
          const found = level.guesses.includes(id);
          const skipped = level.skipped.includes(id);
          const shown = found || skipped || !playing;
          const hints = level.hints[id] ?? 0;
          const country = getCountry(city.countryId);
          return (
            <li key={id} className={found ? 'slot-found' : shown ? 'slot-missed' : hints ? 'slot-hinted' : ''}>
              <span className="slot-rank">{i + 1}</span>
              {shown ? (
                <>
                  <span className="slot-name" title={includesTitle(city)}>
                    {city.name}
                    {city.includes?.length ? <span className="slot-incl"> +{city.includes.length}</span> : null}
                  </span>
                  <span className="slot-pop">{skipped ? 'skipped' : compact.format(city.population)}</span>
                </>
              ) : hints > 0 ? (
                <span className="slot-hint" aria-label={`Hint: in ${country?.name}, starts with ${city.name[0]}`}>
                  {country && <Flag iso2={country.iso2} className="suggestion-flag" />}
                  <span className="slot-letters">{hintText(city.name, hints)}</span>
                </span>
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
            onNoMatch={() => setMessage(MESSAGES.unknown(undefined, null, 0))}
            placeholder="Type a city…"
            label="Guess a city"
          />
          <p className="route-message" role="status">
            {message ??
              (cityData === 'proper'
                ? 'Every city of 50k+ counts, as the city itself, without its suburbs (GeoNames data).'
                : 'Every city of 50k+ counts. Big cities count with their metro area (UN data).')}
          </p>
          <div className="arcade-actions">
            <button
              className="btn"
              onClick={hint}
              disabled={!canHint}
              title={state.hintsLeft === 0 ? 'No hints left: a perfect level earns one back' : undefined}
            >
              💡 Hint ({state.hintsLeft}) <span className="muted">−{hintCost} pts</span>
            </button>
            <button className="btn" onClick={skip}>
              ⏭ Skip city <span className="muted">−1 ♥</span>
            </button>
          </div>
        </>
      ) : state.status === 'level-clear' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">
            Level {level.number} cleared! +{level.points}
          </p>
          {state.bonusLife && (
            <p className="bonus-life">{state.lives >= MAX_LIVES ? 'Perfect level! Lives are full.' : 'Perfect level! +1 ♥'}</p>
          )}
          {state.bonusHint && <p className="bonus-hint">Flawless: +1 💡</p>}
          {message && <p className="muted">{message}</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={() => setState(game.nextLevel(state))}>
            Next level
          </button>
        </div>
      ) : (
        <div className="route-summary failed" role="status">
          <p className="route-summary-title">Out of lives</p>
          {message && <p className="muted">{message}</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={finish}>
            See final score
          </button>
        </div>
      )}

      <GuessTable cities={game.cities} puzzle={puzzle} target={target} guesses={level.guesses} />
    </div>
  );
}
