import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { loadLandGrid } from '@geogames/geodata/land-grid';
import { getGame } from './catalog.ts';
import { distanceKm } from './circle.ts';
import {
  GRID_COUNTRY_GAP,
  GRID_MAX_LIVES,
  GRID_SKIP,
  NEAR_CITY_KM,
  bearingDegrees,
  compassPoint,
  createOnTheGrid,
  formatCoordinates,
  gridPlan,
  nearCity,
  replayOnTheGrid,
  type GridState,
} from './on-the-grid.ts';
import { arcadePools } from './pools.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const grid = await loadLandGrid();
const countries = queryCountries();
const game = createOnTheGrid({ grid, countries });
const byId = new Map(countries.map((c) => [c.id, c]));
const definition = getGame('on-the-grid')!;
const SEEDS = 60;
const { cities } = await arcadePools();
const cellOf = (lat: number, lng: number) => grid.cells.find(([a, b]) => a === lat && b === lng);

/** A country that isn't the answer, and not yet tried. */
const wrongFor = (s: GridState) => countries.map((c) => c.id).find((id) => id !== s.level.country && !s.level.guesses.includes(id))!;
const right = (s: GridState) => game.guess(s, s.level.country).state;

/** Clears `count` levels first guess: a run never ends by itself. */
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

  it('plans the bands: misses, map and distance from borders', () => {
    expect(gridPlan(1)).toMatchObject({ band: 1, step: 10, minClearKm: 300, misses: 3, mapHidden: false, maxLat: 55 });
    expect(gridPlan(8).band).toBe(1);
    expect(gridPlan(9)).toMatchObject({ band: 2, step: 5, minClearKm: 150, misses: 3 });
    expect(gridPlan(21)).toMatchObject({ band: 3, step: 1, misses: 2, mapHidden: false });
    expect(gridPlan(40).mapHidden).toBe(false);
    expect(gridPlan(41)).toMatchObject({ band: 4, misses: 1, mapHidden: true });
    expect(gridPlan(500).mapHidden).toBe(true);
  });

  it('asks on-step points, well clear of borders early, and fairly in band 1, across many seeds', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed).levels) {
        const plan = gridPlan(level.number);
        const [lat, lng] = level.target;
        expect(lat % plan.step === 0 && lng % plan.step === 0, `${seed}/${level.number}`).toBe(true);
        expect(Math.abs(lat)).toBeLessThanOrEqual(plan.maxLat);
        const cell = cellOf(lat, lng)!;
        expect(grid.countries[cell[2]!], `${seed}/${level.number}`).toBe(level.country);
        expect(cell[3]!, `${seed}/${level.number}`).toBeGreaterThanOrEqual(plan.minClearKm);
        if (plan.band === 1) {
          const c = byId.get(level.country)!;
          expect(c.continent).not.toBe('Africa');
          expect(c.subregion).not.toBe('Caribbean');
        }
      }
    }
  });

  it('never repeats a point or a country in a row, and spreads countries out', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed);
      expect(new Set(levels.map((l) => `${l.target}`)).size).toBe(levels.length);
      for (let i = 1; i < levels.length; i++) expect(levels[i]!.country, `${seed}/${i}`).not.toBe(levels[i - 1]!.country);
      // From band 3 there are a hundred countries to choose from: none returns within the gap.
      for (let i = 21; i < levels.length; i++) {
        const lately = levels.slice(i - GRID_COUNTRY_GAP, i).map((l) => l.country);
        expect(lately, `${seed}/${i}`).not.toContain(levels[i]!.country);
      }
    }
  });

  it('scores a first-guess find with the flawless bonus and a life back', () => {
    let state = game.start(3);
    state = right(state);
    expect(state.level).toMatchObject({ status: 'cleared', flawless: true, points: 15 });
    expect(state).toMatchObject({ score: 15, lives: GRID_MAX_LIVES, marks: ['flawless'], status: 'level-over' });
  });

  it('keeps points lower after misses, with no life back', () => {
    let state = game.start(3);
    state = game.skip(state);
    expect(state.lives).toBe(2);
    state = game.nextLevel(state);
    state = game.guess(state, wrongFor(state)).state;
    state = right(state);
    expect(state.level).toMatchObject({ status: 'cleared', flawless: false });
    expect(state.level.points).toBe(Math.round(10 * state.level.number * 0.6));
    expect(state.lives).toBe(2);
    expect(state.marks.at(-1)).toBe('cleared');
    state = right(game.nextLevel(state));
    expect(state.lives).toBe(3);
    state = right(game.nextLevel(state));
    expect(state.lives).toBe(3);
  });

  it('costs one life on the third wrong country, and ends the level', () => {
    let state = game.start(4);
    for (let i = 0; i < 2; i++) {
      const step = game.guess(state, wrongFor(state));
      expect(step.result).toBe('wrong');
      state = step.state;
    }
    const { state: lost, result } = game.guess(state, wrongFor(state));
    expect(result).toBe('lost');
    expect(lost).toMatchObject({ lives: 2, status: 'level-over', marks: ['lost'] });
    expect(lost.level.status).toBe('lost');
    expect(game.guess(lost, lost.level.country).result).toBe('unknown');
  });

  it('allows fewer misses later: two from level 21, one from level 41', () => {
    let state = game.start(6);
    while (state.level.number < 21) state = game.nextLevel(right(state));
    state = game.guess(state, wrongFor(state)).state;
    expect(state.status).toBe('playing');
    expect(game.guess(state, wrongFor(state)).result).toBe('lost');
    state = game.start(6);
    while (state.level.number < 41) state = game.nextLevel(right(state));
    expect(game.guess(state, wrongFor(state)).result).toBe('lost');
  });

  it('ignores a repeated or unknown country, and a skip costs a life; lives run out', () => {
    let state = game.start(8);
    const wrong = wrongFor(state);
    state = game.guess(state, wrong).state;
    expect(game.guess(state, wrong).result).toBe('repeat');
    expect(game.guess(state, 'ZZZ').result).toBe('unknown');
    for (let i = 0; i < 3; i++) {
      state = game.skip(state);
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    expect(state).toMatchObject({ status: 'over', lives: 0 });
    expect(game.skip(state)).toBe(state);
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

  it('has no point in a disputed place or on a border', () => {
    const inBox = (lat: number, lng: number, [s, n, w, e]: number[]) => lat >= s! && lat <= n! && lng >= w! && lng <= e!;
    for (const [lat, lng] of grid.cells) {
      expect(inBox(lat, lng, [32.5, 37.2, 72.5, 80.8]), `${lat},${lng} Kashmir`).toBe(false);
      expect(inBox(lat, lng, [44, 46.6, 32.4, 36.8]), `${lat},${lng} Crimea`).toBe(false);
    }
    expect(grid.cells.some(([lat, lng]) => lat === 43 && lng === 20)).toBe(false);
  });

  it('names a nearby city only in the same country, and close', () => {
    let named = 0;
    // Each point is checked against the whole pool, grouped by country only to keep the test quick.
    const byCountry = new Map<string, typeof cities>();
    for (const city of cities) byCountry.set(city.countryId, [...(byCountry.get(city.countryId) ?? []), city]);
    for (const [lat, lng, c] of grid.cells) {
      const country = grid.countries[c]!;
      const city = nearCity([lat, lng], country, byCountry.get(country) ?? []);
      if (!city) continue;
      named++;
      expect(city.countryId, `${lat},${lng}`).toBe(country);
      expect(distanceKm([lat, lng], city.latlng), `${lat},${lng} ${city.name}`).toBeLessThanOrEqual(NEAR_CITY_KM);
      expect(city.name).not.toMatch(/industrial/i);
    }
    expect(named).toBeGreaterThan(300);
    // And a city of another country is never named, however near.
    const [lat, lng, c] = grid.cells[0]!;
    const others = cities.filter((city) => city.countryId !== grid.countries[c]);
    expect(nearCity([lat, lng], grid.countries[c]!, others)).toBeNull();
  }, 30_000);

  it('replays to the same state, and the server replay agrees', async () => {
    let state = game.start(11);
    for (let i = 1; i <= 45; i++) {
      if (i % 7 === 0) state = game.skip(state);
      else {
        if (i % 3 === 0) state = game.guess(state, wrongFor(state)).state;
        state = right(state);
      }
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    while (state.status !== 'over') {
      state = game.guess(state, wrongFor(state)).state;
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    expect(replayOnTheGrid(game, 11, state.moves)).toEqual(state);
    expect(state.moves).toContain(GRID_SKIP);
    expect(await replayGame(definition, normalizeSettings({}, definition), 11, state.moves)).toEqual({ score: state.score, finished: true });
  });

  it('has no region setting', () => {
    expect(usesRegion(definition)).toBe(false);
  });
});
