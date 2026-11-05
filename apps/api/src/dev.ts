// The API on your machine, with no accounts or Docker: real Postgres in memory
// (data is gone on restart) and made-up sign-ins. Never deployed.
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createLocalDb } from './local-db.ts';

const PORT = Number(process.env.API_PORT) || 5321;
const DEV_TOKEN = /^dev-([0-9a-f-]{36})$/i;

const { rpc, addUser } = await createLocalDb();

const app = createApp({
  rpc,
  verifyToken: async (token) => {
    const id = DEV_TOKEN.exec(token)?.[1];
    if (!id) return null;
    await addUser(id);
    return id;
  },
  freePlaysPerDay: Number(process.env.FREE_PLAYS_PER_DAY) || 5,
  allowedOrigins: '*',
});

serve({ fetch: app.fetch, port: PORT }, () => console.log(`API on http://localhost:${PORT}/api`));
