import { load, save } from './storage.ts';

/** Proves who the player is to the API. */
export interface Auth {
  token(): Promise<string>;
}

/**
 * Supabase sign-in: a new player gets an anonymous account right away, kept in
 * this browser; real sign-in can upgrade it later. The library loads only here,
 * as builds without an API don't need it.
 */
export function createSupabaseAuth(url: string, publishableKey: string): Auth {
  const client = import('@supabase/supabase-js').then(({ createClient }) => createClient(url, publishableKey));
  let signingIn: Promise<unknown> | null = null;
  return {
    async token() {
      const { auth } = await client;
      // The library refreshes an expiring session here.
      let { session } = (await auth.getSession()).data;
      if (!session) {
        signingIn ??= auth.signInAnonymously().finally(() => {
          signingIn = null;
        });
        await signingIn;
        session = (await auth.getSession()).data.session;
      }
      if (!session) throw new Error('sign-in failed');
      return session.access_token;
    },
  };
}

/** For `npm run dev:api`, which accepts these made-up tokens. A deployed API doesn't. */
export function createDevAuth(): Auth {
  return {
    async token() {
      let id = load<string | null>('dev-user', null);
      if (!id) {
        id = crypto.randomUUID();
        save('dev-user', id);
      }
      return `dev-${id}`;
    },
  };
}
