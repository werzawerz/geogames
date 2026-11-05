import { useEffect, useState } from 'react';
import { GAMES, dailyDate, dailyGames, dailyVariant, type GameDefinition } from '@geogames/games';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { href } from '../router.ts';

export function Home() {
  return (
    <div className="page">
      <header className="hero">
        <h1>How well do you know the world?</h1>
        <p>Quick geography games built on fresh World Bank data.</p>
      </header>
      <section className="daily" aria-label="Daily challenge">
        <h2 className="daily-title">Daily challenge</h2>
        <p className="muted">The same run for everyone, one try a day. It doesn't use a free play.</p>
        <div className="daily-games">
          {dailyGames().map((g) => (
            <DailyLink key={g.id} game={g} />
          ))}
        </div>
      </section>
      <div className="game-grid">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}

function DailyLink({ game }: { game: GameDefinition }) {
  const { scores } = usePlatform();
  const [today, setToday] = useState(0);
  useEffect(() => {
    scores.personalBest(game.id, dailyVariant(dailyDate())).then(setToday);
  }, [scores, game.id]);
  return (
    <a className="btn btn-primary daily-game" href={href({ page: 'daily', gameId: game.id })}>
      {game.title}
      {today > 0 && <span className="daily-today"> · today: {today}</span>}
    </a>
  );
}

function GameCard({ game }: { game: GameDefinition }) {
  const { scores } = usePlatform();
  const [best, setBest] = useState(0);
  useEffect(() => {
    scores.personalBest(game.id).then(setBest);
  }, [scores, game.id]);

  const live = game.status === 'live';
  return (
    <article className={`game-card ${live ? '' : 'soon'}`}>
      <h2>{game.title}</h2>
      <p>{game.tagline}</p>
      <div className="game-card-footer">
        {live ? (
          <>
            <a className="btn btn-primary" href={href({ page: 'play', gameId: game.id })}>
              Play
            </a>
            <a className="link" href={href({ page: 'scores', gameId: game.id })}>
              {best > 0 ? `Best: ${best}` : 'Leaderboard'}
            </a>
          </>
        ) : (
          <span className="badge">Coming soon</span>
        )}
      </div>
    </article>
  );
}
