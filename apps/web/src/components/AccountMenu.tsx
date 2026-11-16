import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePlatform, type Account } from '../platform/PlatformProvider.tsx';
import { href } from '../router.ts';

/** Google's "G" mark, as in their branding guidelines. */
export function GoogleG() {
  return (
    <svg className="google-g" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join('') || '?';

/** A round profile picture, or the player's initials when there is none or it can't load. */
export function Avatar({ account, name }: { account: Account; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [account.avatarUrl]);
  if (account.avatarUrl && !failed) {
    return <img className="avatar" src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return (
    <span className="avatar avatar-initials" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** "Sign in with Google" button; "Sign in" on phones (see the CSS). */
export function SignInButton({ className = '' }: { className?: string }) {
  const { signIn } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`google-btn ${className}`}
        aria-label="Sign in with Google"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await signIn();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <GoogleG />
        <span className="g-long">{busy ? 'Signing in…' : 'Sign in with Google'}</span>
        <span className="g-short" aria-hidden="true">
          {busy ? 'Signing in…' : 'Sign in'}
        </span>
      </button>
      {failed && (
        <span className="muted small" role="alert">
          Sign-in didn’t start. Try again.
        </span>
      )}
    </>
  );
}

/** The right-hand end of the header: depends on who is playing. */
export function AccountMenu() {
  const { account, player, signOut } = usePlatform();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  if (account.status === 'local') return <span className="muted player-name">{player.name}</span>;
  if (account.status === 'anonymous') return <SignInButton />;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
      e.preventDefault();
      const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };

  return (
    <div className="account-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu-list"
        aria-label={`Account menu for ${player.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar account={account} name={player.name} />
        <span className="player-name">{player.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <div id="account-menu-list" className={`account-list ${open ? 'open' : ''}`} role="menu" aria-label="Account">
        <a role="menuitem" className="account-item" href={href({ page: 'profile' })} onClick={() => setOpen(false)}>
          Profile
        </a>
        <button
          type="button"
          role="menuitem"
          className="account-item"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signOut();
              setOpen(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
