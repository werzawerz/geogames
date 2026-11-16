import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DATASET_VERSION,
  arcadePools,
  createCircleArcade,
  createHigherLowerGame,
  dailyDate,
  dailySeed,
  dailyVariant,
  getGame,
  loadPool,
  normalizeSettings,
  type HigherLowerDefinition,
} from '@geogames/games';
import { createApp, DEFAULT_LIMITS, parseDailyLimit, type Caller, type Limits } from './app.ts';
import { createLocalDb } from './local-db.ts';

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const ANON = '00000000-0000-4000-8000-0000000000a0';
const ANON2 = '00000000-0000-4000-8000-0000000000a2';

/** alice and bob signed in with Google; anon and anon2 anonymous; alice-before is Alice before she linked Google. */
const TOKENS: Record<string, Caller> = {
  alice: { id: ALICE, anonymous: false },
  bob: { id: BOB, anonymous: false },
  anon: { id: ANON, anonymous: true },
  anon2: { id: ANON2, anonymous: true },
  'alice-before': { id: ALICE, anonymous: true },
};

let local: Awaited<ReturnType<typeof createLocalDb>>;
let app: ReturnType<typeof createApp>;
let deleted: string[] = [];

const makeApp = (options: { freePlaysPerDay?: number | null; limits?: Partial<Limits> } = {}) =>
  createApp({
    rpc: local.rpc,
    verifyToken: async (token) => TOKENS[token] ?? null,
    deleteUser: async (id) => {
      deleted.push(id);
      await local.deleteUser(id);
    },
    dailySecret: 'test-secret',
    allowedOrigins: '*',
    ...options,
  });

beforeAll(async () => {
  local = await createLocalDb();
});

beforeEach(async () => {
  await local.db.exec('delete from public.feedback; delete from public.game_sessions; delete from public.players; delete from auth.users;');
  for (const { id } of Object.values(TOKENS)) await local.addUser(id);
  deleted = [];
  app = makeApp();
});

const call = async (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
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
  it('signs a player up on first use', async () => {
    const { status, json } = await call('GET', '/me', 'alice');
    expect(status).toBe(200);
    expect(json).toEqual({ player: { id: ALICE, name: expect.stringMatching(/^Explorer \d{4}$/) }, bests: {} });
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
  it('picks the seed', async () => {
    const { status, json } = await start('alice');
    expect(status).toBe(201);
    expect(json).toEqual({ sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/), seed: expect.any(Number) });
  });

  it('has no play limit: anonymous and signed-in players play as often as they like', async () => {
    for (const token of ['anon', 'alice']) {
      for (let i = 0; i < 25; i++) expect((await start(token)).status).toBe(201);
    }
  });

  it('can switch a daily limit back on from the configuration, also under simultaneous requests', async () => {
    expect(parseDailyLimit(undefined)).toBeNull();
    expect(parseDailyLimit('')).toBeNull();
    expect(parseDailyLimit('0')).toBeNull();
    expect(parseDailyLimit('abc')).toBeNull();
    expect(parseDailyLimit('3')).toBe(3);
    app = makeApp({ freePlaysPerDay: 3 });
    const results = await Promise.all(Array.from({ length: 7 }, () => start('alice')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429).map((r) => r.json)).toEqual(Array(4).fill({ error: 'rate-limited' }));
    // Other players and the daily challenge aren't affected.
    expect((await start('bob')).status).toBe(201);
    expect((await call('POST', '/daily/border-route/start', 'alice', { datasetVersion: DATASET_VERSION })).status).toBe(200);
  });

  it('caps how many games one player can start a minute and an hour, also under simultaneous requests', async () => {
    app = makeApp({ limits: { startsPerMinute: 4 } });
    const results = await Promise.all(Array.from({ length: 6 }, () => start('anon')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(4);
    expect(results.filter((r) => r.status === 429)).toHaveLength(2);
    expect((await start('bob')).status).toBe(201);
    // A minute later it's fine again, up to the hourly cap.
    await local.db.exec(`update public.game_sessions set started_at = now() - interval '2 minutes'`);
    expect((await start('anon')).status).toBe(201);
    app = makeApp({ limits: { startsPerMinute: 100, startsPerHour: 5 } });
    expect((await start('anon')).status).toBe(429);
    expect(DEFAULT_LIMITS.startsPerMinute).toBeGreaterThanOrEqual(20);
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

describe('daily challenge', () => {
  const startDaily = (token: string, gameId = 'city-circle-arcade', datasetVersion = DATASET_VERSION) =>
    call('POST', `/daily/${gameId}/start`, token, { datasetVersion });

  it('gives everyone the same run, different per game and with a seed nobody can work out', async () => {
    const a = await startDaily('alice');
    const b = await startDaily('bob');
    expect(a.status).toBe(200);
    expect(a.json.date).toBe(dailyDate());
    expect(a.json.seed).toBe(b.json.seed);
    expect(a.json.sessionId).not.toBe(b.json.sessionId);
    expect((await startDaily('alice', 'border-route')).json.seed).not.toBe(a.json.seed);
    expect(a.json.seed).toBe(await dailySeed('city-circle-arcade', dailyDate(), 'test-secret'));
    expect(a.json.seed).not.toBe(await dailySeed('city-circle-arcade', dailyDate()));
  });

  it('allows one try: reopening returns the same run, and a finished one its score', async () => {
    const first = await startDaily('alice');
    const again = await startDaily('alice');
    expect(again.json).toEqual(first.json);
    expect(first.json.finishedScore).toBeNull();

    const played = await playArcade(first.json.seed, 2);
    const finished = await call('POST', `/sessions/${first.json.sessionId}/finish`, 'alice', { moves: played.moves });
    expect(finished.json.score).toBe(played.score);

    const after = await startDaily('alice');
    expect(after.json).toMatchObject({ sessionId: first.json.sessionId, finishedScore: played.score });
    // Simultaneous first calls can't open two runs either.
    const both = await Promise.all([startDaily('bob'), startDaily('bob')]);
    expect(both[0]!.json.sessionId).toBe(both[1]!.json.sessionId);
  });

  it('has a leaderboard of its own for the day', async () => {
    const { json: session } = await startDaily('alice');
    const played = await playArcade(session.seed, 1);
    await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: played.moves });
    const board = await call('GET', `/leaderboards/city-circle-arcade/${dailyVariant(dailyDate())}`);
    expect(board.json.entries.map((e: any) => e.score)).toEqual([played.score]);
    expect((await call('GET', '/leaderboards/city-circle-arcade/world')).json.entries).toEqual([]);
    expect((await call('GET', '/me', 'alice')).json.bests['city-circle-arcade']).toEqual({ [dailyVariant(dailyDate())]: played.score });
  });

  it('refuses other games and clients on other data', async () => {
    expect((await startDaily('alice', 'capitals')).status).toBe(404);
    expect((await startDaily('alice', 'city-circle-arcade', 'old')).status).toBe(409);
    expect((await call('POST', '/daily/border-route/start')).status).toBe(401);
  });

  it('starts over a run left on data that has been replaced since', async () => {
    const first = await startDaily('alice');
    await local.db.exec(`update public.game_sessions set dataset_version = 'old', seed = 1`);
    const reopened = await startDaily('alice');
    expect(reopened.json.seed).toBe(first.json.seed);
    const { rows } = await local.db.query<{ dataset_version: string }>('select dataset_version from public.game_sessions');
    expect(rows).toEqual([{ dataset_version: DATASET_VERSION }]);
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

describe('accounts', () => {
  const finishGame = async (token: string, levels = 2) => {
    const { json: session } = await start(token);
    const played = await playArcade(session.seed, levels);
    await call('POST', `/sessions/${session.sessionId}/finish`, token, { moves: played.moves });
    return played.score;
  };
  const board = async () => (await call('GET', '/leaderboards/city-circle-arcade/world')).json.entries.map((e: any) => e.playerName);

  it('lists only signed-in players on public leaderboards; anonymous players keep their personal bests', async () => {
    await call('PATCH', '/me', 'anon', { name: 'Anon' });
    await call('PATCH', '/me', 'bob', { name: 'Bob' });
    const anonScore = await finishGame('anon');
    await finishGame('bob');
    expect(await board()).toEqual(['Bob']);
    const personal = await call('GET', '/leaderboards/city-circle-arcade/world?scope=personal', 'anon');
    expect(personal.json.entries.map((e: any) => e.score)).toEqual([anonScore]);
    expect((await call('GET', '/me', 'anon')).json.bests).toEqual({ 'city-circle-arcade': { world: anonScore } });
  });

  it('puts a player on the boards, with their earlier games, once they link Google; an old anonymous token never takes them off', async () => {
    await call('PATCH', '/me', 'alice-before', { name: 'Alice' });
    await finishGame('alice-before');
    expect(await board()).toEqual([]);
    // After linking, Supabase issues tokens without is_anonymous for the same user id.
    await call('GET', '/me', 'alice');
    expect(await board()).toEqual(['Alice']);
    await call('GET', '/me', 'alice-before');
    expect(await board()).toEqual(['Alice']);
  });

  it('deletes a player: games, feedback and the sign-in account', async () => {
    await finishGame('alice');
    await call('POST', '/feedback', 'alice', { message: 'Lovely game' });
    await finishGame('bob');
    const res = await call('DELETE', '/me', 'alice');
    expect(res).toEqual({ status: 200, json: { deleted: true } });
    expect(deleted).toEqual([ALICE]);
    const count = async (table: string, column: string) =>
      (await local.db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${column} = $1`, [ALICE])).rows[0]!.n;
    expect(await count('public.players', 'id')).toBe(0);
    expect(await count('public.game_sessions', 'player_id')).toBe(0);
    expect(await count('public.feedback', 'player_id')).toBe(0);
    expect(await count('auth.users', 'id')).toBe(0);
    // Others keep theirs.
    expect((await call('GET', '/leaderboards/city-circle-arcade/world')).json.entries).toHaveLength(1);
    expect((await call('DELETE', '/me')).status).toBe(401);
  });

  it("moves an anonymous player's games into the account they signed in to, given both tokens", async () => {
    await call('PATCH', '/me', 'bob', { name: 'Bob' });
    const before = await finishGame('anon', 1);
    const daily = (await call('POST', '/daily/border-route/start', 'anon', { datasetVersion: DATASET_VERSION })).json;
    // Bob played today's challenge too: his run is the one kept.
    const bobsDaily = (await call('POST', '/daily/border-route/start', 'bob', { datasetVersion: DATASET_VERSION })).json;
    const merged = await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' });
    expect(merged).toEqual({ status: 200, json: { moved: 1 } });
    expect(deleted).toEqual([ANON]);
    expect((await call('GET', '/me', 'bob')).json.bests).toEqual({ 'city-circle-arcade': { world: before } });
    expect(await board()).toEqual(before > 0 ? ['Bob'] : []);
    const again = (await call('POST', '/daily/border-route/start', 'bob', { datasetVersion: DATASET_VERSION })).json;
    expect(again.sessionId).toBe(bobsDaily.sessionId);
    expect(daily.sessionId).not.toBe(bobsDaily.sessionId);
  });

  it('refuses merges that would take over someone else', async () => {
    await call('GET', '/me', 'bob');
    await call('GET', '/me', 'alice');
    await call('GET', '/me', 'anon');
    // Only into a signed-in account, only from an anonymous one, only with a valid token.
    expect((await call('POST', '/me/merge', 'anon2', { anonymousToken: 'anon' })).status).toBe(403);
    expect((await call('POST', '/me/merge', 'bob', { anonymousToken: 'alice' })).status).toBe(403);
    expect((await call('POST', '/me/merge', 'bob', { anonymousToken: 'forged' })).status).toBe(401);
    expect((await call('POST', '/me/merge', 'bob', {})).status).toBe(401);
    expect(deleted).toEqual([]);
  });
});

describe('display names', () => {
  const rename = (name: string) => call('PATCH', '/me', 'alice', { name });

  it.each(['Fuck you', 'sh1thead', 'F U C K', 'f.u.c.k', 'FuUuCk', 'B!tch', 'nigg3r', 'Big Dick', 'c0ck', 'Ass', 'Hitler fan', 'Fück', '5lut'])(
    'refuses %s',
    async (name) => {
      expect(await rename(name)).toEqual({ status: 422, json: { error: 'name-not-allowed' } });
    },
  );

  it.each(['Scunthorpe', 'Dickens', 'Niger Delta', 'Essex Explorer', 'Hiroshi Tanaka', 'Pornic', 'Cockburnspath', 'Assisi', 'Explorer 1234', 'Zoë', 'Therapist'])(
    'accepts %s',
    async (name) => {
      expect(await rename(name)).toEqual({ status: 200, json: { name } });
    },
  );

  it('keeps the old name when a new one is refused', async () => {
    await rename('Alice');
    await rename('shithead');
    expect((await call('GET', '/me', 'alice')).json.player.name).toBe('Alice');
  });
});

describe('finishing games', () => {
  it('caps how many games one player can finish a minute and an hour; a capped game can be sent again later', async () => {
    app = makeApp({ limits: { finishesPerMinute: 2 } });
    const sessions: { sessionId: string; seed: number }[] = [];
    for (let i = 0; i < 3; i++) sessions.push((await start('anon')).json);
    const send = async (s: { sessionId: string; seed: number }, token = 'anon') =>
      call('POST', `/sessions/${s.sessionId}/finish`, token, { moves: (await playArcade(s.seed, 0)).moves });
    expect((await send(sessions[0]!)).status).toBe(200);
    expect((await send(sessions[1]!)).status).toBe(200);
    // Sending a finished one again doesn't count.
    expect((await send(sessions[0]!)).status).toBe(200);
    expect(await send(sessions[2]!)).toEqual({ status: 429, json: { error: 'rate-limited' } });
    // Other players aren't held up.
    expect((await send((await start('bob')).json, 'bob')).status).toBe(200);
    await local.db.exec(`update public.game_sessions set finished_at = now() - interval '2 minutes' where status = 'finished'`);
    expect((await send(sessions[2]!)).status).toBe(200);
    app = makeApp({ limits: { finishesPerHour: 3 } });
    expect((await send((await start('anon')).json)).status).toBe(429);
  });
});

describe('feedback', () => {
  const send = (token: string | undefined, body: unknown, ip = '203.0.113.9') =>
    call('POST', '/feedback', token, body, { 'X-Forwarded-For': `${ip}, 10.0.0.1` });
  const stored = async () =>
    (
      await local.db.query<{ player_id: string; message: string; email: string | null; page: string | null; ip_hash: string | null }>(
        'select player_id, message, email, page, ip_hash from public.feedback order by created_at',
      )
    ).rows;

  it('stores a message with an optional email and page, and a hashed IP address', async () => {
    const first = await send('anon', { message: '  The flags quiz needs Kosovo  ', email: 'me@example.com', page: '#/play/flags' });
    expect(first).toEqual({ status: 201, json: { ok: true } });
    expect((await send('alice', { message: 'Hello' })).status).toBe(201);
    const rows = await stored();
    expect(rows).toEqual([
      { player_id: ANON, message: 'The flags quiz needs Kosovo', email: 'me@example.com', page: '#/play/flags', ip_hash: expect.stringMatching(/^[0-9a-f]{32}$/) },
      { player_id: ALICE, message: 'Hello', email: null, page: null, ip_hash: rows[0]!.ip_hash },
    ]);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');
  });

  it('refuses bad input and callers without a token', async () => {
    expect((await send(undefined, { message: 'hi' })).status).toBe(401);
    const bad = [
      {},
      { message: '   ' },
      { message: 'x'.repeat(2001) },
      { message: 42 },
      { message: 'hi', email: 'not-an-email' },
      { message: 'hi', email: 5 },
      { message: 'hi', page: 'x'.repeat(201) },
    ];
    for (const body of bad) expect((await send('anon', body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect((await send('anon', { message: 'x'.repeat(2000) })).status).toBe(201);
  });

  it('allows 5 messages an hour per player, and 20 per IP address', async () => {
    for (let i = 0; i < 5; i++) expect((await send('anon', { message: `m${i}` }, `198.51.100.${i}`)).status).toBe(201);
    expect(await send('anon', { message: 'one more' }, '198.51.100.99')).toEqual({ status: 429, json: { error: 'rate-limited' } });
    expect((await send('bob', { message: 'mine' })).status).toBe(201);
    await local.db.exec(`update public.feedback set created_at = now() - interval '2 hours'`);
    expect((await send('anon', { message: 'later' })).status).toBe(201);
    expect(DEFAULT_LIMITS).toMatchObject({ feedbackPerPlayerHour: 5, feedbackPerIpHour: 20 });

    // Many fresh anonymous players from one address.
    await local.db.exec('delete from public.feedback');
    app = makeApp({ limits: { feedbackPerIpHour: 3 } });
    expect((await send('anon', { message: 'a' })).status).toBe(201);
    expect((await send('anon2', { message: 'b' })).status).toBe(201);
    expect((await send('bob', { message: 'c' })).status).toBe(201);
    expect((await send('alice', { message: 'd' })).status).toBe(429);
    expect((await send('alice', { message: 'd' }, '192.0.2.1')).status).toBe(201);
  });
});
