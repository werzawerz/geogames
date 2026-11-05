import { describe, expect, it } from 'vitest';
import { getCountry, queryCountries } from '@geogames/geodata';
import { getGame } from './catalog.ts';
import { DAILY_GAMES } from './daily.ts';
import {
  MYSTERY_LEVELS,
  compassBetween,
  createCountryClues,
  createMysteryCountry,
  mysteryExtraClues,
  mysteryPlan,
  replayMysteryCountry,
  type MysteryState,
} from './mystery-country.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion, variantKey } from './settings.ts';

const countries = queryCountries();
const game = createMysteryCountry({ countries, rounds: 20 });
const wrongFor = (state: MysteryState) => countries.find((c) => c.id !== state.target && !state.guesses.includes(c.id))!.id;

const playAll = (seed: number) => {
  let state = game.start(seed);
  for (;;) {
    state = game.guess(state, state.target).state;
    if (state.status === 'over') return state;
    state = game.nextLevel(state);
  }
};
const remote = (id: string) => getCountry(id)?.continent === 'Africa' || getCountry(id)?.subregion === 'Caribbean';

describe('mystery country', () => {
  it('has the data every clue needs, for every country', () => {
    for (const c of countries) {
      expect(c.metrics.population?.value, c.id).toBeGreaterThan(0);
      expect(c.metrics.area?.value, c.id).toBeGreaterThan(0);
      expect(c.subregion, c.id).toBeTruthy();
      expect(c.capitals.length, c.id).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a seed', () => {
    expect(game.start(5).target).toBe(game.start(5).target);
  });

  it('never repeats a country in a run, and keeps the early levels familiar', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { past } = playAll(seed);
      expect(past).toHaveLength(20);
      expect(new Set(past).size).toBe(20);
      past.slice(0, 10).forEach((id, i) => expect(remote(id), `seed ${seed} level ${i + 1}: ${id}`).toBe(false));
    }
  });

  it('never gives two in a row from the same part of the world', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { past } = playAll(seed);
      past.slice(1).forEach((id, i) => expect(getCountry(id)!.subregion).not.toBe(getCountry(past[i]!)!.subregion));
    }
  });

  it('pays more for fewer guesses and higher levels', () => {
    const first = game.guess(game.start(1), game.start(1).target);
    expect(first.result).toBe('correct');
    expect(first.state.score).toBe(10 * 1 * 6);
    expect(first.state.status).toBe('level-clear');

    let late = game.start(1);
    late = game.guess(late, wrongFor(late)).state;
    late = game.guess(late, wrongFor(late)).state;
    expect(game.guess(late, late.target).state.score).toBe(10 * 1 * 4);

    const full = playAll(2);
    const perfect = full.past.reduce((sum, _, i) => sum + 10 * (i + 1) * mysteryPlan(i + 1).guesses, 0);
    expect(full.score).toBe(perfect);
    expect(full.completed).toBe(true);
    expect(full.solvedIn).toEqual(Array(20).fill(1));
  });

  it('has fewer guesses later on, and the last guess still counts', () => {
    expect(MYSTERY_LEVELS.map((p) => p.guesses)).toEqual([6, 6, 5, 4]);
    let state = game.start(3);
    for (let i = 0; i < 5; i++) state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('playing');
    const last = game.guess(state, state.target).state;
    expect(last.status).toBe('level-clear');
    expect(last.score).toBe(10);
  });

  it('ends the run when the guesses are gone, keeping the score', () => {
    let state = game.nextLevel(game.guess(game.start(4), game.start(4).target).state);
    const { score } = state;
    while (state.status === 'playing') state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('over');
    expect(state.completed).toBe(false);
    expect(state.score).toBe(score);
    expect(state.guesses).toHaveLength(6);
  });

  it('charges nothing for naming the same country twice, or one not in the game', () => {
    const start = game.start(6);
    const once = game.guess(start, wrongFor(start)).state;
    const again = game.guess(once, once.guesses[0]!);
    expect(again.result).toBe('repeat');
    expect(again.state).toBe(once);
    expect(game.guess(start, 'nope').result).toBe('unknown');
  });

  it('replays to the same result, and can be verified by a server', async () => {
    let state = game.start(8);
    state = game.guess(state, wrongFor(state)).state;
    state = game.guess(state, state.target).state;
    state = game.nextLevel(state);
    const beforeEnd = state.moves;
    while (state.status === 'playing') state = game.guess(state, wrongFor(state)).state;
    const replayed = replayMysteryCountry(game, 8, state.moves);
    expect(replayed.score).toBe(state.score);
    expect(replayed.status).toBe('over');
    expect(replayed.past).toEqual(state.past);

    const definition = getGame('mystery-country')!;
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 8, state.moves)).toEqual({ score: state.score, finished: true });
    expect(await replayGame(definition, settings, 8, beforeEnd)).toMatchObject({ finished: false });
  });

  it('has no region to pick, one leaderboard, and a daily challenge', () => {
    const definition = getGame('mystery-country')!;
    expect(usesRegion(definition)).toBe(false);
    expect(variantKey(normalizeSettings({ region: 'Europe' }, definition), definition)).toBe('world');
    expect(DAILY_GAMES).toContain('mystery-country');
  });
});

describe('the clues', () => {
  const clue = createCountryClues(countries);
  const c = (id: string) => getCountry(id)!;

  it('points from the guess towards the mystery country', () => {
    expect(compassBetween([0, 0], [10, 0])).toBe('N');
    expect(compassBetween([0, 0], [0, 10])).toBe('E');
    expect(compassBetween([0, 0], [-10, 0])).toBe('S');
    expect(compassBetween([0, 0], [0, -10])).toBe('W');
    expect(clue(c('POL'), c('ESP')).compass).toBe('NE');
    expect(clue(c('ESP'), c('POL')).compass).toBe('SW');
    // Across the date line, the short way round.
    expect(compassBetween([0, 179], [0, -179])).toBe('E');
  });

  it('measures centre to centre, and spots neighbours and continents', () => {
    const near = clue(c('DEU'), c('FRA'));
    expect(near.km).toBeGreaterThan(500);
    expect(near.km).toBeLessThan(1200);
    expect(near.neighbour).toBe(true);
    expect(near.sameContinent).toBe(true);
    const far = clue(c('JPN'), c('BRA'));
    expect(far.km).toBeGreaterThan(15_000);
    expect(far.neighbour).toBe(false);
    expect(far.sameContinent).toBe(false);
  });

  it('compares the mystery country to the guess, not the other way round', () => {
    expect(clue(c('CHN'), c('LUX')).population).toBe('much-more');
    expect(clue(c('LUX'), c('CHN')).population).toBe('much-less');
    expect(clue(c('FRA'), c('ESP')).population).toBe('more');
    expect(clue(c('ESP'), c('FRA')).population).toBe('less');
    expect(clue(c('RUS'), c('MLT')).area).toBe('much-more');
    expect(clue(c('FRA'), c('FRA')).area).toBe('same');
  });

  it('unlocks the capital just before the last guess, on every plan', () => {
    for (const { from, guesses } of MYSTERY_LEVELS) {
      const extra = mysteryExtraClues(from);
      expect(extra.capital).toBe(guesses - 1);
      expect(extra.coast).toBeLessThanOrEqual(extra.subregion);
      expect(extra.subregion).toBeLessThanOrEqual(extra.capital);
    }
  });
});
