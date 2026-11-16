import { describe, expect, it } from 'vitest';
import { RIVERS_VERSION, loadRivers } from '@geogames/geodata/rivers';
import { getGame } from './catalog.ts';
import { DATASET_VERSION, replayGame } from './replay.ts';
import {
  RIVER_RUN_CHOICE_SHARE,
  RIVER_RUN_MAX_LIVES,
  RIVER_RUN_MISSES,
  RIVER_RUN_SKIP,
  RIVER_RUN_START_LIVES,
  RIVER_RUN_TIMEOUT,
  createRiverRun,
  replayRiverRun,
  riverChoices,
  riverRunPlan,
  riverRunPoints,
  riverSeconds,
  type RiverRunState,
} from './river-run.ts';
import { hasSettings, normalizeSettings, usesRegion } from './settings.ts';

const data = await loadRivers();
const game = createRiverRun(data);
const river = (id: string) => game.rivers.get(id)!;
const wrongFor = (s: RiverRunState) =>
  data.rivers.find((r) => r.id !== s.level.river && !s.level.guesses.some((g) => g.id === r.id))!.id;

/** Names each river right away for `count` levels: a run that never ends by itself. */
function playPerfect(seed: number, count: number) {
  let state = game.start(seed);
  const levels: RiverRunState['level'][] = [];
  while (levels.length < count) {
    levels.push(state.level);
    state = game.guess(state, state.level.river, 0.2).state;
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
}

describe('the river data', () => {
  it('has enough rivers in every band, each drawn from source to mouth', () => {
    const tiers = [1, 2, 3, 4].map((t) => data.rivers.filter((r) => r.tier === t).length);
    expect(tiers[0]).toBeGreaterThanOrEqual(15);
    expect(tiers[1]).toBeGreaterThanOrEqual(40);
    expect(tiers[2]).toBeGreaterThanOrEqual(30);
    expect(tiers[3]).toBeGreaterThanOrEqual(10);
    for (const r of data.rivers) {
      expect(r.line.length, r.id).toBeGreaterThan(5);
      expect(new Set(data.rivers.map((x) => x.id)).size).toBe(data.rivers.length);
    }
  });

  it('runs rivers the right way: from the mountains to the sea', () => {
    // [lng, lat] near the source, and near the mouth.
    const ends: Record<string, [[number, number], [number, number]]> = {
      nile: [[29.5, -3], [31, 31]],
      amazon: [[-72, -15], [-52.7, -1.6]],
      danube: [[8.2, 48], [29.5, 45]],
      volga: [[33, 57], [47.8, 46]],
      ob: [[85, 52], [67.5, 66.7]],
      lena: [[108, 54], [127, 72.5]],
      rhine: [[9, 46.6], [4, 51.9]],
      ganges: [[79, 31], [90, 22]],
      mississippi: [[-95, 47.2], [-89, 29]],
      'blue-nile': [[37.4, 11.6], [32.5, 15.6]],
    };
    const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
    for (const [id, [source, mouth]] of Object.entries(ends)) {
      const r = data.rivers.find((x) => x.id === id)!;
      expect(near(r.line[0]!, source), `${id} source ${r.line[0]}`).toBe(true);
      expect(near(r.line.at(-1)!, mouth), `${id} mouth ${r.line.at(-1)}`).toBe(true);
    }
  });

  it('keeps the first band to the truly great rivers', () => {
    const great = data.rivers.filter((r) => r.tier === 1).map((r) => r.id);
    for (const id of ['amazon', 'nile', 'mississippi', 'congo', 'ganges', 'yangtze', 'danube', 'volga']) expect(great).toContain(id);
    for (const id of ['thames', 'murray', 'seine']) expect(great).not.toContain(id);
    // Rivers with little around them to place them by come only in the deepest band.
    for (const id of ['jialing', 'jurua', 'purus']) expect(river(id).tier).toBe(4);
  });

  it('ends every river at its mouth, without walking back up a delta arm', () => {
    const km = ([a, b]: readonly number[], [c, d]: readonly number[]) =>
      Math.hypot((c! - a!) * Math.cos(((b! + d!) / 2) * (Math.PI / 180)), d! - b!) * 111;
    for (const r of data.rivers) {
      const end = r.line.at(-1)!;
      const first = r.line.findIndex((p) => km(p, end) <= 40);
      // Once within 40 km of its end, a line may meander (the Sava by Belgrade) but not head off again.
      expect(Math.max(...r.line.slice(first).map((p) => km(p, end))), r.id).toBeLessThanOrEqual(55);
    }
  });

  it('gives every alias to one river only', () => {
    const seen = new Map<string, string>();
    for (const r of data.rivers)
      for (const a of [r.name, ...r.aliases]) {
        const key = a.toLowerCase();
        if (seen.has(key)) expect(seen.get(key), `${a}: ${r.id}`).toBe(r.id);
        seen.set(key, r.id);
      }
    expect(seen.get('yellow')).toBe('yellow');
    expect(seen.get('red')).toBe('red-vietnam');
    expect(seen.get('yarlung zangbo')).toBe('brahmaputra');
  });

  it('has no alias that is another river’s name', () => {
    const names = new Set(data.rivers.map((r) => r.name.toLowerCase()));
    for (const r of data.rivers) for (const a of r.aliases) expect(names.has(a.toLowerCase()) && a !== r.name, `${r.id}: ${a}`).toBe(false);
  });
});

describe('River Run', () => {
  it('is part of the dataset version, so old runs are not replayed on new rivers', () => {
    expect(DATASET_VERSION).toContain(`rivers${RIVERS_VERSION}`);
  });

  it('is an arcade game with no settings', () => {
    const def = getGame('river-run')!;
    expect(def.kind).toBe('river-run');
    expect(usesRegion(def)).toBe(false);
    expect(hasSettings(def)).toBe(false);
  });

  it('is deterministic for a seed', () => {
    expect(playPerfect(5, 30).levels.map((l) => l.river)).toEqual(playPerfect(5, 30).levels.map((l) => l.river));
    expect(playPerfect(5, 10).levels.map((l) => l.river)).not.toEqual(playPerfect(6, 10).levels.map((l) => l.river));
  });

  it('ramps from great rivers to regional rivers to tributaries, over many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { levels } = playPerfect(seed, 47);
      for (const level of levels) expect(river(level.river).tier, `seed ${seed} level ${level.number}`).toBe(riverRunPlan(level.number).tier);
    }
  });

  it('never repeats a river in a run, and never the same continent twice in a row', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { levels } = playPerfect(seed, 120);
      const ids = levels.map((l) => l.river);
      expect(new Set(ids.slice(0, 100)).size, `seed ${seed}`).toBe(100);
      for (let i = 1; i < 35; i++) expect(river(ids[i]!).continent, `seed ${seed} level ${i + 1}`).not.toBe(river(ids[i - 1]!).continent);
      // Endless: past the last unused river it goes on, without repeating the last 60.
      for (let i = 60; i < ids.length; i++) expect(ids.slice(i - 60, i)).not.toContain(ids[i]);
    }
  });

  it('starts each band slowly and speeds it up, never below its floor', () => {
    expect(riverSeconds(1)).toBe(30);
    expect(riverSeconds(8)).toBeLessThan(riverSeconds(1));
    expect(riverSeconds(9)).toBeGreaterThan(riverSeconds(8));
    expect(riverSeconds(21)).toBeGreaterThan(riverSeconds(20));
    expect(riverSeconds(36)).toBeGreaterThan(riverSeconds(35));
    expect(riverSeconds(200)).toBe(12);
    for (let n = 2; n < 100; n++) if (riverRunPlan(n) === riverRunPlan(n - 1)) expect(riverSeconds(n)).toBeLessThanOrEqual(riverSeconds(n - 1));
  });

  it('scores an early name higher, and a flawless one gives a life back up to 3', () => {
    const start = game.start(9);
    const early = game.guess(start, start.level.river, 0.1).state;
    const late = game.guess(start, start.level.river, 0.45).state;
    expect(early.score).toBeGreaterThan(late.score);
    expect(early.level.flawless).toBe(true);
    expect(late.level.flawless).toBe(true);
    expect(early.score).toBe(Math.round(50 * (0.3 + 0.7 * 0.9) * 1.5));
    expect(late.score).toBe(Math.round(50 * (0.3 + 0.7 * 0.55) * 1.5));
    // Even a last-moment name on level 1 (by then one of the four offered, so a pick) is worth something.
    expect(game.guess(start, start.level.river, 0.99).state.score).toBeGreaterThanOrEqual(8);
    expect(riverRunPoints(1, 0.5)).toBeCloseTo(32.5);
    expect(early.lives).toBe(RIVER_RUN_MAX_LIVES);
    // A life lost, then a flawless level wins it back.
    const lost = game.nextLevel(game.skip(start));
    expect(lost.lives).toBe(RIVER_RUN_START_LIVES - 1);
    const back = game.guess(lost, lost.level.river, 0.3).state;
    expect(back.lives).toBe(RIVER_RUN_START_LIVES);
    expect(back.bonusLife).toBe(true);
  });

  it('lets two misses go free, and the third ends the level for one life', () => {
    let state = game.start(11);
    for (let i = 1; i < RIVER_RUN_MISSES; i++) {
      const { state: next, result } = game.guess(state, wrongFor(state), 0.1 * i);
      expect(result).toBe('wrong');
      expect(next.status).toBe('playing');
      expect(next.lives).toBe(RIVER_RUN_START_LIVES);
      state = next;
    }
    expect(game.guess(state, state.level.guesses[0]!.id, 0.5).result).toBe('repeat');
    const named = game.guess(state, state.level.river, 0.4).state;
    expect(named.level.status).toBe('cleared');
    expect(named.marks).toEqual(['missed']);
    const third = game.guess(state, wrongFor(state), 0.5).state;
    expect(third.status).toBe('level-over');
    expect(third.level.status).toBe('lost');
    expect(third.lostBy).toBe('misses');
    expect(third.lives).toBe(RIVER_RUN_START_LIVES - 1);
    expect(game.guess(third, third.level.river, 0.6).state).toBe(third);
  });

  it('counts a skip and a timeout as one life each, and ends when the lives are gone', () => {
    let state = game.start(13);
    state = game.skip(state);
    expect(state.lostBy).toBe('skip');
    state = game.timeout(game.nextLevel(state));
    expect(state.lostBy).toBe('timeout');
    state = game.skip(game.nextLevel(state));
    expect(state.status).toBe('over');
    expect(state.marks).toEqual(['lost', 'lost', 'lost']);
    expect(state.moves).toEqual([RIVER_RUN_SKIP, RIVER_RUN_TIMEOUT, RIVER_RUN_SKIP]);
  });

  it('scores a picked name at half a typed one, never flawless, and a wrong pick costs the life at once', () => {
    const start = game.start(19);
    // The answer is always on offer from half drawn, so even typed it scores as a pick.
    const typed = { score: Math.round(riverRunPoints(1, 0.6)) };
    const picked = game.guess(start, start.level.river, 0.6, true).state;
    expect(Math.abs(picked.score - typed.score / 2)).toBeLessThanOrEqual(0.5);
    expect(picked.moves).toEqual([`${start.level.river}@600@pick`]);
    expect(picked.level.flawless).toBe(false);
    // Picks are only offered from half drawn, so an earlier pick counts as half drawn.
    expect(game.guess(start, start.level.river, 0.1, true).state.level.guesses[0]!.share).toBe(RIVER_RUN_CHOICE_SHARE);
    const wrong = game.guess(start, wrongFor(start), 0.6, true).state;
    expect(wrong.status).toBe('level-over');
    expect(wrong.lostBy).toBe('pick');
    expect(wrong.lives).toBe(RIVER_RUN_START_LIVES - 1);
    // After a free typed miss, a wrong pick still ends the level, for one life.
    const both = game.guess(game.guess(start, wrongFor(start), 0.2).state, wrongFor(game.guess(start, wrongFor(start), 0.2).state), 0.6, true).state;
    expect(both.lives).toBe(RIVER_RUN_START_LIVES - 1);
    expect(replayRiverRun(game, 19, wrong.moves)).toEqual(wrong);
    expect(replayRiverRun(game, 19, picked.moves)).toEqual(picked);
  });

  it('offers the answer and three real rivers of the same kind from near it, nearer as levels rise', () => {
    const answer = river('danube');
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const options = riverChoices(data.rivers, 'danube', 3, seed);
      expect(options).toHaveLength(4);
      expect(new Set(options).size).toBe(4);
      expect(options).toContain('danube');
      expect(riverChoices(data.rivers, 'danube', 3, seed)).toEqual(options);
      counts.set(String(options.indexOf('danube')), (counts.get(String(options.indexOf('danube'))) ?? 0) + 1);
      for (const id of options) expect(Math.abs(river(id).tier - answer.tier)).toBeLessThanOrEqual(1);
      for (const id of options.filter((o) => o !== 'danube')) expect(river(id).continent).toBe('Europe');
    }
    // The answer is in every place about as often.
    for (const place of ['0', '1', '2', '3']) expect(counts.get(place)).toBeGreaterThan(30);
    // Deep in a run, the wrong options come from nearer rivers, so fewer different ones.
    const spread = (level: number) => new Set(Array.from({ length: 80 }, (_, s) => riverChoices(data.rivers, 'inn', level, s)).flat()).size;
    expect(spread(30)).toBeLessThan(spread(3));
  });

  it('doesn’t put the answer in the middle of the four too often', () => {
    let middle = 0;
    let total = 0;
    for (const r of data.rivers)
      for (const level of [3, 15, 30])
        for (let seed = 1; seed <= 20; seed++) {
          const options = riverChoices(data.rivers, r.id, level, seed).map((id) => river(id).anchor);
          const [cx, cy] = [0, 1].map((k) => options.reduce((sum, p) => sum + p[k]!, 0) / options.length);
          const off = options.map(([x, y]) => Math.hypot(x - cx!, y - cy!));
          const answer = off[riverChoices(data.rivers, r.id, level, seed).indexOf(r.id)]!;
          if (off.every((d) => d >= answer)) middle++;
          total++;
        }
    expect(middle / total).toBeLessThanOrEqual(0.3);
  });

  it('counts a typed name as a pick once the four are offered, and only if it is one of them', () => {
    const start = game.start(23);
    const offered = riverChoices(data.rivers, start.level.river, 1, start.seed);
    const wrongOffered = offered.find((id) => id !== start.level.river)!;
    const notOffered = data.rivers.find((r) => !offered.includes(r.id))!.id;
    // Before half drawn, a wrong name is an ordinary free miss, offered or not.
    expect(game.guess(start, wrongOffered, 0.4).state.status).toBe('playing');
    // From half drawn, a wrong offered name costs the life at once, like a wrong pick…
    const lost = game.guess(start, wrongOffered, 0.6).state;
    expect(lost.lostBy).toBe('pick');
    expect(lost.lives).toBe(RIVER_RUN_START_LIVES - 1);
    // …but one that isn't on offer stays a free miss.
    expect(game.guess(start, notOffered, 0.6).state.status).toBe('playing');
    // The answer typed from half drawn scores like a pick, and the server's replay agrees.
    const typed = game.guess(start, start.level.river, 0.6).state;
    expect(typed.level.guesses[0]!.picked).toBe(true);
    expect(typed.score).toBe(Math.round(riverRunPoints(1, 0.6) / 2));
    const replayed = replayRiverRun(game, 23, [`${start.level.river}@600`]);
    expect([replayed.score, replayed.level.guesses[0]!.picked]).toEqual([typed.score, true]);
  });

  it('logs guesses that never go back in time', () => {
    let state = game.start(17);
    state = game.guess(state, wrongFor(state), 0.6).state;
    state = game.guess(state, state.level.river, 0.2).state;
    // (By then the four names are offered, so typing the answer counts as picking it.)
    expect(state.moves[1]).toBe(`${state.level.river}@600@pick`);
    // The whole river drawn is a timeout, not a guess.
    const late = game.guess(game.start(17), game.start(17).level.river, 1);
    expect(late.state.level.guesses[0]!.share).toBe(0.999);
  });

  it('replays a run from its moves, also on the server', async () => {
    let state = game.start(21);
    for (let i = 0; i < 25; i++) {
      if (i % 4 === 1) state = game.guess(state, wrongFor(state), 0.1).state;
      state = game.nextLevel(game.guess(state, state.level.river, (i % 10) / 10).state);
    }
    while (state.status !== 'over') {
      if (state.status === 'level-over') state = game.nextLevel(state);
      state = state.level.number % 2 ? game.timeout(state) : game.guess(state, wrongFor(state), 0.3).state;
    }
    expect(replayRiverRun(game, 21, state.moves)).toEqual(state);
    const def = getGame('river-run')!;
    expect(await replayGame(def, normalizeSettings({}, def), 21, state.moves)).toEqual({ score: state.score, finished: true });
  });
});
