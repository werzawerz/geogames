import { useState } from 'react';
import { canDuel, duelThings, type GameDefinition, type GameSettings } from '@geogames/games';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { signInThenGoTo } from '../pages/SignInPage.tsx';
import { href } from '../router.ts';

/**
 * "Challenge a friend" under a finished run of any game that can be duelled, arcade or
 * daily. A run saved on the server becomes a duel of that very run: the friend gets the
 * same puzzles and has to beat this score. Without an account the player signs in first
 * and comes back to make it (`#/duels/new/<session-id>`). A run the server doesn't have
 * can't be checked, so the button starts a new duel of the game instead.
 */
export function ChallengeFriend({
  game,
  settings,
  sessionId,
  saved,
  daily = false,
}: {
  game: GameDefinition;
  settings: GameSettings;
  /** The run's server session; null when it has none. */
  sessionId: string | null;
  /** Undefined while the result is still on its way to the server. */
  saved: boolean | undefined;
  daily?: boolean;
}) {
  const { duels, account } = usePlatform();
  const [state, setState] = useState<'idle' | 'making' | 'failed'>('idle');
  // A build without the server has no duels at all, so no button that leads nowhere.
  if (!duels || account.status === 'local' || !canDuel(game, settings)) return null;
  const label = `⚔️ Challenge a friend to ${daily ? "today's" : 'these'} ${duelThings(game)}`;

  if (saved === false || (saved && !sessionId)) {
    return (
      <div className="duel-challenge">
        <a className="btn" href={href({ page: 'duel-new', gameId: game.id })}>
          ⚔️ Challenge a friend at {game.title}
        </a>
        <p className="muted small">This run isn't saved online, so the duel starts with a new run.</p>
      </div>
    );
  }

  const challenge = async () => {
    if (!sessionId) return;
    if (account.status !== 'signed-in') return signInThenGoTo(href({ page: 'duel-new', sessionId }));
    setState('making');
    try {
      location.hash = href({ page: 'duel', code: await duels.create(sessionId) });
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="duel-challenge">
      <button className="btn" disabled={saved === undefined || state === 'making'} onClick={challenge}>
        {label}
      </button>
      {account.status !== 'signed-in' && <p className="muted small">Duels need a free account. Your run is kept while you make one.</p>}
      {state === 'failed' && (
        <p className="muted small" role="alert">
          We couldn't make the duel. Please try again.
        </p>
      )}
    </div>
  );
}
