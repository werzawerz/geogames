import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUEL_VARIANT } from '@geogames/games';
import { createApiBackend } from './api-backend.ts';
import type { Auth } from './auth.ts';

/** An in-memory localStorage: the tests run in Node. */
function memoryStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
    key: (i: number) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
  // Object.keys(localStorage) lists the stored keys in a browser.
  return new Proxy(storage, { ownKeys: () => [...items.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
}

const auth: Auth = {
  initialAccount: { status: 'anonymous' },
  ready: async () => {},
  token: async () => 'token',
  account: async () => ({ status: 'anonymous' }),
  logIn: async () => ({ mergeFrom: null }),
  createAccount: async () => {},
  signOut: async () => {},
};

const player = { id: 'p1', name: 'Ana' };

describe('api backend', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    // The server can't be reached.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps an unsent game in this browser, but never a duel run', async () => {
    const backend = createApiBackend('http://api.test', auth);
    const play = { seed: 1, sessionId: 's1' };
    const duel = await backend.finishPlay(play, { gameId: 'city-circle-arcade', variant: DUEL_VARIANT, score: 50, seed: 1, moves: ['>'] }, player);
    expect(duel).toMatchObject({ status: 'offline', score: 50 });
    expect(await backend.scores.top('city-circle-arcade', DUEL_VARIANT, 'personal')).toEqual([]);

    const normal = await backend.finishPlay(play, { gameId: 'city-circle-arcade', variant: 'world', score: 70, seed: 1, moves: ['>'] }, player);
    expect(normal.status).toBe('offline');
    expect((await backend.scores.top('city-circle-arcade', 'world', 'personal'))?.map((e) => e.score)).toEqual([70]);
  });
});
