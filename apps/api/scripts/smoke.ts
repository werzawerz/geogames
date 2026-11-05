// Runs the built Edge Function in Deno (Supabase's runtime, fetched by npx) against
// a stand-in for Supabase's HTTP API backed by the real migrations, then plays a game.
// Needs `npm run build:api` first. Usage: npm run smoke -w @geogames/api
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_VERSION, arcadePools, createCircleArcade } from '@geogames/games';
import { createLocalDb } from '../src/local-db.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUPABASE_PORT = 54399;
const FUNCTION_PORT = 8000; // Deno.serve's default
const USER = '00000000-0000-4000-8000-000000000001';

const { rpc, addUser } = await createLocalDb();
await addUser(USER);

const supabase = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.apikey !== 'service-key') return reply(401, { message: 'no apikey' });
  const name = /^\/rest\/v1\/rpc\/(\w+)$/.exec(req.url ?? '')?.[1];
  if (name) {
    try {
      return reply(200, await rpc(name, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')));
    } catch (e) {
      return reply(400, { message: (e as Error).message });
    }
  }
  if (req.url?.startsWith('/auth/v1/user')) {
    return req.headers.authorization === 'Bearer good-token'
      ? reply(200, { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true })
      : reply(401, { message: 'invalid JWT' });
  }
  reply(404, { message: `unexpected ${req.url}` });
});
await new Promise<void>((resolve) => supabase.listen(SUPABASE_PORT, resolve));

const deno = spawn('npx', ['-y', 'deno', 'run', '--allow-all', '--no-check', join(ROOT, 'supabase', 'functions', 'api', 'index.ts')], {
  shell: true,
  env: {
    ...process.env,
    SUPABASE_URL: `http://localhost:${SUPABASE_PORT}`,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'service-key' }),
    FREE_PLAYS_PER_DAY: '2',
    ALLOWED_ORIGINS: 'https://example.github.io',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const api = `http://localhost:${FUNCTION_PORT}/api`;
const call = async (method: string, path: string, body?: unknown, token: string | null = 'good-token') => {
  const res = await fetch(api + path, {
    method,
    headers: { Origin: 'https://example.github.io', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
};
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    up = await fetch(`${api}/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 1000));
  }
  check('the function boots in Deno and reaches the database', up);
  if (!up) throw new Error('function did not start');

  const health = await call('GET', '/health', undefined, null);
  check('same data version as this checkout', health.json.datasetVersion === DATASET_VERSION, health.json);
  check('CORS allows the configured origin', health.headers.get('access-control-allow-origin') === 'https://example.github.io');

  check('a bad token is refused', (await call('GET', '/me', undefined, 'bad-token')).status === 401);
  const me = await call('GET', '/me');
  check('signs up on first use', me.status === 200 && me.json.player.id === USER, me.json);

  const session = await call('POST', '/sessions', { gameId: 'city-circle-arcade', settings: {}, datasetVersion: DATASET_VERSION });
  check('starts a session with a server seed', session.status === 201 && typeof session.json.seed === 'number', session.json);

  const game = createCircleArcade(await arcadePools());
  let state = game.start(session.json.seed);
  for (let i = 0; i < 3; i++) {
    for (const id of game.remaining(state.level)) state = game.guess(state, id).state;
    state = game.nextLevel(state);
  }
  while (state.status !== 'over') {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    state = game.skip(state);
  }
  const replayStart = performance.now();
  const finished = await call('POST', `/sessions/${session.json.sessionId}/finish`, { moves: state.moves });
  console.log(`     first replay in Deno, loading the data: ${(performance.now() - replayStart).toFixed(0)} ms wall time`);
  check('verifies the score by replaying', finished.status === 200 && finished.json.score === state.score, { finished: finished.json, expected: state.score });

  const board = await call('GET', '/leaderboards/city-circle-arcade/world', undefined, null);
  check('the score is on the public leaderboard', board.json.entries?.[0]?.score === state.score, board.json);

  await call('POST', '/sessions', { gameId: 'capitals', settings: {}, datasetVersion: DATASET_VERSION });
  const refused = await call('POST', '/sessions', { gameId: 'capitals', settings: {}, datasetVersion: DATASET_VERSION });
  check('the daily limit comes from the environment', refused.status === 402, refused.json);
} finally {
  // With a shell in between, the whole process tree has to go.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(deno.pid), '/T', '/F'], { stdio: 'ignore' });
  else deno.kill();
  supabase.close();
  supabase.closeAllConnections();
  process.exit();
}
