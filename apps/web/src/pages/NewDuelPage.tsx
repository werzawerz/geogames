import { useEffect, useRef, useState } from 'react';
import {
  CITY_DATA,
  GROUPS,
  duelGames,
  duelSettings,
  duelThings,
  getGame,
  normalizeSettings,
  usesCityData,
  variantKey,
  type GameDefinition,
  type GameSettings,
} from '@geogames/games';
import { DuelGate, DuelsNeedServer } from '../components/DuelGate.tsx';
import { settingsNote } from '../components/duelCopy.ts';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { DuelError, type Play } from '../platform/backend.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { load } from '../platform/storage.ts';
import { href } from '../router.ts';

type Phase =
  | { name: 'intro' }
  | { name: 'update-required' }
  | { name: 'playing'; play: Play; game: GameDefinition; settings: GameSettings }
  | { name: 'sending' }
  | { name: 'failed'; message: string; retry(): void };

/** The settings the player last used for a game, so their duel is the game they know (as far as a duel allows). */
const rememberedSettings = (game: GameDefinition) => duelSettings(normalizeSettings(load(`settings:${game.id}`, {}), game));

/** The game a new duel starts on: the one in the link, if it can be duelled, else the default. */
const startingGame = (gameId?: string) => duelGames().find((g) => g.id === gameId) ?? duelGames()[0]!;

/** #/duels/new[/game-id or /CODE]: pick a game, play a run, and it becomes a duel (or a rematch of CODE). */
export function NewDuelPage({ rematchOf, gameId }: { rematchOf?: string; gameId?: string }) {
  const { duels, account, startPlay, finishPlay } = usePlatform();
  const [picked, setPicked] = useState(() => startingGame(gameId));
  // A rematch is the duel's game again, with its settings: known once the duel is read.
  const [rematch, setRematch] = useState<{ game: GameDefinition; settings: GameSettings } | null>(null);
  const game = rematch?.game ?? picked;
  const settings = rematch?.settings ?? rememberedSettings(picked);
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [starting, setStarting] = useState(false);
  const finishing = useRef(false);
  // A rematch is checked before the run, not after it: nobody should play a whole run for nothing.
  const [blocked, setBlocked] = useState<{ message: string; code?: string } | null>(null);
  const [checked, setChecked] = useState(!rematchOf);
  const signedIn = account.status === 'signed-in';
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
        // Unreachable now: making the duel at the end will say so.
        if (!cancelled) setChecked(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rematchOf, duels, signedIn]);

  const shell = (children: React.ReactNode) => (
    <div className="page">
      <a className="link back" href={href({ page: 'duels' })}>
        ← All duels
      </a>
      <h1 className="page-title">{rematchOf ? `Rematch${rematch ? `: ${rematch.game.title}` : ''}` : `New duel: ${game.title}`}</h1>
      {children}
    </div>
  );

  if (!duels || account.status === 'local') return shell(<DuelsNeedServer />);
  if (account.status === 'anonymous') return shell(<DuelGate />);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    const chosen = { game, settings };
    const result = await startPlay(chosen.game, chosen.settings);
    setStarting(false);
    if (result.status === 'update-required') setPhase({ name: 'update-required' });
    // Without a server session the run can't become a duel: say so now, not after it.
    else if (!result.play.sessionId) setPhase({ name: 'failed', retry: start, message: "We couldn't reach the server, so a duel can't start right now." });
    else setPhase({ name: 'playing', play: result.play, ...chosen });
  };

  const makeDuel = async (play: Play, played: GameDefinition, playedSettings: GameSettings, outcome: GameOutcome) => {
    const saved = await finishPlay(play, {
      gameId: played.id,
      variant: variantKey(playedSettings, played),
      score: outcome.score,
      seed: play.seed,
      moves: outcome.moves,
    });
    const retry = () => void makeDuel(play, played, playedSettings, outcome);
    if (saved.status !== 'saved' || !play.sessionId) {
      return setPhase({ name: 'failed', retry, message: "We couldn't save your run on the server, so it can't become a duel." });
    }
    try {
      const code = await duels.create(play.sessionId, rematchOf);
      location.hash = href({ page: 'duel', code });
    } catch (error) {
      const reason = error instanceof DuelError ? error.reason : 'offline';
      const message =
        reason === 'rate-limited'
          ? "You've made a lot of duels lately. Wait a little, then try again."
          : reason === 'unavailable'
            ? "This run can't become a duel."
            : "We couldn't reach the server, so your duel wasn't made.";
      setPhase({ name: 'failed', retry, message });
    }
  };

  const onGameOver = (play: Play, played: GameDefinition, playedSettings: GameSettings) => async (outcome: GameOutcome) => {
    if (finishing.current) return;
    finishing.current = true;
    setPhase({ name: 'sending' });
    try {
      await makeDuel(play, played, playedSettings, outcome);
    } finally {
      finishing.current = false;
    }
  };

  const data = usesCityData(game) ? CITY_DATA.find((c) => c.id === settings.cityData) : undefined;
  const note = data ? `City data: ${data.label.toLowerCase()}` : settingsNote(game, settings);

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
      {phase.name === 'intro' && checked && !blocked && (
        <div className="panel center duel-new">
          {!rematchOf && <GamePicker value={picked} onChange={setPicked} />}
          <p className="lead">
            Play your run first. Your friend then gets exactly the same {duelThings(game)} and has to beat your score.
          </p>
          {note && (
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
            Play
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
          onGameOver={onGameOver(phase.play, phase.game, phase.settings)}
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

/** Which game to duel on, grouped like the home page. */
function GamePicker({ value, onChange }: { value: GameDefinition; onChange(game: GameDefinition): void }) {
  const games = duelGames();
  return (
    <div className="duel-pick">
      <label htmlFor="duel-game">Game</label>
      <select id="duel-game" value={value.id} onChange={(e) => onChange(games.find((g) => g.id === e.target.value)!)}>
        {GROUPS.map((group) => {
          const inGroup = games.filter((g) => g.group === group.id);
          return (
            inGroup.length > 0 && (
              <optgroup key={group.id} label={group.title}>
                {inGroup.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </optgroup>
            )
          );
        })}
      </select>
      <span className="muted small">{value.tagline}</span>
    </div>
  );
}
