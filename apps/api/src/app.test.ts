import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import {
  DATASET_VERSION,
  arcadePools,
  createCircleArcade,
  createHigherLowerGame,
  createMysteryCountry,
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

/** alice and bob have accounts; anon and anon2 are anonymous; alice-before is Alice before she made her account. */
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
let logins: { id: string; email: string; password: string }[] = [];

const makeApp = (options: { freePlaysPerDay?: number | null; limits?: Partial<Limits> } = {}) =>
  createApp({
    rpc: local.rpc,
    verifyToken: async (token) => TOKENS[token] ?? null,
    deleteUser: async (id) => {
      deleted.push(id);
      await local.deleteUser(id);
    },
    createLogin: async (id, email, password) => {
      logins.push({ id, email, password });
      await local.createLogin(id, email);
    },
    dailySecret: 'test-secret',
    allowedOrigins: '*',
    ...options,
  });

beforeAll(async () => {
  local = await createLocalDb();
});

beforeEach(async () => {
  await local.db.exec('delete from public.feedback; delete from public.duels; delete from public.game_sessions; delete from public.players; delete from auth.users;');
  for (const { id } of Object.values(TOKENS)) await local.addUser(id);
  deleted = [];
  logins = [];
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

  it('gives an anonymous player an email and password, keeping the same player', async () => {
    const res = await call('POST', '/me/account', 'alice-before', { email: ' alice@example.com ', password: 'correct horse' });
    expect(res).toEqual({ status: 200, json: { created: true } });
    expect(logins).toEqual([{ id: ALICE, email: 'alice@example.com', password: 'correct horse' }]);
  });

  it('refuses an email another account has, in any case, and bad input', async () => {
    await call('POST', '/me/account', 'alice-before', { email: 'alice@example.com', password: 'correct horse' });
    expect(await call('POST', '/me/account', 'anon', { email: 'Alice@Example.com', password: 'another one' })).toEqual({
      status: 409,
      json: { error: 'email-taken' },
    });
    for (const input of [
      { email: 'not an email', password: 'long enough' },
      { email: 'a@b.co', password: 'short' },
      { email: 'a@b.co', password: 'x'.repeat(73) },
      { email: 'a@b.co' },
      { password: 'long enough' },
    ]) {
      expect((await call('POST', '/me/account', 'anon', input)).status, JSON.stringify(input)).toBe(400);
    }
    // Only an anonymous player, and only with a token.
    expect((await call('POST', '/me/account', 'bob', { email: 'bob@example.com', password: 'long enough' })).status).toBe(403);
    expect((await call('POST', '/me/account', undefined, { email: 'c@example.com', password: 'long enough' })).status).toBe(401);
    expect(logins).toHaveLength(1);
  });

  it('puts a player on the boards, with their earlier games, once they have an account; an old anonymous token never takes them off', async () => {
    await call('PATCH', '/me', 'alice-before', { name: 'Alice' });
    await finishGame('alice-before');
    expect(await board()).toEqual([]);
    // Once it has a confirmed email, Supabase issues tokens without is_anonymous for the same user id.
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

describe('duels', () => {
  /** Starts and finishes an arcade run, clearing `levels` levels first. */
  async function finishedRun(token: string, levels = 1) {
    const { json: session } = await start(token);
    const played = await playArcade(session.seed, levels);
    await call('POST', `/sessions/${session.sessionId}/finish`, token, { moves: played.moves });
    return { sessionId: session.sessionId as string, seed: session.seed as number, score: played.score };
  }
  const makeDuel = async (token: string, levels = 1) => {
    const run = await finishedRun(token, levels);
    const made = await call('POST', '/duels', token, { sessionId: run.sessionId });
    return { ...run, code: made.json.code as string, made };
  };
  const accept = (token: string, code: string) => call('POST', `/duels/${code}/accept`, token, { datasetVersion: DATASET_VERSION });
  /** The challenger plays their duel run to the end, clearing `levels` levels. */
  async function play(token: string, code: string, levels: number) {
    const taken = await accept(token, code);
    const played = await playArcade(taken.json.seed, levels);
    const finished = await call('POST', `/sessions/${taken.json.sessionId}/finish`, token, { moves: played.moves });
    return { ...taken.json, score: played.score, moves: played.moves as string[], finished };
  }

  it('makes a duel from a finished run, and the same one again', async () => {
    const { made, sessionId } = await makeDuel('alice', 2);
    expect(made.status).toBe(201);
    expect(made.json.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    const again = await call('POST', '/duels', 'alice', { sessionId });
    expect(again.json.code).toBe(made.json.code);
  });

  it('needs an account to make one', async () => {
    const run = await finishedRun('anon');
    const res = await call('POST', '/duels', 'anon', { sessionId: run.sessionId });
    expect(res).toEqual({ status: 403, json: { error: 'account-required' } });
  });

  it('refuses runs that cannot become a duel', async () => {
    const make = (token: string, sessionId: string) => call('POST', '/duels', token, { sessionId });
    const { json: open } = await start('alice');
    expect((await make('alice', open.sessionId)).status).toBe(422);
    const run = await finishedRun('alice');
    expect((await make('bob', run.sessionId)).status).toBe(404);
    expect((await make('alice', 'nope')).status).toBe(400);
    // City Circle with circles the player places: a friend couldn't play the same ones.
    const placed = await start('alice', 'city-circle', { circlePlacement: 'custom' });
    expect((await make('alice', placed.json.sessionId)).status).toBe(400);
    // A duel run.
    const { code } = await makeDuel('bob');
    const taken = await play('alice', code, 0);
    expect((await make('alice', taken.sessionId)).status).toBe(400);
    // Finished more than a day ago, or on old data.
    const old = await finishedRun('alice');
    await local.db.exec(`update public.game_sessions set finished_at = now() - interval '25 hours' where id = '${old.sessionId}'`);
    expect((await make('alice', old.sessionId)).status).toBe(400);
    const stale = await finishedRun('alice');
    await local.db.exec(`update public.game_sessions set dataset_version = 'old' where id = '${stale.sessionId}'`);
    expect((await make('alice', stale.sessionId)).status).toBe(409);
  });

  it('shows a visitor the stake but not the seed, the moves or the session', async () => {
    const { code, seed, score } = await makeDuel('alice', 2);
    const { status, json } = await call('GET', `/duels/${code}`, 'anon');
    expect(status).toBe(200);
    expect(json).toMatchObject({ code, you: 'visitor', state: 'open', creator: { score, level: expect.any(Number) }, challenger: null, outcome: null });
    expect(json.creator.moves).toBeUndefined();
    expect(json.session).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain(String(seed));
    expect((await call('GET', `/duels/${code}`, 'alice')).json.you).toBe('creator');
  });

  it('takes bad and lowercase codes in its stride', async () => {
    const { code } = await makeDuel('alice');
    expect((await call('GET', '/duels/short', 'bob')).status).toBe(404);
    expect((await call('GET', '/duels/AAAAAAAA', 'bob')).status).toBe(404);
    expect((await call('GET', '/duels/IIIIIIII', 'bob')).status).toBe(404);
    expect((await call('GET', `/duels/${code.toLowerCase()}`, 'bob')).json.code).toBe(code);
  });

  it('gives the first player to accept the same seed, once', async () => {
    const { code, seed } = await makeDuel('alice');
    const taken = await accept('anon', code);
    expect(taken.status).toBe(200);
    expect(taken.json.seed).toBe(seed);
    expect((await accept('anon', code)).json).toEqual(taken.json);
    expect((await accept('bob', code)).json).toEqual({ error: 'duel-unavailable' });
    expect((await accept('alice', code)).status).toBe(403);
    expect((await accept('bob', 'ZZZZZZZZ')).status).toBe(404);
    expect((await call('POST', `/duels/${code}/accept`, 'bob', { datasetVersion: 'old' })).status).toBe(409);
  });

  it('hides the challenger while they play', async () => {
    const { code, seed } = await makeDuel('alice');
    const taken = await accept('anon', code);
    const creatorView = (await call('GET', `/duels/${code}`, 'alice')).json;
    expect(creatorView).toMatchObject({ state: 'playing', challenger: { score: null, status: 'playing' } });
    expect(creatorView.session).toBeUndefined();
    expect(creatorView.challenger.moves).toBeUndefined();
    const mine = (await call('GET', `/duels/${code}`, 'anon')).json;
    expect(mine).toMatchObject({ you: 'challenger', state: 'playing', session: { sessionId: taken.json.sessionId, seed } });
    const stranger = (await call('GET', `/duels/${code}`, 'bob')).json;
    expect(stranger.session).toBeUndefined();
  });

  it('settles a finished duel and reveals both runs', async () => {
    const { code, score, seed } = await makeDuel('alice', 1);
    const won = await play('anon', code, 3);
    expect(won.score).toBeGreaterThan(score);
    for (const token of ['alice', 'anon', 'bob']) {
      const { json } = await call('GET', `/duels/${code}`, token);
      expect(json).toMatchObject({ state: 'finished', outcome: 'challenger', challenger: { score: won.score, status: 'finished' }, creator: { score } });
      expect(json.challenger.moves).toEqual(won.moves);
      expect(json.seed).toBe(seed);
      expect(json.creator.moves.length).toBeGreaterThan(0);
    }
  });

  it('calls equal scores a draw, and a lower score a loss', async () => {
    const drawn = await makeDuel('alice', 1);
    await play('bob', drawn.code, 1);
    expect((await call('GET', `/duels/${drawn.code}`, 'alice')).json.outcome).toBe('draw');
    const lost = await makeDuel('alice', 3);
    await play('bob', lost.code, 1);
    expect((await call('GET', `/duels/${lost.code}`, 'alice')).json.outcome).toBe('creator');
  });

  it("keeps the challenger's run off the leaderboards and out of their bests", async () => {
    const { code, score } = await makeDuel('alice');
    const won = await play('bob', code, 2);
    expect(won.finished.status).toBe(200);
    expect((await call('GET', '/me', 'bob')).json.bests).toEqual({});
    const world = (await call('GET', '/leaderboards/city-circle-arcade/world')).json.entries;
    expect(world.map((e: { score: number }) => e.score)).toEqual([score]);
  });

  it('expires an untaken duel, and one whose data has changed', async () => {
    const { code } = await makeDuel('alice');
    await local.db.exec(`update public.duels set expires_at = now() - interval '1 minute'`);
    expect((await call('GET', `/duels/${code}`, 'bob')).json).toMatchObject({ state: 'expired', expiredReason: 'time' });
    expect((await accept('bob', code)).status).toBe(409);
    const other = await makeDuel('alice');
    await local.db.exec(`update public.duels set dataset_version = 'old' where code = '${other.code}'`);
    expect((await call('GET', `/duels/${other.code}`, 'bob')).json).toMatchObject({ state: 'expired', expiredReason: 'outdated' });
    expect((await accept('bob', other.code)).status).toBe(409);
  });

  it('gives a forfeit to the creator when the challenger takes more than a day', async () => {
    const { code, score } = await makeDuel('alice');
    await accept('bob', code);
    await local.db.exec(`update public.game_sessions set started_at = now() - interval '25 hours' where variant = 'duel'; update public.duels set accepted_at = now() - interval '25 hours' where accepted_at is not null`);
    const { json } = await call('GET', `/duels/${code}`, 'alice');
    expect(json).toMatchObject({ state: 'finished', outcome: 'creator', challenger: { status: 'forfeit', score: null }, creator: { score } });
  });

  it('reserves a rematch for the other player', async () => {
    const first = await makeDuel('alice');
    await play('bob', first.code, 1);
    const run = await finishedRun('bob');
    expect((await call('POST', '/duels', 'bob', { sessionId: run.sessionId, rematchOf: 'ZZZZZZZZ' })).status).toBe(403);
    const made = await call('POST', '/duels', 'bob', { sessionId: run.sessionId, rematchOf: first.code });
    expect(made.status).toBe(201);
    const rematch = made.json.code as string;
    expect((await call('GET', `/duels/${rematch}`, 'alice')).json).toMatchObject({ reservedFor: expect.any(String), reservedForYou: true });
    expect((await accept('anon', rematch)).status).toBe(403);
    expect((await call('GET', `/duels/${first.code}`, 'alice')).json.rematch).toEqual({ code: rematch, forYou: true, byYou: false, state: 'open' });
    expect((await call('GET', `/duels/${first.code}`, 'bob')).json.rematch).toMatchObject({ byYou: true, forYou: false });
    expect((await call('GET', `/duels/${first.code}`, 'anon')).json.rematch).toBeNull();
    // Only a player of the first duel can ask for a rematch.
    const others = await makeDuel('bob');
    await accept('anon', others.code);
    const mine = await finishedRun('alice');
    expect((await call('POST', '/duels', 'alice', { sessionId: mine.sessionId, rematchOf: others.code })).status).toBe(403);
    expect((await accept('alice', rematch)).status).toBe(200);
  });

  it("lists the caller's duels, including rematches waiting for them", async () => {
    const mine = await makeDuel('alice');
    const theirs = await makeDuel('bob');
    await play('alice', theirs.code, 0);
    const run = await finishedRun('bob');
    const rematch = (await call('POST', '/duels', 'bob', { sessionId: run.sessionId, rematchOf: theirs.code })).json.code;
    const list = (await call('GET', '/duels', 'alice')).json.duels as { code: string; you: string; creator: { moves?: unknown } }[];
    expect(list.map((d) => [d.code, d.you]).sort()).toEqual(
      [[mine.code, 'creator'], [theirs.code, 'challenger'], [rematch, 'visitor']].sort(),
    );
    expect(list.every((d) => d.creator.moves === undefined)).toBe(true);
    expect((await call('GET', '/duels', 'anon2')).json.duels).toEqual([]);
  });

  it("moves an anonymous challenger's duels into the account they sign in to", async () => {
    const { code } = await makeDuel('alice');
    await accept('anon', code);
    expect((await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' })).status).toBe(200);
    expect((await call('GET', `/duels/${code}`, 'bob')).json.you).toBe('challenger');
  });

  it('drops a duel that would pit a player against themselves when accounts merge', async () => {
    const { code } = await makeDuel('bob');
    await accept('anon', code);
    await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' });
    expect((await call('GET', `/duels/${code}`, 'bob')).status).toBe(404);
  });

  it("deletes a player's duels with them", async () => {
    const { code } = await makeDuel('alice');
    await call('DELETE', '/me', 'alice');
    expect((await call('GET', `/duels/${code}`, 'bob')).status).toBe(404);
  });

  it('limits how many duels one player makes', async () => {
    app = makeApp({ limits: { duelsPerHour: 1 } });
    await makeDuel('alice');
    const run = await finishedRun('alice');
    expect((await call('POST', '/duels', 'alice', { sessionId: run.sessionId })).status).toBe(429);
    app = makeApp({ limits: { openDuelsMax: 1 } });
    await local.db.exec('delete from public.duels');
    await makeDuel('bob');
    const next = await finishedRun('bob');
    expect((await call('POST', '/duels', 'bob', { sessionId: next.sessionId })).status).toBe(429);
  });

  it('lets only one of two simultaneous players take a duel', async () => {
    const { code } = await makeDuel('alice');
    const results = await Promise.all([accept('bob', code), accept('anon', code), accept('anon2', code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it('refuses a rematch of a duel that is not finished', async () => {
    const { code } = await makeDuel('alice');
    await accept('bob', code);
    // Bob is still playing: neither of them can ask for a rematch yet.
    const bobs = await finishedRun('bob');
    expect((await call('POST', '/duels', 'bob', { sessionId: bobs.sessionId, rematchOf: code })).status).toBe(403);
    const alices = await finishedRun('alice');
    expect((await call('POST', '/duels', 'alice', { sessionId: alices.sessionId, rematchOf: code })).status).toBe(403);
    // Void (the game was updated while Bob played): no rematch either.
    await local.db.exec(`update public.duels set dataset_version = 'old' where code = '${code}'`);
    expect((await call('POST', '/duels', 'alice', { sessionId: alices.sessionId, rematchOf: code })).status).toBe(403);
  });

  it('counts a result sent after the deadline as a forfeit', async () => {
    const { code } = await makeDuel('alice', 1);
    const taken = await accept('bob', code);
    await local.db.exec(`update public.game_sessions set started_at = now() - interval '25 hours' where variant = 'duel'; update public.duels set accepted_at = now() - interval '25 hours' where accepted_at is not null`);
    const played = await playArcade(taken.json.seed, 3);
    await call('POST', `/sessions/${taken.json.sessionId}/finish`, 'bob', { moves: played.moves });
    const { json } = await call('GET', `/duels/${code}`, 'alice');
    expect(json).toMatchObject({ state: 'finished', outcome: 'creator', challenger: { status: 'forfeit', score: null } });
    expect(json.challenger.moves).toBeUndefined();
  });

  it('voids a duel whose data changed while the challenger played, even after the deadline', async () => {
    const { code } = await makeDuel('alice');
    await accept('bob', code);
    await local.db.exec(`update public.duels set dataset_version = 'old' where code = '${code}'`);
    await local.db.exec(`update public.game_sessions set started_at = now() - interval '25 hours' where variant = 'duel'; update public.duels set accepted_at = now() - interval '25 hours' where accepted_at is not null`);
    const { json } = await call('GET', `/duels/${code}`, 'bob');
    expect(json).toMatchObject({ state: 'expired', expiredReason: 'outdated', outcome: null });
    expect(json.session).toBeUndefined();
    expect(json.seed).toBeUndefined();
  });

  it('keeps duel runs off the world leaderboard endpoint', async () => {
    const { code } = await makeDuel('alice');
    await play('bob', code, 1);
    expect((await call('GET', '/leaderboards/city-circle-arcade/duel')).status).toBe(404);
    expect((await call('GET', '/leaderboards/city-circle-arcade/duel?scope=personal', 'bob')).json.entries).toHaveLength(1);
  });

  it("moves a rematch reserved for an anonymous player into the account they log in to", async () => {
    const first = await makeDuel('alice');
    await play('anon', first.code, 1);
    const run = await finishedRun('alice');
    const rematch = (await call('POST', '/duels', 'alice', { sessionId: run.sessionId, rematchOf: first.code })).json.code;
    await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' });
    expect((await call('GET', `/duels/${rematch}`, 'bob')).json).toMatchObject({ reservedForYou: true, state: 'open' });
    expect((await call('GET', `/duels/${first.code}`, 'bob')).json).toMatchObject({ you: 'challenger', rematch: { forYou: true } });
    expect((await accept('bob', rematch)).status).toBe(200);
  });

  it('drops a rematch reserved for the account the creator merges with', async () => {
    const first = await makeDuel('bob');
    await play('anon', first.code, 1);
    const run = await finishedRun('bob');
    const rematch = (await call('POST', '/duels', 'bob', { sessionId: run.sessionId, rematchOf: first.code })).json.code;
    await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' });
    expect((await call('GET', `/duels/${first.code}`, 'bob')).status).toBe(404);
    expect((await call('GET', `/duels/${rematch}`, 'bob')).status).toBe(404);
    // The rest of the merge still happens: Bob keeps his own runs and gains anon's.
    expect((await call('GET', '/me', 'bob')).json.bests['city-circle-arcade']).toBeDefined();
  });

  it("hides the challenger's result in the list while they play", async () => {
    const { code } = await makeDuel('alice');
    await accept('bob', code);
    const listed = (await call('GET', '/duels', 'alice')).json.duels[0];
    expect(listed).toMatchObject({ state: 'playing', challenger: { score: null, durationSec: null } });
    expect(listed.session).toBeUndefined();
    expect(listed.seed).toBeUndefined();
    const bobsList = (await call('GET', '/duels', 'bob')).json.duels[0];
    expect(bobsList.creator.moves).toBeUndefined();
  });

  /** Plays Mystery Country from the server's seed: solves `solved` levels at once, then runs out of guesses. */
  function playMystery(seed: number, solved: number) {
    const countries = queryCountries();
    const game = createMysteryCountry({ countries, rounds: 20 });
    let state = game.start(seed);
    for (let i = 0; i < solved; i++) state = game.nextLevel(game.guess(state, state.target).state);
    while (state.status !== 'over') {
      const wrong = countries.find((c) => c.id !== state.target && !state.guesses.includes(c.id))!;
      state = game.guess(state, wrong.id).state;
    }
    return state;
  }

  it('plays a duel of another game end to end: Mystery Country', async () => {
    const { json: session } = await start('alice', 'mystery-country');
    const mine = playMystery(session.seed, 3);
    await call('POST', `/sessions/${session.sessionId}/finish`, 'alice', { moves: mine.moves });
    const made = await call('POST', '/duels', 'alice', { sessionId: session.sessionId });
    expect(made.status).toBe(201);
    const code = made.json.code as string;
    const open = (await call('GET', `/duels/${code}`, 'bob')).json;
    expect(open).toMatchObject({ gameId: 'mystery-country', state: 'open', creator: { score: mine.score, level: 4 } });
    // Bob gets Alice's seed, so the same mystery countries in the same order.
    const taken = await accept('bob', code);
    expect(taken.json.seed).toBe(session.seed);
    const theirs = playMystery(taken.json.seed, 1);
    expect(theirs.past).toEqual(mine.past.slice(0, theirs.past.length));
    const finished = await call('POST', `/sessions/${taken.json.sessionId}/finish`, 'bob', { moves: theirs.moves });
    expect(finished.json.score).toBe(theirs.score);
    const result = (await call('GET', `/duels/${code}`, 'bob')).json;
    expect(result).toMatchObject({ state: 'finished', outcome: 'creator', seed: session.seed, challenger: { score: theirs.score } });
    expect(result.creator.moves).toEqual(mine.moves);
    expect(result.challenger.moves).toEqual(theirs.moves);
    // A rematch is the same game again, not another one.
    const other = await finishedRun('bob');
    expect((await call('POST', '/duels', 'bob', { sessionId: other.sessionId, rematchOf: code })).status).toBe(400);
    const { json: again } = await start('bob', 'mystery-country');
    await call('POST', `/sessions/${again.sessionId}/finish`, 'bob', { moves: playMystery(again.seed, 0).moves });
    expect((await call('POST', '/duels', 'bob', { sessionId: again.sessionId, rematchOf: code })).status).toBe(201);
  });
});

describe('daily duels', () => {
  const GAME = 'city-circle-arcade';
  const today = () => dailyVariant(dailyDate());
  const openDaily = (token: string) => call('POST', `/daily/${GAME}/start`, token, { datasetVersion: DATASET_VERSION });
  /** Opens and finishes the player's daily run, clearing `levels` levels. */
  async function playDaily(token: string, levels: number) {
    const { json: daily } = await openDaily(token);
    const played = await playArcade(daily.seed, levels);
    await call('POST', `/sessions/${daily.sessionId}/finish`, token, { moves: played.moves });
    return { sessionId: daily.sessionId as string, seed: daily.seed as number, score: played.score };
  }
  async function makeDailyDuel(token: string, levels = 1) {
    const run = await playDaily(token, levels);
    const made = await call('POST', '/duels', token, { sessionId: run.sessionId });
    expect(made.status).toBe(201);
    return { ...run, code: made.json.code as string };
  }
  const accept = (token: string, code: string) => call('POST', `/duels/${code}/accept`, token, { datasetVersion: DATASET_VERSION });
  const get = async (token: string, code: string) => (await call('GET', `/duels/${code}`, token)).json;
  /** The challenger finishes the run they took the duel with, clearing `levels` levels. */
  async function finishTaken(token: string, taken: { json: any }, levels: number) {
    const played = await playArcade(taken.json.seed, levels);
    await call('POST', `/sessions/${taken.json.sessionId}/finish`, token, { moves: played.moves });
    return played.score;
  }
  /** Moves every daily run and daily duel of today to yesterday: the day is over. */
  const endTheDay = () =>
    local.db.exec(`
      update public.game_sessions set variant = public.daily_variant(public.utc_today() - 1) where variant = public.daily_variant(public.utc_today());
      update public.duels set daily_date = public.utc_today() - 1 where daily_date is not null;`);
  const variantOf = async (sessionId: string) =>
    (await local.db.query<{ variant: string }>('select variant from public.game_sessions where id = $1', [sessionId])).rows[0]!.variant;

  it("makes a daily duel from a daily run; the friend's run is their one daily, on the day's leaderboard", async () => {
    const alice = await makeDailyDuel('alice', 1);
    const open = await get('bob', alice.code);
    expect(open).toMatchObject({ daily: dailyDate(), yourDaily: null, state: 'open', creator: { score: alice.score } });
    expect(JSON.stringify(open)).not.toContain(String(alice.seed));

    const taken = await accept('bob', alice.code);
    expect(taken.json.seed).toBe(alice.seed);
    expect(await variantOf(taken.json.sessionId)).toBe(today());
    // Accepting spent Bob's daily: the daily page reopens the very same run.
    expect((await openDaily('bob')).json).toMatchObject({ sessionId: taken.json.sessionId, finishedScore: null });
    expect((await get('bob', alice.code)).session).toEqual({ sessionId: taken.json.sessionId, seed: alice.seed, variant: today() });

    const score = await finishTaken('bob', taken, 2);
    expect(await get('bob', alice.code)).toMatchObject({ state: 'finished', outcome: 'challenger', challenger: { score } });
    expect((await openDaily('bob')).json.finishedScore).toBe(score);
    const board = await call('GET', `/leaderboards/${GAME}/${today()}`);
    expect(board.json.entries.map((e: any) => e.score).sort()).toEqual([alice.score, score].sort());
  });

  it('answers with a daily the friend already played, at once, and one daily answers several duels', async () => {
    const mine = await playDaily('anon', 2);
    const fromAlice = await makeDailyDuel('alice', 1);
    const fromBob = await makeDailyDuel('bob', 3);
    expect((await get('anon', fromAlice.code)).yourDaily).toEqual({ status: 'finished', score: mine.score });
    const first = await accept('anon', fromAlice.code);
    const second = await accept('anon', fromBob.code);
    expect(first.json.sessionId).toBe(mine.sessionId);
    expect(second.json.sessionId).toBe(mine.sessionId);
    expect(await get('alice', fromAlice.code)).toMatchObject({ state: 'finished', outcome: 'challenger', challenger: { score: mine.score } });
    expect(await get('bob', fromBob.code)).toMatchObject({ state: 'finished', outcome: 'creator' });
  });

  it('carries on a daily the friend has started', async () => {
    const { code } = await makeDailyDuel('alice');
    const { json: started } = await openDaily('bob');
    const taken = await accept('bob', code);
    expect(taken.json.sessionId).toBe(started.sessionId);
    expect(await get('alice', code)).toMatchObject({ state: 'playing', challenger: { score: null } });
  });

  it("never shows the day's answers to someone who can still play that daily", async () => {
    const { code, seed } = await makeDailyDuel('alice', 1);
    await finishTaken('bob', await accept('bob', code), 0);
    // Both players finished their daily: they see both runs.
    for (const token of ['alice', 'bob']) {
      const seen = await get(token, code);
      expect(seen.seed).toBe(seed);
      expect(seen.creator.moves.length).toBeGreaterThan(0);
    }
    // Someone who hasn't played today's daily, or is in the middle of it, sees the scores only.
    await openDaily('anon2');
    for (const token of ['anon', 'anon2']) {
      const seen = await get(token, code);
      expect(seen).toMatchObject({ state: 'finished', outcome: 'creator' });
      expect(JSON.stringify(seen)).not.toContain(String(seed));
      expect(seen.creator.moves).toBeUndefined();
      expect(seen.challenger.moves).toBeUndefined();
    }
    // Once the day is over, someone without a run of it can't use the answers: shown.
    // A run of that day still open could be finished, so it stays hidden.
    await endTheDay();
    expect((await get('anon', code)).seed).toBe(seed);
    expect((await get('anon2', code)).seed).toBeUndefined();
  });

  it("plays a daily duel of a day that's over as a run for the duel only", async () => {
    const { code, seed, score } = await makeDailyDuel('alice', 1);
    await endTheDay();
    const taken = await accept('bob', code);
    expect(taken.json.seed).toBe(seed);
    expect(await variantOf(taken.json.sessionId)).toBe('duel');
    const theirs = await finishTaken('bob', taken, 2);
    expect(await get('bob', code)).toMatchObject({ state: 'finished', outcome: 'challenger', creator: { score }, challenger: { score: theirs } });
    // Bob's daily of today is his own, new run.
    const daily = (await openDaily('bob')).json;
    expect(daily.finishedScore).toBeNull();
    expect(daily.sessionId).not.toBe(taken.json.sessionId);
  });

  it("answers a daily duel with the account's daily run when its anonymous challenger logs in", async () => {
    const { code } = await makeDailyDuel('alice', 1);
    // Anon answers with a daily run; Bob, whose account anon logs in to, played today's daily too.
    await finishTaken('anon', await accept('anon', code), 0);
    const bobs = await playDaily('bob', 3);
    expect((await call('POST', '/me/merge', 'bob', { anonymousToken: 'anon' })).status).toBe(200);
    expect(await get('bob', code)).toMatchObject({ you: 'challenger', state: 'finished', challenger: { score: bobs.score } });
  });

  it('times a daily challenger from when they took the duel, not from when they opened their daily', async () => {
    const { code } = await makeDailyDuel('alice');
    const { json: started } = await openDaily('bob');
    await local.db.exec(`update public.game_sessions set started_at = now() - interval '25 hours' where id = '${started.sessionId}'`);
    await accept('bob', code);
    expect((await get('alice', code)).state).toBe('playing');
  });
});
