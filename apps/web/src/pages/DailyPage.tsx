import { useCallback, useEffect, useRef, useState } from 'react';
import { DATASET_VERSION, dailyVariant, dailySettings, type GameDefinition, type GameSettings } from '@geogames/games';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import type { FinishStatus, Play } from '../platform/backend.ts';
import type { RankedScore } from '../platform/scores.ts';
import { load, remove, save } from '../platform/storage.ts';
import { href } from '../router.ts';
import { AnonymousNote } from './ScoresPage.tsx';

type Phase =
  | { name: 'loading' }
  | { name: 'unavailable' }
  | { name: 'update-required' }
  | { name: 'playing'; date: string; play: Play; moves: readonly string[] }
  | { name: 'done'; date: string; score: number; message?: string; shareLine?: string; notice?: string; status?: FinishStatus };

/** What's kept to show or share a finished challenge again. */
interface SavedResult {
  message?: string;
  shareLine?: string;
}

const key = (game: GameDefinition, date: string) => `daily:${game.id}:${date}`;

export function DailyPage({ game }: { game: GameDefinition }) {
  const { startDaily, finishPlay } = usePlatform();
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [settings] = useState<GameSettings>(() => dailySettings(game));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase({ name: 'loading' });
    startDaily(game).then((result) => {
      if (cancelled) return;
      if (result.status === 'unavailable') return setPhase({ name: 'unavailable' });
      if (result.status === 'update-required') return setPhase({ name: 'update-required' });
      const { date, play, finishedScore } = result;
      if (finishedScore !== null) {
        return setPhase({ name: 'done', date, score: finishedScore, ...load<SavedResult>(`${key(game, date)}:result`, {}) });
      }
      // A reload picks the run up again rather than starting it over.
      const moves = load<{ version: string; moves: string[] } | null>(`${key(game, date)}:moves`, null);
      setPhase({ name: 'playing', date, play, moves: moves?.version === DATASET_VERSION ? moves.moves : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [game, startDaily, attempt]);

  const playing = phase.name === 'playing' ? phase : null;
  const date = playing?.date;
  const play = playing?.play;

  const onMovesChange = useCallback(
    (moves: readonly string[]) => {
      if (date) save(`${key(game, date)}:moves`, { version: DATASET_VERSION, moves });
    },
    [game, date],
  );

  // A slow network shouldn't let a second click send the result twice.
  const finishing = useRef(false);
  const onGameOver = useCallback(
    async ({ score, moves, message, shareLine }: GameOutcome) => {
      if (!play || !date || finishing.current) return;
      finishing.current = true;
      setPhase({ name: 'done', date, score, message, shareLine });
      const result = await finishPlay(play, { gameId: game.id, variant: dailyVariant(date), score, seed: play.seed, moves });
      const saved: SavedResult = { message, shareLine };
      save(`${key(game, date)}:result`, saved);
      remove(`${key(game, date)}:moves`);
      setPhase({ name: 'done', date, score: result.score, message, shareLine, notice: result.notice, status: result.status });
    },
    [finishPlay, game, play, date],
  );

  return (
    <div className="page">
      <a className="link back" href={href({ page: 'dailies' })}>
        ← All daily challenges
      </a>
      <h1 className="page-title">Daily challenge: {game.title}</h1>

      {phase.name === 'loading' && <p className="panel center muted">Loading today's challenge…</p>}
      {phase.name === 'unavailable' && (
        <div className="panel center">
          <p className="lead">We can't reach the server, and everyone's daily challenge lives there.</p>
          <button className="btn btn-primary btn-lg" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {phase.name === 'update-required' && (
        <div className="panel center">
          <h2>There's a new version of the game</h2>
          <button className="btn btn-primary btn-lg" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
      {playing && (
        <GameScreen
          key={playing.play.seed}
          game={game}
          settings={settings}
          seed={playing.play.seed}
          initialMoves={playing.moves}
          onMovesChange={onMovesChange}
          onGameOver={onGameOver}
        />
      )}
      {phase.name === 'done' && <DailyResult game={game} {...phase} />}
    </div>
  );
}

export const nextChallengeAt = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function DailyResult({
  game,
  date,
  score,
  message,
  shareLine,
  notice,
  status,
}: {
  game: GameDefinition;
  date: string;
  score: number;
  message?: string;
  shareLine?: string;
  notice?: string;
  status?: FinishStatus;
}) {
  const { scores, account } = usePlatform();
  const [entries, setEntries] = useState<RankedScore[] | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    scores.top(game.id, dailyVariant(date), 'global', 10).then((e) => !cancelled && setEntries(e));
    return () => {
      cancelled = true;
    };
  }, [scores, game.id, date, score]);

  const share = async () => {
    const lines = [`🌍 GeoGames daily ${date}`, `${game.title}: ${score} points`, message, shareLine, location.origin + location.pathname];
    await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
    setCopied(true);
  };

  return (
    <>
      <div className="panel center">
        <p className="eyebrow">Today's result · {date}</p>
        <p className="big-score">{score}</p>
        {message && <p className="lead">{message}</p>}
        {shareLine && <p className="daily-share-line">{shareLine}</p>}
        {notice && (
          <p className={`muted score-notice score-${status}`} role="status">
            {notice}
          </p>
        )}
        <div className="row">
          <button className="btn btn-primary btn-lg" onClick={share}>
            {copied ? 'Copied!' : 'Copy result'}
          </button>
          <a className="btn" href={href({ page: 'dailies' })}>
            Other daily challenges
          </a>
        </div>
        <p className="muted">One try a day. The next challenge starts at {nextChallengeAt()}.</p>
      </div>
      <div className="panel">
        <h2 className="setup-label">Today's leaderboard</h2>
        {entries === undefined && <p className="muted">Loading…</p>}
        {entries === null && <p className="muted">The global leaderboard isn't available right now.</p>}
        {entries?.length === 0 && <p className="muted">No scores yet today.</p>}
        {account.status === 'anonymous' && <AnonymousNote />}
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
    </>
  );
}
