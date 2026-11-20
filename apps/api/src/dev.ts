// The API on your machine, with no accounts or Docker: real Postgres in memory
// (data is gone on restart) and made-up sign-ins. Never deployed.
import { serve } from '@hono/node-server';
import { createApp, parseDailyLimit } from './app.ts';
import { createLocalDb } from './local-db.ts';

const PORT = Number(process.env.API_PORT) || 5321;
// dev-<uuid> is an anonymous player, dev-account-<uuid> the same player once it
// has an email and password (see createDevAuth in the web app).
const DEV_TOKEN = /^dev-(account-)?([0-9a-f-]{36})$/i;

const { rpc, addUser, deleteUser, createLogin } = await createLocalDb();

const app = createApp({
  rpc,
  verifyToken: async (token) => {
    const [, account, id] = DEV_TOKEN.exec(token) ?? [];
    if (!id) return null;
    await addUser(id);
    return { id, anonymous: !account };
  },
  deleteUser,
  createLogin,
  freePlaysPerDay: parseDailyLimit(process.env.FREE_PLAYS_PER_DAY),
  dailySecret: process.env.DAILY_SECRET ?? '',
  allowedOrigins: '*',
});

serve({ fetch: app.fetch, port: PORT }, () => console.log(`API on http://localhost:${PORT}/api`));
