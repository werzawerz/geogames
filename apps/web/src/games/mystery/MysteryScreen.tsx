import { useEffect, useMemo, useState } from 'react';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry, queryCountries, type Country, type CountryId } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  createCountryClues,
  createMysteryCountry,
  mysteryExtraClues,
  mysteryPlan,
  replayMysteryCountry,
  type Comparison,
  type Compass,
  type CountryClue,
  type MysteryCountryDefinition,
  type MysteryGuessResult,
  type MysteryState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry, type MapTone } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';

const WHOLE_WORLD: GeoPermissibleObjects = { type: 'Sphere' };
const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;

const ARROWS: Record<Compass, { arrow: string; label: string }> = {
  N: { arrow: '↑', label: 'north' },
  NE: { arrow: '↗', label: 'north-east' },
  E: { arrow: '→', label: 'east' },
  SE: { arrow: '↘', label: 'south-east' },
  S: { arrow: '↓', label: 'south' },
  SW: { arrow: '↙', label: 'south-west' },
  W: { arrow: '←', label: 'west' },
  NW: { arrow: '↖', label: 'north-west' },
};

const COMPARISONS: Record<Comparison, { mark: string; label: string }> = {
  'much-more': { mark: '▲▲', label: 'over 3 times more' },
  more: { mark: '▲', label: 'more' },
  same: { mark: '≈', label: 'about the same' },
  less: { mark: '▼', label: 'less' },
  'much-less': { mark: '▼▼', label: 'under a third' },
};

const NEAR_KM = 1000;
const MIDDLE_KM = 3000;
const toneOf = (clue: CountryClue): MapTone => (clue.neighbour || clue.km < NEAR_KM ? 'optimal' : clue.km < MIDDLE_KM ? 'near' : 'far');

/** One mark per level: how many guesses it took, or 🟥 for the one that ended the run. */
const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
const shareLine = ({ solvedIn, completed }: MysteryState) => solvedIn.map((n) => KEYCAPS[n]).join('') + (completed ? '' : '🟥');

/** Loads the map shapes (lazily), then plays. */
export function MysteryScreen({ game: definition, seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<MysteryCountryDefinition>) {
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
  return <MysteryPlay shapes={shapes} rounds={definition.rounds} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

function messageFor(result: MysteryGuessResult, id: CountryId): string | null {
  switch (result) {
    case 'repeat':
      return `You already tried ${nameOf(id)}.`;
    case 'unknown':
      return "That country isn't in this game.";
    default:
      return null;
  }
}

function MysteryPlay({
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
  const countries = useMemo(() => queryCountries(), []);
  const game = useMemo(() => createMysteryCountry({ countries, rounds }), [countries, rounds]);
  const clueFor = useMemo(() => createCountryClues(countries), [countries]);
  const items = useMemo(() => countryItems(countries.map((c) => c.id)), [countries]);

  const [state, setState] = useState<MysteryState>(() => replayMysteryCountry(game, seed, initialMoves ?? []));
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  useEffect(() => setMessage(null), [state.level]);

  const { level, guesses } = state;
  const target = getCountry(state.target)!;
  const allowed = mysteryPlan(level).guesses;
  const playing = state.status === 'playing';
  const wrong = guesses.filter((id) => id !== state.target);
  const exclude = useMemo(() => new Set(guesses), [guesses]);
  const unlocked = mysteryExtraClues(level);
  const shows = (after: number) => !playing || wrong.length >= after;

  const mapCountries: MapCountry[] = wrong.map((id) => ({ id, tone: toneOf(clueFor(target, getCountry(id)!)), label: nameOf(id) }));
  if (!playing) mapCountries.push({ id: target.id, tone: 'start', label: target.name });

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, id));
    setState(next);
  };

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: state.completed ? `You solved all ${rounds} countries!` : `You reached level ${level} of ${rounds}.`,
      completed: state.completed,
      shareLine: shareLine(state),
    });

  return (
    <div className="route mystery-game">
      <div className="route-status">
        <span>
          Level <strong>{level}</strong> of {rounds}
        </span>
        <span>
          Guesses left <strong className="mystery-left">{playing ? allowed - guesses.length : 0}</strong> of {allowed}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <WorldMap shapes={shapes} countries={mapCountries} frame={WHOLE_WORLD} borders={false} label="World map of your guesses" />

      <ul className="map-legend" aria-label="Legend">
        <li className="tone-optimal">A neighbour, or under {km.format(NEAR_KM)} km</li>
        <li className="tone-near">Under {km.format(MIDDLE_KM)} km</li>
        <li className="tone-far">Further</li>
      </ul>

      <ExtraClues target={target} coast={shows(unlocked.coast)} subregion={shows(unlocked.subregion)} capital={shows(unlocked.capital)} />

      {playing ? (
        <>
          <SearchInput
            key={level}
            items={items}
            exclude={exclude}
            onPick={guess}
            onNoMatch={() => setMessage('No such country.')}
            placeholder="Type a country…"
            label="Guess the mystery country"
          />
          <p className="route-message" role="status">
            {message ?? (guesses.length === 0 ? 'Which country is it? Any guess will do to start.' : 'Each guess narrows it down.')}
          </p>
        </>
      ) : state.status === 'level-clear' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">
            <Flag iso2={target.iso2} className="suggestion-flag" /> It's {target.name}!
          </p>
          <button className="btn btn-primary btn-lg" autoFocus onClick={() => setState(game.nextLevel(state))}>
            Next level
          </button>
        </div>
      ) : (
        <div className={`route-summary ${state.completed ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">
            {state.completed ? `All ${rounds} levels solved! ` : 'Out of guesses. '}
            <Flag iso2={target.iso2} className="suggestion-flag" /> It was {target.name}.
          </p>
          <button className="btn btn-primary btn-lg" autoFocus onClick={finish}>
            See final score
          </button>
        </div>
      )}

      {wrong.length > 0 && (
        <div className="mystery-table" role="table" aria-label="Your guesses and what they reveal">
          <div className="mystery-row mystery-head" role="row">
            <span role="columnheader">Your guess</span>
            <span role="columnheader">Distance</span>
            <span role="columnheader">Way</span>
            <span role="columnheader">Continent</span>
            <span role="columnheader">People</span>
            <span role="columnheader">Land</span>
          </div>
          {[...wrong].reverse().map((id) => (
            <GuessRow key={id} country={getCountry(id)!} clue={clueFor(target, getCountry(id)!)} />
          ))}
        </div>
      )}
    </div>
  );
}

function GuessRow({ country, clue }: { country: Country; clue: CountryClue }) {
  const way = ARROWS[clue.compass];
  const people = COMPARISONS[clue.population];
  const land = COMPARISONS[clue.area];
  return (
    <div className={`mystery-row tone-${toneOf(clue)}`} role="row">
      <span className="mystery-name" role="cell">
        <Flag iso2={country.iso2} className="suggestion-flag" /> {country.name}
      </span>
      <span role="cell">{clue.neighbour ? 'Neighbour' : `${km.format(Math.round(clue.km / 10) * 10)} km`}</span>
      <span className="mystery-way" role="cell" aria-label={way.label} title={way.label}>
        {way.arrow}
      </span>
      <span role="cell" aria-label={clue.sameContinent ? 'Same continent' : 'Another continent'}>
        {clue.sameContinent ? '✓' : '✗'}
      </span>
      <span role="cell" aria-label={`People: ${people.label}`} title={people.label}>
        {people.mark}
      </span>
      <span role="cell" aria-label={`Land: ${land.label}`} title={land.label}>
        {land.mark}
      </span>
    </div>
  );
}

function ExtraClues({ target, coast, subregion, capital }: { target: Country; coast: boolean; subregion: boolean; capital: boolean }) {
  if (!coast && !subregion && !capital) return null;
  return (
    <ul className="mystery-clues" aria-label="Clues about the mystery country">
      {coast && <li>{target.landlocked ? 'Landlocked' : 'Has a coast'}</li>}
      {subregion && <li>In {target.subregion}</li>}
      {capital && <li>Capital: {target.capitals[0]}</li>}
    </ul>
  );
}
