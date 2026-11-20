import { useEffect, useMemo, useRef, useState } from 'react';
import { getCountry } from '@geogames/geodata';
import { loadRegions, type RegionCountry, type RegionData } from '@geogames/geodata/regions';
import {
  REGION_MAX_LIVES,
  REGION_MISSES,
  REGION_SKIP,
  createRegionRun,
  replayRegionRun,
  type RegionGuessResult,
  type RegionMark,
  type RegionRun,
  type RegionRunDefinition,
  type RegionState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput, type SearchItem } from '../../components/SearchInput.tsx';
import { normalize } from '../../components/search.ts';
import type { GameScreenProps } from '../types.ts';
import { RegionMap, type DivisionTone } from './RegionMap.tsx';

const MARKS: Record<RegionMark, string> = { flawless: '🎯', cleared: '🟩', missed: '🟧', lost: '🟥' };

/** Loads the divisions (lazily: they are the bulk of the game), then plays. */
export function RegionRunScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<RegionRunDefinition>) {
  const [data, setData] = useState<RegionData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadRegions().then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const game = useMemo(() => (data ? createRegionRun({ countries: data.countries }) : null), [data]);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!data || !game) return <p className="panel center muted">Loading map…</p>;
  return <RegionPlay data={data} game={game} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

/**
 * Every division of every country is offered, the lit one's country first: the
 * list says nothing about which is lit, and a division of another country is
 * only ever a free "that's elsewhere". Divisions of other countries say which
 * country they are in. A name the lit country also has (Amazonas, Córdoba) is
 * left out of the others, so typing it in full is never ambiguous.
 */
function searchItems(data: RegionData, current: string): SearchItem[] {
  const own = new Set(data.countries.find((c) => c.id === current)!.divisions.flatMap((d) => [d.name, ...d.aliases].map(normalize)));
  return data.countries.flatMap((c) => {
    const here = c.id === current;
    const scope = [c.name, c.id, getCountry(c.id)?.iso2 ?? ''].filter(Boolean);
    return c.divisions
      .filter((d) => here || !own.has(normalize(d.name)))
      .map((d) => ({ id: d.id, label: d.name, aliases: here ? d.aliases : d.aliases.filter((a) => !own.has(normalize(a))), detail: here ? undefined : c.name, scope, weight: here ? 1 : 0 }));
  });
}

function RegionPlay({
  data,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  data: RegionData;
  game: RegionRun;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<RegionState>(() => replayRegionRun(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const { level } = state;
  const playing = state.status === 'playing';
  const country: RegionCountry = data.countries.find((c) => c.id === level.country)!;
  const names = useMemo(() => new Map(data.countries.flatMap((c) => c.divisions.map((d) => [d.id, d.name] as const))), [data]);
  const answer = names.get(level.division)!;
  const items = useMemo(() => searchItems(data, level.country), [data, level.country]);
  const exclude = useMemo(() => new Set<string>(level.guesses), [level.guesses]);
  useEffect(() => setMessage(null), [level.number]);

  const wrong = level.guesses.filter((g) => g !== level.division);
  const misses = level.status === 'cleared' ? level.guesses.length - 1 : level.guesses.length;
  // What the map shows: the lit division, the player's wrong guesses where they really are, and the answer once it is told.
  const tones = useMemo(() => {
    const t = new Map<string, DivisionTone>(wrong.map((id) => [id, 'wrong']));
    t.set(level.division, playing ? 'lit' : 'answer');
    return t;
  }, [wrong, level.division, playing]);
  const shownNames = useMemo(() => (playing ? undefined : new Map([[level.division, answer]])), [playing, level.division, answer]);

  const messageFor = (result: RegionGuessResult, id: string): string | null => {
    const name = names.get(id) ?? id;
    if (result === 'repeat') return `You’ve tried ${name} already.`;
    if (result === 'elsewhere') return `${name} is in ${data.countries.find((c) => c.divisions.some((d) => d.id === id))?.name}, not ${country.name}. No miss for that.`;
    if (result === 'wrong') return `Not ${name}: it’s shaded red where it really is.`;
    if (result === 'unknown') return 'That isn’t one of the answers.';
    return null;
  };
  const guess = (id: string) => {
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

  // When a level ends its button takes the focus, so Enter goes on; a new level focuses the input, never Skip.
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const skipped = level.status === 'lost' && state.moves.at(-1) === REGION_SKIP;
  const left = REGION_MISSES - level.guesses.length;
  const iso2 = getCountry(level.country)?.iso2;

  return (
    <div className={`route grid-game region-game${playing ? '' : ' done'}`}>
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
        <span aria-label={`${misses} of ${REGION_MISSES} misses`}>
          Misses <strong className="grid-misses">{misses}</strong>/{REGION_MISSES}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="grid-prompt">
        {iso2 && <Flag iso2={iso2} className="suggestion-flag" />} Which {country.unit} of <strong className="region-country">{country.name}</strong> is lit?
      </p>

      <RegionMap country={country} tones={tones} nameOf={shownNames} label={playing ? `Map of ${country.name} with no names: one division is lit.` : `Map of ${country.name}: ${answer}`} />

      {playing ? (
        <>
          <div className="grid-input">
            <SearchInput
              key={level.number}
              items={items}
              exclude={exclude}
              onPick={guess}
              onNoMatch={() => setMessage('Not one of the answers. Pick one from the list.')}
              placeholder="Type the name"
              label={`Name the ${country.unit}`}
              exactOnly
              focusWithoutScroll
            />
            <button type="button" className="btn grid-skip" onClick={skip}>
              ⏭ Skip <span className="muted">−1 ♥</span>
            </button>
          </div>
          <p className="route-message" role="status">
            {message ?? (wrong.length ? (left === 1 ? 'One more miss costs a life.' : `${left - 1} more free ${left === 2 ? 'miss' : 'misses'}.`) : 'Type its name: English, or the local one.')}
          </p>
          {wrong.length > 0 && (
            <ul className="grid-hints" aria-label="Your wrong guesses">
              {wrong.map((id) => (
                <li key={id}>✗ {names.get(id)}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className={`route-summary ${level.status === 'cleared' ? 'solved' : 'failed'}`} role="status">
          <p className="route-summary-title">{level.status === 'cleared' ? `${answer}! +${level.points}` : skipped ? 'Skipped: −1 ♥' : `${REGION_MISSES} misses: −1 ♥`}</p>
          <p>
            {answer} is a {country.unit} of {country.name}.
          </p>
          {level.flawless && <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${REGION_MAX_LIVES} at most).`}</p>}
          {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
          <button ref={nextButton} className="btn btn-primary btn-lg" onClick={state.status === 'over' ? finish : next}>
            {state.status === 'over' ? 'See final score' : 'Next level'}
          </button>
        </div>
      )}
    </div>
  );
}
