import { describe, expect, it } from 'vitest';
import { getCountry } from '@geogames/geodata';
import {
  MAX_HINTS,
  MAX_LIVES,
  START_HINTS,
  START_LIVES,
  createCircleArcade,
  famousNeeded,
  circleOverlap,
  hintText,
  sharesTooMany,
  planFor,
  replayCircleArcade,
  type ArcadeState,
} from './circle-arcade.ts';
import { distanceKm } from './circle.ts';
import { arcadePools } from './pools.ts';
import { getGame } from './catalog.ts';
import { arcadeRunSummary, replayGame } from './replay.ts';
import { DEFAULT_SETTINGS, normalizeSettings, settingsFromVariant, variantKey } from './settings.ts';

const pools = await arcadePools();
const game = createCircleArcade(pools);

/** Names every remaining top city of the current level. */
function clear(state: ArcadeState): ArcadeState {
  for (const id of game.remaining(state.level)) state = game.guess(state, id).state;
  return state;
}
/** A city outside the current circle that hasn't been guessed yet (repeats are free, so they'd loop). */
const outsider = (state: ArcadeState) =>
  [...game.cities.keys()].find((id) => !state.level.puzzle.inside.includes(id) && !state.level.guesses.includes(id))!;

describe('city circle arcade', () => {
  it('ramps up: more cities to find and smaller circles as levels go on', () => {
    expect(planFor(1).target).toBe(3);
    expect(planFor(21).target).toBe(7);
    expect(planFor(40)).toBe(planFor(21));

    let state = game.start(1);
    const levels: { target: number; radius: number; inside: number }[] = [];
    for (let i = 0; i < 21; i++) {
      const { level } = state;
      levels.push({ target: level.target, radius: level.puzzle.radiusKm, inside: level.puzzle.inside.length });
      const [min, max] = planFor(level.number).radius;
      expect(level.puzzle.radiusKm).toBeGreaterThanOrEqual(min);
      expect(level.puzzle.radiusKm).toBeLessThanOrEqual(max);
      expect(level.puzzle.inside.length).toBeGreaterThanOrEqual(level.target + 3);
      state = game.nextLevel(clear(state));
    }
    expect(levels[0]!.target).toBe(3);
    expect(levels[20]!.target).toBe(7);
    expect(levels[20]!.radius).toBeLessThan(levels[0]!.radius);
  });

  it('early levels are mostly about well-known cities, anywhere in the world', () => {
    expect(famousNeeded(planFor(1))).toBe(2);
    expect(famousNeeded(planFor(5))).toBe(2);
    const continents = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 12; n++) {
        const famous = game.top(state.level).filter((id) => pools.famous.has(id));
        expect(famous.length, `seed ${seed} level ${n}`).toBeGreaterThanOrEqual(famousNeeded(planFor(n)));
        if (n <= 4) continents.add(getCountry(game.cities.get(game.top(state.level)[0]!)!.countryId)!.continent);
        state = game.nextLevel(clear(state));
      }
    }
    expect(continents.size).toBeGreaterThanOrEqual(5);
  });

  it("doesn't ask the same city again within a few levels", () => {
    for (let seed = 1; seed <= 10; seed++) {
      let state = game.start(seed);
      const asked: string[][] = [];
      for (let n = 1; n <= 12; n++) {
        const top = game.top(state.level);
        for (const earlier of asked.slice(-4)) expect(top.filter((id) => earlier.includes(id))).toEqual([]);
        asked.push(top);
        state = game.nextLevel(clear(state));
      }
    }
  });

  it('plays with the city-proper data too', async () => {
    const proper = await arcadePools({ ...DEFAULT_SETTINGS, cityData: 'proper' });
    const properGame = createCircleArcade(proper);
    expect(properGame.cities.has('wup18-21599')).toBe(false);
    for (let seed = 1; seed <= 10; seed++) {
      let state = properGame.start(seed);
      for (let n = 1; n <= 25; n++) {
        expect(properGame.top(state.level).filter((id) => proper.famous.has(id)).length).toBeGreaterThanOrEqual(famousNeeded(planFor(n)));
        for (const id of properGame.remaining(state.level)) state = properGame.guess(state, id).state;
        state = properGame.nextLevel(state);
      }
    }
  });

  it('keeps a separate leaderboard for each Border Route mode', () => {
    const route = getGame('border-route')!;
    expect(variantKey(normalizeSettings({}, route), route)).toBe('world');
    // A run goes around the world, so a remembered region doesn't apply.
    const hard = normalizeSettings({ routeMode: 'hard', region: 'Europe' }, route);
    expect(hard.region).toBe('world');
    expect(variantKey(hard, route)).toBe('world-hard');
    expect(settingsFromVariant('world-hard', route)).toEqual(hard);
    // Quizzes have their own "hard", and no route mode.
    const quiz = getGame('capitals')!;
    expect(settingsFromVariant('world-hard', quiz).routeMode).toBe('easy');
    expect(settingsFromVariant('world-hard', quiz).difficulty).toBe('hard');
  });

  it('keeps a separate leaderboard for each city dataset', () => {
    const arcade = getGame('city-circle-arcade')!;
    const proper = normalizeSettings({ cityData: 'proper' }, arcade);
    expect(variantKey(normalizeSettings({}, arcade), arcade)).toBe('world');
    expect(variantKey(proper, arcade)).toBe('world-proper');
    expect(settingsFromVariant('world-proper', arcade).cityData).toBe('proper');
    // Other games have no such choice.
    expect(normalizeSettings({ cityData: 'proper' }, getGame('city-circle')!).cityData).toBe('metro');
  });

  it('measures how much two circles overlap', () => {
    const paris: readonly [number, number] = [48.86, 2.35];
    expect(circleOverlap({ center: paris, radiusKm: 1000 }, { center: paris, radiusKm: 1000 })).toBeCloseTo(1);
    expect(circleOverlap({ center: paris, radiusKm: 300 }, { center: paris, radiusKm: 1500 })).toBeCloseTo(0.04);
    expect(circleOverlap({ center: paris, radiusKm: 500 }, { center: [40.42, -3.7], radiusKm: 500 })).toBe(0);
    // Half the smaller circle's answers, rounded down: 1 of 3, 2 of 5.
    expect(sharesTooMany(['a', 'b', 'c'], ['a', 'x', 'y'])).toBe(false);
    expect(sharesTooMany(['a', 'b', 'c'], ['a', 'b', 'y', 'z', 'w'])).toBe(true);
    expect(sharesTooMany(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'x', 'y', 'z'])).toBe(false);
    expect(sharesTooMany(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'y', 'z'])).toBe(true);
  });

  it('never repeats a circle within a game', () => {
    for (let seed = 1; seed <= 8; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 20; n++) state = game.nextLevel(clear(state));
      const { past } = state;
      for (let i = 0; i < past.length; i++) {
        for (let j = 0; j < i; j++) {
          expect(circleOverlap(past[i]!, past[j]!), `seed ${seed}: levels ${j + 1} and ${i + 1}`).toBeLessThanOrEqual(0.5);
          expect(sharesTooMany(past[i]!.top, past[j]!.top), `seed ${seed}: levels ${j + 1} and ${i + 1}`).toBe(false);
        }
      }
    }
  });

  it('keeps consecutive circles apart', () => {
    let state = game.start(3);
    for (let i = 0; i < 6; i++) {
      const before = state.level.puzzle.center;
      state = game.nextLevel(clear(state));
      expect(distanceKm(before, state.level.puzzle.center)).toBeGreaterThan(1000);
    }
  });

  it('scores 10 × level per city and gives a life for a perfect level', () => {
    let state = clear(game.start(4));
    expect(state.status).toBe('level-clear');
    expect(state.score).toBe(3 * 10);
    expect(state.bonusLife).toBe(true);
    expect(state.lives).toBe(START_LIVES + 1);
    state = clear(game.nextLevel(state));
    expect(state.score).toBe(30 + 3 * 20);
  });

  it('costs a life for a skip but not for a wrong guess, and ends at zero lives', () => {
    let state = game.start(5);
    state = game.guess(state, outsider(state)).state;
    expect(state.lives).toBe(START_LIVES);
    expect(state.level.misses).toBe(1);
    const best = game.remaining(state.level)[0]!;
    state = game.skip(state);
    expect(state.level.skipped).toEqual([best]);
    expect(state.lives).toBe(START_LIVES - 1);
    state = clear(state);
    expect(state.bonusLife).toBe(false);
    expect(state.lives).toBe(START_LIVES - 1);

    // A level with only a miss is not perfect either.
    state = game.nextLevel(state);
    state = game.guess(state, outsider(state)).state;
    state = clear(state);
    expect(state.bonusLife).toBe(false);
    expect(state.lives).toBe(START_LIVES - 1);

    // Only skips end the game.
    while (state.status !== 'over') {
      if (state.status === 'level-clear') state = game.nextLevel(state);
      state = game.skip(state);
    }
    expect(state.status).toBe('over');
    expect(state.lives).toBe(0);
  });

  it('caps lives', () => {
    let state = game.start(6);
    for (let i = 0; i < 8; i++) state = game.nextLevel(clear(state));
    expect(state.lives).toBe(MAX_LIVES);
  });

  it('a hint shows the country and every third letter, once per city', () => {
    let state = game.start(7);
    expect(state.hintsLeft).toBe(START_HINTS);
    const target = game.hintTarget(state.level)!;
    state = game.hint(state);
    expect(state.level.hints[target.id]).toBe(1);
    expect(state.hintsLeft).toBe(START_HINTS - 1);
    const name = game.cities.get(target.id)!.name;
    expect(hintText(name, 0).replace(/[_ -]/g, '')).toBe('');
    // Every third letter, never the first: the search box would finish the name from it.
    expect(hintText('Pyongyang', 1)).toBe('__o__y__g');
    expect(hintText('Rio de Janeiro', 1)).toBe('__o _e _a__i__');
    expect(hintText(name, 1)[0]).toBe(name[0] === ' ' ? ' ' : '_');
    // The next hints move on to other cities instead of spelling this one out.
    state = game.hint(state);
    state = game.hint(state);
    expect(state.level.hints[target.id]).toBe(1);
    expect(Object.keys(state.level.hints)).toHaveLength(3);
    expect(state.hintsLeft).toBe(0);
    // Out of hints: nothing happens.
    expect(game.hint(state)).toBe(state);
    expect(getCountry(game.cities.get(target.id)!.countryId)).toBeDefined();
  });

  it('a hinted city is worth half', () => {
    let state = game.start(7);
    const [first, second] = game.remaining(state.level);
    state = game.hint(state); // on the best city
    state = game.guess(state, first!).state;
    expect(state.score).toBe(5);
    state = game.guess(state, second!).state;
    expect(state.score).toBe(15);
    expect(state.lives).toBe(START_LIVES);
  });

  it('gives a hint back only for a flawless level', () => {
    let state = game.start(8);
    state = game.hint(state);
    state = clear(state);
    expect(state.bonusHint).toBe(false);
    expect(state.hintsLeft).toBe(START_HINTS - 1);
    // No hints, but a skip: not flawless.
    state = game.skip(game.nextLevel(state));
    state = clear(state);
    expect(state.bonusHint).toBe(false);
    expect(state.hintsLeft).toBe(START_HINTS - 1);
    // No hints, but a miss: not flawless either.
    state = game.nextLevel(state);
    state = clear(game.guess(state, outsider(state)).state);
    expect(state.bonusHint).toBe(false);
    state = clear(game.nextLevel(state));
    expect(state.bonusHint).toBe(true);
    expect(state.hintsLeft).toBe(START_HINTS);
    for (let i = 0; i < 5; i++) state = clear(game.nextLevel(state));
    expect(state.hintsLeft).toBe(MAX_HINTS);
  });

  it('replays guesses, skips and hints to the same result', () => {
    let state = game.start(9);
    state = game.hint(state);
    state = game.guess(state, outsider(state)).state;
    state = game.skip(state);
    state = clear(state);
    state = game.nextLevel(state);
    state = clear(state);
    const replayed = replayCircleArcade(game, 9, state.moves);
    expect(replayed.score).toBe(state.score);
    expect(replayed.lives).toBe(state.lives);
    expect(replayed.level.number).toBe(state.level.number);
  });
});

describe('duels: one seed, the same circles whatever the player does', () => {
  const shape = (state: ArcadeState) => ({
    center: state.level.puzzle.center,
    radiusKm: state.level.puzzle.radiusKm,
    top: game.top(state.level),
  });

  it('gives a solver and a skipper identical circles for every level both reach', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const solver: ReturnType<typeof shape>[] = [];
      let a = game.start(seed);
      for (let n = 1; n <= 8; n++) {
        solver.push(shape(a));
        a = game.nextLevel(clear(a));
      }
      // The skipper uses a hint and skips, losing lives on the way.
      const skipper: ReturnType<typeof shape>[] = [];
      let b = game.start(seed);
      while (b.status !== 'over' && skipper.length < 8) {
        skipper.push(shape(b));
        b = game.hint(b);
        while (b.status === 'playing') b = game.skip(b);
        if (b.status === 'level-clear') b = game.nextLevel(b);
      }
      expect(skipper.length).toBeGreaterThan(1);
      expect(skipper).toEqual(solver.slice(0, skipper.length));
    }
  });

  it('summarises a run the way replayGame scores it', async () => {
    const definition = getGame('city-circle-arcade')!;
    const settings = normalizeSettings({}, definition);
    let state = clear(game.start(21));
    state = clear(game.nextLevel(state));
    while (state.status !== 'over') {
      if (state.status === 'level-clear') state = game.nextLevel(state);
      state = game.skip(state);
    }
    const summary = await arcadeRunSummary(settings, 21, state.moves);
    expect(summary).toEqual({ score: state.score, finished: true, level: state.level.number, cleared: state.level.number - 1 });
    expect((await replayGame(definition, settings, 21, state.moves)).score).toBe(summary.score);
    // A run that hasn't ended says so.
    expect((await arcadeRunSummary(settings, 21, [])).finished).toBe(false);
  });
});
