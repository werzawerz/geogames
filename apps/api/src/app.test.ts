import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATASET_VERSION,
  arcadePools,
  createCircleArcade,
  createHigherLowerGame,
  getGame,
  loadPool,
  normalizeSettings,
  type HigherLowerDefinition,
} from '@geogames/games';
import { createApp } from './app.ts';
import { createLocalDb } from './local-db.ts';

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const FREE_PLAYS = 3;

let local: Awaited<ReturnType<typeof createLocalDb>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  local = await createLocalDb();
  await local.addUser(ALICE);
  await local.addUser(BOB);
  app = createApp({
    rpc: local.rpc,
    verifyToken: async (token) => (token === 'alice' ? ALICE : token === 'bob' ? BOB : null),
    freePlaysPerDay: FREE_PLAYS,
    allowedOrigins: '*',
  });
});

beforeEach(async () => {
  await local.db.exec('delete from public.game_sessions; delete from public.subscriptions; delete from public.players;');
});

const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};

const start = (token: string, gameId = 'city-circle-arcade', settings = {}) =>
  call('POST', '/sessions', token, { gameId, settings, datasetVersion: DATASET_VERSION });

/** Plays an arcade game from the server's seed: finds everything, then skips until out of lives. */
async function playArcade(seed: number, levelsToClear: number) {
  const game = createCircleArcade(await arcadePools());
  let state = game.start(seed);
  for (let i = 0; i < levelsToClear; i++) {
    for (const id of game.remaining(state.level)) state = game.guess(state, id).state;
    state = game.nextLevel(state);
  }
  while (state.status !== 'over') {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    state = game.skip(state);
  }
  return state;
}

describe('players', () => {
  it('signs a player up on first use, with their allowance', async () => {
    const { status, json } = await call('GET', '/me', 'alice');
    expect(status).toBe(200);
    expect(json.player.id).toBe(ALICE);
    expect(json.player.name).toMatch(/^Explorer \d{4}$/);
    expect(json.allowance).toMatchObject({ plan: 'free', limit: FREE_PLAYS, used: 0 });
    expect(new Date(json.allowance.resetsAt).getTime()).toBeGreaterThan(Date.now());
    expect(json.bests).toEqual({});
    // Stays the same player on the next call.
    expect((await call('GET', '/me', 'alice')).json.player.name).toBe(json.player.name);
  });

  it('renames, trimming and capping the name, and refuses an empty one', async () => {
    await call('GET', '/me', 'alice');
    expect((await call('PATCH', '/me', 'alice', { name: '  ' + 'x'.repeat(40) })).json.name).toHaveLength(24);
    expect((await call('PATCH', '/me', 'alice', { name: '   ' })).status).toBe(400);
    expect((await call('GET', '/me', 'alice')).json.player.name).toBe('x'.repeat(24));
  });

  it('refuses requests without a valid token', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', 'mallory')).status).toBe(401);
    expect((await call('POST', '/sessions', undefined, {})).status).toBe(401);
  });
});

describe('game sessions', () => {
  it('picks the seed and spends a play', async () => {
    const { status, json } = await start('alice');
    expect(status).toBe(201);
    expect(json.seed).toEqual(expect.any(Number));
    expect(json.allowance.used).toBe(1);
  });

  it('enforces the daily limit, also under simultaneous requests', async () => {
    const results = await Promise.all(Array.from({ length: FREE_PLAYS + 4 }, () => start('alice')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(FREE_PLAYS);
    const refused = results.filter((r) => r.status === 402);
    expect(refused).toHaveLength(4);
    expect(refused[0]!.json).toMatchObject({ error: 'out-of-plays', allowance: { used: FREE_PLAYS, limit: FREE_PLAYS } });
    // Other players aren't affected.
    expect((await start('bob')).status).toBe(201);
  });

  it('gives subscribers unlimited plays until the subscription ends', async () => {
    await call('GET', '/me', 'alice');
    await local.db.query('insert into public.subscriptions (player_id) values ($1)', [ALICE]);
    for (let i = 0; i < FREE_PLAYS + 2; i++) expect((await start('alice')).status).toBe(201);
    expect((await call('GET', '/me', 'alice')).json.allowance).toMatchObject({ plan: 'premium', limit: null });
    await local.db.query(`update public.subscriptions set current_period_end = now() - interval '1 day'`);
    expect((await call('GET', '/me', 'alice')).json.allowance.plan).toBe('free');
    expect((await start('alice')).status).toBe(402);
  });

  it('refuses unknown games and clients on other data', async () => {
    expect((await start('alice', 'no-such-game')).status).toBe(400);
    const stale = await call('POST', '/sessions', 'alice', { gameId: 'capitals', settings: {}, datasetVersion: 'old' });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe('update-required');
  });

  it('computes the score by replaying the moves', async () => {
    const { json: session } = await start('alice');
    const played = await playArcade(session.seed, 2);
    expect(played.score).toBeGreaterThan(0);
    const { status, json } = await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: played.moves });
    expect(status).toBe(200);
    expect(json).toEqual({ score: played.score, isPersonalBest: true, personalBest: played.score });
    expect((await call('GET', '/me', 'alice')).json.bests).toEqual({ 'city-circle-arcade': { world: played.score } });
  });

  it('can not be cheated', async () => {
    const { json: session } = await start('alice');
    const played = await playArcade(session.seed, 1);
    const finish = (token: string, moves: unknown) => call('POST', `/sessions/${session.sessionId}/finish`, token, { moves });

    // A client can't state its score: only moves count.
    const claimed = await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: played.moves, score: 999_999 });
    expect(claimed.json.score).toBe(played.score);

    // Moves from another seed earn what they earn on this one.
    const { json: other } = await start('alice');
    const elsewhere = await playArcade((other.seed + 1) % 2 ** 32, 3);
    const stolen = await call('POST', `/sessions/${other.sessionId}/finish`, 'alice', { moves: elsewhere.moves });
    expect(stolen.json.score ?? 0).toBeLessThan(elsewhere.score);

    // Someone else's game, nonsense moves, and a game that isn't over are refused.
    const { json: third } = await start('alice');
    expect((await call('POST', `/sessions/${third.sessionId}/finish`, 'bob', { moves: [] })).status).toBe(404);
    expect((await call('POST', `/sessions/${third.sessionId}/finish`, 'alice', { moves: 'lots' })).status).toBe(400);
    expect((await call('POST', `/sessions/${third.sessionId}/finish`, 'alice', { moves: [] })).status).toBe(422);
    expect((await call('POST', '/sessions/not-a-uuid/finish', 'alice', { moves: [] })).status).toBe(404);

    // Finishing again keeps the first result, whatever the moves.
    expect((await finish('alice', [])).json.score).toBe(played.score);
  });

  it('refuses a game started on data that has been replaced since', async () => {
    const { json: session } = await start('alice');
    await local.db.exec(`update public.game_sessions set dataset_version = 'old'`);
    const played = await playArcade(session.seed, 0);
    const res = await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: played.moves });
    expect(res.status).toBe(409);
  });

  it('replays every kind of game', async () => {
    // Higher or lower, with a real pool: wrong on purpose after one right answer.
    const definition = getGame('higher-lower-population') as HigherLowerDefinition;
    const { json: session } = await start('alice', definition.id);
    const engine = createHigherLowerGame({ metric: definition.metric, pool: await loadPool(definition, normalizeSettings({}, definition)) });
    let state = engine.start(session.seed);
    while (state.status !== 'over') {
      const value = (item: { metrics: object }) => (item.metrics as Record<string, { value: number }>)[definition.metric]!.value;
      const higher = value(state.challenger) >= value(state.current);
      const guess = state.score === 0 ? (higher ? 'higher' : 'lower') : higher ? 'lower' : 'higher';
      state = engine.next(engine.guess(state, guess));
    }
    const res = await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: state.guesses });
    expect(res.json.score).toBe(state.score);
    expect(state.score).toBeGreaterThan(0);
  });
});

describe('leaderboards', () => {
  const finishGame = async (token: string, levels: number) => {
    const { json: session } = await start(token);
    const played = await playArcade(session.seed, levels);
    await call('POST', `/sessions/${session.sessionId}/finish`, token, { moves: played.moves });
    return played.score;
  };

  it("ranks each player's best game, publicly", async () => {
    await call('GET', '/me', 'alice');
    await call('PATCH', '/me', 'alice', { name: 'Alice' });
    await call('GET', '/me', 'bob');
    await call('PATCH', '/me', 'bob', { name: 'Bob' });
    const scoresA = [await finishGame('alice', 1), await finishGame('alice', 3)];
    const scoreB = await finishGame('bob', 2);

    const global = await call('GET', '/leaderboards/city-circle-arcade/world');
    expect(global.status).toBe(200);
    expect(global.json.entries.map((e: any) => e.playerName)).toEqual(
      Math.max(...scoresA) >= scoreB ? ['Alice', 'Bob'] : ['Bob', 'Alice'],
    );
    expect(global.json.entries.find((e: any) => e.playerName === 'Alice').score).toBe(Math.max(...scoresA));

    const personal = await call('GET', '/leaderboards/city-circle-arcade/world?scope=personal', 'alice');
    expect(personal.json.entries.map((e: any) => e.score)).toEqual([...scoresA].sort((a, b) => b - a));
    expect((await call('GET', '/leaderboards/city-circle-arcade/world?scope=personal')).status).toBe(401);
  });

  it('keeps settings apart', async () => {
    await finishGame('alice', 1);
    expect((await call('GET', '/leaderboards/city-circle-arcade/world-proper')).json.entries).toEqual([]);
    const { json: session } = await start('bob', 'city-circle-arcade', { cityData: 'proper' });
    const game = createCircleArcade(await arcadePools({ ...normalizeSettings({}, getGame('city-circle-arcade')!), cityData: 'proper' }));
    let state = game.start(session.seed);
    while (state.status !== 'over') {
      if (state.status === 'level-clear') state = game.nextLevel(state);
      state = game.skip(state);
    }
    const res = await call('POST', `/sessions/${session.sessionId}/finish`, 'bob', { moves: state.moves });
    expect(res.status).toBe(200);
  });
});

describe('database access', () => {
  it('locks browsers out of every table and function', async () => {
    const { rows: tables } = await local.db.query<{ rowsecurity: boolean; tablename: string }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(3);
    expect(tables.every((t) => t.rowsecurity)).toBe(true);

    const privileges = async (role: string) => {
      const { rows } = await local.db.query<{ n: number }>(
        `select count(*)::int as n from pg_proc p
         where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute')`,
        [role],
      );
      return rows[0]!.n;
    };
    expect(await privileges('anon')).toBe(0);
    expect(await privileges('authenticated')).toBe(0);
    expect(await privileges('service_role')).toBeGreaterThan(5);
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await local.db.query<{ allowed: boolean }>(`select has_table_privilege($1, 'public.game_sessions', 'select') as allowed`, [role]);
      expect(rows[0]!.allowed).toBe(false);
    }
  });

  it('answers the health check', async () => {
    const { status, json } = await call('GET', '/health');
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, datasetVersion: DATASET_VERSION });
  });
});
