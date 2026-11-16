import { useEffect, useState } from 'react';
import { dailyDate, dailyGames, dailyVariant, type GameDefinition } from '@geogames/games';
import { GameCardArt } from '../games/GameCardArt.tsx';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import type { RankedScore } from '../platform/scores.ts';
import { href } from '../router.ts';

/** Time left until the next challenge (midnight UTC), as "5h 12m". */
export function untilNext(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** #/daily: every daily challenge, what you scored today, and when the next ones start. */
export function DailiesPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const date = dailyDate(now);

  return (
    <div className="page">
      <header className="hero">
        <h1>Daily challenges</h1>
        <p>
          {longDate(date)} · <span className="nowrap">new challenges in <strong>{untilNext(now)}</strong></span>
        </p>
      </header>
      <div className="game-grid dailies-grid">
        {dailyGames().map((g) => (
          <DailyCard key={g.id} game={g} date={date} />
        ))}
      </div>
      <section className="panel dailies-rules" aria-labelledby="dailies-how">
        <h2 id="dailies-how">How the dailies work</h2>
        <ul>
          <li>Everyone in the world plays the same run, with the default settings, so scores compare fairly.</li>
          <li>One try per challenge per day. Leaving halfway keeps your place; you carry on where you left off.</li>
          <li>New challenges start at midnight UTC. Each day has its own leaderboard.</li>
          <li>Sign in with Google to appear on the leaderboards.</li>
        </ul>
      </section>
    </div>
  );
}

function DailyCard({ game, date }: { game: GameDefinition; date: string }) {
  const { scores } = usePlatform();
  const [today, setToday] = useState<number | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    scores.personalBest(game.id, dailyVariant(date)).then((s) => !cancelled && setToday(s));
    return () => {
      cancelled = true;
    };
  }, [scores, game.id, date]);
  const played = (today ?? 0) > 0;

  return (
    <article className="game-card daily-card">
      <GameCardArt gameId={game.id} />
      <h2>{game.title}</h2>
      <p>{game.tagline}</p>
      <p className={`daily-status ${played ? 'done' : ''}`}>{today === undefined ? ' ' : played ? `Played today: ${today} points` : 'Not played yet today'}</p>
      <div className="game-card-footer">
        <a className="btn btn-primary" href={href({ page: 'daily', gameId: game.id })}>
          {played ? 'See result' : 'Play'}
        </a>
      </div>
      <TopToday game={game} date={date} />
    </article>
  );
}

/** Today's top three; signed-in players only, like every global board. */
function TopToday({ game, date }: { game: GameDefinition; date: string }) {
  const { scores } = usePlatform();
  const [entries, setEntries] = useState<RankedScore[] | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    scores.top(game.id, dailyVariant(date), 'global', 3).then((e) => !cancelled && setEntries(e));
    return () => {
      cancelled = true;
    };
  }, [scores, game.id, date]);
  if (entries === null) return null;
  return (
    <div className="daily-top">
      <h3 className="setup-label">Today's top 3</h3>
      {entries === undefined && <p className="muted">Loading…</p>}
      {entries?.length === 0 && <p className="muted">No scores yet. Be the first.</p>}
      {entries && entries.length > 0 && (
        <ol className="scores">
          {entries.map((e, i) => (
            <li key={e.id}>
              <span className="rank">{i + 1}</span>
              <span className="who">{e.playerName}</span>
              <span className="pts">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
