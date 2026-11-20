import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { loadGreatCircles } from '@geogames/geodata/cities';
import { loadRivers } from '@geogames/geodata/rivers';
import { loadLandGrid } from '@geogames/geodata/land-grid';
import { loadNativeNames } from '@geogames/geodata/native-names';
import { loadSupplyChain } from '@geogames/geodata/supply-chain';
import { DUEL_GAMES } from './api-contract.ts';
import { blankAtlasGame, replayGame, replayRun } from './replay.ts';
import { GAMES, getGame, type HigherLowerDefinition, type QuizDefinition } from './catalog.ts';
import { canDuel, duelGames, duelHasLevels, duelSettings, duelThings } from './duel.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.ts';
import { arcadePools, circleCities, halfwayPools, loadPool, quizItems, routeCountries, type PoolItem } from './pools.ts';
import { createHigherLowerGame, type HigherLowerState } from './higher-lower.ts';
import { createChoiceQuiz, type QuizState } from './choice-quiz.ts';
import { createRouteGame, type RouteGameState } from './route.ts';
import { createCircleGame, type CircleGameState } from './circle.ts';
import { createGreatCircle, type GreatCircleState } from './great-circle.ts';
import { createMysteryCountry, type MysteryState } from './mystery-country.ts';
import { createBorderBlitz, type BlitzState } from './border-blitz.ts';
import { createPinDrop, type PinState } from './pin-drop.ts';
import { createHalfway, type HalfwayState } from './halfway.ts';
import { clockworkCountries, createClockwork, type ClockState } from './clockwork.ts';
import { createNativeTongue, type TongueState } from './native-tongue.ts';
import { createOnTheGrid, type GridState } from './on-the-grid.ts';
import { createSupplyChain, type ChainState } from './supply-chain.ts';
import { createRiverRun, riverChoices, type RiverRunState } from './river-run.ts';
import type { BlankAtlasState } from './blank-atlas.ts';
import { createCircleArcade } from './circle-arcade.ts';

/**
 * The premise of a duel: one seed gives both players the same puzzles, in the
 * same order, whatever they do. For each game, a careful player and a sloppy one
 * (wrong answers, skips, give-ups) play the same seed, and every level both reach
 * must show the same puzzle. City Circle Arcade's own test is in circle-arcade.test.ts.
 */
interface Premise<S> {
  id: string;
  start(seed: number): S;
  /** Everything the level shows that could differ: the puzzle and any options. */
  puzzle(state: S): unknown;
  over(state: S): boolean;
  /** Play the level well, then move on to the next one. */
  good(state: S): S;
  /** Play the level differently and worse, then move on (when the run goes on). */
  bad(state: S): S;
}

const LEVELS = 8;

function puzzles<S>(game: Premise<S>, seed: number, play: (state: S, level: number) => S): unknown[] {
  const seen: unknown[] = [];
  let state = game.start(seed);
  while (seen.length < LEVELS) {
    seen.push(game.puzzle(state));
    state = play(state, seen.length);
    if (game.over(state)) break;
  }
  return seen;
}

const countries = queryCountries();
const isOver = (s: { status: string }) => s.status === 'over';

async function premises(): Promise<Premise<any>[]> {
  const settings = DEFAULT_SETTINGS;

  const hlDef = getGame('higher-lower-population') as HigherLowerDefinition;
  const hl = createHigherLowerGame({ metric: hlDef.metric, pool: await loadPool(hlDef, settings) });
  const hlRight = (s: HigherLowerState<PoolItem>) => (hl.valueOf(s.challenger) >= hl.valueOf(s.current) ? 'higher' : 'lower');
  const hlWrong = (s: HigherLowerState<PoolItem>) => (hlRight(s) === 'higher' ? 'lower' : 'higher');

  const quizDef = getGame('flags') as QuizDefinition;
  const quiz = createChoiceQuiz({ items: quizItems(quizDef, settings), lives: quizDef.lives });

  const route = createRouteGame({ countries: routeCountries(settings), rounds: 20 });
  const routeSolve = (s: RouteGameState) => {
    for (const id of route.shortestRoute(route.current(s).puzzle).slice(1, -1)) s = route.guess(s, id).state;
    return s.status === 'round-over' ? route.nextRound(s) : s;
  };

  const circle = createCircleGame({ ...(await circleCities(settings)), rounds: 3, target: 5, misses: 5, radiusKm: 0, placement: 'random' });

  const gc = createGreatCircle({ puzzles: (await loadGreatCircles()).puzzles, countries, rounds: 20 });
  const gcNext = (s: GreatCircleState) => (s.status === 'level-clear' ? gc.nextLevel(s) : s);

  const mystery = createMysteryCountry({ countries, rounds: 20 });
  const mysteryNext = (s: MysteryState) => (s.status === 'level-clear' ? mystery.nextLevel(s) : s);

  const blitz = createBorderBlitz({ countries: routeCountries(settings), rounds: 20 });
  const blitzAll = (s: BlitzState) => {
    for (const id of s.neighbours) s = blitz.guess(s, id).state;
    return s;
  };
  const blitzNext = (s: BlitzState) => (s.status === 'level-clear' ? blitz.nextLevel(s) : s);

  const pin = createPinDrop(await arcadePools());
  const pinNext = (s: PinState) => (s.status === 'revealed' ? pin.next(s) : s);

  const halfway = createHalfway(await halfwayPools());
  const clock = createClockwork({ countries: clockworkCountries() });
  const tongue = createNativeTongue({ names: (await loadNativeNames()).names, countries });
  const grid = createOnTheGrid({ grid: await loadLandGrid(), countries });
  const chain = createSupplyChain({ commodities: (await loadSupplyChain()).commodities, countries });
  const rivers = await loadRivers();
  const river = createRiverRun(rivers);
  const atlas = await blankAtlasGame();
  /** The games where a level ends ('level-over') and the next one has to be asked for. */
  const onward =
    <S extends { status: string }>(next: (s: S) => S) =>
    (s: S) =>
      s.status === 'level-over' ? next(s) : s;

  return [
    {
      id: 'higher-lower-population',
      start: (seed) => hl.start(seed),
      puzzle: (s: HigherLowerState<PoolItem>) => [s.current.id, s.challenger.id],
      over: isOver,
      good: (s: HigherLowerState<PoolItem>) => hl.next(hl.guess(s, hlRight(s))),
      // Right for a while, then wrong: a streak can't go on any other way.
      bad: (s: HigherLowerState<PoolItem>) => hl.next(hl.guess(s, s.guesses.length < 4 ? hlRight(s) : hlWrong(s))),
    },
    {
      id: 'flags',
      start: (seed) => quiz.start(seed),
      puzzle: (s: QuizState) => s.question,
      over: isOver,
      good: (s: QuizState) => quiz.next(quiz.answer(s, s.question.correctIndex)),
      bad: (s: QuizState) => quiz.next(quiz.answer(s, s.moves.length % 2 ? s.question.correctIndex : (s.question.correctIndex + 1) % 4)),
    },
    {
      id: 'border-route',
      start: (seed) => route.start(seed),
      puzzle: (s: RouteGameState) => route.current(s).puzzle,
      over: isOver,
      good: routeSolve,
      // A detour first: a country next to the start that isn't on the shortest route.
      bad: (s: RouteGameState) => {
        const round = route.current(s);
        const path = route.shortestRoute(round.puzzle);
        const detour = [...route.frontier(round)].find((id) => !path.includes(id));
        return routeSolve(detour ? route.guess(s, detour).state : s);
      },
    },
    {
      id: 'city-circle',
      start: (seed) => circle.start(seed),
      puzzle: (s: CircleGameState) => circle.current(s)!.puzzle,
      over: isOver,
      good: (s: CircleGameState) => {
        for (const id of circle.top(circle.current(s)!.puzzle)) s = circle.guess(s, id).state;
        return circle.nextRound(s);
      },
      bad: (s: CircleGameState) => circle.nextRound(circle.giveUp(s)),
    },
    {
      id: 'great-circle',
      start: (seed) => gc.start(seed),
      puzzle: (s: GreatCircleState) => [s.puzzle.from.id, s.puzzle.to.id],
      over: isOver,
      good: (s: GreatCircleState) => {
        for (const id of s.puzzle.via) s = gc.guess(s, id).state;
        return gcNext(s);
      },
      bad: (s: GreatCircleState) => {
        s = gc.skip(s);
        for (const id of gc.remaining(s)) s = gc.guess(s, id).state;
        return gcNext(s);
      },
    },
    {
      id: 'mystery-country',
      start: (seed) => mystery.start(seed),
      puzzle: (s: MysteryState) => s.target,
      over: isOver,
      good: (s: MysteryState) => mysteryNext(mystery.guess(s, s.target).state),
      bad: (s: MysteryState) => {
        for (const c of countries.filter((c) => c.id !== s.target).slice(s.level, s.level + 2)) s = mystery.guess(s, c.id).state;
        return mysteryNext(mystery.guess(s, s.target).state);
      },
    },
    {
      id: 'border-blitz',
      start: (seed) => blitz.start(seed),
      puzzle: (s: BlitzState) => s.target,
      over: isOver,
      good: (s: BlitzState) => blitzNext(blitz.claimTime(blitzAll(s), 20)),
      bad: (s: BlitzState) => {
        const wrong = blitz.askable.find((id) => id !== s.target && !s.neighbours.includes(id) && !blitz.throughTerritory(s.target, id))!;
        return blitzNext(blitz.claimTime(blitzAll(blitz.guess(s, wrong).state), 0));
      },
    },
    {
      id: 'pin-drop',
      start: (seed) => pin.start(seed),
      puzzle: (s: PinState) => s.city,
      over: isOver,
      good: (s: PinState) => {
        const [lat, lng] = pin.cities.get(s.city)!.latlng;
        return pinNext(pin.place(s, lat, lng));
      },
      bad: (s: PinState) => {
        const [lat, lng] = pin.cities.get(s.city)!.latlng;
        return pinNext(pin.place(s, lat > 0 ? lat - 8 : lat + 8, lng));
      },
    },
    {
      id: 'halfway',
      start: (seed) => halfway.start(seed),
      puzzle: (s: HalfwayState) => [s.level.from, s.level.to],
      over: isOver,
      good: (s: HalfwayState) => onward(halfway.nextLevel)(halfway.guess(s, s.level.fair[0]!).state),
      bad: (s: HalfwayState) => onward(halfway.nextLevel)(halfway.skip(s)),
    },
    {
      id: 'clockwork',
      start: (seed) => clock.start(seed),
      puzzle: (s: ClockState) => [s.level.place, s.level.date, s.level.utcHour],
      over: isOver,
      good: (s: ClockState) => onward(clock.nextLevel)(clock.guess(s, s.level.answer).state),
      bad: (s: ClockState) => onward(clock.nextLevel)(clock.skip(s)),
    },
    {
      id: 'native-tongue',
      start: (seed) => tongue.start(seed),
      puzzle: (s: TongueState) => s.level.country,
      over: isOver,
      good: (s: TongueState) => onward(tongue.nextLevel)(tongue.guess(s, s.level.country).state),
      bad: (s: TongueState) => onward(tongue.nextLevel)(tongue.skip(s)),
    },
    {
      id: 'on-the-grid',
      start: (seed) => grid.start(seed),
      puzzle: (s: GridState) => [s.level.target, s.level.country],
      over: isOver,
      good: (s: GridState) => onward(grid.nextLevel)(grid.guess(s, s.level.country).state),
      bad: (s: GridState) => onward(grid.nextLevel)(grid.skip(s)),
    },
    {
      id: 'supply-chain',
      start: (seed) => chain.start(seed),
      puzzle: (s: ChainState) => s.level.commodity,
      over: isOver,
      good: (s: ChainState) => {
        const { accepted, need } = chain.answers(s.level.commodity, s.level.number)!;
        for (const id of accepted.slice(0, need)) s = chain.guess(s, id).state;
        return onward(chain.nextLevel)(s);
      },
      bad: (s: ChainState) => onward(chain.nextLevel)(chain.skip(s)),
    },
    {
      id: 'river-run',
      start: (seed) => river.start(seed),
      // The four names offered come from the seed and the level too.
      puzzle: (s: RiverRunState) => [s.level.river, riverChoices(rivers.rivers, s.level.river, s.level.number, s.seed)],
      over: isOver,
      good: (s: RiverRunState) => onward(river.nextLevel)(river.guess(s, s.level.river, 0.1).state),
      bad: (s: RiverRunState) => onward(river.nextLevel)(river.timeout(s)),
    },
    {
      id: 'blank-atlas',
      start: (seed) => atlas.start(seed),
      puzzle: (s: BlankAtlasState) => [s.level.feature, s.level.options],
      over: isOver,
      good: (s: BlankAtlasState) => onward(atlas.nextLevel)(atlas.guess(s, s.level.feature).state),
      bad: (s: BlankAtlasState) => onward(atlas.nextLevel)(atlas.guess(s, s.level.options.find((o) => o !== s.level.feature)!).state),
    },
  ];
}

const all = await premises();

describe('duels: one seed, the same puzzles whatever the player does', () => {
  it('covers every duel game but City Circle Arcade (tested with its engine)', () => {
    // The Higher or Lower games share one engine, and so do Flags and Capitals.
    const engine = (id: string) => (id.startsWith('higher-lower') ? 'higher-lower-population' : id === 'capitals' ? 'flags' : id);
    expect([...all.map((p) => p.id), 'city-circle-arcade'].sort()).toEqual([...new Set(DUEL_GAMES.map(engine))].sort());
  });

  for (const game of all) {
    it(`${game.id}: a careful and a sloppy player see the same puzzles on every level both reach`, () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const careful = puzzles(game, seed, (s) => game.good(s));
        const sloppy = puzzles(game, seed, (s) => game.bad(s));
        const mixed = puzzles(game, seed, (s, level) => (level % 2 ? game.bad(s) : game.good(s)));
        expect(sloppy.length, `${game.id} seed ${seed}`).toBeGreaterThan(1);
        expect(sloppy).toEqual(careful.slice(0, sloppy.length));
        expect(mixed).toEqual(careful.slice(0, mixed.length));
      }
    });
  }
});

describe('which runs can become a duel', () => {
  it('lists live games only, each with what its levels are about', () => {
    expect(duelGames().map((g) => g.id)).toEqual([...DUEL_GAMES]);
    expect(duelGames()[0]!.id).toBe('city-circle-arcade');
    for (const game of duelGames()) {
      expect(game.status).toBe('live');
      expect(duelThings(game)).not.toBe('levels');
    }
  });

  it('leaves out games not on the list', () => {
    const others = GAMES.filter((g) => !DUEL_GAMES.includes(g.id));
    for (const game of others) expect(canDuel(game, DEFAULT_SETTINGS)).toBe(false);
  });

  it("can't duel City Circle with circles the player places", () => {
    const circle = getGame('city-circle')!;
    const custom = normalizeSettings({ circlePlacement: 'custom' }, circle);
    expect(canDuel(circle, custom)).toBe(false);
    expect(canDuel(circle, normalizeSettings({}, circle))).toBe(true);
    expect(canDuel(circle, duelSettings(custom))).toBe(true);
  });

  it('compares streaks and quizzes by score, and the rest level by level', () => {
    expect(duelHasLevels(getGame('flags')!)).toBe(false);
    expect(duelHasLevels(getGame('higher-lower-area')!)).toBe(false);
    expect(duelHasLevels(getGame('river-run')!)).toBe(true);
  });
});

describe('a run, level by level', () => {
  it('scores like replayGame and says how each level ended', async () => {
    const definition = getGame('mystery-country')!;
    const settings = normalizeSettings({}, definition);
    const engine = createMysteryCountry({ countries, rounds: 20 });
    let state = engine.start(3);
    state = engine.nextLevel(engine.guess(state, state.target).state);
    const wrong = countries.find((c) => c.id !== state.target)!.id;
    state = engine.nextLevel(engine.guess(engine.guess(state, wrong).state, state.target).state);
    while (state.status !== 'over') state = engine.guess(state, countries.find((c) => !state.guesses.includes(c.id) && c.id !== state.target)!.id).state;
    const run = await replayRun(definition, settings, 3, state.moves);
    expect(run).toMatchObject({ score: state.score, finished: true, level: 3 });
    expect(await replayGame(definition, settings, 3, state.moves)).toEqual({ score: run.score, finished: true });
    expect(run.levels.map((l) => l.outcome)).toEqual(['perfect', 'cleared', 'lost']);
    expect(run.levels.reduce((sum, l) => sum + l.points, 0)).toBe(state.score);
  });

  it('shows a City Circle Arcade level finished by skipping as skipped, not cleared', async () => {
    const definition = getGame('city-circle-arcade')!;
    const settings = normalizeSettings({}, definition);
    const arcade = createCircleArcade(await arcadePools(settings));
    let state = arcade.start(4);
    for (const id of arcade.remaining(state.level)) state = arcade.guess(state, id).state;
    state = arcade.nextLevel(state);
    // Level 2: every city skipped, which the engine counts as cleared.
    while (state.status === 'playing') state = arcade.skip(state);
    expect(state.level.status).toBe('cleared');
    state = arcade.nextLevel(state);
    while (state.status !== 'over') {
      if (state.status === 'level-clear') state = arcade.nextLevel(state);
      state = arcade.skip(state);
    }
    const run = await replayRun(definition, settings, 4, state.moves);
    expect(run.levels[0]).toMatchObject({ number: 1, outcome: 'perfect' });
    expect(run.levels[1]).toMatchObject({ number: 2, outcome: 'skipped', points: 0 });
    expect(run.level).toBe(state.level.number);
    expect(run.score).toBe(state.score);
  });

  it('marks a level the clock ran out on', async () => {
    const definition = getGame('river-run')!;
    const settings = normalizeSettings({}, definition);
    const engine = createRiverRun(await loadRivers());
    let state = engine.start(5);
    state = engine.nextLevel(engine.guess(state, state.level.river, 0.2).state);
    state = engine.nextLevel(engine.timeout(state));
    const run = await replayRun(definition, settings, 5, state.moves);
    expect(run.levels.map((l) => l.outcome)).toEqual(['perfect', 'timeout']);
    expect(run).toMatchObject({ finished: false, level: 2 });
  });
});
