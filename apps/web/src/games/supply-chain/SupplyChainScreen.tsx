import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry, queryCountries, type CountryId } from '@geogames/geodata';
import { loadSupplyChain, type SupplyChainData } from '@geogames/geodata/supply-chain';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  CHAIN_MAX_LIVES,
  CHAIN_SKIP,
  CHAIN_TIE_BAND,
  chainPlan,
  createSupplyChain,
  replaySupplyChain,
  type ChainGuessResult,
  type ChainMark,
  type ChainState,
  type SupplyChain,
  type SupplyChainDefinition,
} from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { countryItems } from '../../components/searchItems.ts';
import { WorldMap, type MapCountry } from '../../components/WorldMap.tsx';
import type { GameScreenProps } from '../types.ts';

const MARKS: Record<ChainMark, string> = {
  flawless: '🎯',
  cleared: '🟩',
  missed: '🟧',
  lost: '🟥',
};
/** The whole globe, centred on Greenwich like the other games' maps; the box crops it (the south and the sides) to the height the page has left. */
const WORLD_FRAME: GeoPermissibleObjects = { type: 'Sphere' };

/** Loads the data and the map shapes (lazily), then plays. */
export function SupplyChainScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<SupplyChainDefinition>) {
  const [loaded, setLoaded] = useState<{
    shapes: WorldShapes;
    data: SupplyChainData;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadSupplyChain()]).then(
      ([shapes, data]) => !cancelled && setLoaded({ shapes, data }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the game. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading…</p>;
  return <ChainPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

/** The figure as the source gives it, in the unit named once under the list. */
const amount = (value: number) => value.toLocaleString('en-GB', { maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0 });

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

function ChainPlay({
  shapes,
  data,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  data: SupplyChainData;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const countries = useMemo(() => queryCountries(), []);
  const game: SupplyChain = useMemo(() => createSupplyChain({ commodities: data.commodities, countries }), [data, countries]);
  // Every country is on offer, in the same order whatever the level: the list must never hint at the answer.
  const items = useMemo(() => countryItems(countries.map((c) => c.id)), [countries]);
  const commodityById = useMemo(() => new Map(data.commodities.map((c) => [c.id, c])), [data]);

  const [state, setState] = useState<ChainState>(() => replaySupplyChain(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const { level } = state;
  const plan = chainPlan(level.number);
  const playing = state.status === 'playing';
  const commodity = commodityById.get(level.commodity)!;
  const source = data.sources[commodity.source]!;
  const answers = game.answers(level.commodity, level.number)!;
  const exclude = useMemo(() => new Set(level.guesses), [level.guesses]);
  const shareOf = (id: CountryId) => commodity.producers.find((p) => p.id === id)?.share ?? 0;

  useEffect(() => setMessage(null), [level.number]);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  // Only what has been found is on the map: no outline, no fill, nothing for a producer to give itself away by.
  const mapCountries = useMemo<MapCountry[]>(() => {
    const found = level.found.map((id) => ({
      id,
      tone: 'optimal' as const,
      label: percent(shareOf(id)),
    }));
    if (playing) return found;
    const missed = answers.accepted.filter((id, i) => i < answers.need && !level.found.includes(id));
    return [
      ...missed.map((id) => ({
        id,
        tone: 'near' as const,
        label: percent(shareOf(id)),
      })),
      ...found,
    ];
    // shareOf only reads the commodity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level.found, playing, answers, commodity]);

  const messageFor = (result: ChainGuessResult, id: CountryId, next: ChainState): string | null => {
    const name = getCountry(id)?.name ?? id;
    switch (result) {
      case 'repeat':
        return `You’ve tried ${name} already.`;
      case 'unknown':
        return 'That isn’t a country in this game.';
      case 'found': {
        if (next.level.status === 'cleared') return null;
        const rank = game.rank(level.commodity, id);
        const near = rank !== null && rank > level.need ? ` It is ${ordinal(rank)}, but counts: within a tenth of the last place.` : '';
        return `${name}: ${percent(shareOf(id))} of the world’s output.${near}`;
      }
      case 'wrong': {
        if (next.level.status === 'lost') return null;
        const rank = game.rank(level.commodity, id);
        const why = rank ? `${name} is a big producer, but only ${ordinal(rank)}.` : `${name} is not among the biggest.`;
        const left = plan.misses - (next.level.guesses.length - next.level.found.length);
        return `${why} ${left > 1 ? `${left - 1} more free ${left === 2 ? 'miss' : 'misses'}.` : 'One more miss costs a life.'}`;
      }
    }
  };

  const guess = (id: CountryId) => {
    const { state: next, result } = game.guess(state, id);
    setMessage(messageFor(result, id, next));
    setState(next);
  };
  const skip = () => {
    setMessage(null);
    setState(game.skip(state));
  };
  const finish = () => {
    const flawless = state.marks.filter((m) => m === 'flawless').length;
    const best = state.best && { ...state.best, name: getCountry(state.best.country)!.name, what: commodityById.get(state.best.commodity)!.name };
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}, with ${flawless} flawless ${flawless === 1 ? 'level' : 'levels'}.${best ? ` Your hardest find: ${best.name}, with ${percent(best.share)} of the world’s ${best.what}.` : ''}`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });
  };
  const next = () => setState(game.nextLevel(state));

  const misses = level.guesses.length - level.found.length;
  const skipped = level.status === 'lost' && state.moves.at(-1) === CHAIN_SKIP;
  const wrong = level.guesses.filter((g) => !level.found.includes(g));
  const wrongList =
    wrong.length > 0 ? (
      <ul className="chain-wrong" aria-label="Your wrong guesses">
        {wrong.map((id) => {
          const c = getCountry(id)!;
          const rank = game.rank(level.commodity, id);
          return (
            <li key={id}>
              <Flag iso2={c.iso2} className="suggestion-flag" /> {c.name} <span className="muted">{rank ? ordinal(rank) : 'unranked'}</span>
            </li>
          );
        })}
      </ul>
    ) : null;

  const sourceLine = (
    <p className="chain-source muted">
      {source.name}, {source.year}. {source.licence}.
    </p>
  );

  // The slots show what has been found, and how many are left, and nothing else.
  const slots = Array.from({ length: level.need }, (_, i) => level.found[i]);
  // The top places, and any near-tie that was named too; the other near-ties get a line of their own.
  const shown = answers.accepted.filter((id, i) => i < answers.need || level.found.includes(id));
  const extras = answers.accepted.filter((id) => !shown.includes(id));
  // One line that teaches: how much of the world the list makes, and who came next.
  const together = shown.reduce((sum, id) => sum + shareOf(id), 0);
  const nextUp = commodity.producers.find((p) => !answers.accepted.includes(p.id) && countries.some((c) => c.id === p.id));

  return (
    <div className={`route chain-game${playing ? '' : ' done'}${level.need > 3 ? ' many' : ''}`}>
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
          Misses <strong className="chain-misses">{misses}</strong>/{plan.misses}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="chain-body">
        <div className="chain-card">
          <p className="chain-ask">
            The {level.need} countries that {commodity.verb} the most
          </p>
          <p className={`chain-commodity ${commodity.name.length <= 13 ? 'size-l' : commodity.name.length <= 20 ? 'size-m' : 'size-s'}`}>{commodity.name}</p>
          {/* Once the level is over, the list under the map says it all. */}
          {playing && (
            <ul className="chain-slots" aria-label={`${level.found.length} of ${level.need} found`}>
              {slots.map((id, i) => {
                const c = id ? getCountry(id) : undefined;
                return c ? (
                  <li key={i} className="chain-slot found">
                    <Flag iso2={c.iso2} className="suggestion-flag" /> {c.name} <strong>{percent(shareOf(c.id))}</strong>
                  </li>
                ) : (
                  <li key={i} className="chain-slot" aria-label="Not found yet">
                    ?
                  </li>
                );
              })}
            </ul>
          )}
          {sourceLine}
        </div>

        <div className="chain-map">
          <WorldMap
            shapes={shapes}
            countries={mapCountries}
            frame={playing ? WORLD_FRAME : undefined}
            focus={playing ? [] : shown}
            fit={playing ? 'slice' : 'meet'}
            borders={false}
            label="World map: the producers you have found"
          />
        </div>

        <div className="chain-rest">
          {playing ? (
            <>
              <div className="chain-input">
                <SearchInput
                  key={level.number}
                  items={items}
                  exclude={exclude}
                  onPick={guess}
                  onNoMatch={() => setMessage('Not one of the countries. Pick one from the list.')}
                  placeholder="Name a producer"
                  label="Name a producer"
                  focusWithoutScroll
                />
                <button type="button" className="btn chain-skip" onClick={skip}>
                  ⏭ Skip <span className="muted">−1 ♥</span>
                </button>
              </div>
              <p className="route-message" role="status">
                {message ?? `Any order. Each one you find fills in on the map with its share of the world’s output.`}
              </p>
              {wrongList}
            </>
          ) : (
            <div className={level.status === 'cleared' ? 'route-summary solved' : 'route-summary failed'} role="status">
              <p className="route-summary-title">
                {level.status === 'cleared'
                  ? `All ${level.need} found! +${level.points}`
                  : skipped
                    ? 'Skipped: −1 ♥'
                    : plan.misses === 1
                      ? 'A miss: −1 ♥'
                      : `${plan.misses} misses: −1 ♥`}
              </p>
              {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
              {level.flawless && <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${CHAIN_MAX_LIVES}).`}</p>}
              <ol className="chain-top">
                {shown.map((id) => {
                  const c = getCountry(id)!;
                  const p = commodity.producers.find((x) => x.id === id)!;
                  return (
                    <li key={id} className={level.found.includes(id) ? 'got' : 'missed'}>
                      <Flag iso2={c.iso2} className="suggestion-flag" /> <span className="chain-top-name">{c.name}</span>
                      <span className="muted chain-top-amount">
                        {percent(p.share)} · {amount(p.value)}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="muted chain-unit">
                Output in {commodity.unit}. Together {Math.round(together * 100)}% of the world’s {commodity.name}
                {nextUp ? `; next is ${getCountry(nextUp.id)!.name}, ${ordinal(game.rank(level.commodity, nextUp.id)!)} with ${percent(nextUp.share)}.` : '.'}
                {extras.length > 0 && ` Also counts: ${extras.map((id) => getCountry(id)?.name).join(', ')} (within ${Math.round(CHAIN_TIE_BAND * 100)}%).`}
              </p>
              <button ref={nextButton} className="btn btn-primary btn-lg" onClick={state.status === 'over' ? finish : next}>
                {state.status === 'over' ? 'See final score' : 'Next level'}
              </button>
            </div>
          )}
          {!playing && wrongList}
        </div>
      </div>
    </div>
  );
}
