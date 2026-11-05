import { useEffect, useMemo, useState } from 'react';
import { getCountry, type CountryId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  EXTRA_GUESSES,
  createRouteGame,
  replayRoute,
  routeCountries,
  type GuessQuality,
  type RouteDefinition,
  type RouteGame,
  type RouteGameState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import type { GameScreenProps } from '../types.ts';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry } from '../../components/WorldMap.tsx';

const name = (id: CountryId) => getCountry(id)?.name ?? id;

/** Loads map shapes (lazily, ~740 KB) and the region's border graph, then plays. */
export function RouteScreen({ game: definition, settings, seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<RouteDefinition>) {
  const [shapes, setShapes] = useState<WorldShapes | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadWorldShapes().then(
      (s) => !cancelled && setShapes(s),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const game = useMemo(
    () =>
      createRouteGame({
        countries: routeCountries(settings),
        rounds: definition.rounds,
        hard: settings.routeMode === 'hard',
      }),
    [settings, definition.rounds],
  );

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!shapes) return <p className="panel center muted">Loading map…</p>;
  return (
    <RoutePlay
      game={game}
      shapes={shapes}
      seed={seed}
      initialMoves={initialMoves}
      onMovesChange={onMovesChange}
      onGameOver={onGameOver}
      hard={settings.routeMode === 'hard'}
    />
  );
}

const MESSAGES = {
  repeat: () => 'Already guessed.',
  endpoint: () => "That's the start or the goal.",
  unknown: () => "That country isn't on this map.",
  'not-adjacent': (id: CountryId) => `${name(id)} doesn't border your route yet. Go country by country.`,
} as const;

function RoutePlay({
  game,
  shapes,
  seed,
  initialMoves,
  onMovesChange,
  hard,
  onGameOver,
}: {
  game: RouteGame;
  shapes: WorldShapes;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  hard: boolean;
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<RouteGameState>(() => replayRoute(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const round = game.current(state);
  const { puzzle } = round;
  const playing = state.status === 'playing';

  const searchItems = useMemo(() => countryItems(game.graph.keys()), [game]);
  const exclude = useMemo(() => new Set([puzzle.start, puzzle.end, ...round.guesses]), [puzzle, round.guesses]);
  const qualities = round.guesses.map((id) => [id, game.classify(puzzle, id)] as const);
  const route = playing ? [] : game.shortestRoute(puzzle, round.guesses);

  const mapCountries: MapCountry[] = [
    ...route.slice(1, -1).filter((id) => !round.guesses.includes(id)).map((id) => ({ id, tone: 'route' as const, label: name(id) })),
    ...qualities.map(([id, q]) => ({ id, tone: q, label: name(id) })),
    { id: puzzle.start, tone: 'start', label: name(puzzle.start) },
    { id: puzzle.end, tone: 'end', label: name(puzzle.end) },
  ];
  // One frame per round: start, goal and their neighbours cover the area of play.
  // Keeping it fixed means the full map is projected once per round, not per guess.
  const focus = useMemo(
    () => [puzzle.start, puzzle.end, ...(game.graph.get(puzzle.start) ?? []), ...(game.graph.get(puzzle.end) ?? [])],
    [game, puzzle],
  );

  useEffect(() => setMessage(null), [round.puzzle]);

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    if (result === 'not-adjacent' && hard) setMessage(`${name(id)} doesn't border your route. That cost you a guess.`);
    else setMessage(result === 'accepted' ? null : MESSAGES[result](id));
    setState(next);
  };

  const left = game.guessLimit(puzzle) - round.guesses.length - round.misses.length;

  return (
    <div className="route">
      <div className="route-status">
        <span>
          Level <strong>{state.rounds.length}</strong> of {game.rounds}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="route-ends">
        <span className="route-end tone-start">
          <Flag iso2={getCountry(puzzle.start)!.iso2} className="end-flag" />
          {name(puzzle.start)}
        </span>
        <span className="route-arrow" aria-hidden="true">
          →
        </span>
        <span className="route-end tone-end">
          <Flag iso2={getCountry(puzzle.end)!.iso2} className="end-flag" />
          {name(puzzle.end)}
        </span>
      </div>
      <p className="route-hint muted">
        {hard && playing ? (
          `${left} guesses left`
        ) : (
          <>
            Shortest route: <strong>{puzzle.minimal}</strong> {puzzle.minimal === 1 ? 'country' : 'countries'} in between
            {playing && ` · ${left} guesses left`}
          </>
        )}
      </p>

      <WorldMap shapes={shapes} countries={mapCountries} focus={focus} label="Map of your route" borders={!hard} />

      <ul className="map-legend" aria-label="Legend">
        <li className="tone-optimal">On a shortest route</li>
        <li className="tone-near">One detour</li>
        <li className="tone-far">Off track</li>
      </ul>

      {playing ? (
        <>
          <SearchInput
            items={searchItems}
            exclude={exclude}
            onPick={guess}
            onNoMatch={() => setMessage(MESSAGES.unknown())}
            placeholder="Type a country…"
            label="Guess a country"
          />
          <p className="route-message" role="status">
            {message ??
              (hard
                ? `Go country by country from ${name(puzzle.start)}: each guess should border your route. One that doesn't costs a guess and points, as does every step beyond the shortest route.`
                : `Go country by country from ${name(puzzle.start)}: each guess must border your route. You have ${puzzle.minimal} + ${EXTRA_GUESSES} guesses.`)}
          </p>
        </>
      ) : (
        <RoundSummary
          solved={round.status === 'solved'}
          points={round.points}
          route={route}
          last={state.status === 'over'}
          onNext={() => {
            if (state.status !== 'over') return setState(game.nextRound(state));
            const level = state.rounds.length;
            onGameOver({
              score: state.score,
              moves: state.moves,
              message:
                round.status === 'solved' ? `You connected all ${level} routes!` : `You reached level ${level} of ${game.rounds}.`,
              shareLine: state.rounds.map(routeEmoji).join(''),
            });
          }}
        />
      )}

      {round.guesses.length + round.misses.length > 0 && (
        <ol className="guess-list" aria-label="Your guesses">
          {qualities.map(([id, q]) => (
            <li key={id} className={`guess tone-${q}`}>
              <Flag iso2={getCountry(id)!.iso2} className="suggestion-flag" />
              {name(id)}
              <span className="sr-only"> ({QUALITY_TEXT[q]})</span>
            </li>
          ))}
          {round.misses.map((id) => (
            <li key={`miss-${id}`} className="guess guess-miss">
              <Flag iso2={getCountry(id)!.iso2} className="suggestion-flag" />
              {name(id)}
              <span className="sr-only"> (doesn't border your route)</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One square per level: 🟩 no extra guesses, 🟧 solved with some, 🟥 failed. */
function routeEmoji(round: RouteGameState['rounds'][number]): string {
  if (round.status !== 'solved') return '🟥';
  return round.guesses.length + round.misses.length === round.puzzle.minimal ? '🟩' : '🟧';
}

const QUALITY_TEXT: Record<GuessQuality, string> = {
  optimal: 'on a shortest route',
  near: 'one detour',
  far: 'off track',
};

function RoundSummary({
  solved,
  points,
  route,
  last,
  onNext,
}: {
  solved: boolean;
  points: number;
  route: readonly CountryId[];
  last: boolean;
  onNext(): void;
}) {
  return (
    <div className={`route-summary ${solved ? 'solved' : 'failed'}`} role="status">
      <p className="route-summary-title">{solved ? `Connected! +${points}` : 'Out of guesses'}</p>
      <p className="muted">Shortest route: {route.map(name).join(' → ')}</p>
      <button className="btn btn-primary btn-lg" onClick={onNext} autoFocus>
        {last ? 'See final score' : 'Next level'}
      </button>
    </div>
  );
}
