import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CITY_DATA,
  DATASET_VERSION,
  DUEL_OPEN_DAYS,
  DUEL_PLAY_HOURS,
  DUEL_VARIANT,
  arcadeRunSummary,
  getGame,
  type DuelDto,
} from '@geogames/games';
import { DuelsNeedServer } from '../components/DuelGate.tsx';
import { DuelLevels, levelReached, useDuelRuns } from '../components/DuelLevels.tsx';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { DuelError } from '../platform/backend.ts';
import type { Play } from '../platform/backend.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { load, remove, save } from '../platform/storage.ts';
import { href } from '../router.ts';

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

const movesKey = (code: string) => `duel:${code}:moves`;
const dateText = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const minutes = (seconds: number | null) => (seconds === null ? null : `in ${Math.max(1, Math.round(seconds / 60))} min`);
const levelText = (level: number | null) => (level === null ? null : `level ${level}`);

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
  const onMovesChange = useCallback((moves: readonly string[]) => save(movesKey(code), { version: DATASET_VERSION, moves }), [code]);
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
        const finalScore = score ?? (await arcadeRunSummary(settings, play.seed, moves)).score;
        const result = await finishRef.current(play, { gameId: dto.gameId, variant: DUEL_VARIANT, score: finalScore, seed: play.seed, moves });
        if (result.status === 'saved') {
          remove(movesKey(code));
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
          const stored = load<{ version: string; moves: string[] } | null>(movesKey(code), null);
          const moves = stored?.version === DATASET_VERSION ? stored.moves : [];
          // A run that was over when the page closed still has to be sent.
          if (moves.length > 0 && (await arcadeRunSummary(dto.settings, play.seed, moves)).finished) {
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

  const game = getGame('city-circle-arcade');

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
            ? "The game was updated since this duel was made, so its circles can't be played any more."
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
          <p className="eyebrow">Duel · City Circle Arcade</p>
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
  const text = `⚔️ I scored ${dto.creator.score} on City Circle Arcade (level ${dto.creator.level}). Same circles, one try: can you beat me?\n${url}`;
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
      <p className="eyebrow">Duel · City Circle Arcade</p>
      <p className="big-score">{dto.creator.score}</p>
      <p className="lead">
        Level {dto.creator.level} · {dto.creator.level! - 1 === 1 ? '1 circle' : `${dto.creator.level! - 1} circles`} cleared
      </p>
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
  const data = CITY_DATA.find((c) => c.id === dto.settings.cityData);
  return (
    <div className="panel center duel-invite">
      <h1 className="page-title">{dto.reservedForYou ? `${dto.creator.name} has challenged you to a rematch` : `${dto.creator.name} challenges you`}</h1>
      <p className="lead">
        {dto.creator.name} scored <strong>{dto.creator.score}</strong> on City Circle Arcade and reached level {dto.creator.level}.
      </p>
      <ul className="rules-list">
        <li>You get exactly the same circles, in the same order.</li>
        <li>One try. Your score is checked by the server.</li>
        <li>{dto.creator.name}'s answers stay hidden until you've finished.</li>
      </ul>
      {data && <p className="muted small">City data: {data.label.toLowerCase()} ({data.id === 'metro' ? 'UN' : 'GeoNames'})</p>}
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
        Play the duel
      </button>
      <p className="muted small">Pressing Play takes this duel: nobody else can play it.</p>
    </div>
  );
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
  const runs = useDuelRuns(dto.settings, forfeit ? undefined : dto.seed, left.moves, right.moves);
  const copyText = `⚔️ GeoGames duel: ${creator.name} ${creator.score} – ${challenger.name} ${forfeit ? 'did not finish' : challenger.score} (City Circle Arcade)`;
  const rematch = dto.rematch;
  if (!dto.challenger) return null;

  return (
    <>
      <div className={`panel center duel-result tone-${tone}`}>
        <p className="eyebrow">Duel · City Circle Arcade</p>
        <p className="lead duel-headline" role="status">
          {headline}
        </p>
        <div className="duel-cards">
          <ScoreCard label={leftName} side={left} level={runs ? levelReached(runs.left) : left.level} />
          <ScoreCard label={right.name} side={right} level={runs ? levelReached(runs.right) : right.level} />
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
      {!forfeit && dto.seed !== undefined && creator.moves && challenger.moves && (
        <div className="panel">
          <DuelLevels data={runs} left={leftName} right={right.name} />
        </div>
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
