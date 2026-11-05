import { useEffect, useMemo, useState } from 'react';
import { countries as allCountries, getCountry, type CountryId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  EXTRA_GUESSES,
  createRouteGame,
  maxGuesses,
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
export function RouteScreen({ game: definition, settings, seed, onGameOver }: GameScreenProps<RouteDefinition>) {
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
    () => createRouteGame({ countries: routeCountries(settings), rounds: definition.rounds }),
    [settings, definition.rounds],
  );

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!shapes) return <p className="panel center muted">Loading map…</p>;
  return <RoutePlay game={game} shapes={shapes} seed={seed} onGameOver={onGameOver} region={settings.region} />;
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
  region,
  onGameOver,
}: {
  game: RouteGame;
  shapes: WorldShapes;
  seed: number;
  region: string;
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<RouteGameState>(() => game.start(seed));
  const [message, setMessage] = useState<string | null>(null);
  const round = game.current(state);
  const { puzzle } = round;
  const playing = state.status === 'playing';

  const searchItems = useMemo(() => countryItems(game.graph.keys()), [game]);
  // Dim only what lies outside the chosen region; islands and territories inside it look normal.
  const inPlay = useMemo(
    () => new Set(allCountries.filter((c) => region === 'world' || c.continent === region).map((c) => c.id)),
    [region],
  );
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
    setMessage(result === 'accepted' ? null : MESSAGES[result](id));
    setState(next);
  };

  const left = maxGuesses(puzzle) - round.guesses.length;

  return (
    <div className="route">
      <div className="route-status">
        <span>
          Route <strong>{state.rounds.length}</strong> of {game.rounds}
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
        Shortest route: <strong>{puzzle.minimal}</strong> {puzzle.minimal === 1 ? 'country' : 'countries'} in between
        {region !== 'world' && ' (within the region)'}
        {playing && ` · ${left} guesses left`}
      </p>

      <WorldMap shapes={shapes} countries={mapCountries} focus={focus} inPlay={inPlay} label="Map of your route" />

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
              `Go country by country from ${name(puzzle.start)}: each guess must border your route. You have ${puzzle.minimal} + ${EXTRA_GUESSES} guesses.`}
          </p>
        </>
      ) : (
        <RoundSummary
          solved={round.status === 'solved'}
          points={round.points}
          route={route}
          last={state.status === 'over'}
          onNext={() => (state.status === 'over' ? onGameOver({ score: state.score, moves: state.moves }) : setState(game.nextRound(state)))}
        />
      )}

      {round.guesses.length > 0 && (
        <ol className="guess-list" aria-label="Your guesses">
          {qualities.map(([id, q]) => (
            <li key={id} className={`guess tone-${q}`}>
              <Flag iso2={getCountry(id)!.iso2} className="suggestion-flag" />
              {name(id)}
              <span className="sr-only"> ({QUALITY_TEXT[q]})</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
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
        {last ? 'See final score' : 'Next route'}
      </button>
    </div>
  );
}
