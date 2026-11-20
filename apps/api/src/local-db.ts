import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Rpc } from './app.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');

/** What Supabase provides and the migrations expect. */
const SUPABASE_STANDINS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
`;

/**
 * Real Postgres inside this process (no Docker), running the real migrations:
 * for tests and `npm run dev:api`, in place of a Supabase project.
 */
export async function createLocalDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  for (const file of (await readdir(MIGRATIONS)).sort()) {
    await db.exec(await readFile(join(MIGRATIONS, file), 'utf8'));
  }
  /** Calls a function by named parameters, like Supabase's REST layer does. */
  const rpc: Rpc = async (name, args) => {
    const names = Object.keys(args);
    const params = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
    const { rows } = await db.query<{ result: unknown }>(
      `select public.${name}(${params}) as result`,
      names.map((n) => args[n]),
    );
    return rows[0]?.result ?? null;
  };
  const addUser = (id: string) => db.query('insert into auth.users (id) values ($1) on conflict do nothing', [id]);
  const deleteUser = async (id: string) => {
    await db.query('delete from auth.users where id = $1', [id]);
  };
  /** Records the email only: the dev web app checks passwords itself (see createDevAuth). */
  const createLogin = async (id: string, email: string) => {
    await db.query('update auth.users set email = $2 where id = $1', [id, email]);
  };
  return { db, rpc, addUser, deleteUser, createLogin };
}
