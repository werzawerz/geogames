import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPermissibleObjects } from 'd3-geo';
import { getCountry, queryCountries, type CountryId } from '@geogames/geodata';
import { loadSupplyChain, type SupplyChainData } from '@geogames/geodata/supply-chain';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  CHAIN_MAX_LIVES,
  CHAIN_MIN_SHARE_SMALL,
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

/** The one line of feedback for the latest guess. */
interface Feedback {
  tone: 'good' | 'bad' | 'info';
  text: string;
}

/** Desktop layout: question and list beside a landscape map. */
function useWide(): boolean {
  const query = '(min-width: 900px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Who the dependencies that can out-produce a country belong to, for the reveal's line about them. */
const OWNER: Record<string, string> = { NCL: 'France', PYF: 'France', HKG: 'China', MAC: 'China', GRL: 'Denmark', PRI: 'United States' };

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
  const [message, setMessage] = useState<Feedback | null>(null);
  const wide = useWide();
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
    // While the whole world is in view a label only fits on a big country; the list has the rest.
    const big = (id: CountryId) => !playing || (countries.find((c) => c.id === id)?.metrics.area?.value ?? 0) >= 1_000_000;
    const found = level.found.map((id) => ({
      id,
      tone: 'optimal' as const,
      ...(big(id) ? { label: percent(shareOf(id)) } : {}),
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

  const messageFor = (result: ChainGuessResult, id: CountryId, next: ChainState): Feedback | null => {
    const name = getCountry(id)?.name ?? id;
    switch (result) {
      case 'repeat':
        return { tone: 'info', text: `You’ve tried ${name} already.` };
      case 'unknown':
        return { tone: 'info', text: 'That isn’t a country in this game.' };
      case 'found': {
        if (next.level.status === 'cleared') return null;
        const rank = game.rank(level.commodity, id);
        const near = rank !== null && rank > level.need ? ` · ${ordinal(rank)}, but within a tenth of the last place, so it counts` : '';
        return { tone: 'good', text: `${name}: ${percent(shareOf(id))} of the world’s output${near}` };
      }
      case 'wrong': {
        if (next.level.status === 'lost') return null;
        const rank = game.rank(level.commodity, id);
        const left = plan.misses - (next.level.guesses.length - next.level.found.length);
        const cost = left > 1 ? `${left - 1} more free ${left === 2 ? 'miss' : 'misses'}` : 'next miss costs a life';
        return { tone: 'bad', text: `${name}: ${rank ? `only ${ordinal(rank)}` : 'not in the top 10'} · ${cost}` };
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
  // The top places, and any near-tie that was named too; the other near-ties get a line of their own.
  const shown = answers.accepted.filter((id, i) => i < answers.need || level.found.includes(id));
  const extras = answers.accepted.filter((id) => !shown.includes(id));
  // One line that teaches: how much of the world the list makes, and who came next.
  const together = shown.reduce((sum, id) => sum + shareOf(id), 0);
  const nextUp = commodity.producers.find((p) => !answers.accepted.includes(p.id) && game.isNameable(p.id));
  // A dependency that out-produces the next country (New Caledonia's nickel) has no place in the ranking, so it is named here instead.
  const dependency = commodity.producers.find((p) => !game.isNameable(p.id) && p.share >= CHAIN_MIN_SHARE_SMALL && (!nextUp || p.value >= nextUp.value));

  /** A bar as wide as the share, scaled so a 40% producer fills it. */
  const bar = (share: number) => ({ width: `${Math.min(100, (share / 0.4) * 100)}%` });
  // While playing: one row for each producer to find, filled as they are found, and nothing else. At the end: the answers, ranked.
  const rows = playing ? Array.from({ length: level.need }, (_, i) => ({ id: level.found[i], i })) : shown.map((id, i) => ({ id, i }));

  const heading =
    level.status === 'cleared'
      ? `All ${level.need} found! +${level.points}`
      : skipped
        ? `Skipped · ${level.found.length} of ${level.need} found`
        : `${level.found.length} of ${level.need} found · ${plan.misses === 1 ? 'a miss' : `${plan.misses} misses`}`;

  return (
    <div className={`route chain-game${playing ? '' : ' done'}${level.need > 3 ? ' many' : ''}`}>
      <div className="chain-status">
        <span className="chain-stat">
          <span className="chain-stat-label">Level</span> <strong>{level.number}</strong>
        </span>
        <span className="lives" aria-label={`${state.lives} lives`}>
          {Array.from({ length: Math.max(state.lives, 1) }, (_, i) => (
            <span key={i} className={i < state.lives ? 'life' : 'life lost'} aria-hidden="true">
              ♥
            </span>
          ))}
        </span>
        <span className="chain-stat" aria-label={`${misses} of ${plan.misses} misses`}>
          <span className="chain-stat-label">Misses</span>{' '}
          <span className="chain-pips" aria-hidden="true">
            {Array.from({ length: plan.misses }, (_, i) => (
              <span key={i} className={i < misses ? 'pip used' : 'pip'} />
            ))}
          </span>
          <span className="chain-misses chain-hidden">{misses}</span>
        </span>
        <span className="chain-stat chain-score" aria-live="polite">
          <span className="chain-stat-label">Score</span> <strong>{state.score}</strong>
        </span>
      </div>

      <div className="chain-body">
        <div className="chain-panel">
          <div className="chain-panel-inner">
            <div className="chain-card">
              <p className="chain-ask">
                The {level.need} countries that {commodity.verb} the most
              </p>
              <h2 className={`chain-commodity ${commodity.name.length <= 13 ? 'size-l' : commodity.name.length <= 20 ? 'size-m' : 'size-s'}`}>
                {commodity.name}
              </h2>
              <ol className="chain-rows" aria-label={playing ? `${level.found.length} of ${level.need} found` : 'The biggest producers'}>
                {rows.map(({ id, i }) => {
                  const c = id ? getCountry(id) : undefined;
                  if (!c) {
                    return (
                      <li key={i} className="chain-row empty" aria-label="Not found yet">
                        Producer {i + 1} of {level.need}
                      </li>
                    );
                  }
                  const p = commodity.producers.find((x) => x.id === c.id)!;
                  const got = level.found.includes(c.id);
                  return (
                    <li key={c.id} className={`chain-row ${got ? 'found' : 'missed'}`}>
                      {!playing && <span className="chain-row-rank">{ordinal(game.rank(level.commodity, c.id)!)}</span>}
                      <Flag iso2={c.iso2} className="suggestion-flag" />
                      <span className="chain-row-name">{c.name}</span>
                      <span className="chain-row-fig">
                        <strong>{percent(p.share)}</strong>
                        {!playing && <span className="chain-row-amount"> · {amount(p.value)}</span>}
                      </span>
                      <span className="chain-bar" style={bar(p.share)} aria-hidden="true" />
                    </li>
                  );
                })}
              </ol>
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
                      onNoMatch={() => setMessage({ tone: 'info', text: 'Not one of the countries. Pick one from the list.' })}
                      placeholder="Name a producer"
                      label="Name a producer"
                      focusWithoutScroll
                    />
                    <button type="button" className="btn chain-skip" onClick={skip}>
                      Skip <span className="muted">−1 ♥</span>
                    </button>
                  </div>
                  <p className={`chain-feedback ${message?.tone ?? 'hint'}`} role="status">
                    {message
                      ? `${message.tone === 'good' ? '✓ ' : message.tone === 'bad' ? '✗ ' : ''}${message.text}`
                      : 'Any order. Each one you find fills in on the map.'}
                  </p>
                </>
              ) : (
                <div className={level.status === 'cleared' ? 'chain-result solved' : 'chain-result failed'} role="status">
                  <h3 className="chain-result-title">{heading}</h3>
                  {state.status === 'over' && <p className="chain-result-over">Out of lives</p>}
                  {level.status === 'lost' && state.status !== 'over' && <p className="chain-result-cost">−1 ♥</p>}
                  {level.flawless && <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${CHAIN_MAX_LIVES}).`}</p>}
                  <p className="chain-teach">
                    These make {Math.round(together * 100)}% of the world’s output
                    {nextUp ? `; next: ${getCountry(nextUp.id)!.name}, ${ordinal(game.rank(level.commodity, nextUp.id)!)} (${percent(nextUp.share)}).` : '.'}
                    {dependency &&
                      ` ${getCountry(dependency.id)?.name ?? dependency.id}${OWNER[dependency.id] ? ` (${OWNER[dependency.id]})` : ''} also ${commodity.verb}s ${percent(dependency.share)}, but isn’t a country in this game.`}
                    {extras.length > 0 && ` Also counts: ${extras.map((id) => getCountry(id)?.name).join(', ')} (within ${Math.round(CHAIN_TIE_BAND * 100)}%).`}
                  </p>
                  <button ref={nextButton} className="btn btn-primary btn-lg chain-next" onClick={state.status === 'over' ? finish : next}>
                    {state.status === 'over' ? 'See final score' : 'Next level'}
                  </button>
                </div>
              )}
              {wrong.length > 0 && (
                <ul className="chain-chips" aria-label="Your wrong guesses">
                  {wrong.map((id) => {
                    const c = getCountry(id)!;
                    const rank = game.rank(level.commodity, id);
                    return (
                      <li key={id} className="chain-chip">
                        <Flag iso2={c.iso2} className="suggestion-flag" /> {c.name} · {rank ? ordinal(rank) : 'unranked'}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="chain-source">
              {playing ? 'Source: ' : `Output in ${commodity.unit}. Source: `}
              {source.name}, {source.year}. {source.licence}.
            </p>
          </div>
        </div>

        <div className="chain-map">
          <WorldMap
            shapes={shapes}
            countries={mapCountries}
            frame={playing || wide ? WORLD_FRAME : undefined}
            focus={playing || wide ? [] : shown}
            fit={playing && !wide ? 'slice' : 'meet'}
            borders={false}
            label="World map: the producers you have found"
          />
        </div>
      </div>
    </div>
  );
}
