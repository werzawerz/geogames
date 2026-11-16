import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { NATIVE_NAMES_VERSION, loadNativeNames } from '@geogames/geodata/native-names';
import { getGame } from './catalog.ts';
import {
  DISTINCT_SCRIPT,
  TONGUE_MAX_LIVES,
  TONGUE_MIN_AREA_KM2,
  TONGUE_SKIP,
  createNativeTongue,
  replayNativeTongue,
  tonguePlan,
  tonguePool,
  type TongueState,
} from './native-tongue.ts';
import { DATASET_VERSION, replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const { names } = await loadNativeNames();
const countries = queryCountries();
const game = createNativeTongue({ names, countries });
const nameOf = new Map(names.map((n) => [n.id, n]));
const byId = new Map(countries.map((c) => [c.id, c]));
const definition = getGame('native-tongue')!;
const SEEDS = 60;

/** A wrong country for the level, not tried yet. */
const wrong = (state: TongueState) => countries.find((c) => c.id !== state.level.country && !state.level.guesses.includes(c.id))!.id;

/** Clears `count` levels first go: a run never ends by itself. */
const playPerfect = (seed: number, count = 40) => {
  let state = game.start(seed);
  const levels = [];
  while (levels.length < count) {
    levels.push(state.level);
    state = game.guess(state, state.level.country).state;
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
};

describe('the names', () => {
  it('come from a recorded source and release, one per country', () => {
    expect(NATIVE_NAMES_VERSION).toMatch(/^cldr\d+/);
    expect(DATASET_VERSION).toContain(NATIVE_NAMES_VERSION);
    expect(new Set(names.map((n) => n.id)).size).toBe(names.length);
    for (const n of names) expect(byId.has(n.id), n.id).toBe(true);
  });

  it('give the well-known endonyms', () => {
    const native = (id: string) => nameOf.get(id)!.name;
    expect(native('DEU')).toBe('Deutschland');
    expect(native('FIN')).toBe('Suomi');
    expect(native('GRC')).toBe('Ελλάδα');
    expect(native('UKR')).toBe('Україна');
    expect(native('EGY')).toBe('مصر');
    expect(native('IND')).toBe('भारत');
  });

  it('mark right-to-left scripts, and only those', () => {
    for (const n of names) expect(!!n.rtl, n.id).toBe(n.script === 'Arabic' || n.script === 'Hebrew');
  });

  it('leave out names that read like the English one, and countries too small to see', () => {
    const pool = new Set(tonguePool(names, countries).map((n) => n.id));
    for (const id of ['USA', 'AUS', 'MEX', 'CHL', 'GHA']) expect(pool.has(id), id).toBe(false);
    for (const id of pool) expect(byId.get(id)!.metrics.area!.value).toBeGreaterThanOrEqual(TONGUE_MIN_AREA_KM2);
    expect(pool.size).toBeGreaterThan(90);
  });

  it('use scripts that are listed as distinct only for names in a script of their own', () => {
    for (const id of DISTINCT_SCRIPT) expect(nameOf.get(id)!.script, id).not.toBe('Latin');
    for (const id of DISTINCT_SCRIPT) expect(game.pool.some((n) => n.id === id), id).toBe(true);
  });
});

describe('the level plan', () => {
  it('starts with 3 free misses, and tightens late so a run ends', () => {
    expect([1, 20, 21, 40, 41, 99].map((l) => tonguePlan(l).misses)).toEqual([3, 3, 2, 2, 1, 1]);
    expect([1, 8, 9, 14, 15, 20, 21, 500].map((l) => tonguePlan(l).band)).toEqual([1, 1, 2, 2, 2, 2, 3, 3]);
  });

  it('asks Latin endonyms of well-known countries first, then single scripts, then shared ones', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 30);
      for (const level of levels) {
        const n = nameOf.get(level.country)!;
        const country = byId.get(level.country)!;
        if (level.number <= 8) {
          expect(n.script, `${seed}/${level.number}`).toBe('Latin');
          expect(country.continent, `${seed}/${level.number}`).not.toBe('Africa');
          expect(country.subregion).not.toBe('Caribbean');
        } else if (level.number <= 20) {
          expect(DISTINCT_SCRIPT.has(level.country), `${seed}/${level.number}`).toBe(true);
          if (level.number <= 14) expect(country.continent).not.toBe('Africa');
        }
      }
    }
  });

  it('asks the shared scripts from level 21', () => {
    const scripts = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 30).levels.filter((l) => l.number >= 21)) scripts.add(nameOf.get(level.country)!.script);
    }
    expect(scripts.has('Cyrillic')).toBe(true);
    expect(scripts.has('Arabic')).toBe(true);
  });

  it('never repeats a country in a run, or one script twice in a row in band 2', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 60);
      expect(new Set(levels.map((l) => l.country)).size, `seed ${seed}`).toBe(levels.length);
      levels.slice(1).forEach((l, i) => {
        // Band 1 is all Latin, so only from band 2 on.
        if (l.number >= 10 && l.number <= 20) expect(nameOf.get(l.country)!.script, `${seed}/${l.number}`).not.toBe(nameOf.get(levels[i]!.country)!.script);
      });
    }
  });

  it('asks Arabic script at most once in any four levels', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 70);
      for (let i = 20; i + 4 <= levels.length; i++) {
        const window = levels.slice(i, i + 4).filter((l) => nameOf.get(l.country)!.script === 'Arabic');
        expect(window.length, `seed ${seed} from level ${i + 1}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never asks a name that reads like the English one, in any band, even past the whole pool', () => {
    for (const id of ['CUB', 'CHL', 'MLI', 'SWZ', 'MEX', 'GHA', 'USA']) expect(nameOf.get(id)?.looksEnglish ?? true, id).toBe(true);
    for (let seed = 1; seed <= 20; seed++) {
      for (const level of playPerfect(seed, game.pool.length + 40).levels) expect(nameOf.get(level.country)!.looksEnglish, `${seed}/${level.number}`).toBe(false);
    }
  });

  it('keeps going past the pool, repeating the country asked longest ago', () => {
    const { levels } = playPerfect(5, game.pool.length + 10);
    expect(levels.length).toBe(game.pool.length + 10);
    expect(new Set(levels.slice(0, game.pool.length).map((l) => l.country)).size).toBe(game.pool.length);
  });

  it('is deterministic, and differs between seeds', () => {
    expect(playPerfect(9).levels).toEqual(playPerfect(9).levels);
    const first = (s: number) => playPerfect(s, 5).levels.map((l) => l.country).join();
    expect(new Set(Array.from({ length: 10 }, (_, i) => first(i + 1))).size).toBeGreaterThan(5);
  });
});

describe('playing a level', () => {
  it('scores a flawless level 15 × the level, and gives a life back only up to 3', () => {
    const start = game.start(3);
    const lost = game.nextLevel(game.skip(start));
    expect(lost.lives).toBe(2);
    const won = game.guess(lost, lost.level.country);
    expect(won.result).toBe('right');
    expect(won.state.score).toBe(15 * lost.level.number);
    expect(won.state.lives).toBe(3);
    expect(won.state.bonusLife).toBe(true);
    const full = game.guess(game.start(3), game.start(3).level.country).state;
    expect(full.lives).toBe(TONGUE_MAX_LIVES);
    expect(full.bonusLife).toBe(false);
  });

  it('pays less after a miss and gives no life back', () => {
    let state = game.start(4);
    state = game.guess(state, wrong(state)).state;
    expect(state.status).toBe('playing');
    const { state: won } = game.guess(state, state.level.country);
    expect(won.score).toBe(Math.round(10 * 1 * 0.6));
    expect(won.lives).toBe(3);
    expect(won.marks).toEqual(['cleared']);
  });

  it('costs one life when the misses run out, and ends the level', () => {
    let state = game.start(5);
    for (let i = 0; i < 3; i++) state = game.guess(state, wrong(state)).state;
    expect(state.lives).toBe(2);
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.marks).toEqual(['lost']);
    // Nothing more to guess on a finished level.
    expect(game.guess(state, state.level.country).result).toBe('unknown');
  });

  it('does not charge repeated or unknown guesses', () => {
    let state = game.start(6);
    const w = wrong(state);
    state = game.guess(state, w).state;
    expect(game.guess(state, w)).toMatchObject({ result: 'repeat', state });
    expect(game.guess(state, 'ZZZ')).toMatchObject({ result: 'unknown', state });
  });

  it('loses one life for a skip, and ends the run at none', () => {
    let state = game.start(7);
    state = game.skip(state);
    expect(state.lives).toBe(2);
    expect(state.moves).toEqual([TONGUE_SKIP]);
    state = game.skip(game.nextLevel(state));
    state = game.skip(game.nextLevel(state));
    expect(state.lives).toBe(0);
    expect(state.status).toBe('over');
    expect(game.nextLevel(state)).toBe(state);
  });

  it('never loses more than one life in a level', () => {
    let state = game.start(8);
    for (let i = 0; i < 3; i++) state = game.guess(state, wrong(state)).state;
    expect(game.skip(state)).toBe(state);
    expect(state.lives).toBe(2);
  });
});

describe('replay', () => {
  function play(seed: number) {
    let state = game.start(seed);
    for (let i = 0; state.status !== 'over' && i < 200; i++) {
      if (state.status === 'level-over') state = game.nextLevel(state);
      else if (i % 7 === 3) state = game.skip(state);
      else if (i % 3 === 0) state = game.guess(state, state.level.country).state;
      else state = game.guess(state, wrong(state)).state;
    }
    return state;
  }

  it('rebuilds a run from its seed and moves', () => {
    for (const seed of [1, 2, 3, 99]) {
      const played = play(seed);
      expect(played.status).toBe('over');
      expect(replayNativeTongue(game, seed, played.moves)).toMatchObject({ score: played.score, lives: 0, status: 'over' });
    }
  });

  it('is what the server uses to score, and treats a half-finished run as unfinished', async () => {
    const played = play(11);
    const settings = normalizeSettings({}, definition);
    expect(await replayGame(definition, settings, 11, played.moves)).toEqual({ score: played.score, finished: true });
    expect(await replayGame(definition, settings, 11, played.moves.slice(0, 2))).toMatchObject({ finished: false });
  });

  it('has no region to choose', () => {
    expect(usesRegion(definition)).toBe(false);
  });
});
