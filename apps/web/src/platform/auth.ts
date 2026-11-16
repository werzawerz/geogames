import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { load, save } from './storage.ts';

/** Who the player is. 'local' is a build without a server, where signing in isn't available. */
export interface Account {
  status: 'local' | 'anonymous' | 'signed-in';
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Proves who the player is to the API, and signs in and out. */
export interface Auth {
  /** A best guess, without waiting for anything, for the first render. */
  initialAccount: Account;
  /**
   * Finishes a sign-in this page load is coming back from. Resolves with the
   * token of an anonymous player whose games should move into the account just
   * signed in to, if any.
   */
  ready(): Promise<{ mergeFrom: string | null }>;
  token(): Promise<string>;
  account(): Promise<Account>;
  /** Starts "Sign in with Google". Leaves the page (to Google and back) unless it fails. */
  signIn(): Promise<void>;
  /** Forgets the session in this browser; the next request starts a fresh anonymous player. */
  signOut(): Promise<void>;
}

/** What a sign-in redirect needs to remember across leaving the page. */
interface PendingSignIn {
  /** The hash route to return to: the redirect comes back to the page's plain URL. */
  route: string;
  /** 'link': adding Google to the anonymous player; 'sign-in': signing in to an existing account. */
  step: 'link' | 'sign-in';
  /** The anonymous player's token, when signing in to another account left it behind. */
  mergeFrom?: string;
  at: number;
}

const PENDING_KEY = 'geogames:sign-in';
const PENDING_MAX_AGE_MS = 15 * 60_000;

function savePending(pending: PendingSignIn) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without storage the player comes back to the home page.
  }
}

function takePending(): PendingSignIn | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const pending = raw ? (JSON.parse(raw) as PendingSignIn) : null;
    return pending && Date.now() - pending.at < PENDING_MAX_AGE_MS ? pending : null;
  } catch {
    return null;
  }
}

/** Puts the player back on the page they signed in from, dropping what the redirect added to the URL. */
function restoreRoute(route: string) {
  const target = location.pathname + (route || '#/');
  if (location.pathname + location.search + location.hash === target) return;
  history.replaceState(history.state, '', target);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

const errorCode = (error: AuthError) => (error as AuthError & { details?: { code?: string } }).details?.code ?? error.code;

export function toAccount(user: Pick<User, 'is_anonymous' | 'email' | 'user_metadata'> | null | undefined): Account {
  if (!user || user.is_anonymous) return { status: 'anonymous' };
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (...values: unknown[]) => values.find((v): v is string => typeof v === 'string' && v !== '');
  return {
    status: 'signed-in',
    email: user.email || undefined,
    displayName: text(meta.full_name, meta.name),
    avatarUrl: text(meta.avatar_url, meta.picture),
  };
}

/**
 * Supabase sign-in. A new player gets an anonymous account right away, kept in
 * this browser. "Sign in with Google" links Google to that same account, so its
 * games are kept. If that Google account already belongs to another player, this
 * browser signs in to that one instead and asks the API to move the anonymous
 * player's games into it.
 *
 * PKCE, not the implicit flow: the implicit flow returns tokens in the URL
 * fragment, which is where the hash router keeps its routes. With PKCE, Google
 * comes back with `?code=` on the page's plain URL; the library swaps it for a
 * session on load, and the route the player left from is put back.
 *
 * The library loads only here, as builds without an API don't need it.
 */
export function createSupabaseAuth(url: string, publishableKey: string): Auth {
  const redirectTo = () => location.origin + location.pathname;
  const google = () => ({ provider: 'google' as const, options: { redirectTo: redirectTo() } });
  const client: Promise<SupabaseClient> = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, publishableKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }),
  );

  let finishing: Promise<{ mergeFrom: string | null }> | null = null;
  const ready = () =>
    (finishing ??= client.then(async ({ auth }) => {
      // Exchanges a ?code= from a redirect, or reports the redirect's error.
      const { error } = await auth.initialize();
      const pending = takePending();
      if (!pending) return { mergeFrom: null };
      if (error && pending.step === 'link' && errorCode(error) === 'identity_already_exists') {
        // This Google account is another player's: sign in to it, taking this one's games along.
        const { session } = (await auth.getSession()).data;
        savePending({ route: pending.route, step: 'sign-in', mergeFrom: session?.user.is_anonymous ? session.access_token : undefined, at: Date.now() });
        const { error: signInError } = await auth.signInWithOAuth(google());
        if (!signInError) return new Promise<never>(() => {}); // on the way to Google
        takePending();
      }
      restoreRoute(pending.route);
      return { mergeFrom: !error && pending.step === 'sign-in' ? (pending.mergeFrom ?? null) : null };
    }));

  let signingIn: Promise<unknown> | null = null;
  const session = async () => {
    await ready();
    const { auth } = await client;
    // The library refreshes an expiring session here.
    let current = (await auth.getSession()).data.session;
    if (!current) {
      signingIn ??= auth.signInAnonymously().finally(() => {
        signingIn = null;
      });
      await signingIn;
      current = (await auth.getSession()).data.session;
    }
    if (!current) throw new Error('sign-in failed');
    return current;
  };

  return {
    initialAccount: (() => {
      // The session the library keeps, read directly so the first render is right.
      try {
        const key = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
        const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as { user?: User } | null;
        return toAccount(stored?.user);
      } catch {
        return { status: 'anonymous' };
      }
    })(),
    ready,
    async token() {
      return (await session()).access_token;
    },
    async account() {
      return toAccount((await session()).user);
    },
    async signIn() {
      const current = await session();
      if (!current.user.is_anonymous) return;
      const { auth } = await client;
      savePending({ route: location.hash, step: 'link', at: Date.now() });
      const { error } = await auth.linkIdentity(google());
      if (error) {
        takePending();
        throw error;
      }
    },
    async signOut() {
      await ready();
      const { auth } = await client;
      // Only this browser: other devices signed in to the account stay signed in.
      const { error } = await auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  };
}

/**
 * For `npm run dev:api`, which accepts these made-up tokens. A deployed API doesn't.
 * "Signing in" keeps the player id, as linking Google does.
 */
export function createDevAuth(): Auth {
  const id = () => {
    let current = load<string | null>('dev-user', null);
    if (!current) {
      current = crypto.randomUUID();
      save('dev-user', current);
    }
    return current;
  };
  const signedIn = () => load('dev-google', false);
  const account = (): Account =>
    signedIn() ? { status: 'signed-in', email: 'dev@example.com', displayName: 'Dev Player' } : { status: 'anonymous' };
  return {
    initialAccount: account(),
    ready: async () => ({ mergeFrom: null }),
    token: async () => `dev-${signedIn() ? 'google-' : ''}${id()}`,
    account: async () => account(),
    async signIn() {
      save('dev-google', true);
    },
    async signOut() {
      save('dev-user', crypto.randomUUID());
      save('dev-google', false);
    },
  };
}
