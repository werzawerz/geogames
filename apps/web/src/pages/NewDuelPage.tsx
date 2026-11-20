import { useEffect, useRef, useState } from 'react';
import {
  CITY_DATA,
  DATASET_VERSION,
  GROUPS,
  dailyDate,
  dailySettings,
  dailyVariant,
  duelGames,
  duelSettings,
  duelThings,
  getGame,
  hasDaily,
  normalizeSettings,
  usesCityData,
  variantKey,
  type GameDefinition,
  type GameSettings,
} from '@geogames/games';
import { DuelGate, DuelsNeedServer } from '../components/DuelGate.tsx';
import { settingsNote } from '../components/duelCopy.ts';
import { GameCardArt } from '../games/GameCardArt.tsx';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { DuelError, type Play } from '../platform/backend.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { load, remove, save } from '../platform/storage.ts';
import { href } from '../router.ts';
import { dailyMovesKey } from './DailyPage.tsx';

/** A duel is of a random run, or of today's daily challenge (for the games that have one). */
type Mode = 'random' | 'daily';

type Phase =
  | { name: 'intro' }
  | { name: 'update-required' }
  | {
      name: 'playing';
      play: Play;
      game: GameDefinition;
      settings: GameSettings;
      variant: string;
      /** A daily run keeps its moves where the daily page does, so either page resumes it. */
      movesKey: string | null;
      initialMoves: readonly string[];
    }
  | { name: 'sending' }
  | { name: 'failed'; message: string; retry(): void };

/** The settings the player last used for a game, so their duel is the game they know (as far as a duel allows). */
const rememberedSettings = (game: GameDefinition) => duelSettings(normalizeSettings(load(`settings:${game.id}`, {}), game));

const failureMessage = (error: unknown) => {
  const reason = error instanceof DuelError ? error.reason : 'offline';
  if (reason === 'rate-limited') return "You've made a lot of duels lately. Wait a little, then try again.";
  if (reason === 'unavailable') return "This run can't become a duel.";
  return "We couldn't reach the server, so your duel wasn't made.";
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page">
      <a className="link back" href={href({ page: 'duels' })}>
        ← All duels
      </a>
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}

/**
 * #/duels/new: pick a game from cards, like the home page.
 * #/duels/new/<game-id>: choose a random run or today's daily, play it, and it becomes a duel.
 * #/duels/new/<CODE>: a rematch of that duel.
 * #/duels/new/<session-id>: a run just finished becomes a duel (where sign-in comes back to).
 */
export function NewDuelPage({ rematchOf, gameId, sessionId }: { rematchOf?: string; gameId?: string; sessionId?: string }) {
  const { duels, account } = usePlatform();
  const game = duelGames().find((g) => g.id === gameId);
  if (!duels || account.status === 'local') {
    return (
      <Shell title="New duel">
        <DuelsNeedServer />
      </Shell>
    );
  }
  if (sessionId) return <DuelFromRun sessionId={sessionId} />;
  if (!rematchOf && !game) return <DuelGamePicker />;
  return <StartDuel game={game} rematchOf={rematchOf} />;
}

/** The game picker: the duel games as cards, grouped as on the home page. */
function DuelGamePicker() {
  const games = duelGames();
  return (
    <div className="page duel-picker">
      <a className="link back" href={href({ page: 'duels' })}>
        ← All duels
      </a>
      <header className="hero">
        <h1>Duel a friend</h1>
        <p>Pick a game and play your run. Your friend gets exactly the same puzzles, one try, and has to beat your score.</p>
      </header>
      {GROUPS.map((group) => {
        const inGroup = games.filter((g) => g.group === group.id);
        if (inGroup.length === 0) return null;
        return (
          <section key={group.id} className="game-group" aria-labelledby={`duel-group-${group.id}`}>
            <h2 className="group-title" id={`duel-group-${group.id}`}>
              {group.title}
            </h2>
            <div className="game-grid">
              {inGroup.map((g) => (
                <DuelGameCard key={g.id} game={g} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DuelGameCard({ game }: { game: GameDefinition }) {
  return (
    <article className="game-card duel-game-card">
      <GameCardArt gameId={game.id} />
      <h2>{game.title}</h2>
      <p>{game.tagline}</p>
      <div className="game-card-footer">
        <a className="btn btn-primary" href={href({ page: 'duel-new', gameId: game.id })} aria-label={`Duel at ${game.title}`}>
          Duel
        </a>
        {hasDaily(game) && <span className="badge">Random or today's daily</span>}
      </div>
    </article>
  );
}

/** Makes a duel of a run the player has already finished, once they're signed in. */
function DuelFromRun({ sessionId }: { sessionId: string }) {
  const { duels, account } = usePlatform();
  const [failed, setFailed] = useState<string | null>(null);
  const signedIn = account.status === 'signed-in';
  useEffect(() => {
    if (!signedIn || !duels) return;
    let cancelled = false;
    duels.create(sessionId).then(
      (code) => {
        if (!cancelled) location.hash = href({ page: 'duel', code });
      },
      (error: unknown) => {
        if (cancelled) return;
        const reason = error instanceof DuelError ? error.reason : 'offline';
        setFailed(
          reason === 'unavailable'
            ? "This run can't become a duel any more. A run can be turned into a duel for a day after you finish it."
            : failureMessage(error),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, duels, sessionId]);

  return (
    <Shell title="Challenge a friend">
      {!signedIn && <DuelGate extra="Your run is kept: once you're signed in, it becomes the duel." />}
      {signedIn && !failed && (
        <p className="panel center muted" role="status">
          Making your duel…
        </p>
      )}
      {failed && (
        <div className="panel center">
          <p className="lead">{failed}</p>
          <a className="btn btn-primary" href={href({ page: 'duel-new' })}>
            Start a new duel
          </a>
        </div>
      )}
    </Shell>
  );
}

/** The start step: a game (or a rematch's game), random or today's daily, then the run. */
function StartDuel({ game: picked, rematchOf }: { game?: GameDefinition; rematchOf?: string }) {
  const { duels, account, startPlay, startDaily, finishPlay, scores } = usePlatform();
  // A rematch is the duel's game again, with its settings: known once the duel is read.
  const [rematch, setRematch] = useState<{ game: GameDefinition; settings: GameSettings } | null>(null);
  const game = rematch?.game ?? picked;
  const [mode, setMode] = useState<Mode>('random');
  const daily = mode === 'daily' && !!game && hasDaily(game) && !rematchOf;
  const settings = rematch?.settings ?? (game ? (daily ? dailySettings(game) : rememberedSettings(game)) : null);
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [starting, setStarting] = useState(false);
  const finishing = useRef(false);
  // A rematch is checked before the run, not after it: nobody should play a whole run for nothing.
  const [blocked, setBlocked] = useState<{ message: string; code?: string } | null>(null);
  const [checked, setChecked] = useState(!rematchOf);
  // What the player scored in today's daily, if they've played it: a daily duel then uses that result.
  const [todayScore, setTodayScore] = useState<number | undefined>(undefined);
  const signedIn = account.status === 'signed-in';

  useEffect(() => {
    if (!game || !hasDaily(game) || rematchOf) return;
    let cancelled = false;
    scores.personalBest(game.id, dailyVariant(dailyDate())).then((s) => !cancelled && setTodayScore(s));
    return () => {
      cancelled = true;
    };
  }, [scores, game, rematchOf]);

  useEffect(() => {
    if (!rematchOf || !duels || !signedIn) return;
    let cancelled = false;
    duels.get(rematchOf).then(
      (dto) => {
        if (cancelled) return;
        setChecked(true);
        const original = dto && getGame(dto.gameId);
        if (!dto || !original) setBlocked({ message: "This duel link doesn't work. Check you copied all of it." });
        else if (dto.you === 'visitor') setBlocked({ message: 'Only the two players of a duel can ask for a rematch.' });
        else if (dto.state !== 'finished') setBlocked({ message: 'You can ask for a rematch once this duel is finished.', code: dto.code });
        else if (dto.rematch) setBlocked({ message: 'There is already a rematch of this duel.', code: dto.rematch.code });
        else setRematch({ game: original, settings: dto.settings });
      },
      () => {
        // Without the duel we don't know its game, so a run now might not be able to become its rematch.
        if (cancelled) return;
        setChecked(true);
        setBlocked({ message: "We couldn't reach the server to check this duel. Reload the page to try again.", code: rematchOf });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rematchOf, duels, signedIn]);

  const title = rematchOf ? `Rematch${rematch ? `: ${rematch.game.title}` : ''}` : `New duel: ${game?.title ?? ''}`;
  const back = rematchOf ? href({ page: 'duels' }) : href({ page: 'duel-new' });
  const shell = (children: React.ReactNode) => (
    <div className="page">
      <a className="link back" href={back}>
        {rematchOf ? '← All duels' : '← Pick another game'}
      </a>
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );

  if (!signedIn) return shell(<DuelGate />);

  const makeDuel = async (play: Play) => {
    try {
      const code = await duels!.create(play.sessionId!, rematchOf);
      location.hash = href({ page: 'duel', code });
    } catch (error) {
      setPhase({ name: 'failed', retry: () => void makeDuel(play), message: failureMessage(error) });
    }
  };

  const finishRun = async (playing: Extract<Phase, { name: 'playing' }>, outcome: GameOutcome) => {
    const saved = await finishPlay(playing.play, {
      gameId: playing.game.id,
      variant: playing.variant,
      score: outcome.score,
      seed: playing.play.seed,
      moves: outcome.moves,
    });
    if (playing.movesKey) remove(playing.movesKey);
    if (saved.status !== 'saved' || !playing.play.sessionId) {
      return setPhase({
        name: 'failed',
        retry: () => void finishRun(playing, outcome),
        message: "We couldn't save your run on the server, so it can't become a duel.",
      });
    }
    await makeDuel(playing.play);
  };

  const onGameOver = (playing: Extract<Phase, { name: 'playing' }>) => async (outcome: GameOutcome) => {
    if (finishing.current) return;
    finishing.current = true;
    setPhase({ name: 'sending' });
    try {
      await finishRun(playing, outcome);
    } finally {
      finishing.current = false;
    }
  };

  const start = async () => {
    if (starting || !game || !settings) return;
    setStarting(true);
    try {
      if (daily) {
        const result = await startDaily(game);
        if (result.status === 'update-required') return setPhase({ name: 'update-required' });
        if (result.status === 'unavailable' || !result.play.sessionId) {
          return setPhase({ name: 'failed', retry: start, message: "We couldn't reach the server, so a duel can't start right now." });
        }
        // Today's daily already played: that result is the duel. One daily a day, never a second run.
        if (result.finishedScore !== null) {
          setPhase({ name: 'sending' });
          return void (await makeDuel(result.play));
        }
        const movesKey = dailyMovesKey(game, result.date);
        const stored = load<{ version: string; moves: string[] } | null>(movesKey, null);
        return setPhase({
          name: 'playing',
          play: result.play,
          game,
          settings,
          variant: dailyVariant(result.date),
          movesKey,
          initialMoves: stored?.version === DATASET_VERSION ? stored.moves : [],
        });
      }
      const result = await startPlay(game, settings);
      if (result.status === 'update-required') return setPhase({ name: 'update-required' });
      // Without a server session the run can't become a duel: say so now, not after it.
      if (!result.play.sessionId) {
        return setPhase({ name: 'failed', retry: start, message: "We couldn't reach the server, so a duel can't start right now." });
      }
      setPhase({ name: 'playing', play: result.play, game, settings, variant: variantKey(settings, game), movesKey: null, initialMoves: [] });
    } finally {
      setStarting(false);
    }
  };

  const data = game && settings && usesCityData(game) ? CITY_DATA.find((c) => c.id === settings.cityData) : undefined;
  const note = !game || !settings ? null : data ? `City data: ${data.label.toLowerCase()}` : settingsNote(game, settings);
  const playedToday = (todayScore ?? 0) > 0;

  return shell(
    <>
      {phase.name === 'intro' && blocked && (
        <div className="panel center">
          <p className="lead">{blocked.message}</p>
          <div className="row">
            {blocked.code && (
              <a className="btn btn-primary" href={href({ page: 'duel', code: blocked.code })}>
                Open the duel
              </a>
            )}
            <a className="btn" href={href({ page: 'duel-new' })}>
              Start a new duel
            </a>
          </div>
        </div>
      )}
      {phase.name === 'intro' && !checked && <p className="panel center muted">Checking the duel…</p>}
      {phase.name === 'intro' && checked && !blocked && game && (
        <div className="panel center duel-new">
          {game && !rematchOf && <GameCardArt gameId={game.id} />}
          {hasDaily(game) && !rematchOf && (
            <div className="duel-modes" role="radiogroup" aria-label="Which run">
              <button type="button" role="radio" aria-checked={mode === 'random'} className="duel-mode" onClick={() => setMode('random')}>
                <strong>Random</strong>
                <span>A new run, just for this duel. Doesn't touch your daily.</span>
              </button>
              <button type="button" role="radio" aria-checked={mode === 'daily'} className="duel-mode" onClick={() => setMode('daily')}>
                <strong>Today's daily</strong>
                <span>
                  {playedToday
                    ? `You've played it: your ${todayScore} points are the score to beat.`
                    : 'Uses your one daily try, and counts on today’s leaderboard.'}
                </span>
              </button>
            </div>
          )}
          <p className="lead">
            {daily
              ? `Your friend gets today's ${duelThings(game)} too, and has to beat your score. It uses up their daily try as well.`
              : `Play your run first. Your friend then gets exactly the same ${duelThings(game)} and has to beat your score.`}
          </p>
          {note && !daily && (
            <p className="muted small">
              {note}
              {!rematchOf && (
                <>
                  {' '}
                  ·{' '}
                  <a className="link" href={href({ page: 'play', gameId: game.id })}>
                    change it on the game’s page
                  </a>
                </>
              )}
            </p>
          )}
          <button className="btn btn-primary btn-lg" onClick={start} disabled={starting}>
            {daily && playedToday ? 'Challenge with my daily' : daily ? "Play today's daily" : 'Play'}
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
      {phase.name === 'playing' && (
        <GameScreen
          key={phase.play.seed}
          game={phase.game}
          settings={phase.settings}
          seed={phase.play.seed}
          initialMoves={phase.initialMoves}
          onMovesChange={phase.movesKey ? (moves) => save(phase.movesKey!, { version: DATASET_VERSION, moves }) : undefined}
          onGameOver={onGameOver(phase)}
        />
      )}
      {phase.name === 'sending' && (
        <p className="panel center muted" role="status">
          Making your duel…
        </p>
      )}
      {phase.name === 'failed' && (
        <div className="panel center">
          <p className="lead">{phase.message}</p>
          <button className="btn btn-primary btn-lg" onClick={phase.retry}>
            Try again
          </button>
        </div>
      )}
    </>,
  );
}
