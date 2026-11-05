import { describe, expect, it } from 'vitest';
import { getCountry, queryCountries } from '@geogames/geodata';
import { loadGreatCircles } from '@geogames/geodata/cities';
import { loadWorldShapes } from '@geogames/geodata/shapes';
import { getGame } from './catalog.ts';
import {
  GC_MAX_LIVES,
  GC_START_LIVES,
  GREAT_CIRCLE_LEVELS,
  createGreatCircle,
  greatCirclePlan,
  replayGreatCircle,
  type GreatCircleState,
} from './great-circle.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const { puzzles } = await loadGreatCircles();
const countries = queryCountries();
const game = createGreatCircle({ puzzles, countries, rounds: 20 });

const clear = (state: GreatCircleState) => {
  for (const id of game.remaining(state)) state = game.guess(state, id).state;
  return state;
};
const notOnLine = (state: GreatCircleState) =>
  countries.find(
    (c) =>
      !state.puzzle.via.includes(c.id) &&
      c.id !== state.puzzle.from.countryId &&
      c.id !== state.puzzle.to.countryId &&
      !state.wrong.includes(c.id),
  )!.id;
const playAll = (seed: number) => {
  let state = game.start(seed);
  for (;;) {
    state = clear(state);
    if (state.status === 'over') return state;
    state = game.nextLevel(state);
  }
};

describe('the lines', () => {
  it('are all fair questions', async () => {
    const shapes = await loadWorldShapes();
    expect(puzzles.length).toBeGreaterThan(2000);
    for (const p of puzzles) {
      expect(p.from.countryId).not.toBe(p.to.countryId);
      expect(p.via.length).toBeGreaterThan(0);
      // No country twice, and every country can be named and seen.
      const route = [p.from.countryId, ...p.via, p.to.countryId];
      expect(new Set(route).size).toBe(route.length);
      for (const id of p.via) {
        expect(getCountry(id)).toBeDefined();
        expect(shapes.countries.has(id)).toBe(true);
      }
    }
  });

  it('match what the map shows', () => {
    const find = (from: string, to: string) => puzzles.find((p) => p.from.name === from && p.to.name === to);
    const line = find('Barcelona', 'Copenhagen');
    if (line) expect(line.via).toEqual(['FRA', 'DEU']);
    // A line across Western Europe has to cross France or Germany, if any such line exists.
    const western = puzzles.filter((p) => p.from.countryId === 'ESP' && p.to.countryId === 'POL');
    for (const p of western) expect(p.via.includes('FRA') || p.via.includes('DEU')).toBe(true);
  });
});

describe('great circle', () => {
  it('is deterministic for a seed', () => {
    expect(game.start(5).puzzle).toEqual(game.start(5).puzzle);
  });

  it('follows the level plans over a whole run, on any seed', () => {
    const remote = (id: string) => getCountry(id)?.continent === 'Africa' || getCountry(id)?.subregion === 'Caribbean';
    for (let seed = 1; seed <= 25; seed++) {
      playAll(seed).past.forEach((p, i) => {
        const plan = greatCirclePlan(i + 1);
        const where = `seed ${seed} level ${i + 1}: ${p.from.name} → ${p.to.name}`;
        expect(p.via.length, where).toBeGreaterThanOrEqual(plan.between[0]);
        expect(p.via.length, where).toBeLessThanOrEqual(plan.between[1]);
        if (plan.easyEnds) expect(p.easy, where).toBe(true);
        if (plan.scope !== 'any') expect([p.from.countryId, p.to.countryId, ...p.via].filter(remote), where).toEqual([]);
      });
    }
  });

  it('keeps Chinese and Indian cities out of the early levels, unless huge', () => {
    const allowed = new Set(['Beijing', 'Shanghai', 'Delhi', 'Mumbai']);
    for (let seed = 1; seed <= 25; seed++) {
      for (const p of playAll(seed).past.slice(0, 8)) {
        for (const end of [p.from, p.to]) {
          if (end.countryId === 'CHN' || end.countryId === 'IND') expect(allowed.has(end.name), end.name).toBe(true);
        }
      }
    }
  });

  it('never repeats a city in a run, nor most of an earlier line', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { past } = playAll(seed);
      expect(past).toHaveLength(GREAT_CIRCLE_LEVELS.length * 4);
      const ends = past.flatMap((p) => [p.from.id, p.to.id]);
      expect(new Set(ends).size).toBe(ends.length);
      past.forEach((p, i) => {
        for (const q of past.slice(0, i)) {
          const shared = p.via.filter((id) => q.via.includes(id)).length;
          expect(shared).toBeLessThanOrEqual(Math.floor(0.5 * Math.min(p.via.length, q.via.length)));
        }
      });
    }
  });

  it('scores 10 × level per country, gives a life for a perfect level, and ends after level 20', () => {
    let state = game.start(1);
    const { length } = state.puzzle.via;
    state = clear(state);
    expect(state.status).toBe('level-clear');
    expect(state.score).toBe(10 * length);
    expect(state.bonusLife).toBe(true);
    expect(state.lives).toBe(GC_START_LIVES + 1);

    const full = playAll(2);
    expect(full.status).toBe('over');
    expect(full.completed).toBe(true);
    expect(full.level).toBe(20);
    expect(full.lives).toBe(GC_MAX_LIVES);
    expect(full.score).toBe(full.past.reduce((sum, p, i) => sum + 10 * (i + 1) * p.via.length, 0));
  });

  it('accepts countries in any order', () => {
    let state = game.start(3);
    while (state.puzzle.via.length < 2) state = game.nextLevel(clear(state));
    const backwards = [...state.puzzle.via].reverse();
    for (const id of backwards) expect(game.guess(state, id).result).toBe('found');
    for (const id of backwards) state = game.guess(state, id).state;
    expect(state.status).toBe('level-clear');
  });

  it('costs a life for a wrong country, once each, and nothing for the ends', () => {
    const start = game.start(4);
    const wrong = notOnLine(start);
    const first = game.guess(start, wrong);
    expect(first.result).toBe('wrong');
    expect(first.state.lives).toBe(GC_START_LIVES - 1);
    const again = game.guess(first.state, wrong);
    expect(again.result).toBe('repeat');
    expect(again.state).toBe(first.state);
    expect(game.guess(start, start.puzzle.from.countryId).result).toBe('endpoint');
    expect(game.guess(start, start.puzzle.to.countryId).state).toBe(start);
    // A level with a mistake earns no life.
    const cleared = clear(first.state);
    expect(cleared.bonusLife).toBe(false);
    expect(cleared.lives).toBe(GC_START_LIVES - 1);
  });

  it('gives away the next country for a life, without points', () => {
    const start = game.start(6);
    const next = game.skip(start);
    expect(next.skipped).toEqual([start.puzzle.via[0]]);
    expect(next.lives).toBe(GC_START_LIVES - 1);
    expect(next.score).toBe(0);
  });

  it('ends when the lives are gone, keeping the score', () => {
    let state = game.nextLevel(clear(game.start(7)));
    const { score } = state;
    while (state.status === 'playing') state = game.guess(state, notOnLine(state)).state;
    expect(state.status).toBe('over');
    expect(state.completed).toBe(false);
    expect(state.lives).toBe(0);
    expect(state.score).toBe(score);
  });

  it('replays to the same result, and can be verified by a server', async () => {
    let state = game.nextLevel(clear(game.start(8)));
    state = game.guess(state, notOnLine(state)).state;
    state = game.skip(state);
    if (state.status === 'level-clear') state = game.nextLevel(state);
    state = clear(state);
    if (state.status === 'level-clear') state = game.nextLevel(state);
    const beforeEnd = state.moves;
    while (state.status === 'playing') state = game.guess(state, notOnLine(state)).state;
    const replayed = replayGreatCircle(game, 8, state.moves);
    expect(replayed.score).toBe(state.score);
    expect(replayed.status).toBe('over');
    expect(replayed.past).toEqual(state.past);

    const definition = getGame('great-circle')!;
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 8, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(definition, settings, 8, beforeEnd)).toMatchObject({ finished: false });
  });

  it('has no region to pick, and one leaderboard', () => {
    const definition = getGame('great-circle')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
  });
});
