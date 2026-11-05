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
