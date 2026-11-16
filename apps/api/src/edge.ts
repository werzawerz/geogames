// Supabase Edge Function entry point. `npm run build:api` bundles this file into
// supabase/functions/api/index.ts, which is what gets deployed.
import { createClient } from '@supabase/supabase-js';
import { createApp, parseDailyLimit } from './app.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

/** New projects have secret keys, older ones the service role key; both skip row level security. */
function serviceKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = secretKeys ? (JSON.parse(secretKeys) as Record<string, string>).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('no Supabase service key in the environment');
  return key;
}

const key = serviceKey();
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const origins = Deno.env.get('ALLOWED_ORIGINS');

const app = createApp({
  rpc: async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  },
  // Asks Supabase Auth, so a token is checked against the live account (a deleted
  // or signed-out one fails), and `is_anonymous` is the server's, not the browser's.
  verifyToken: async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, anonymous: data.user.is_anonymous === true };
  },
  deleteUser: async (id) => {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser: ${error.message}`);
  },
  // Off unless set: the game is free. Kept as a switch for a paid tier later.
  freePlaysPerDay: parseDailyLimit(Deno.env.get('FREE_PLAYS_PER_DAY')),
  // Already a secret of this project, so a daily challenge needs no extra setup.
  dailySecret: key,
  allowedOrigins: origins ? origins.split(',').map((o) => o.trim()) : '*',
});

Deno.serve(app.fetch);
