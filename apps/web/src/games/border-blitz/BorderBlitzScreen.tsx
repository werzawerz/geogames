import { useEffect, useMemo, useState } from 'react';
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
import { WorldMap, type MapCountry, type ToScreen } from '../../components/WorldMap.tsx';
import { load, remove, save } from '../../platform/storage.ts';
import type { GameScreenProps } from '../types.ts';
import { frameFor, frameShape } from './frame.ts';

const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;
const TICK_MS = 100;
/** Countries smaller than this (km²) vanish at the map's scale, so they get a dot. */
const DOT_BELOW_KM2 = 1000;
const isTiny = (id: CountryId) => (getCountry(id)?.metrics.area?.value ?? Infinity) < DOT_BELOW_KM2;
/** Where the level's deadline is kept, so a reload doesn't give a fresh clock. */
const CLOCK_KEY = 'border-blitz-clock';
interface Deadline {
  seed: number;
  level: number;
  /** Epoch milliseconds. */
  at: number;
}

/** One mark per level: 🟩 flawless, 🟨 cleared with a mistake, then how the run ended. */
const shareLine = ({ cleared, completed, ended }: BlitzState) =>
  cleared.map((flawless) => (flawless ? '🟩' : '🟨')).join('') + (completed ? '' : ended === 'time' ? '⏱️' : '🟥');

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

function messageFor(result: BlitzGuessResult, id: CountryId, target: CountryId, points: number, via: CountryId | null): string | null {
  switch (result) {
    case 'found':
      return `${nameOf(id)} ✓ +${points}`;
    case 'wrong':
      return `${nameOf(id)} doesn't border ${nameOf(target)}. −1 ♥ −${BLITZ_WRONG_SECONDS} s`;
    case 'repeat':
      return `You already named ${nameOf(id)}.`;
    case 'territory':
      return `${nameOf(id)} meets ${nameOf(target)} only through ${nameOf(via ?? '')}, which doesn't count here. No harm done!`;
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

  // The clock: a deadline for this level, which each wrong answer brings closer.
  // It's saved, so a reload carries on with it (and times out at once if it has
  // passed) instead of starting the level's clock again. It belongs to its level,
  // so the last level's can't run out on this one.
  const [deadline, setDeadline] = useState<Deadline | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const keepDeadline = (next: Deadline) => {
    save(CLOCK_KEY, next);
    setDeadline(next);
  };
  useEffect(() => {
    setMessage(null);
    if (state.status !== 'playing') return;
    const saved = load<Deadline | null>(CLOCK_KEY, null);
    keepDeadline(saved && saved.seed === seed && saved.level === level ? saved : { seed, level, at: Date.now() + (total - wrong.length * BLITZ_WRONG_SECONDS) * 1000 });
    // Only a new level resets the clock; wrong answers move it in `guess`.
  }, [level]);
  useEffect(() => {
    if (state.status === 'over') remove(CLOCK_KEY);
  }, [state.status]);
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

  const frame = useMemo(() => frameShape(frameFor(shapes, target, neighbours)), [shapes, target, neighbours]);
  const missed = playing ? [] : neighbours.filter((id) => !found.includes(id));
  // Microstates are drawn as dots with their own labels (below), so the map's labels skip them.
  const label = (id: CountryId) => (isTiny(id) ? undefined : nameOf(id));
  const mapCountries: MapCountry[] = [
    ...missed.map((id): MapCountry => ({ id, tone: 'far', label: label(id) })),
    ...found.map((id): MapCountry => ({ id, tone: 'optimal', label: label(id) })),
    { id: target, tone: 'start', label: nameOf(target) },
  ];
  const dots = (toScreen: ToScreen) =>
    [...found.map((id) => [id, 'marker-found'] as const), ...missed.map((id) => [id, 'marker-outside'] as const)]
      .filter(([id]) => isTiny(id))
      .map(([id, className]) => {
        const [lat, lng] = getCountry(id)!.latlng;
        const point = toScreen([lng, lat]);
        return point ? (
          <g key={id} className={`city-marker ${className}`}>
            <circle cx={point[0]} cy={point[1]} r={5} />
            <text x={point[0] + 8} y={point[1]}>
              {nameOf(id)}
            </text>
          </g>
        ) : null;
      });
  const exclude = useMemo(() => new Set([target, ...found, ...wrong]), [target, found, wrong]);

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    if (result === 'wrong' && deadline) keepDeadline({ ...deadline, at: deadline.at - BLITZ_WRONG_SECONDS * 1000 });
    setMessage(messageFor(result, id, target, next.score - state.score, game.throughTerritory(target, id)));
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

      <WorldMap shapes={shapes} countries={mapCountries} frame={frame} markers={dots} borders={false} label={`Map of ${nameOf(target)} and the neighbours you found`} />

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
    </div>
  );
}
