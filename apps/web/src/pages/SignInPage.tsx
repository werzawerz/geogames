import { useState } from 'react';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@geogames/games';
import { SignInError, type SignInFailure } from '../platform/auth.ts';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { href } from '../router.ts';

const RETURN_KEY = 'geogames:return-to';

/** Remembers the page a player left for the sign-in page, to go back to it afterwards. */
export function rememberReturn() {
  try {
    if (!location.hash.startsWith('#/sign-in')) sessionStorage.setItem(RETURN_KEY, location.hash || '#/');
  } catch {
    // Without storage the player lands on their profile.
  }
}

function goBack() {
  let target: string | null = null;
  try {
    target = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // As above.
  }
  location.hash = target && !target.startsWith('#/sign-in') ? target : href({ page: 'profile' });
}

type Mode = 'log-in' | 'create';

const MESSAGES: Record<SignInFailure, Record<Mode, string>> = {
  'wrong-login': { 'log-in': 'That email and password don’t match an account.', create: 'That didn’t work. Please try again.' },
  'email-taken': { 'log-in': 'That email already has an account.', create: 'That email already has an account. Log in instead.' },
  'bad-input': {
    'log-in': 'Check the email and password.',
    create: `Use a valid email and a password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
  },
  offline: { 'log-in': 'We couldn’t reach the server. Please try again.', create: 'We couldn’t reach the server. Please try again.' },
};

/** "Log in" and "Create account", with an email and password. */
export function SignInPage() {
  const { account, player, logIn, createAccount } = usePlatform();
  const [mode, setMode] = useState<Mode>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.status === 'local') {
    return (
      <div className="page sign-in">
        <h1 className="page-title">Sign in</h1>
        <p className="muted">Accounts aren’t available in this version of the site. Your scores are kept in this browser.</p>
      </div>
    );
  }
  if (account.status === 'signed-in') {
    return (
      <div className="page sign-in">
        <h1 className="page-title">Signed in</h1>
        <p>
          You’re signed in as <strong>{account.email ?? player.name}</strong>. <a href={href({ page: 'profile' })}>Go to your profile</a>.
        </p>
      </div>
    );
  }

  const creating = mode === 'create';
  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="page sign-in">
      <h1 className="page-title">{creating ? 'Create an account' : 'Log in'}</h1>
      <p className="muted">
        {creating
          ? 'Keep your scores on every device and appear on the leaderboards. The games you’ve played so far come with you.'
          : 'Welcome back. The games you’ve played on this device move into your account.'}
      </p>
      <div className="mode-switch" role="group" aria-label="Sign-in mode">
        <button type="button" className="mode-option" aria-pressed={creating} onClick={() => switchTo('create')}>
          Create account
        </button>
        <button type="button" className="mode-option" aria-pressed={!creating} onClick={() => switchTo('log-in')}>
          Log in
        </button>
      </div>
      <form
        className="feedback-form sign-in-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await (creating ? createAccount : logIn)(email, password);
            goBack();
          } catch (failure) {
            const reason = failure instanceof SignInError ? failure.reason : 'offline';
            setError(MESSAGES[reason][mode]);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Email
          <input type="email" value={email} required autoComplete="email" maxLength={254} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            value={password}
            required
            minLength={creating ? MIN_PASSWORD_LENGTH : undefined}
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete={creating ? 'new-password' : 'current-password'}
            aria-describedby={creating ? 'password-note' : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {creating && (
          <p id="password-note" className="muted small">
            At least {MIN_PASSWORD_LENGTH} characters. There’s no password reset yet, so keep it somewhere safe.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? (creating ? 'Creating account…' : 'Logging in…') : creating ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
