import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePlatform, type Account } from '../platform/PlatformProvider.tsx';
import { rememberReturn } from '../pages/SignInPage.tsx';
import { href } from '../router.ts';

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

/** The way to the sign-in page, back to this page afterwards. */
export function SignInButton({ className = '' }: { className?: string }) {
  return (
    <a className={`btn sign-in-btn ${className}`} href={href({ page: 'sign-in' })} onClick={rememberReturn}>
      Sign in
    </a>
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
    const close = () => setOpen(false);
    addEventListener('hashchange', close);
    return () => removeEventListener('hashchange', close);
  }, []);

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
