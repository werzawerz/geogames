import { describe, expect, it } from 'vitest';
import { getCountry } from '@geogames/geodata';
import {
  BLITZ_LEVELS,
  BLITZ_LIVES,
  BLITZ_TIMEOUT,
  blitzFlawlessBonus,
  blitzPlan,
  blitzSeconds,
  createBorderBlitz,
  replayBorderBlitz,
  type BlitzState,
} from './border-blitz.ts';
import { getGame } from './catalog.ts';
import { DAILY_GAMES } from './daily.ts';
import { routeCountries } from './pools.ts';
import { replayGame } from './replay.ts';
import { buildBorderGraph } from './route.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const countries = routeCountries();
const game = createBorderBlitz({ countries, rounds: 20 });
const sovereign = countries.filter((c) => c.sovereignty !== 'territory');
const wrongFor = (state: BlitzState) =>
  sovereign.find(
    (c) => c.id !== state.target && !state.neighbours.includes(c.id) && !state.wrong.includes(c.id) && !game.throughTerritory(state.target, c.id),
  )!.id;
const african = (id: string) => getCountry(id)?.continent === 'Africa';
const remote = (id: string) => african(id) || getCountry(id)?.subregion === 'Caribbean';
/** Central Asia and the Caucasus: known by name, rarely by their borders. */
const lessKnown = (id: string) => getCountry(id)?.subregion === 'Central Asia' || ['ARM', 'AZE', 'GEO'].includes(id);

/** Names every neighbour of every level: a perfect run. */
const runs = new Map<number, BlitzState>();
const playAll = (seed: number) => {
  if (!runs.has(seed)) runs.set(seed, perfectRun(seed));
  return runs.get(seed)!;
};
const perfectRun = (seed: number) => {
  let state = game.start(seed);
  for (;;) {
    for (const id of state.neighbours) state = game.guess(state, id).state;
    if (state.status === 'over') return state;
    state = game.nextLevel(state);
  }
};
const SEEDS = 120;
const shared = (a: readonly string[], b: readonly string[]) => a.filter((n) => b.includes(n)).length;

describe('border blitz', () => {
  it('uses Border Route’s border graph, bridges and tunnels included, but only countries', () => {
    expect(game.neighboursOf('DNK')).toEqual(['DEU', 'SWE']);
    expect(game.neighboursOf('GBR')).toEqual(['FRA', 'IRL']);
    expect(game.neighboursOf('FRA')).toContain('GBR');
    // Hong Kong and Macau are territories, so they're not China's neighbours here.
    expect(game.neighboursOf('CHN')).not.toContain('HKG');
    expect(game.neighboursOf('CHN')).toHaveLength(14);
    expect(game.neighboursOf('ESP')).not.toContain('GIB');
    const route = buildBorderGraph(countries);
    for (const id of game.askable) expect(route.get(id)).toEqual(expect.arrayContaining([...game.neighboursOf(id)]));
  });

  it('never asks a country without neighbours, or a territory', () => {
    for (const id of ['JPN', 'AUS', 'ISL', 'CUB', 'HKG', 'ESH']) expect(game.askable).not.toContain(id);
    for (const id of game.askable) expect(game.neighboursOf(id).length).toBeGreaterThan(0);
  });

  it('is deterministic for a seed', () => {
    expect(playAll(5).past).toEqual(playAll(5).past);
    expect(playAll(5).past).not.toEqual(playAll(6).past);
  });

  it('follows the level plan: few, familiar neighbours first, more later', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { past } = playAll(seed);
      expect(past).toHaveLength(20);
      past.forEach((id, i) => {
        const level = i + 1;
        const n = game.neighboursOf(id);
        const [lo, hi] = blitzPlan(level).neighbours;
        expect(n.length, `seed ${seed} level ${level}: ${id}`).toBeGreaterThanOrEqual(lo);
        expect(n.length, `seed ${seed} level ${level}: ${id}`).toBeLessThanOrEqual(hi);
        if (level <= 8) {
          // No Africa or Caribbean early on, neither asked nor as an answer, except
          // Morocco for Spain: they only meet at Ceuta and Melilla.
          expect(remote(id), `seed ${seed} level ${level}: ${id}`).toBe(false);
          expect(n.filter((a) => remote(a) && !(id === 'ESP' && a === 'MAR')), `seed ${seed} level ${level}: ${id}`).toEqual([]);
        }
        if (level <= 4) {
          expect(lessKnown(id), `seed ${seed} level ${level}: ${id}`).toBe(false);
          expect(n.filter(lessKnown), `seed ${seed} level ${level}: ${id}`).toEqual([]);
        }
      });
    }
  });

  it('lets Spain come early, but not Central Asia or the Caucasus', () => {
    const early = new Set([...Array(SEEDS).keys()].flatMap((i) => playAll(i + 1).past.slice(0, 4)));
    expect(early).toContain('ESP');
    for (const id of ['UZB', 'AZE', 'KGZ', 'TJK', 'TKM', 'KAZ']) expect(early).not.toContain(id);
  });

  it('asks an African country at most about a third of the time from level 9, and never 3 in a row', () => {
    const later = Array(21).fill(0);
    for (let seed = 1; seed <= SEEDS * 3; seed++) {
      const { past } = playAll(seed);
      past.forEach((id, i) => {
        if (african(id)) later[i + 1]++;
        if (i >= 2) expect(past.slice(i - 2, i + 1).every(african), `seed ${seed} level ${i + 1}`).toBe(false);
      });
    }
    for (let level = 9; level <= 20; level++) expect(later[level] / (SEEDS * 3), `level ${level}`).toBeLessThan(0.38);
    // But Africa does come in: it has many of the countries with many neighbours.
    expect(later.slice(9).reduce((a, b) => a + b) / (SEEDS * 3 * 12)).toBeGreaterThan(0.2);
  });

  it('never repeats a country, and no two levels share over half their neighbours', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { past } = playAll(seed);
      expect(new Set(past).size).toBe(past.length);
      for (let i = 0; i < past.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = game.neighboursOf(past[i]!);
          const b = game.neighboursOf(past[j]!);
          expect(shared(a, b), `seed ${seed}: ${past[j]} then ${past[i]}`).toBeLessThanOrEqual(Math.min(a.length, b.length) / 2);
        }
        // A level doesn't ask one of the last country's neighbours.
        if (i > 0) expect(game.neighboursOf(past[i - 1]!)).not.toContain(past[i]);
      }
    }
  });

  it('gives more time for more neighbours, and less per neighbour later', () => {
    expect(blitzSeconds(1, 3)).toBe(10 + 24);
    expect(blitzSeconds(20, 14)).toBe(10 + 63);
    expect(BLITZ_LEVELS.map((p) => p.secondsEach)).toEqual([...BLITZ_LEVELS.map((p) => p.secondsEach)].sort((a, b) => b - a));
  });

  it('pays per neighbour by level, and a bonus only for a flawless level', () => {
    let state = game.start(1);
    const [first, ...rest] = state.neighbours;
    state = game.guess(state, first!).state;
    expect(state.score).toBe(10);
    for (const id of rest) state = game.guess(state, id).state;
    expect(state.status).toBe('level-clear');
    expect(state.score).toBe(10 * state.neighbours.length + blitzFlawlessBonus(1, state.neighbours.length));
    expect(state.cleared).toEqual([true]);

    let flawed = game.start(1);
    flawed = game.guess(flawed, wrongFor(flawed)).state;
    for (const id of flawed.neighbours) flawed = game.guess(flawed, id).state;
    expect(flawed.score).toBe(10 * flawed.neighbours.length);
    expect(flawed.cleared).toEqual([false]);

    state = game.nextLevel(state);
    const before = state.score;
    state = game.guess(state, state.neighbours[0]!).state;
    expect(state.score - before).toBe(20);
  });

  it('completes a perfect run of 20 levels', () => {
    const full = playAll(2);
    expect(full.completed).toBe(true);
    expect(full.status).toBe('over');
    expect(full.cleared).toEqual(Array(20).fill(true));
    const perfect = full.past.reduce((sum, id, i) => {
      const n = game.neighboursOf(id).length;
      return sum + 10 * (i + 1) * n + blitzFlawlessBonus(i + 1, n);
    }, 0);
    expect(full.score).toBe(perfect);
  });

  it('ends the run on the third wrong answer, keeping the points so far', () => {
    let state = game.start(4);
    state = game.guess(state, state.neighbours[0]!).state;
    const { score } = state;
    for (let i = 0; i < BLITZ_LIVES - 1; i++) state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('playing');
    state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('over');
    expect(state.ended).toBe('lives');
    expect(state.completed).toBe(false);
    expect(state.score).toBe(score);
  });

  it('ends the run when the clock runs out', () => {
    let state = game.start(4);
    state = game.guess(state, state.neighbours[0]!).state;
    const out = game.timeout(state);
    expect(out.status).toBe('over');
    expect(out.ended).toBe('time');
    expect(out.score).toBe(state.score);
    expect(out.moves.at(-1)).toBe(BLITZ_TIMEOUT);
    expect(game.timeout(out)).toBe(out);
  });

  it('lets a neighbour through a territory pass for free, either way round', () => {
    expect(game.throughTerritory('BRA', 'FRA')).toBe('GUF');
    expect(game.throughTerritory('FRA', 'BRA')).toBe('GUF');
    expect(game.throughTerritory('FRA', 'SUR')).toBe('GUF');
    expect(game.throughTerritory('ESP', 'GBR')).toBe('GIB');
    expect(game.throughTerritory('GBR', 'ESP')).toBe('GIB');
    // Real neighbours, strangers and China's own Hong Kong aren't passes.
    expect(game.throughTerritory('ESP', 'FRA')).toBeNull();
    expect(game.throughTerritory('BRA', 'DEU')).toBeNull();
    expect(game.throughTerritory('CHN', 'CHN')).toBeNull();

    // Find a run that asks Brazil, and name France there.
    const seed = [...Array(SEEDS * 3).keys()].map((i) => i + 1).find((s) => playAll(s).past.includes('BRA'))!;
    let state = game.start(seed);
    while (state.target !== 'BRA') {
      for (const id of state.neighbours) state = game.guess(state, id).state;
      state = game.nextLevel(state);
    }
    expect(game.guess(state, 'FRA')).toEqual({ state, result: 'territory' });
  });

  it('charges nothing for repeats, the country itself, or a territory', () => {
    const start = game.start(6);
    expect(game.guess(start, start.target)).toEqual({ state: start, result: 'target' });
    expect(game.guess(start, 'HKG').result).toBe('unknown');
    expect(game.guess(start, 'nope').result).toBe('unknown');
    const once = game.guess(start, wrongFor(start)).state;
    expect(game.guess(once, once.wrong[0]!)).toEqual({ state: once, result: 'repeat' });
    const found = game.guess(start, start.neighbours[0]!).state;
    expect(game.guess(found, start.neighbours[0]!)).toEqual({ state: found, result: 'repeat' });
  });

  it('replays to the same result, and can be verified by a server', async () => {
    let state = game.start(8);
    state = game.guess(state, wrongFor(state)).state;
    for (const id of state.neighbours) state = game.guess(state, id).state;
    state = game.nextLevel(state);
    state = game.guess(state, state.neighbours[0]!).state;
    const beforeEnd = state.moves;
    state = game.timeout(state);
    const replayed = replayBorderBlitz(game, 8, state.moves);
    expect(replayed).toEqual(state);

    const definition = getGame('border-blitz')!;
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 8, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(definition, settings, 8, beforeEnd)).toMatchObject({ finished: false });
    // Moves after the end don't count.
    expect(await replayGame(definition, settings, 8, [...state.moves, 'DEU'])).toEqual({ score: state.score, finished: true });
  });

  it('has no region to pick and one leaderboard; the daily challenge is left to decide', () => {
    const definition = getGame('border-blitz')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
    expect(DAILY_GAMES).not.toContain('border-blitz');
  });
});
