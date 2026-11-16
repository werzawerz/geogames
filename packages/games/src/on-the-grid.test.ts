import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { loadLandGrid } from '@geogames/geodata/land-grid';
import { getGame } from './catalog.ts';
import { arcadePools } from './pools.ts';
import { distanceKm } from './circle.ts';
import {
  GRID_CLICKS,
  GRID_MAX_LIVES,
  GRID_NEAR_KM,
  GRID_SKIP,
  bearingDegrees,
  compassPoint,
  createOnTheGrid,
  formatCoordinates,
  gridPlan,
  nearCity,
  NEAR_CITY_KM,
  replayOnTheGrid,
  type GridState,
} from './on-the-grid.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const grid = await loadLandGrid();
const countries = queryCountries();
const game = createOnTheGrid({ grid, countries });
const byId = new Map(countries.map((c) => [c.id, c]));
const definition = getGame('on-the-grid')!;
const SEEDS = 60;
const { cities } = await arcadePools();

/** A click far from the spot of the level, and from the same place twice. */
const wrong = (s: GridState, i = 0): [number, number] => [s.level.target[0] > 0 ? -40 + i : 40 + i, s.level.target[1] > 0 ? s.level.target[1] - 90 : s.level.target[1] + 90];
const right = (s: GridState) => game.click(s, s.level.target[0], s.level.target[1]).state;

/** Clears `count` levels first click: a run never ends by itself. */
const playPerfect = (seed: number, count = 60) => {
  let state = game.start(seed);
  const levels = [];
  while (levels.length < count) {
    levels.push(state.level);
    state = right(state);
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
};

describe('on the grid', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(playPerfect(5, 10).levels).toEqual(playPerfect(5, 10).levels);
    expect(playPerfect(5, 10).levels.map((l) => l.target)).not.toEqual(playPerfect(6, 10).levels.map((l) => l.target));
  });

  it('has the land points to play from, all labelled', () => {
    expect(grid.cells.length).toBeGreaterThan(10_000);
    for (const [lat, lng, c] of grid.cells) {
      expect(Math.abs(lat)).toBeLessThanOrEqual(80);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      expect(grid.countries[c]).toBeTruthy();
    }
  });

  it('plans the bands: grid lines, then key lines, then none; tighter late', () => {
    expect(gridPlan(1)).toMatchObject({ band: 1, lines: 'every-10', step: 10 });
    expect(gridPlan(8).band).toBe(1);
    expect(gridPlan(9)).toMatchObject({ band: 2, lines: 'key', step: 5 });
    expect(gridPlan(21)).toMatchObject({ band: 3, lines: 'none', step: 1 });
    expect(gridPlan(100).radiusKm).toBeLessThan(gridPlan(21).radiusKm);
  });

  it('asks on-step land spots, and early ones fairly, across many seeds', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed).levels) {
        const plan = gridPlan(level.number);
        const [lat, lng] = level.target;
        expect(lat % plan.step === 0 && lng % plan.step === 0, `${seed}/${level.number}`).toBe(true);
        expect(grid.cells.some(([a, b, c]) => a === lat && b === lng && grid.countries[c] === level.country)).toBe(true);
        if (plan.fair) {
          const c = byId.get(level.country)!;
          expect(c.continent).not.toBe('Africa');
          expect(c.subregion).not.toBe('Caribbean');
        }
      }
    }
  });

  it('never repeats a spot in a run, nor asks one near the one before', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed);
      expect(new Set(levels.map((l) => `${l.target}`)).size).toBe(levels.length);
      for (let i = 1; i < levels.length; i++) {
        expect(distanceKm(levels[i]!.target, levels[i - 1]!.target), `${seed}/${i}`).toBeGreaterThanOrEqual(GRID_NEAR_KM);
      }
    }
  });

  it('scores a first-click find with the flawless bonus and a life back', () => {
    let state = game.start(3);
    state = game.click(state, state.level.target[0], state.level.target[1]).state;
    expect(state.level).toMatchObject({ status: 'cleared', flawless: true, points: 15 });
    expect(state).toMatchObject({ score: 15, lives: GRID_MAX_LIVES, marks: ['flawless'], status: 'level-over' });
  });

  it('gives lives back only up to the maximum, and only when flawless', () => {
    let state = game.start(3);
    state = game.skip(state);
    expect(state.lives).toBe(2);
    state = right(game.nextLevel(state));
    expect(state.lives).toBe(3);
    state = right(game.nextLevel(state));
    expect(state.lives).toBe(3);
    // A find on the second click earns less and no life.
    state = game.skip(game.nextLevel(state));
    state = game.nextLevel(state);
    state = game.click(state, ...wrong(state)).state;
    state = right(state);
    expect(state.level).toMatchObject({ status: 'cleared', flawless: false });
    expect(state.level.points).toBe(Math.round(10 * state.level.number * 0.6));
    expect(state.lives).toBe(2);
  });

  it('shows the way and the distance after a miss, and the level goes on', () => {
    const state = game.start(4);
    const [lat, lng] = wrong(state);
    const { state: after, result } = game.click(state, lat, lng);
    expect(result).toBe('miss');
    expect(after.status).toBe('playing');
    const click = after.level.clicks[0]!;
    expect(click.km).toBeCloseTo(distanceKm([lat, lng], state.level.target), 6);
    expect(click.bearing).toBeCloseTo(bearingDegrees([lat, lng], state.level.target), 6);
    expect(after.lives).toBe(3);
  });

  it('costs one life on the third miss and ends the level', () => {
    let state = game.start(4);
    for (let i = 0; i < GRID_CLICKS - 1; i++) {
      const step = game.click(state, ...wrong(state, i));
      expect(step.result).toBe('miss');
      state = step.state;
    }
    const { state: lost, result } = game.click(state, ...wrong(state, 5));
    expect(result).toBe('lost');
    expect(lost).toMatchObject({ lives: 2, status: 'level-over', marks: ['lost'] });
    expect(lost.level.status).toBe('lost');
    expect(game.click(lost, 0, 0).result).toBe('invalid');
  });

  it('a skip costs one life and the run ends when they are gone', () => {
    let state = game.start(8);
    for (let i = 0; i < 3; i++) {
      expect(state.status).toBe('playing');
      state = game.skip(state);
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    expect(state).toMatchObject({ status: 'over', lives: 0 });
    expect(game.skip(state)).toBe(state);
  });

  it('accepts a click within the radius as a find, and refuses nonsense', () => {
    const state = game.start(9);
    const [lat, lng] = state.level.target;
    expect(game.click(state, NaN, 0).result).toBe('invalid');
    expect(game.click(state, 95, 0).result).toBe('invalid');
    // About 300 km north: inside the first band's 500 km.
    expect(game.click(state, lat + 300 / 111.195, lng).result).toBe('found');
  });

  it('wraps a click past the date line', () => {
    const { state } = game.click(game.start(9), 10, 190);
    expect(state.level.clicks[0]!.at[1]).toBe(-170);
  });

  it('names coordinates and directions', () => {
    expect(formatCoordinates([-23, -47])).toBe('23°S, 47°W');
    expect(formatCoordinates([30, 31])).toBe('30°N, 31°E');
    expect(formatCoordinates([0, 0])).toBe('0°N, 0°');
    expect(compassPoint(0)).toBe('north');
    expect(compassPoint(95)).toBe('east');
    expect(compassPoint(359)).toBe('north');
    expect(compassPoint(225)).toBe('south-west');
    expect(bearingDegrees([0, 0], [10, 0])).toBeCloseTo(0);
    expect(bearingDegrees([0, 0], [0, 10])).toBeCloseTo(90);
  });

  it('replays to the same state, and the server replay agrees', async () => {
    let state = game.start(11);
    for (let i = 1; i <= 25; i++) {
      if (i % 7 === 0) state = game.skip(state);
      else {
        if (i % 3 === 0) state = game.click(state, ...wrong(state)).state;
        state = right(state);
      }
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    while (state.status !== 'over') {
      for (let i = 0; i < GRID_CLICKS && state.status === 'playing'; i++) state = game.click(state, ...wrong(state, i)).state;
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    expect(replayOnTheGrid(game, 11, state.moves)).toEqual(state);
    expect(state.moves).toContain(GRID_SKIP);
    expect(await replayGame(definition, normalizeSettings({}, definition), 11, state.moves)).toEqual({ score: state.score, finished: true });
  });

  it('keeps band 1 out of the Arctic and the empty south', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 8).levels) expect(Math.abs(level.target[0]), `${seed}`).toBeLessThanOrEqual(55);
    }
  });

  it('allows two clicks from level 26, and the second miss costs the life', () => {
    expect(gridPlan(25).clicks).toBe(3);
    expect(gridPlan(26).clicks).toBe(2);
    let state = game.start(6);
    while (state.level.number < 26) state = game.nextLevel(right(state));
    state = game.click(state, ...wrong(state)).state;
    expect(state.status).toBe('playing');
    const { state: lost, result } = game.click(state, ...wrong(state, 1));
    expect(result).toBe('lost');
    expect(lost.lives).toBe(2);
  });

  it('keeps the closest find for the end screen', () => {
    let state = game.start(3);
    expect(state.closestKm).toBeNull();
    const [lat, lng] = state.level.target;
    state = game.click(state, lat + 1, lng).state;
    expect(state.closestKm).toBeCloseTo(distanceKm([lat + 1, lng], [lat, lng]), 3);
    state = game.nextLevel(state);
    state = right(state);
    expect(state.closestKm).toBe(0);
  });

  it('never has a point in a disputed place or on a border', () => {
    const inBox = (lat: number, lng: number, [s, n, w, e]: number[]) => lat >= s! && lat <= n! && lng >= w! && lng <= e!;
    for (const [lat, lng] of grid.cells) {
      expect(inBox(lat, lng, [32.5, 37.2, 72.5, 80.8]), `${lat},${lng} Kashmir`).toBe(false);
      expect(inBox(lat, lng, [44, 46.6, 32.4, 36.8]), `${lat},${lng} Crimea`).toBe(false);
    }
    // 43°N 20°E sits on the Serbia and Montenegro border region: not a point.
    expect(grid.cells.some(([lat, lng]) => lat === 43 && lng === 20)).toBe(false);
  });

  it('names a nearby city only in the same country, and close', () => {
    let named = 0;
    for (const [lat, lng, c] of grid.cells) {
      const country = grid.countries[c]!;
      const city = nearCity([lat, lng], country, cities);
      if (!city) continue;
      named++;
      expect(city.countryId, `${lat},${lng}`).toBe(country);
      expect(distanceKm([lat, lng], city.latlng), `${lat},${lng} ${city.name}`).toBeLessThanOrEqual(NEAR_CITY_KM);
      expect(city.name).not.toMatch(/industrial/i);
    }
    expect(named).toBeGreaterThan(300);
  });

  it('has no region setting', () => {
    expect(usesRegion(definition)).toBe(false);
  });
});
