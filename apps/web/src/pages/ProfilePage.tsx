import { useEffect, useRef, useState } from 'react';
import { GAMES } from '@geogames/games';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import { Avatar, SignInButton } from '../components/AccountMenu.tsx';
import { href } from '../router.ts';

const MAX_NAME_LENGTH = 24;

export function ProfilePage() {
  const { account } = usePlatform();
  return (
    <div className="page profile">
      <h1 className="page-title">Profile</h1>
      <NameSection />
      {account.status !== 'local' && <AccountSection />}
      <BestsSection />
      {account.status === 'signed-in' && <SignOutSection />}
      {account.status !== 'local' && <DeleteSection />}
    </div>
  );
}

function NameSection() {
  const { player, renamePlayer, account } = usePlatform();
  const [value, setValue] = useState(player.name);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(player.name), [player.name]);

  const save = async () => {
    const name = value.trim();
    if (!name || name === player.name) {
      setValue(player.name);
      setNote(null);
      return;
    }
    setBusy(true);
    const result = await renamePlayer(name);
    setBusy(false);
    if (result === 'rejected') setNote({ kind: 'error', text: 'That name isn’t allowed. Please pick another.' });
    else if (result === 'offline') setNote({ kind: 'error', text: 'You’re offline. The new name is kept here and will be sent next time.' });
    else setNote({ kind: 'ok', text: 'Name saved.' });
  };

  return (
    <section className="panel" aria-labelledby="profile-name">
      <h2 id="profile-name" className="section-title">
        Player name
      </h2>
      <form
        className="profile-name-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="name-field">
          Name on leaderboards
          <input
            value={value}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            aria-describedby={note ? 'profile-name-note' : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setNote(null);
            }}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save name
        </button>
      </form>
      {note && (
        <p id="profile-name-note" className={note.kind === 'error' ? 'form-error' : 'muted'} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
      {account.status === 'signed-in' && <p className="muted small">Only this name is shown publicly. Your email never is.</p>}
    </section>
  );
}

function AccountSection() {
  const { account, player } = usePlatform();
  return (
    <section className="panel" aria-labelledby="profile-account">
      <h2 id="profile-account" className="section-title">
        Account
      </h2>
      {account.status === 'signed-in' ? (
        <div className="profile-account">
          <Avatar account={account} name={player.name} />
          <p>
            Signed in as <strong>{account.email ?? player.name}</strong>. Your scores follow you to any device you sign in on, and they appear
            on the public leaderboards.
          </p>
        </div>
      ) : (
        <>
          <p>You’re playing anonymously. Your scores are kept in this browser.</p>
          <p className="muted">
            Create an account with your email to keep your scores across devices and to appear on the public leaderboards under your player name.
            The games you have played so far come with you.
          </p>
          <p>
            <SignInButton />
          </p>
        </>
      )}
    </section>
  );
}

function BestsSection() {
  const { scores } = usePlatform();
  const [bests, setBests] = useState<Record<string, number> | null>(null);
  const games = GAMES.filter((g) => g.status === 'live');

  useEffect(() => {
    let cancelled = false;
    Promise.all(games.map(async (g) => [g.id, await scores.personalBest(g.id)] as const)).then((rows) => {
      if (!cancelled) setBests(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores]);

  return (
    <section className="panel" aria-labelledby="profile-bests">
      <h2 id="profile-bests" className="section-title">
        Your best scores
      </h2>
      {bests === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="bests">
          {games.map((g) => (
            <li key={g.id}>
              <a href={href({ page: 'scores', gameId: g.id })}>{g.title}</a>
              <span className={bests[g.id] ? 'pts' : 'muted'}>{bests[g.id] ? bests[g.id] : 'Not played yet'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignOutSection() {
  const { signOut } = usePlatform();
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel" aria-labelledby="profile-signout">
      <h2 id="profile-signout" className="section-title">
        Sign out
      </h2>
      <p className="muted">You can keep playing as a new anonymous player. Sign in again any time to get your scores back.</p>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signOut();
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign out
      </button>
    </section>
  );
}

function DeleteSection() {
  const { deleteAccount } = usePlatform();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    dialogRef.current?.close();
    setTyped('');
    setError(null);
    openerRef.current?.focus();
  };

  return (
    <section className="panel danger-zone" aria-labelledby="profile-delete">
      <h2 id="profile-delete" className="section-title">
        Delete my account
      </h2>
      <p className="muted">Permanently removes you from GeoGames. This can’t be undone.</p>
      <button ref={openerRef} type="button" className="btn btn-danger" onClick={() => dialogRef.current?.showModal()}>
        Delete my account
      </button>
      <dialog ref={dialogRef} className="dialog" aria-labelledby="delete-title" onClose={() => setTyped('')}>
        <form
          method="dialog"
          onSubmit={async (e) => {
            e.preventDefault();
            if (typed !== 'DELETE') return;
            setBusy(true);
            setError(null);
            try {
              await deleteAccount();
              dialogRef.current?.close();
              location.hash = href({ page: 'home' });
            } catch {
              setError('We couldn’t delete the account just now. Please try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 id="delete-title">Delete your account?</h2>
          <p>This permanently deletes:</p>
          <ul>
            <li>your player and player name,</li>
            <li>all your games, scores and daily results,</li>
            <li>any feedback you sent,</li>
            <li>your sign-in account and its email address.</li>
          </ul>
          <p>You can keep playing afterwards, as a new anonymous player.</p>
          <label className="name-field">
            <span>
              Type <strong>DELETE</strong> to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="row dialog-actions">
            <button type="button" className="btn" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={typed !== 'DELETE' || busy}>
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
