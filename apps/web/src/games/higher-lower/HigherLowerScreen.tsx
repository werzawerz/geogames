import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { METRICS, getCountry } from '@geogames/geodata';
import { createHigherLowerGame, loadPool, type Guess, type HigherLowerDefinition, type PoolItem } from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { CountUp } from '../../components/CountUp.tsx';
import type { GameOutcome, GameScreenProps } from '../types.ts';

const REVEAL_MS = 1600;

/** Loads the game's pool (city data is fetched on demand), then plays. */
export function HigherLowerScreen({ game, settings, seed, onGameOver }: GameScreenProps<HigherLowerDefinition>) {
  const [pool, setPool] = useState<readonly PoolItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadPool(game, settings).then(
      (p) => !cancelled && setPool(p),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [game, settings]);

  if (error) return <p className="panel center">Couldn't load the game data. Check your connection and try again.</p>;
  if (!pool) return <p className="panel center muted">Loading…</p>;
  return <HigherLowerRound game={game} pool={pool} seed={seed} onGameOver={onGameOver} />;
}

export function HigherLowerRound({
  game: definition,
  pool,
  seed,
  onGameOver,
}: {
  game: HigherLowerDefinition;
  pool: readonly PoolItem[];
  seed: number;
  onGameOver(outcome: GameOutcome): void;
}) {
  const metric = METRICS[definition.metric];
  const game = useMemo(() => createHigherLowerGame({ metric: definition.metric, pool }), [definition.metric, pool]);
  const [state, setState] = useState(() => game.start(seed));

  useEffect(() => {
    if (state.status === 'guessing') return;
    const timer = setTimeout(() => {
      const next = state.status === 'revealed' ? game.next(state) : state;
      if (next.status !== 'over') return setState(next);
      const unit = definition.subject === 'city' ? 'cities' : 'countries';
      onGameOver({
        score: next.score,
        moves: next.guesses,
        message: next.completed ? `Perfect run: you went through all ${game.pool.length} ${unit}!` : undefined,
      });
    }, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [state, game, onGameOver, definition.subject]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const guess: Guess | null =
        e.key === 'ArrowUp' ? 'higher' : e.key === 'ArrowDown' ? 'lower' : null;
      if (guess) setState((s) => game.guess(s, guess));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [game]);

  const result = state.lastResult;
  const { current, challenger } = state;
  const caption = definition.valueNote ?? metric.label;

  return (
    <div className="hl">
      <div className="hl-score" aria-live="polite">
        Score <strong>{state.score}</strong>
      </div>

      <div className="hl-cards">
        <ItemCard item={current} key={`a-${current.id}`}>
          <div className="hl-value">{metric.format(game.valueOf(current))}</div>
          <div className="hl-caption">{caption}</div>
        </ItemCard>

        <div className="hl-vs" aria-hidden="true">vs</div>

        <ItemCard
          item={challenger}
          key={`b-${challenger.id}`}
          tone={result ? (result.correct ? 'correct' : 'wrong') : undefined}
        >
          {result ? (
            <>
              <div className="hl-value">
                <CountUp value={result.challengerValue} format={metric.format} />
              </div>
              <div className="hl-caption">{result.correct ? 'Correct!' : 'Not quite'}</div>
            </>
          ) : (
            <>
              <div className="hl-question">compared to {current.name}</div>
              <div className="hl-buttons">
                <button className="btn btn-up" onClick={() => setState(game.guess(state, 'higher'))}>
                  ▲ {metric.more}
                </button>
                <button className="btn btn-down" onClick={() => setState(game.guess(state, 'lower'))}>
                  ▼ {metric.less}
                </button>
              </div>
            </>
          )}
        </ItemCard>
      </div>
      <p className="hint">Tip: use ↑ / ↓ on your keyboard.</p>
    </div>
  );
}

/** Flag, name and one line of context for a country or a city. */
function describe(item: PoolItem): { iso2: string; detail: string } {
  if ('countryId' in item) {
    const country = getCountry(item.countryId);
    const region = item.admin1 && !item.admin1.includes(item.name) && !item.name.includes(item.admin1) ? item.admin1 : null;
    const place = [region, country?.name].filter(Boolean).join(', ');
    const where = item.capital ? `Capital of ${country?.name}` : place;
    // Urban areas that swallowed other cities say so, or "Essen: 2.7M" looks wrong next to "Dusseldorf: 0.9M".
    return { iso2: country?.iso2 ?? '', detail: item.includes.length ? `${where} · incl. ${item.includes.slice(0, 3).join(', ')}` : where };
  }
  return { iso2: item.iso2, detail: `${item.capitals[0] ?? '—'} · ${item.subregion ?? item.continent}` };
}

function ItemCard({ item, tone, children }: { item: PoolItem; tone?: 'correct' | 'wrong'; children: ReactNode }) {
  const { iso2, detail } = describe(item);
  return (
    <section className={`hl-card ${tone ?? ''}`}>
      <Flag iso2={iso2} className="hl-flag" />
      <h2 className="hl-name">{item.name}</h2>
      <div className="hl-meta">{detail}</div>
      {children}
    </section>
  );
}
