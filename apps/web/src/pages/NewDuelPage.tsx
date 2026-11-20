import { useRef, useState } from 'react';
import { getGame, normalizeSettings, variantKey, type GameSettings } from '@geogames/games';
import { DuelGate, DuelsNeedServer } from '../components/DuelGate.tsx';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { DuelError, type Play } from '../platform/backend.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { load } from '../platform/storage.ts';
import { href } from '../router.ts';

type Phase =
  | { name: 'intro' }
  | { name: 'update-required' }
  | { name: 'playing'; play: Play; settings: GameSettings }
  | { name: 'sending' }
  | { name: 'failed'; message: string; retry(): void };

const GAME_ID = 'city-circle-arcade';

/** #/duels/new[/CODE]: play a run, then it becomes a duel (or a rematch of CODE) and you land on its page. */
export function NewDuelPage({ rematchOf }: { rematchOf?: string }) {
  const { duels, account, startPlay, finishPlay } = usePlatform();
  const game = getGame(GAME_ID)!;
  const [phase, setPhase] = useState<Phase>({ name: 'intro' });
  const [starting, setStarting] = useState(false);
  const finishing = useRef(false);

  const shell = (children: React.ReactNode) => (
    <div className="page">
      <a className="link back" href={href({ page: 'duels' })}>
        ← All duels
      </a>
      <h1 className="page-title">{rematchOf ? 'Rematch: City Circle Arcade' : 'New duel: City Circle Arcade'}</h1>
      {children}
    </div>
  );

  if (!duels || account.status === 'local') return shell(<DuelsNeedServer />);
  if (account.status === 'anonymous') return shell(<DuelGate />);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    // The settings the player last used for this game, so their duel is the game they know.
    const settings = normalizeSettings(load(`settings:${GAME_ID}`, {}), game);
    const result = await startPlay(game, settings);
    setStarting(false);
    if (result.status === 'update-required') setPhase({ name: 'update-required' });
    else setPhase({ name: 'playing', play: result.play, settings });
  };

  const makeDuel = async (play: Play, settings: GameSettings, outcome: GameOutcome) => {
    const saved = await finishPlay(play, { gameId: game.id, variant: variantKey(settings, game), score: outcome.score, seed: play.seed, moves: outcome.moves });
    const retry = () => void makeDuel(play, settings, outcome);
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

  const onGameOver = (settings: GameSettings, play: Play) => async (outcome: GameOutcome) => {
    if (finishing.current) return;
    finishing.current = true;
    setPhase({ name: 'sending' });
    try {
      await makeDuel(play, settings, outcome);
    } finally {
      finishing.current = false;
    }
  };

  return shell(
    <>
      {phase.name === 'intro' && (
        <div className="panel center">
          <p className="lead">Play your run first. Your friend then gets exactly the same circles and has to beat your score.</p>
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
        <GameScreen key={phase.play.seed} game={game} settings={phase.settings} seed={phase.play.seed} onGameOver={onGameOver(phase.settings, phase.play)} />
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
