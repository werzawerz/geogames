import { useEffect, useMemo, useState } from 'react';
import type { DuelDto } from '@geogames/games';
import { DuelGate, DuelsNeedServer } from '../components/DuelGate.tsx';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { href } from '../router.ts';

type Loaded = { status: 'loading' } | { status: 'offline' } | { status: 'ok'; duels: DuelDto[] };

/** How the duel went for the caller: won, drawn or lost; null while it's still going (or void). */
export function resultFor(d: DuelDto): 'W' | 'D' | 'L' | null {
  if (d.state !== 'finished' || d.you === 'visitor' || !d.outcome) return null;
  if (d.outcome === 'draw') return 'D';
  return d.outcome === d.you ? 'W' : 'L';
}

/** The other player's name, from the caller's side. */
export const opponentOf = (d: DuelDto) => (d.you === 'challenger' ? d.creator.name : (d.challenger?.name ?? null));

/** Wins–draws–losses against each opponent, by name (names are all the list knows). */
export function recordsByOpponent(duels: readonly DuelDto[]): Map<string, [number, number, number]> {
  const records = new Map<string, [number, number, number]>();
  for (const d of duels) {
    const result = resultFor(d);
    const who = opponentOf(d);
    if (!result || !who) continue;
    const record = records.get(who) ?? [0, 0, 0];
    record[result === 'W' ? 0 : result === 'D' ? 1 : 2] += 1;
    records.set(who, record);
  }
  return records;
}

const myScore = (d: DuelDto) => (d.you === 'challenger' ? d.challenger?.score : d.creator.score) ?? 0;
const theirScore = (d: DuelDto) => (d.you === 'challenger' ? d.creator.score : d.challenger?.score) ?? 0;

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/** #/duels: your turn, waiting, finished. */
export function DuelsPage() {
  const { duels, account } = usePlatform();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Anonymous players load theirs too: a friend's duel they took, or a rematch for them.
    if (!duels || account.status === 'local') return;
    let cancelled = false;
    setLoaded({ status: 'loading' });
    duels.list().then(
      (list) => !cancelled && setLoaded({ status: 'ok', duels: list }),
      () => !cancelled && setLoaded({ status: 'offline' }),
    );
    return () => {
      cancelled = true;
    };
  }, [duels, account.status, attempt]);

  const list = loaded.status === 'ok' ? loaded.duels : [];
  const groups = useMemo(() => {
    const yourTurn = list.filter((d) => (d.state === 'open' && d.reservedForYou) || (d.you === 'challenger' && d.state === 'playing'));
    const waiting = list.filter(
      (d) => !yourTurn.includes(d) && d.you === 'creator' && (d.state === 'open' || d.state === 'playing'),
    );
    const finished = list.filter((d) => d.state === 'finished');
    return { yourTurn, waiting, finished };
  }, [list]);
  const records = useMemo(() => recordsByOpponent(list), [list]);

  const header = (
    <header className="duels-head">
      <h1 className="page-title">Duels</h1>
      <a className="btn btn-primary" href={href({ page: 'duel-new' })}>
        Start a new duel
      </a>
    </header>
  );

  if (!duels || account.status === 'local') {
    return (
      <div className="page">
        <h1 className="page-title">Duels</h1>
        <DuelsNeedServer />
      </div>
    );
  }
  const none = loaded.status === 'ok' && list.length === 0;
  if (account.status === 'anonymous' && (none || loaded.status === 'offline')) {
    return (
      <div className="page">
        {header}
        <DuelGate extra="Got a link from a friend? Just open it: no account needed to play." />
      </div>
    );
  }

  return (
    <div className="page duels-page">
      {header}
      {loaded.status === 'loading' && <p className="panel center muted">Loading your duels…</p>}
      {loaded.status === 'offline' && (
        <div className="panel center">
          <p className="lead">Duels live on the server, and we can't reach it right now.</p>
          <button className="btn btn-primary btn-lg" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {none && (
        <p className="panel center muted">No duels yet. Play a City Circle Arcade run and challenge a friend to the same circles.</p>
      )}

      {groups.yourTurn.length > 0 && (
        <section className="panel" aria-labelledby="duels-turn">
          <h2 id="duels-turn" className="setup-label">Your turn</h2>
          <ul className="duel-list">
            {groups.yourTurn.map((d) => (
              <li key={d.code}>
                <span>
                  {d.state === 'playing' ? `Your duel vs ${d.creator.name}` : `Rematch from ${d.creator.name}`} · to beat {d.creator.score}
                </span>
                <a className="btn btn-primary" href={href({ page: 'duel', code: d.code })}>
                  {d.state === 'playing' ? 'Carry on' : 'Play it'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.waiting.length > 0 && (
        <section className="panel" aria-labelledby="duels-waiting">
          <h2 id="duels-waiting" className="setup-label">Waiting</h2>
          <ul className="duel-list">
            {groups.waiting.map((d) => (
              <WaitingRow key={d.code} duel={d} />
            ))}
          </ul>
        </section>
      )}

      {groups.finished.length > 0 && (
        <section className="panel" aria-labelledby="duels-finished">
          <h2 id="duels-finished" className="setup-label">Finished</h2>
          <ul className="duel-list">
            {groups.finished.map((d) => {
              const result = resultFor(d);
              const who = opponentOf(d);
              const verb = result === 'W' ? 'Won' : result === 'L' ? 'Lost' : 'Drew';
              return (
                <li key={d.code}>
                  <span>
                    {result && (
                      <span className={`duel-chip chip-${result}`} aria-hidden="true">
                        {result}
                      </span>
                    )}{' '}
                    {result ? `${verb} ${myScore(d)}–${d.challenger?.status === 'forfeit' ? 'did not finish' : theirScore(d)}` : 'Duel'} vs {who} · {ago(d.createdAt)}
                    {who && records.get(who) && <span className="muted small"> (vs {who}: {records.get(who)!.join('–')})</span>}
                  </span>
                  <a className="link" href={href({ page: 'duel', code: d.code })}>
                    Open
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function WaitingRow({ duel }: { duel: DuelDto }) {
  const [copied, setCopied] = useState(false);
  const url = location.origin + location.pathname + href({ page: 'duel', code: duel.code });
  return (
    <li>
      <span>
        {duel.state === 'playing' ? `${duel.challenger?.name} is playing` : 'Waiting for a challenger'} · you scored {duel.creator.score}
      </span>
      <span className="row">
        {duel.state === 'open' && (
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        )}
        <a className="link" href={href({ page: 'duel', code: duel.code })}>
          Open
        </a>
      </span>
    </li>
  );
}
