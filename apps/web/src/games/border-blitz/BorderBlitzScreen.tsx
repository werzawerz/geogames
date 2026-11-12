import { useEffect, useMemo, useState } from 'react';
import { geoCentroid, geoCircle, geoDistance, type GeoPermissibleObjects } from 'd3-geo';
import { getCountry, type CountryId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  BLITZ_LIVES,
  BLITZ_WRONG_SECONDS,
  blitzFlawlessBonus,
  blitzSeconds,
  createBorderBlitz,
  replayBorderBlitz,
  routeCountries,
  type BlitzGuessResult,
  type BlitzState,
  type BorderBlitzDefinition,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, mainland, type MapCountry } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';

const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;
const TICK_MS = 100;
const DEGREES = 180 / Math.PI;

/** One mark per level: 🟩 flawless, 🟨 cleared with a mistake, then how the run ended. */
const shareLine = ({ cleared, completed, ended }: BlitzState) =>
  cleared.map((flawless) => (flawless ? '🟩' : '🟨')).join('') + (completed ? '' : ended === 'time' ? '⏱️' : '🟥');

/**
 * Frames the map on a circle around the country's main landmass, wide enough
 * for its neighbours. It depends on the country alone, so it gives nothing away
 * about where the neighbours are.
 */
function frameAround(shapes: WorldShapes, id: CountryId): GeoPermissibleObjects {
  const shape = shapes.countries.get(id);
  const fallback = getCountry(id)!.latlng;
  if (!shape) return geoCircle().center([fallback[1], fallback[0]]).radius(6)();
  const main = mainland(shape);
  const centre = geoCentroid(main);
  const reach = Math.max(...main.geometry.coordinates[0]!.map((p) => geoDistance(centre, p as [number, number]) * DEGREES));
  return geoCircle().center(centre).radius(Math.min(60, reach * 1.8 + 3))();
}

/** Loads the map shapes (lazily), then plays. */
export function BorderBlitzScreen({ game: definition, seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<BorderBlitzDefinition>) {
  const [shapes, setShapes] = useState<WorldShapes | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadWorldShapes().then(
      (loaded) => !cancelled && setShapes(loaded),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!shapes) return <p className="panel center muted">Loading map…</p>;
  return <BlitzPlay shapes={shapes} rounds={definition.rounds} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

function messageFor(result: BlitzGuessResult, id: CountryId, target: CountryId, points: number): string | null {
  switch (result) {
    case 'found':
      return `${nameOf(id)} ✓ +${points}`;
    case 'wrong':
      return `${nameOf(id)} doesn't border ${nameOf(target)}. −1 ♥ −${BLITZ_WRONG_SECONDS} s`;
    case 'repeat':
      return `You already named ${nameOf(id)}.`;
    case 'target':
      return `That's ${nameOf(target)} itself: name the countries around it.`;
    case 'unknown':
      return "That country isn't in this game.";
  }
}

function BlitzPlay({
  shapes,
  rounds,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  rounds: number;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const countries = useMemo(() => routeCountries(), []);
  const game = useMemo(() => createBorderBlitz({ countries, rounds }), [countries, rounds]);
  // Every country can be named, islands too: they're wrong answers like any other.
  const items = useMemo(() => countryItems(countries.filter((c) => c.sovereignty !== 'territory').map((c) => c.id)), [countries]);

  const [state, setState] = useState<BlitzState>(() => replayBorderBlitz(game, seed, initialMoves ?? []));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);

  const { level, target, neighbours, found, wrong } = state;
  const playing = state.status === 'playing';
  const total = blitzSeconds(level, neighbours.length);

  // The clock: a deadline for this level, which each wrong answer brings closer. A
  // resumed level starts it again, minus what its wrong answers cost.
  // The deadline belongs to its level, so the last level's can't run out on this one.
  const [deadline, setDeadline] = useState<{ level: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setMessage(null);
    if (state.status === 'playing') setDeadline({ level, at: Date.now() + (total - wrong.length * BLITZ_WRONG_SECONDS) * 1000 });
    // Only a new level resets the clock; wrong answers move it in `guess`.
  }, [level]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);
  const running = deadline?.level === level;
  const left = running ? Math.max(0, deadline.at - now) : total * 1000;
  useEffect(() => {
    if (playing && running && left <= 0) setState((s) => game.timeout(s));
  }, [playing, running, left, game]);

  const frame = useMemo(() => frameAround(shapes, target), [shapes, target]);
  const missed = playing ? [] : neighbours.filter((id) => !found.includes(id));
  const mapCountries: MapCountry[] = [
    ...missed.map((id): MapCountry => ({ id, tone: 'far', label: nameOf(id) })),
    ...found.map((id): MapCountry => ({ id, tone: 'optimal', label: nameOf(id) })),
    { id: target, tone: 'start', label: nameOf(target) },
  ];
  const exclude = useMemo(() => new Set([target, ...found, ...wrong]), [target, found, wrong]);

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    if (result === 'wrong') setDeadline((d) => d && { ...d, at: d.at - BLITZ_WRONG_SECONDS * 1000 });
    setMessage(messageFor(result, id, target, next.score - state.score));
    setState(next);
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: state.completed ? `You cleared all ${rounds} levels!` : `You reached level ${level} of ${rounds}.`,
      shareLine: shareLine(state),
    });

  const livesLeft = playing || state.status === 'level-clear' ? BLITZ_LIVES - wrong.length : 0;
  const seconds = Math.ceil(left / 1000);
  const flawless = state.status !== 'playing' && state.cleared.length === level && state.cleared[level - 1];

  return (
    <div className="route blitz-game">
      <div className="route-status">
        <span>
          Level <strong>{level}</strong> of {rounds}
        </span>
        <span className="lives" aria-label={`${livesLeft} lives`}>
          {Array.from({ length: BLITZ_LIVES }, (_, i) => (
            <span key={i} className={i < livesLeft ? 'life' : 'life lost'} aria-hidden="true">
              ♥
            </span>
          ))}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="blitz-prompt">
        Name every neighbour of <Flag iso2={getCountry(target)!.iso2} className="suggestion-flag" /> <strong>{nameOf(target)}</strong>
        <span className="blitz-count muted">
          {found.length} of {neighbours.length} found
        </span>
      </p>

      {playing && (
        <div className={`blitz-clock${seconds <= 5 ? ' blitz-clock-low' : ''}`} role="timer" aria-label={`${seconds} seconds left`}>
          <div className="blitz-clock-bar" style={{ width: `${Math.min(100, (left / (total * 1000)) * 100)}%` }} />
          <span className="blitz-clock-text">{seconds} s</span>
        </div>
      )}

      <WorldMap shapes={shapes} countries={mapCountries} frame={frame} borders={false} label={`Map of ${nameOf(target)} and the neighbours you found`} />

      <ol className="rank-slots blitz-slots" aria-label="Neighbours">
        {[...found, ...missed].map((id) => (
          <li key={id} className={found.includes(id) ? 'slot-found' : 'slot-missed'}>
            <span className="slot-name">
              <Flag iso2={getCountry(id)!.iso2} className="suggestion-flag" /> {nameOf(id)}
            </span>
          </li>
        ))}
        {Array.from({ length: neighbours.length - found.length - missed.length }, (_, i) => (
          <li key={`blank-${i}`}>
            <span className="slot-name muted">?</span>
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
            label={`Name a neighbour of ${nameOf(target)}`}
          />
          <p className="route-message" role="status">
            {message ?? 'Any order. A wrong country costs a life and two seconds.'}
          </p>
        </>
      ) : state.status === 'level-clear' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">Level {level} cleared!</p>
          {flawless && <p className="bonus-life">Flawless! +{blitzFlawlessBonus(level, neighbours.length)} bonus</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={() => setState(game.nextLevel(state))}>
            Next level
          </button>
        </div>
      ) : (
        <div className={`route-summary ${state.completed ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">
            {state.completed ? `All ${rounds} levels cleared!` : state.ended === 'time' ? "Time's up!" : 'Out of lives'}
          </p>
          {flawless && <p className="bonus-life">Flawless! +{blitzFlawlessBonus(level, neighbours.length)} bonus</p>}
          {missed.length > 0 && <p className="muted">You missed {missed.map(nameOf).join(', ')}.</p>}
          <button className="btn btn-primary btn-lg" autoFocus onClick={finish}>
            See final score
          </button>
        </div>
      )}
    </div>
  );
}
