import { rememberReturn } from '../pages/SignInPage.tsx';
import { href } from '../router.ts';

/** What an anonymous player sees instead of "make a duel": duels need an account. */
export function DuelGate({ extra }: { extra?: string }) {
  return (
    <div className="panel center duel-gate">
      <p className="lead">Duels need an account, so your friend knows who they're playing and your duels follow you to any device.</p>
      <div className="row">
        <a className="btn btn-primary btn-lg" href={`${href({ page: 'sign-in' })}/create`} onClick={rememberReturn}>
          Create account
        </a>
        <a className="btn" href={`${href({ page: 'sign-in' })}/log-in`} onClick={rememberReturn}>
          Log in
        </a>
      </div>
      {extra && <p className="muted small">{extra}</p>}
    </div>
  );
}

/** Shown where duels can't work at all: a build without the server. */
export function DuelsNeedServer() {
  return (
    <div className="panel center">
      <p className="lead">Duels need the GeoGames server.</p>
      <a className="btn" href={href({ page: 'home' })}>
        Back to the games
      </a>
    </div>
  );
}
