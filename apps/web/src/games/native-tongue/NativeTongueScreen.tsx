import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry, queryCountries, type CountryId } from '@geogames/geodata';
import { loadNativeNames, type NativeName } from '@geogames/geodata/native-names';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  TONGUE_MAX_LIVES,
  TONGUE_SKIP,
  createNativeTongue,
  replayNativeTongue,
  tonguePlan,
  type NativeTongue,
  type NativeTongueDefinition,
  type TongueGuessResult,
  type TongueMark,
  type TongueState,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { blockShownNames, englishCountryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import type { GameScreenProps } from '../types.ts';

const MARKS: Record<TongueMark, string> = { flawless: '🎯', cleared: '🟩', missed: '🟧', lost: '🟥' };
const WHOLE_WORLD: GeoPermissibleObjects = { type: 'Sphere' };

/** Loads the names and the map shapes (lazily), then plays. */
export function NativeTongueScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<NativeTongueDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; names: NativeName[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadNativeNames()]).then(
      ([shapes, data]) => !cancelled && setLoaded({ shapes, names: data.names }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the game. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading…</p>;
  return <TonguePlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

/**
 * A name in its own language: its direction makes right-to-left names read the right way round, and its
 * lang picks the glyphs (Chinese or Japanese). The question name leaves lang off until the language is
 * given away anyway, since lang is in the page for anyone who looks.
 */
function Native({ name, className, lang = true }: { name: NativeName; className?: string; lang?: boolean }) {
  return (
    <span className={className} lang={lang ? name.lang : undefined} dir={name.rtl ? 'rtl' : 'ltr'}>
      {name.name}
    </span>
  );
}

/** A long name gets a smaller type, so it still fits two lines on a phone. */
const sizeClass = (name: string) => (name.length <= 9 ? 'size-l' : name.length <= 18 ? 'size-m' : 'size-s');

function messageFor(result: TongueGuessResult, id: CountryId, state: TongueState): string | null {
  const name = getCountry(id)?.name ?? id;
  switch (result) {
    case 'repeat':
      return `You’ve tried ${name} already.`;
    case 'unknown':
      return 'That isn’t a country in this game.';
    case 'wrong': {
      if (state.level.status === 'lost') return null;
      const left = tonguePlan(state.level.number).misses - state.level.guesses.length;
      return left > 1 ? `Not ${name}. ${left - 1} more free ${left === 2 ? 'miss' : 'misses'}.` : `Not ${name}. One more miss costs a life.`;
    }
    default:
      return null;
  }
}

function TonguePlay({
  shapes,
  names,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  names: NativeName[];
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const countries = useMemo(() => queryCountries(), []);
  const game: NativeTongue = useMemo(() => createNativeTongue({ names, countries }), [names, countries]);
  // "Congo" alone is both countries': take it off the Republic so the list offers the two to pick from.
  // No other languages' names in the search, or typing what's on screen would hand over the answer.
  const shown = useMemo(() => names.map((n) => n.name), [names]);
  const items = useMemo(
    () => englishCountryItems(countries.map((c) => c.id), shown).map((i) => (i.id === 'COG' ? { ...i, aliases: i.aliases?.filter((a) => a !== 'Congo') } : i)),
    [countries, shown],
  );
  const blockShown = useMemo(() => blockShownNames(shown), [shown]);
  const nativeOf = useMemo(() => new Map(names.map((n) => [n.id, n])), [names]);

  const [state, setState] = useState<TongueState>(() => replayNativeTongue(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const { level } = state;
  const plan = tonguePlan(level.number);
  const playing = state.status === 'playing';
  const answer = getCountry(level.country)!;
  const name = nativeOf.get(level.country)!;
  const exclude = useMemo(() => new Set(level.guesses), [level.guesses]);

  useEffect(() => setMessage(null), [level.number]);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  // The answer's map stays plain until the level ends, then the country lights up.
  const frame = useMemo<GeoPermissibleObjects>(
    () => (playing ? WHOLE_WORLD : circleShape(answer.latlng, 500 + Math.sqrt(answer.metrics.area?.value ?? 0))),
    [playing, answer],
  );
  const mapCountries = useMemo<MapCountry[]>(() => (playing ? [] : [{ id: answer.id, tone: 'start', label: answer.name }]), [playing, answer]);

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, id, next));
    setState(next);
  };
  const skip = () => {
    setMessage(null);
    setState(game.skip(state));
  };
  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  const wrong = level.guesses.filter((g) => g !== level.country);
  const misses = level.status === 'cleared' ? level.guesses.length - 1 : level.guesses.length;
  const skipped = level.status === 'lost' && state.moves.at(-1) === TONGUE_SKIP;
  const next = () => setState(game.nextLevel(state));

  const hinted = wrong.length > 0 || !playing;
  const wrongList =
    wrong.length > 0 ? (
      <ul className="tongue-wrong" aria-label="Your wrong guesses, and what each calls itself">
        {wrong.map((id) => {
          const c = getCountry(id)!;
          const own = nativeOf.get(id);
          return (
            <li key={id}>
              <Flag iso2={c.iso2} className="suggestion-flag" /> {c.name}{' '}
              {own?.looksEnglish ? (
                <span className="muted">also calls itself {own.name}</span>
              ) : (
                own && (
                  <>
                    <span className="muted">calls itself</span> <Native name={own} className="tongue-chip" />
                  </>
                )
              )}
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div className={playing ? 'route tongue-game' : 'route tongue-game done'}>
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
          Misses <strong className="tongue-misses">{misses}</strong>/{plan.misses}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="tongue-card">
        <p className="tongue-ask">This country calls itself</p>
        <Native name={name} lang={hinted} className={`tongue-name ${sizeClass(name.name)}`} />
        {/* The line is always there, so the hint arriving moves nothing. */}
        <p className="tongue-hint" role="status">
          {hinted ? `Hint: it’s in ${name.language}.` : ''}
        </p>
      </div>

      {!playing && <WorldMap shapes={shapes} countries={mapCountries} frame={frame} borders={false} label={`Map: ${answer.name}`} />}

      {playing ? (
        <>
          <div className="tongue-input">
            <SearchInput
              key={level.number}
              items={items}
              exclude={exclude}
              onPick={guess}
              onNoMatch={() => setMessage('Not one of the countries. Pick one from the list.')}
              placeholder="Which country is it?"
              label="Name the country"
              cleanQuery={blockShown}
              focusWithoutScroll
            />
            <button type="button" className="btn tongue-skip" onClick={skip}>
              ⏭ Skip <span className="muted">−1 ♥</span>
            </button>
          </div>
          <p className="route-message" role="status">
            {message ?? 'Type the English name of the country. Each wrong one shows how that country writes its own name.'}
          </p>
          {wrongList}
        </>
      ) : level.status === 'cleared' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">
            <Flag iso2={answer.iso2} className="suggestion-flag" /> {answer.name}! +{level.points}
          </p>
          <p className="muted">
            <Native name={name} /> is {answer.name} in {name.language} ({name.script === 'Latin' ? 'Latin letters' : `${name.script} script`}).
          </p>
          {level.flawless && <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${TONGUE_MAX_LIVES} at most).`}</p>}
          <button ref={nextButton} className="btn btn-primary btn-lg" onClick={next}>
            Next level
          </button>
        </div>
      ) : (
        <div className="route-summary failed" role="status">
          <p className="route-summary-title">{skipped ? 'Skipped: −1 ♥' : plan.misses === 1 ? 'A miss: −1 ♥' : `${plan.misses} misses: −1 ♥`}</p>
          {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
          <p>
            <Native name={name} /> is <strong>{answer.name}</strong> in {name.language} ({name.script === 'Latin' ? 'Latin letters' : `${name.script} script`}).
          </p>
          <button ref={nextButton} className="btn btn-primary btn-lg" onClick={state.status === 'over' ? finish : next}>
            {state.status === 'over' ? 'See final score' : 'Next level'}
          </button>
        </div>
      )}
      {!playing && wrongList}
    </div>
  );
}
