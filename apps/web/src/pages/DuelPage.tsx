import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CITY_DATA,
  DATASET_VERSION,
  DUEL_OPEN_DAYS,
  DUEL_PLAY_HOURS,
  DUEL_VARIANT,
  dailyDate,
  dailyDateOf,
  duelHasLevels,
  duelThings,
  getGame,
  replayRun,
  usesCityData,
  type DuelDto,
  type GameDefinition,
} from '@geogames/games';
import { DuelsNeedServer } from '../components/DuelGate.tsx';
import { DuelLevels, useDuelRuns } from '../components/DuelLevels.tsx';
import { settingsNote } from '../components/duelCopy.ts';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { DuelError } from '../platform/backend.ts';
import type { Play } from '../platform/backend.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { load, remove, save } from '../platform/storage.ts';
import { href } from '../router.ts';
import { dailyMovesKey } from './DailyPage.tsx';

type Phase =
  | { name: 'loading' }
  | { name: 'offline' }
  | { name: 'not-found' }
  | { name: 'update-required' }
  | { name: 'ready'; dto: DuelDto }
  | { name: 'playing'; dto: DuelDto; play: Play; moves: readonly string[] }
  | { name: 'sending'; dto: DuelDto }
  | { name: 'send-failed'; dto: DuelDto; play: Play; moves: readonly string[] };

const POLL_MS = 20_000;
const POLL_FOR_MS = 15 * 60_000;

/**
 * Where the challenger's run keeps its moves. A daily duel is played on the player's own
 * daily run, so it shares the daily page's place and either page resumes it.
 */
const movesKey = (dto: DuelDto) => {
  const date = dto.session && dailyDateOf(dto.session.variant);
  return date ? dailyMovesKey(gameOf(dto), date) : `duel:${dto.code}:moves`;
};
/** "City Circle Arcade", or "City Circle Arcade · daily of Fri 20 Nov". */
const duelTitle = (dto: DuelDto) => `${gameOf(dto).title}${dto.daily ? ` · daily of ${dayText(dto.daily)}` : ''}`;
/** "today's daily", or "the daily of Wed 18 Nov" once that day is over. */
const dailyName = (date: string) => (date === dailyDate() ? "today's daily" : `the daily of ${dayText(date)}`);
/** "Fri 20 Nov", for a daily duel's day. */
const dayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateText = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const minutes = (seconds: number | null) => (seconds === null ? null : `in ${Math.max(1, Math.round(seconds / 60))} min`);
const levelText = (level: number | null) => (level === null ? null : `level ${level}`);
/** The duel's game; a duel is only ever made of a known one. */
const gameOf = (dto: DuelDto) => getGame(dto.gameId)!;
/** "City Circle Arcade (level 9)", or just the title for a game without levels. */
const reached = (game: GameDefinition, level: number | null) => (duelHasLevels(game) && level ? ` (level ${level})` : '');

/** The duel's pages share the title and the way back. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page duel-page">
      <a className="link back" href={href({ page: 'duels' })}>
        ← All duels
      </a>
      {children}
    </div>
  );
}

/** #/duel/CODE: one duel, whoever you are and whatever state it's in. */
export function DuelPage({ code }: { code: string }) {
  const { duels, finishPlay, account, player, renamePlayer } = usePlatform();
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Keeps the moves of a run in progress, so a reload picks it up where it was.
  const keyRef = useRef(`duel:${code}:moves`);
  const onMovesChange = useCallback((moves: readonly string[]) => save(keyRef.current, { version: DATASET_VERSION, moves }), []);
  const [pollStopped, setPollStopped] = useState(false);
  // A slow network shouldn't let a second click send the result twice.
  const sending = useRef(false);
  // The platform's finishPlay changes when the player is renamed; the page must not reload for that.
  const finishRef = useRef(finishPlay);
  finishRef.current = finishPlay;
  const accepting = useRef(false);

  const submit = useCallback(
    async (dto: DuelDto, play: Play, moves: readonly string[], score?: number) => {
      if (sending.current) return;
      sending.current = true;
      setPhase({ name: 'sending', dto });
      try {
        const settings = dto.settings;
        const finalScore = score ?? (await replayRun(gameOf(dto), settings, play.seed, moves)).score;
        const variant = dto.session?.variant ?? DUEL_VARIANT;
        const result = await finishRef.current(play, { gameId: dto.gameId, variant, score: finalScore, seed: play.seed, moves });
        if (result.status === 'saved') {
          remove(movesKey(dto));
          const fresh = await duels?.get(code);
          setPhase(fresh ? { name: 'ready', dto: fresh } : { name: 'not-found' });
        } else {
          setPhase({ name: 'send-failed', dto, play, moves });
        }
      } catch {
        setPhase({ name: 'send-failed', dto, play, moves });
      } finally {
        sending.current = false;
      }
    },
    [code, duels],
  );

  /** Reads the duel and decides what to show: a challenger mid-run resumes, everyone else sees the page. */
  const refresh = useCallback(
    async (quiet = false) => {
      if (!duels) return;
      try {
        const dto = await duels.get(code);
        if (!dto) return setPhase({ name: 'not-found' });
        if (dto.you === 'challenger' && dto.state === 'playing' && dto.session) {
          const play: Play = { seed: dto.session.seed, sessionId: dto.session.sessionId };
          keyRef.current = movesKey(dto);
          const stored = load<{ version: string; moves: string[] } | null>(keyRef.current, null);
          const moves = stored?.version === DATASET_VERSION ? stored.moves : [];
          // A run that was over when the page closed still has to be sent.
          if (moves.length > 0 && (await replayRun(gameOf(dto), dto.settings, play.seed, moves)).finished) {
            return void submit(dto, play, moves);
          }
          return setPhase({ name: 'playing', dto, play, moves });
        }
        setPhase((current) => (quiet && current.name !== 'ready' ? current : { name: 'ready', dto }));
      } catch (error) {
        if (quiet) return;
        setPhase(error instanceof DuelError && error.reason === 'update-required' ? { name: 'update-required' } : { name: 'offline' });
      }
    },
    [code, duels, submit],
  );

  useEffect(() => {
    setPhase({ name: 'loading' });
    setPollStopped(false);
    void refresh();
  }, [refresh, attempt]);

  // The creator waits for a challenger, then for a result: ask now and then while the tab is showing.
  const dto = phase.name === 'ready' ? phase.dto : null;
  const watching =
    !!dto &&
    ((dto.you === 'creator' && (dto.state === 'open' || dto.state === 'playing')) ||
      (!!dto.rematch?.byYou && (dto.rematch.state === 'open' || dto.rematch.state === 'playing')));
  useEffect(() => {
    if (!watching) return;
    const started = Date.now();
    const tick = () => {
      if (Date.now() - started > POLL_FOR_MS) return setPollStopped(true);
      if (document.visibilityState === 'visible') void refresh(true);
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watching, refresh]);

  const accept = async (name: string) => {
    if (!duels || accepting.current) return;
    accepting.current = true;
    try {
      if (account.status === 'anonymous' && name.trim() && name.trim() !== player.name) await renamePlayer(name);
      const result = await duels.accept(code);
      if (result.status === 'ok') return void (await refresh());
      if (result.status === 'update-required') return setPhase({ name: 'update-required' });
      if (result.status === 'offline') return setPhase({ name: 'offline' });
      // Taken or reserved in the meantime: the page says which.
      await refresh();
    } finally {
      accepting.current = false;
    }
  };

  if (!duels) {
    return (
      <Shell>
        <DuelsNeedServer />
      </Shell>
    );
  }

  const game = phase.name === 'playing' ? gameOf(phase.dto) : undefined;

  return (
    <Shell>
      {phase.name === 'loading' && <p className="panel center muted">Loading the duel…</p>}
      {phase.name === 'offline' && (
        <div className="panel center">
          <p className="lead">Duels live on the server, and we can't reach it right now.</p>
          <button className="btn btn-primary btn-lg" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {phase.name === 'not-found' && (
        <div className="panel center">
          <p className="lead">This duel link doesn't work. Check you copied all of it.</p>
          <a className="btn" href={href({ page: 'duels' })}>
            All duels
          </a>
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
      {phase.name === 'sending' && <p className="panel center muted" role="status">Sending your result…</p>}
      {phase.name === 'send-failed' && (
        <div className="panel center">
          <p className="lead">We couldn't send your result to the server. Your run is kept on this device.</p>
          <button className="btn btn-primary btn-lg" onClick={() => void submit(phase.dto, phase.play, phase.moves)}>
            Try again
          </button>
        </div>
      )}
      {phase.name === 'playing' && game && (
        <>
          <p className="duel-strip" role="status">
            Duel vs {phase.dto.creator.name} · to beat: <strong>{phase.dto.creator.score}</strong>
            {phase.dto.session && dailyDateOf(phase.dto.session.variant) && ` · ${dailyName(phase.dto.daily!)}`}
          </p>
          <GameScreen
            key={phase.play.seed}
            game={game}
            settings={phase.dto.settings}
            seed={phase.play.seed}
            initialMoves={phase.moves}
            onMovesChange={onMovesChange}
            onGameOver={({ score, moves }: GameOutcome) => void submit(phase.dto, phase.play, moves, score)}
          />
        </>
      )}
      {phase.name === 'ready' && (
        <DuelBody
          dto={phase.dto}
          anonymous={account.status !== 'signed-in'}
          playerName={player.name}
          onAccept={accept}
          pollStopped={pollStopped && watching}
          onRefresh={() => {
            setPollStopped(false);
            void refresh();
          }}
        />
      )}
    </Shell>
  );
}

function DuelBody({
  dto,
  anonymous,
  playerName,
  onAccept,
  pollStopped,
  onRefresh,
}: {
  dto: DuelDto;
  anonymous: boolean;
  playerName: string;
  onAccept(name: string): Promise<void>;
  pollStopped: boolean;
  onRefresh(): void;
}) {
  const refreshButton = pollStopped && (
    <p className="center">
      <button className="btn" onClick={onRefresh}>
        Refresh
      </button>
    </p>
  );
  const startOwn = (
    <div className="row">
      <a className="btn btn-primary" href={href({ page: 'duel-new' })}>
        Start your own duel
      </a>
      <a className="btn" href={href({ page: 'duels' })}>
        All duels
      </a>
    </div>
  );

  if (dto.state === 'expired') {
    return (
      <div className="panel center">
        <p className="lead">
          {dto.expiredReason === 'outdated'
            ? `The game was updated since this duel was made, so its ${duelThings(gameOf(dto))} can't be played any more.`
            : `Nobody took this duel within ${DUEL_OPEN_DAYS} days.`}
        </p>
        {dto.you === 'creator' ? (
          <a className="btn btn-primary" href={href({ page: 'duel-new' })}>
            Start a new duel
          </a>
        ) : (
          startOwn
        )}
      </div>
    );
  }

  if (dto.state === 'open' && dto.you === 'creator') {
    return (
      <>
        <SharePanel dto={dto} />
        {refreshButton}
      </>
    );
  }

  if (dto.state === 'open') {
    if (dto.reservedFor && !dto.reservedForYou) {
      return (
        <div className="panel center">
          <p className="lead">This rematch is for {dto.reservedFor}.</p>
          {startOwn}
        </div>
      );
    }
    return <Invitation dto={dto} anonymous={anonymous} playerName={playerName} onAccept={onAccept} />;
  }

  if (dto.state === 'playing') {
    if (dto.you === 'creator') {
      return (
        <div className="panel center">
          <p className="eyebrow">Duel · {duelTitle(dto)}</p>
          <p className="big-score">{dto.creator.score}</p>
          <p className="lead" role="status">
            {dto.challenger?.name} took your duel and is playing now. You'll see the result here.
          </p>
          {refreshButton}
        </div>
      );
    }
    return (
      <div className="panel center">
        <p className="lead">Someone else already played this duel.</p>
        {startOwn}
      </div>
    );
  }

  return <Result dto={dto} refreshButton={refreshButton || null} />;
}

function SharePanel({ dto }: { dto: DuelDto }) {
  const [note, setNote] = useState<string | null>(null);
  const url = location.origin + location.pathname + href({ page: 'duel', code: dto.code });
  const game = gameOf(dto);
  const on = dto.daily ? `${dailyName(dto.daily)} of ${game.title}` : game.title;
  const text = `⚔️ I scored ${dto.creator.score} on ${on}${reached(game, dto.creator.level)}. Same ${duelThings(game)}, one try: can you beat me?\n${url}`;
  const copy = async (message: string, what = text) => {
    try {
      await navigator.clipboard.writeText(what);
      setNote(message);
    } catch {
      setNote('Copy this link: ' + url);
    }
  };
  const send = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
      } catch {
        // Closing the share sheet isn't a failure.
      }
      return;
    }
    await copy('Link copied!');
  };
  return (
    <div className="panel center duel-share">
      <p className="eyebrow">Duel · {duelTitle(dto)}</p>
      <p className="big-score">{dto.creator.score}</p>
      {duelHasLevels(game) && dto.creator.level && <p className="lead">Reached level {dto.creator.level}</p>}
      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={send}>
          Send the link
        </button>
        <button className="btn" onClick={() => copy('Link copied!', url)}>
          Copy link
        </button>
      </div>
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      <p className="muted">
        Waiting for a challenger. The link works until {dateText(dto.expiresAt)}, and the first person to press Play takes the duel.
      </p>
    </div>
  );
}

function Invitation({
  dto,
  anonymous,
  playerName,
  onAccept,
}: {
  dto: DuelDto;
  anonymous: boolean;
  playerName: string;
  onAccept(name: string): Promise<void>;
}) {
  const [name, setName] = useState(playerName);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(playerName), [playerName]);
  const game = gameOf(dto);
  const data = usesCityData(game) ? CITY_DATA.find((c) => c.id === dto.settings.cityData) : undefined;
  return (
    <div className="panel center duel-invite">
      <h1 className="page-title">{dto.reservedForYou ? `${dto.creator.name} has challenged you to a rematch` : `${dto.creator.name} challenges you`}</h1>
      <p className="lead">
        {dto.creator.name} scored <strong>{dto.creator.score}</strong> on {game.title}
        {duelHasLevels(game) && dto.creator.level ? ` and reached level ${dto.creator.level}` : ''}.
      </p>
      <ul className="rules-list">
        <li>You get exactly the same {duelThings(game)}, in the same order.</li>
        <li>One try. Your score is checked by the server.</li>
        <li>{dto.creator.name}'s answers stay hidden until you've finished.</li>
        {dto.daily && <li className="duel-daily-note">{dailyNote(dto)}</li>}
      </ul>
      {data && <p className="muted small">City data: {data.label.toLowerCase()} ({data.id === 'metro' ? 'UN' : 'GeoNames'})</p>}
      {settingsNote(game, dto.settings) && <p className="muted small">{settingsNote(game, dto.settings)}</p>}
      {anonymous && (
        <label className="field duel-name">
          Your name in this duel
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <button
        className="btn btn-primary btn-lg"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onAccept(name);
          setBusy(false);
        }}
      >
        {dto.yourDaily?.status === 'finished' ? 'See who wins' : 'Play the duel'}
      </button>
      <p className="muted small">Pressing Play takes this duel: nobody else can play it.</p>
    </div>
  );
}

/** What taking a daily duel does with the player's own daily run. */
function dailyNote(dto: DuelDto): string {
  const day = dailyName(dto.daily!);
  const today = dto.daily === dailyDate();
  if (dto.yourDaily?.status === 'finished') return `This is ${day}, and you've played it: your ${dto.yourDaily.score} points are your duel score.`;
  if (dto.yourDaily?.status === 'playing') return `This is ${day}, which you've started: you carry on where you left off.`;
  if (today) return "This is today's daily challenge: playing it here uses your one daily try, and your score counts on today's leaderboard.";
  return `This is ${day}. That day is over, so your run counts for this duel only.`;
}

function Result({ dto, refreshButton }: { dto: DuelDto; refreshButton: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const { creator } = dto;
  const challenger = dto.challenger ?? { ...dto.creator, status: 'playing' as const };
  const forfeit = challenger.status === 'forfeit';
  const names = { creator: creator.name, challenger: challenger.name };
  const mine = dto.you === 'visitor' ? null : dto.you;
  const winner = dto.outcome === 'draw' ? null : dto.outcome;
  const high = Math.max(creator.score ?? 0, challenger.score ?? 0);
  const low = Math.min(creator.score ?? 0, challenger.score ?? 0);

  let headline: React.ReactNode;
  if (forfeit) {
    headline = (
      <>
        {challenger.name} didn't finish within {DUEL_PLAY_HOURS} hours, so {creator.name} wins.
      </>
    );
  } else if (!winner) {
    headline = (
      <>
        <strong>A draw!</strong> {high} each
      </>
    );
  } else if (mine === null) {
    headline = (
      <>
        {creator.name} {creator.score} – {challenger.name} {challenger.score}
      </>
    );
  } else if (winner === mine) {
    headline = (
      <>
        <strong>You win!</strong> {high} to {low}
      </>
    );
  } else {
    headline = (
      <>
        <strong>{names[winner]} wins.</strong> {high} to {low}
      </>
    );
  }
  const tone = !winner ? 'draw' : mine === null ? 'neutral' : winner === mine ? 'win' : 'loss';

  const left = mine === 'challenger' ? challenger : creator;
  const right = mine === 'challenger' ? creator : challenger;
  const leftName = mine ? 'You' : left.name;
  const game = gameOf(dto);
  const levels = duelHasLevels(game);
  const runs = useDuelRuns(game, dto.settings, forfeit ? undefined : dto.seed, left.moves, right.moves);
  const levelOf = (run: 'left' | 'right', side: typeof left) => (!levels ? null : runs ? runs[run].level : side.level);
  const copyText = `⚔️ GeoGames duel: ${creator.name} ${creator.score} – ${challenger.name} ${forfeit ? 'did not finish' : challenger.score} (${game.title})`;
  const rematch = dto.rematch;
  if (!dto.challenger) return null;

  return (
    <>
      <div className={`panel center duel-result tone-${tone}`}>
        <p className="eyebrow">Duel · {duelTitle(dto)}</p>
        <p className="lead duel-headline" role="status">
          {headline}
        </p>
        <div className="duel-cards">
          <ScoreCard label={leftName} side={left} level={levelOf('left', left)} />
          <ScoreCard label={right.name} side={right} level={levelOf('right', right)} />
        </div>
        {mine && rematch?.forYou && (
          <p className="duel-banner" role="status">
            {mine === 'creator' ? challenger.name : creator.name} has challenged you to a rematch{' '}
            <a className="btn btn-primary" href={href({ page: 'duel', code: rematch.code })}>
              Play it
            </a>
          </p>
        )}
        {mine && rematch?.byYou && (
          <p className="duel-banner" role="status">
            Rematch sent: waiting for {mine === 'creator' ? challenger.name : creator.name}.{' '}
            <a className="link" href={href({ page: 'duel', code: rematch.code })}>
              Open it
            </a>
          </p>
        )}
        <div className="row">
          {mine && !rematch && (
            <a className="btn btn-primary btn-lg" href={href({ page: 'duel-new', rematchOf: dto.code })}>
              Rematch
            </a>
          )}
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(copyText);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied!' : 'Copy result'}
          </button>
          <a className="btn" href={href({ page: 'duels' })}>
            All duels
          </a>
        </div>
        {refreshButton}
      </div>
      {levels && !forfeit && dto.seed !== undefined && creator.moves && challenger.moves && (
        <div className="panel">
          <DuelLevels data={runs} left={leftName} right={right.name} />
        </div>
      )}
      {levels && !forfeit && dto.daily && dto.seed === undefined && (
        <p className="panel center muted small">The level-by-level answers show once you've played this daily, or when its day is over.</p>
      )}
    </>
  );
}

function ScoreCard({ label, side, level }: { label: string; side: DuelDto['creator']; level: number | null }) {
  const forfeit = side.status === 'forfeit';
  return (
    <div className="duel-card">
      <p className="duel-card-name">{label}</p>
      <p className="big-score">{forfeit ? '–' : side.score}</p>
      <p className="muted small">
        {forfeit ? "didn't finish" : [levelText(level), minutes(side.durationSec)].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}
