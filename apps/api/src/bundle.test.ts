import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DATASET_VERSION,
  GAMES,
  arcadePools,
  createChoiceQuiz,
  createCircleArcade,
  createHalfway,
  halfwayPools,
  distanceKm,
  createMysteryCountry,
  createRouteGame,
  normalizeSettings,
  quizItems,
  replayGame,
  routeCountries,
  type CircleArcade,
  type GameDefinition,
  type QuizDefinition,
  type RouteDefinition,
} from '@geogames/games';
import { queryCountries } from '@geogames/geodata';
import { bundle } from '../scripts/bundle.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The replay code with the server's slimmed data, as a module to compare against the full data. */
const dir = await mkdtemp(join(tmpdir(), 'geogames-bundle-'));
afterAll(() => rm(dir, { recursive: true, force: true }));
const entry = join(HERE, '__replay-entry.ts');
await writeFile(entry, `export { DATASET_VERSION, replayGame } from '@geogames/games';\n`);
const bytes = await bundle(entry, join(dir, 'replay.mjs'));
await rm(entry);
const server = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'replay.mjs')).href)) as {
  DATASET_VERSION: string;
  replayGame: typeof replayGame;
};

const playArcade = (game: CircleArcade, seed: number) => {
  let state = game.start(seed);
  for (let i = 0; i < 6; i++) {
    for (const id of game.remaining(state.level)) state = game.guess(state, id).state;
    state = game.nextLevel(state);
  }
  state = game.hint(state);
  while (state.status !== 'over') {
    if (state.status === 'level-clear') state = game.nextLevel(state);
    state = game.skip(state);
  }
  return state.moves;
};

describe('the server bundle', () => {
  it('stays under the deploy limit', () => {
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
  });

  it('is on the same data version as the web app', () => {
    expect(server.DATASET_VERSION).toBe(DATASET_VERSION);
  });

  it('scores arcade games the same with its slimmed data', async () => {
    const game = GAMES.find((g) => g.kind === 'circle-arcade')!;
    for (const cityData of ['metro', 'proper'] as const) {
      const settings = normalizeSettings({ cityData }, game);
      const engine = createCircleArcade(await arcadePools(settings));
      const moves = playArcade(engine, 12345);
      const full = await replayGame(game, settings, 12345, moves);
      expect(full.finished).toBe(true);
      expect(full.score).toBeGreaterThan(0);
      expect(await server.replayGame(game, settings, 12345, moves)).toEqual(full);
    }
  });

  it('scores route and quiz games the same', async () => {
    const route = GAMES.find((g) => g.kind === 'route') as RouteDefinition;
    const settings = normalizeSettings({}, route);
    const engine = createRouteGame({ countries: routeCountries(settings), rounds: route.rounds });
    let state = engine.start(7);
    while (state.status !== 'over') {
      if (state.status === 'round-over') state = engine.nextRound(state);
      const round = engine.current(state);
      for (const id of engine.shortestRoute(round.puzzle).slice(1, -1)) state = engine.guess(state, id).state;
    }
    expect(await server.replayGame(route, settings, 7, state.moves)).toEqual(await replayGame(route, settings, 7, state.moves));

    const definition = GAMES.find((g) => g.kind === 'quiz') as QuizDefinition;
    const quizSettings = normalizeSettings({}, definition);
    const quiz = createChoiceQuiz({ items: quizItems(definition, quizSettings), lives: definition.lives });
    let q = quiz.start(9);
    while (q.status !== 'over') q = quiz.next(quiz.answer(q, 0));
    const moves = q.moves.map(String);
    expect(await server.replayGame(definition, quizSettings, 9, moves)).toEqual(await replayGame(definition, quizSettings, 9, moves));
  });

  it('scores Mystery Country the same, without country positions', async () => {
    const definition = GAMES.find((g) => g.kind === 'mystery-country')!;
    const settings = normalizeSettings({}, definition);
    const engine = createMysteryCountry({ countries: queryCountries(), rounds: 20 });
    let state = engine.start(31);
    for (let i = 0; i < 12; i++) state = engine.nextLevel(engine.guess(state, state.target).state);
    while (state.status === 'playing') state = engine.guess(state, queryCountries().find((c) => c.id !== state.target && !state.guesses.includes(c.id))!.id).state;
    const full = await replayGame(definition, settings, 31, state.moves);
    expect(full).toEqual({ score: state.score, finished: true });
    expect(await server.replayGame(definition, settings, 31, state.moves)).toEqual(full);
  });

  it('scores Halfway the same with its slimmed cities', async () => {
    const definition = GAMES.find((g) => g.kind === 'halfway')!;
    const settings = normalizeSettings({}, definition);
    const engine = createHalfway(await halfwayPools());
    const cities = [...engine.cities.values()];
    let state = engine.start(41);
    // Clears 12 levels with a city at the edge of each radius, missing first on every third.
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 2) state = engine.guess(state, cities.find((c) => distanceKm(c.latlng, state.level.midpoint) > 5000)!.id).state;
      state = engine.nextLevel(engine.guess(state, state.level.fair.at(-1)!).state);
    }
    // Then a skip, and lost levels until the lives are gone.
    state = engine.nextLevel(engine.skip(state));
    while (state.status !== 'over') {
      if (state.status === 'level-over') state = engine.nextLevel(state);
      state = engine.guess(state, cities.find((c) => distanceKm(c.latlng, state.level.midpoint) > 5000 && !state.level.guesses.some((g) => g.id === c.id))!.id).state;
    }
    const full = await replayGame(definition, settings, 41, state.moves);
    expect(full).toEqual({ score: state.score, finished: true });
    expect(full.score).toBeGreaterThan(0);
    const started = performance.now();
    expect(await server.replayGame(definition, settings, 41, state.moves)).toEqual(full);
    console.log(`replaying Halfway: ${(performance.now() - started).toFixed(0)} ms`);
  }, 30_000);

  it('replays hard Border Route with its fixed guesses', async () => {
    const route = GAMES.find((g) => g.kind === 'route') as RouteDefinition;
    const settings = normalizeSettings({ routeMode: 'hard' }, route);
    const engine = createRouteGame({ countries: routeCountries(settings), rounds: route.rounds, hard: true });
    let state = engine.start(21);
    while (state.status !== 'over') {
      if (state.status === 'round-over') state = engine.nextRound(state);
      const round = engine.current(state);
      // Wastes guesses on detours first: more than easy mode's limit would allow on short routes.
      const route = engine.shortestRoute(round.puzzle);
      for (let i = 0; i < 2 && state.status === 'playing'; i++) {
        const detour = [...engine.frontier(engine.current(state))].find((id) => !route.includes(id));
        if (detour) state = engine.guess(state, detour).state;
      }
      // And a miss, which counts though it's not on the route.
      const borders = engine.frontier(engine.current(state));
      const miss = [...engine.graph.keys()].find((id) => !borders.has(id) && !route.includes(id) && !engine.current(state).guesses.includes(id));
      if (miss && state.status === 'playing') state = engine.guess(state, miss).state;
      for (const id of route.slice(1, -1)) if (state.status === 'playing') state = engine.guess(state, id).state;
    }
    const full = await replayGame(route, settings, 21, state.moves);
    expect(full).toEqual({ score: state.score, finished: true });
    expect(await server.replayGame(route, settings, 21, state.moves)).toEqual(full);
  });

  it('builds every live game without the fields it strips', async () => {
    for (const game of GAMES.filter((g: GameDefinition) => g.status === 'live')) {
      const settings = normalizeSettings({}, game);
      const fromServer = await server.replayGame(game, settings, 1, []);
      expect(fromServer, game.id).toEqual(await replayGame(game, settings, 1, []));
    }
  });

  it('replays a long arcade game quickly enough for the 2 second CPU limit', async () => {
    const game = GAMES.find((g) => g.kind === 'circle-arcade')!;
    const settings = normalizeSettings({}, game);
    const engine = createCircleArcade(await arcadePools(settings));
    let state = engine.start(99);
    for (let i = 0; i < 40; i++) {
      for (const id of engine.remaining(state.level)) state = engine.guess(state, id).state;
      state = engine.nextLevel(state);
    }
    const started = performance.now();
    const { finished } = await server.replayGame(game, settings, 99, [...state.moves, ...Array<string>(15).fill('>')]);
    const ms = performance.now() - started;
    console.log(`replaying 40 levels: ${ms.toFixed(0)} ms`);
    expect(finished).toBe(true);
    expect(ms).toBeLessThan(1500);
  }, 30_000);
});
