import { describe, expect, it } from 'vitest';
import { getCountry } from '@geogames/geodata';
import {
  BLITZ_GIVE_UP,
  BLITZ_LEVELS,
  BLITZ_MAX_LIVES,
  BLITZ_START_LIVES,
  BLITZ_TIMEOUT,
  BLITZ_TIME_POINTS,
  blitzFlawlessBonus,
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
const nameAll = (state: BlitzState) => state.neighbours.reduce((s, id) => game.guess(s, id).state, state);

/** Names every neighbour of every level: a perfect run. */
const runs = new Map<number, BlitzState>();
const playAll = (seed: number) => {
  if (!runs.has(seed)) runs.set(seed, perfectRun(seed));
  return runs.get(seed)!;
};
const perfectRun = (seed: number) => {
  let state = game.start(seed);
  for (;;) {
    state = nameAll(state);
    if (state.status === 'over') return state;
    state = game.nextLevel(state);
  }
};
const SEEDS = 300;
const seeds = [...Array(SEEDS).keys()].map((i) => i + 1);
const shared = (a: readonly string[], b: readonly string[]) => a.filter((n) => b.includes(n)).length;
/** The mean level at which a country comes up, over the runs that ask it. */
const meanLevel = (id: string) => {
  const levels = seeds.flatMap((s) => {
    const i = playAll(s).past.indexOf(id);
    return i < 0 ? [] : [i + 1];
  });
  return levels.reduce((a, b) => a + b, 0) / levels.length;
};

describe('border blitz: the countries', () => {
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

  it('asks only countries with at least 3 neighbours, never a territory', () => {
    for (const id of ['JPN', 'AUS', 'CUB', 'HKG', 'ESH', 'USA', 'PRT', 'GBR']) expect(game.askable).not.toContain(id);
    for (const id of game.askable) expect(game.neighboursOf(id).length).toBeGreaterThanOrEqual(3);
  });

  it('rates obscure neighbour sets hardest, and lists the countries easiest first', () => {
    const d = game.difficulty;
    expect(d('BEL')).toBeLessThan(d('AUT'));
    for (const middle of ['AUT', 'HUN', 'BRA']) {
      for (const hard of ['CAF', 'COD', 'CHN', 'RUS']) expect(d(middle), `${middle} < ${hard}`).toBeLessThan(d(hard));
    }
    const scores = game.askable.map(d);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
});

// Hundreds of whole runs: slow when the machine is busy.
describe('border blitz: the run', { timeout: 30_000 }, () => {
  it('is deterministic for a seed', () => {
    expect(perfectRun(5).past).toEqual(playAll(5).past);
    expect(playAll(5).past).not.toEqual(playAll(6).past);
  });

  it('keeps the early levels familiar', () => {
    for (const seed of seeds) {
      playAll(seed).past.forEach((id, i) => {
        const level = i + 1;
        const n = game.neighboursOf(id);
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
    const early = new Set(seeds.flatMap((s) => playAll(s).past.slice(0, 4)));
    expect(early).toContain('ESP');
  });

  it('goes from easy to hard: Austria, Hungary and Brazil in the middle, the likes of the Central African Republic late', () => {
    const byLevel = Array.from({ length: 20 }, (_, i) => seeds.map((s) => game.difficulty(playAll(s).past[i]!)));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const first = mean(byLevel.slice(0, 4).flat());
    const middle = mean(byLevel.slice(8, 12).flat());
    const last = mean(byLevel.slice(16).flat());
    expect(first).toBeLessThan(middle);
    expect(middle).toBeLessThan(last);
    for (const id of ['AUT', 'HUN', 'BRA']) expect(meanLevel(id), id).toBeLessThan(16);
    for (const id of ['CAF', 'CHN', 'RUS']) expect(meanLevel(id), id).toBeGreaterThan(16);
  });

  it('opens on many different countries', () => {
    const openers = new Map<string, number>();
    for (const s of seeds) openers.set(playAll(s).past[0]!, (openers.get(playAll(s).past[0]!) ?? 0) + 1);
    expect(openers.size).toBeGreaterThanOrEqual(30);
    expect(Math.max(...openers.values()) / SEEDS).toBeLessThan(0.07);
  });

  it('never repeats a country, its neighbour set or its part of the world too soon', () => {
    for (const seed of seeds) {
      const { past } = playAll(seed);
      expect(past).toHaveLength(20);
      expect(new Set(past).size).toBe(past.length);
      for (let i = 0; i < past.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = game.neighboursOf(past[i]!);
          const b = game.neighboursOf(past[j]!);
          expect(shared(a, b), `seed ${seed}: ${past[j]} then ${past[i]}`).toBeLessThanOrEqual(Math.min(a.length, b.length) / 2);
        }
        // No two from one subregion within 3 levels, and not one of the last country's neighbours.
        const recent = past.slice(Math.max(0, i - 3), i);
        expect(recent.map((r) => getCountry(r)!.subregion), `seed ${seed} level ${i + 1}`).not.toContain(getCountry(past[i]!)!.subregion);
        if (i > 0) expect(game.neighboursOf(past[i - 1]!)).not.toContain(past[i]);
      }
    }
  });

  it('asks an African country at most about a third of the time from level 9, and never 3 in a row', () => {
    const later = Array(21).fill(0);
    for (const seed of seeds) {
      const { past } = playAll(seed);
      past.forEach((id, i) => {
        if (african(id)) later[i + 1]++;
        if (i >= 2) expect(past.slice(i - 2, i + 1).every(african), `seed ${seed} level ${i + 1}`).toBe(false);
      });
    }
    for (let level = 9; level <= 20; level++) expect(later[level] / SEEDS, `level ${level}`).toBeLessThan(0.4);
    // But Africa does come in: it has many of the countries with many neighbours.
    expect(later.slice(9).reduce((a, b) => a + b) / (SEEDS * 12)).toBeGreaterThan(0.2);
  });
});

describe('border blitz: the clock', () => {
  it('gives less time per neighbour as the run goes on', () => {
    const each = BLITZ_LEVELS.map((p) => p.secondsEach);
    expect(each).toEqual([...each].sort((a, b) => b - a));
    expect(blitzSeconds(1, 4)).toBe(5 + 24);
    expect(blitzSeconds(20, 8)).toBe(5 + 24);
  });

  it('leaves a quick player only a few seconds spare by the end', () => {
    // At 2.5 s an answer, the last levels leave about 10 s to think, on the largest sets.
    for (const seed of seeds.slice(0, 50)) {
      for (const id of playAll(seed).past.slice(16)) {
        const n = game.neighboursOf(id).length;
        expect(blitzSeconds(20, n) - 2.5 * n, id).toBeLessThanOrEqual(12);
      }
    }
  });

  it('turns the seconds left into points, once, and no more than the clock had', () => {
    const cleared = nameAll(game.start(1));
    const level = cleared.level;
    const withTime = game.claimTime(cleared, 12);
    expect(withTime.score - cleared.score).toBe(BLITZ_TIME_POINTS * level * 12);
    expect(withTime.secondsLeft).toBe(12);
    expect(withTime.moves.at(-1)).toBe('t:12');
    expect(game.claimTime(withTime, 5)).toBe(withTime);
    expect(game.claimTime(cleared, 9999).secondsLeft).toBe(blitzSeconds(level, cleared.neighbours.length));
    expect(game.claimTime(cleared, -3).secondsLeft).toBe(0);
    // Not mid-level, nor after a level that wasn't cleared.
    const start = game.start(1);
    expect(game.claimTime(start, 10)).toBe(start);
    expect(game.claimTime(game.timeout(start), 10).score).toBe(0);
  });
});

describe('border blitz: lives and scores', () => {
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
    flawed = nameAll(flawed);
    expect(flawed.score).toBe(10 * flawed.neighbours.length);
    expect(flawed.cleared).toEqual([false]);
  });

  it('carries lives over the run: a wrong country costs one, a flawless level earns one back, up to 5', () => {
    let state = game.start(2);
    expect(state.lives).toBe(BLITZ_START_LIVES);
    state = game.guess(state, wrongFor(state)).state;
    expect(state.lives).toBe(2);
    state = game.nextLevel(nameAll(state));
    // Not flawless, so still 2 on the next level.
    expect(state.lives).toBe(2);
    expect(state.bonusLife).toBe(false);
    state = nameAll(state);
    expect(state.bonusLife).toBe(true);
    expect(state.lives).toBe(3);
    for (let i = 0; i < 5; i++) state = nameAll(game.nextLevel(state));
    expect(state.lives).toBe(BLITZ_MAX_LIVES);
  });

  it('ends the run when the lives run out, keeping the points so far', () => {
    let state = game.nextLevel(nameAll(game.start(4)));
    expect(state.lives).toBe(4);
    state = game.guess(state, state.neighbours[0]!).state;
    const { score } = state;
    for (let i = 0; i < 3; i++) state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('playing');
    state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('over');
    expect(state.ended).toBe('lives');
    expect(state.completed).toBe(false);
    expect(state.score).toBe(score);
  });

  it('ends the run when the clock runs out, or the player gives up', () => {
    const state = game.guess(game.start(4), game.start(4).neighbours[0]!).state;
    const out = game.timeout(state);
    expect(out).toMatchObject({ status: 'over', ended: 'time', score: state.score });
    expect(out.moves.at(-1)).toBe(BLITZ_TIMEOUT);
    expect(game.timeout(out)).toBe(out);
    const gaveUp = game.giveUp(state);
    expect(gaveUp).toMatchObject({ status: 'over', ended: 'gave-up', score: state.score });
    expect(gaveUp.moves.at(-1)).toBe(BLITZ_GIVE_UP);
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
    const seed = seeds.find((s) => playAll(s).past.includes('BRA'))!;
    let state = game.start(seed);
    while (state.target !== 'BRA') state = game.nextLevel(nameAll(state));
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
});

describe('border blitz: replays', () => {
  it('replays answers, time bonuses, timeouts and give-ups, and can be verified by a server', async () => {
    const definition = getGame('border-blitz')!;
    const settings = normalizeSettings({}, definition);
    let state = game.start(8);
    state = game.guess(state, wrongFor(state)).state;
    state = game.claimTime(nameAll(state), 7);
    state = game.nextLevel(state);
    state = game.claimTime(nameAll(state), 3);
    state = game.nextLevel(state);
    state = game.guess(state, state.neighbours[0]!).state;
    const beforeEnd = state;
    for (const end of [game.timeout(state), game.giveUp(state)]) {
      expect(replayBorderBlitz(game, 8, end.moves)).toEqual(end);
      expect(await replayGame(definition, settings, 8, end.moves)).toEqual({ score: end.score, finished: true });
      // Moves after the end don't count.
      expect(await replayGame(definition, settings, 8, [...end.moves, 'DEU', 't:30'])).toEqual({ score: end.score, finished: true });
    }
    expect(await replayGame(definition, settings, 8, beforeEnd.moves)).toEqual({ score: beforeEnd.score, finished: false });

    // A completed run claims time on its last level too.
    const full = game.claimTime(playAll(3), 4);
    expect(replayBorderBlitz(game, 3, full.moves).score).toBe(full.score);
  });

  it('has no region to pick and one leaderboard; the daily challenge is left to decide', () => {
    const definition = getGame('border-blitz')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
    expect(DAILY_GAMES).not.toContain('border-blitz');
  });
});
