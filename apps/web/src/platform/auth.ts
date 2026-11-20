import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { load, save } from './storage.ts';

/** Who the player is. 'local' is a build without a server, where signing in isn't available. */
export interface Account {
  status: 'local' | 'anonymous' | 'signed-in';
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Why logging in or creating an account didn't work, for the message the player sees. */
export type SignInFailure = 'wrong-login' | 'email-taken' | 'bad-input' | 'offline';

export class SignInError extends Error {
  readonly reason: SignInFailure;
  constructor(reason: SignInFailure) {
    super(reason);
    this.reason = reason;
  }
}

/** Proves who the player is to the API, and logs in and out. */
export interface Auth {
  /** A best guess, without waiting for anything, for the first render. */
  initialAccount: Account;
  /** Resolves once the session this browser kept is loaded. */
  ready(): Promise<void>;
  token(): Promise<string>;
  account(): Promise<Account>;
  /**
   * Signs in with an email and password, or rejects with a SignInError. Resolves
   * with the token of the anonymous player this browser had before, if the account
   * is another player: that player's games should move into it.
   */
  logIn(email: string, password: string): Promise<{ mergeFrom: string | null }>;
  /**
   * "Create account": `create` asks the API to give this anonymous player the email
   * and password (POST /me/account); then this browser signs in with them.
   */
  createAccount(email: string, password: string, create: () => Promise<void>): Promise<void>;
  /** Forgets the session in this browser; the next request starts a fresh anonymous player. */
  signOut(): Promise<void>;
}

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
 * this browser. "Create account" gives that same account an email and password
 * (through the API, see POST /me/account), so its games are kept. "Log in" signs
 * in to an account made before, on this device or another, and the anonymous
 * player's games move into it.
 *
 * The library loads only here, as builds without an API don't need it.
 */
export function createSupabaseAuth(url: string, publishableKey: string): Auth {
  const client: Promise<SupabaseClient> = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, publishableKey, { auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true } }),
  );

  let loading: Promise<void> | null = null;
  const ready = () =>
    (loading ??= client.then(async ({ auth }) => {
      await auth.initialize();
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
    async logIn(email, password) {
      await ready();
      const { auth } = await client;
      const before = (await auth.getSession()).data.session;
      const { data, error } = await auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new SignInError(failure(error));
      const other = before?.user.is_anonymous && before.user.id !== data.user.id;
      return { mergeFrom: other ? before.access_token : null };
    },
    async createAccount(email, password, create) {
      await create();
      // The same player, now with an email: no games to move.
      await this.logIn(email, password);
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

const failure = (error: AuthError): SignInFailure => {
  const code = (error as AuthError & { details?: { code?: string } }).details?.code ?? error.code;
  if (code === 'invalid_credentials' || code === 'email_not_confirmed' || error.status === 400) return 'wrong-login';
  return 'offline';
};

/**
 * For `npm run dev:api`, which accepts these made-up tokens. A deployed API doesn't.
 * Accounts are kept in this browser: an email, a password and the player id.
 * Creating one keeps the player id, as on the real server.
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
  const email = () => load<string | null>('dev-account', null);
  const account = (): Account => (email() ? { status: 'signed-in', email: email()! } : { status: 'anonymous' });
  const token = () => `dev-${email() ? 'account-' : ''}${id()}`;
  return {
    initialAccount: account(),
    ready: async () => {},
    token: async () => token(),
    account: async () => account(),
    async logIn(address, password) {
      const logins = load<Record<string, { id: string; password: string }>>('dev-logins', {});
      const login = logins[address.trim().toLowerCase()];
      if (!login || login.password !== password) throw new SignInError('wrong-login');
      const before = email() ? null : token();
      save('dev-user', login.id);
      save('dev-account', address.trim().toLowerCase());
      return { mergeFrom: before && login.id !== before.slice(4) ? before : null };
    },
    async createAccount(address, password, create) {
      await create();
      const logins = load<Record<string, { id: string; password: string }>>('dev-logins', {});
      logins[address.trim().toLowerCase()] = { id: id(), password };
      save('dev-logins', logins);
      save('dev-account', address.trim().toLowerCase());
    },
    async signOut() {
      save('dev-user', crypto.randomUUID());
      save('dev-account', null);
    },
  };
}
