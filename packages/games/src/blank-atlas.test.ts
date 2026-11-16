import { describe, expect, it } from 'vitest';
import { geoArea } from 'd3-geo';
import { BLANK_ATLAS_VERSION, loadBlankAtlas } from '@geogames/geodata/blank-atlas';
import { loadBlankAtlasShapes } from '@geogames/geodata/blank-atlas-shapes';
import { getGame } from './catalog.ts';
import { distanceKm } from './circle.ts';
import {
  BLANK_ATLAS_FAR_KM,
  BLANK_ATLAS_MAX_LIVES,
  BLANK_ATLAS_NEAR_KM,
  BLANK_ATLAS_OPTIONS,
  BLANK_ATLAS_PLANS,
  BLANK_ATLAS_SKIP,
  BLANK_ATLAS_START_LIVES,
  blankAtlasGroup,
  blankAtlasPlan,
  blankAtlasViewKm,
  createBlankAtlas,
  replayBlankAtlas,
  type BlankAtlas,
  type BlankAtlasState,
} from './blank-atlas.ts';
import { DATASET_VERSION, replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const data = await loadBlankAtlas();
const game = createBlankAtlas(data.features);
const feature = (id: string) => game.features.get(id)!;

/** Plays a run, answering every level right (or with `answer`), up to `levels` levels. */
function play(seed: number, levels: number, answer = (s: BlankAtlasState) => s.level.feature, g: BlankAtlas = game): BlankAtlasState {
  let state = g.start(seed);
  while (state.level.number < levels && state.status !== 'over') {
    state = g.guess(state, answer(state)).state;
    if (state.status === 'level-over' && state.level.number < levels) state = g.nextLevel(state);
  }
  return state;
}

/** One of the level's wrong options. */
const wrongOption = (s: BlankAtlasState) => s.level.options.find((id) => id !== s.level.feature)!;

describe('Blank Atlas data', () => {
  it('has enough features in every tier for an endless run', () => {
    for (const tier of [1, 2, 3]) expect(data.features.filter((f) => f.tier === tier).length).toBeGreaterThanOrEqual(tier === 1 ? 40 : 100);
  });

  it('gives every feature a unique id, a name, an outline and a sane place', async () => {
    const shapes = await loadBlankAtlasShapes();
    expect(new Set(data.features.map((f) => f.id)).size).toBe(data.features.length);
    for (const f of data.features) {
      expect(f.name.length).toBeGreaterThan(2);
      expect(shapes[f.id], f.id).toBeDefined();
      expect(Math.abs(f.center[0])).toBeLessThan(85);
      expect(f.radiusKm).toBeGreaterThan(0);
      // Antarctica is left out: it's too distorted on a world map.
      expect(f.center[0]).toBeGreaterThan(-65);
    }
  });

  it('draws every outline as a real area, not a sliver or nothing', async () => {
    const shapes = await loadBlankAtlasShapes();
    for (const f of data.features) {
      const sphere = geoArea(shapes[f.id]!);
      const km2 = Math.min(sphere, 4 * Math.PI - sphere) * 6371 ** 2;
      // The thinnest real outlines (the Namib, Lake Champlain) cover about 4% of the circle they span.
      expect(km2 / (Math.PI * f.radiusKm ** 2), f.id).toBeGreaterThan(0.03);
    }
  });

  it('gives each feature a kind a player would agree with', () => {
    const kind = (id: string) => data.features.find((f) => f.id === id)?.kind;
    expect(kind('jutland')).toBe('peninsula');
    expect(kind('anatolia')).toBe('peninsula');
    expect(kind('iberian-peninsula')).toBe('peninsula');
    // An ice cap isn't a mountain range, and a salt flat isn't a desert.
    expect(kind('vatnajokull')).toBeUndefined();
    expect(kind('salar-de-uyuni')).toBeUndefined();
  });

  it('knows which features are part of another', () => {
    const related = (a: string, b: string) => data.features.find((f) => f.id === a)!.related.includes(b);
    for (const [part, whole] of [
      ['james-bay', 'hudson-bay'],
      ['aegean-sea', 'mediterranean-sea'],
      ['sea-of-crete', 'mediterranean-sea'],
      ['bay-of-campeche', 'gulf-of-mexico'],
      ['tenere', 'sahara'],
      ['tatra-mountains', 'carpathian-mountains'],
      ['musandam-peninsula', 'arabian-peninsula'],
      ['adirondack-mountains', 'appalachian-mountains'],
    ]) {
      expect(related(part!, whole!), `${part} in ${whole}`).toBe(true);
      expect(related(whole!, part!), `${whole} has ${part}`).toBe(true);
    }
  });

  it('is part of the dataset version, so old runs aren\'t replayed on new features', () => {
    expect(DATASET_VERSION).toContain(BLANK_ATLAS_VERSION);
  });

  it('shows every feature clearly, with a shore in view to find your way by', () => {
    for (const f of data.features) {
      const level = BLANK_ATLAS_PLANS.find((p) => p.tier === f.tier)!.from;
      const view = blankAtlasViewKm(f, level);
      expect(view, f.name).toBeGreaterThanOrEqual(f.radiusKm);
      expect(view, f.name).toBeGreaterThanOrEqual(f.coastKm + 300);
      // At least about 7 px across on a phone (the view's radius is about 220 px at full width).
      expect(f.radiusKm / view, f.name).toBeGreaterThan(0.03);
    }
  });

  it('keeps names and aliases unambiguous, so a typed name means one feature', () => {
    const owner = new Map<string, string>();
    const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const f of data.features) {
      for (const name of [f.name, ...f.aliases]) {
        const k = key(name);
        expect(owner.get(k) ?? f.id, `${name} names ${owner.get(k)} and ${f.id}`).toBe(f.id);
        owner.set(k, f.id);
      }
    }
  });

  it('knows the aliases players type', () => {
    const named = (alias: string) => data.features.find((f) => f.name === alias || f.aliases.includes(alias))?.id;
    expect(named('Arabian Gulf')).toBe('persian-gulf');
    expect(named('East Sea')).toBe('sea-of-japan');
    expect(named('Rockies')).toBe('rocky-mountains');
    expect(named('Empty Quarter')).toBe('rub-al-khali');
    expect(named('Bosphorus')).toBe('bosporus');
  });
});

describe('Blank Atlas engine', () => {
  it('is deterministic for a seed', () => {
    expect(play(7, 30)).toEqual(play(7, 30));
    expect(play(7, 5).past).not.toEqual(play(8, 5).past);
  });

  it('asks each tier in its band, so no strait comes before level 21, over many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const state = play(seed, 60);
      state.past.forEach((id, i) => {
        expect(feature(id).tier, `seed ${seed} level ${i + 1}`).toBe(blankAtlasPlan(i + 1).tier);
        if (i + 1 < 21) expect(feature(id).kind, `seed ${seed} level ${i + 1}`).not.toBe('strait');
      });
    }
  });

  it('spreads the first level over the headline features', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 2000; seed++) {
      const id = game.start((seed * 2654435761) >>> 0).level.feature;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(data.features.filter((f) => f.tier === 1).length);
    expect(Math.max(...counts.values())).toBeLessThan(2000 * 0.05);
  });

  it('never repeats a feature in a run, and keeps neighbours and kinds apart', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { past } = play(seed, 80);
      expect(new Set(past).size).toBe(past.length);
      for (let i = 1; i < past.length; i++) {
        const [a, b] = [feature(past[i - 1]!), feature(past[i]!)];
        expect(blankAtlasGroup(a.kind)).not.toBe(blankAtlasGroup(b.kind));
        expect(distanceKm(a.center, b.center)).toBeGreaterThanOrEqual(BLANK_ATLAS_NEAR_KM);
      }
    }
  });

  it('offers four different options of the answer’s kind, the answer in no fixed place', () => {
    const places = [0, 0, 0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 40; n++) {
        const { options, feature: answer } = state.level;
        expect(options).toHaveLength(BLANK_ATLAS_OPTIONS);
        expect(new Set(options).size).toBe(BLANK_ATLAS_OPTIONS);
        expect(options).toContain(answer);
        for (const id of options) expect(feature(id).kind).toBe(feature(answer).kind);
        places[options.indexOf(answer)]!++;
        state = game.nextLevel(game.guess(state, answer).state);
      }
    }
    for (const n of places) expect(n).toBeGreaterThan((1600 / 4) * 0.8);
  });

  it('makes the wrong options closer look-alikes as the run goes on', () => {
    const meanKm = (from: number, to: number) => {
      const kms: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        let state = game.start(seed);
        while (state.level.number <= to) {
          const { options, feature: answer, number } = state.level;
          if (number >= from) for (const id of options) if (id !== answer) kms.push(distanceKm(feature(id).center, feature(answer).center));
          state = game.nextLevel(game.guess(state, answer).state);
        }
      }
      return kms.reduce((a, b) => a + b, 0) / kms.length;
    };
    const [early, middle, late] = [meanKm(1, 4), meanKm(9, 14), meanKm(31, 40)];
    expect(early).toBeGreaterThan(BLANK_ATLAS_FAR_KM);
    expect(middle).toBeLessThan(early);
    expect(late).toBeLessThan(middle);
    expect(late).toBeLessThan(3500);
  });

  it('never offers a feature the lit-up area also fits: its parent, a part of it, or one it overlaps', () => {
    for (let seed = 1; seed <= 120; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 60; n++) {
        const answer = feature(state.level.feature);
        for (const id of state.level.options) expect(answer.related, `${answer.id} offered with ${id}`).not.toContain(id);
        state = game.nextLevel(game.guess(state, answer.id).state);
      }
    }
  });

  it('draws wrong options from the answer\'s own tier, so picking the obscure (or famous) one doesn\'t pay', () => {
    let wins = 0;
    let levels = 0;
    for (let seed = 1; seed <= 100; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 60; n++) {
        // A player who knows nothing but the tiers: a random option from the level's tier.
        const tier = blankAtlasPlan(n).tier;
        const guesses = state.level.options.filter((id) => feature(id).tier === tier);
        const pick = guesses[(seed * 31 + n * 7) % guesses.length]!;
        if (pick === state.level.feature) wins++;
        levels++;
        state = game.nextLevel(game.guess(state, state.level.feature).state);
      }
    }
    expect(wins / levels).toBeLessThanOrEqual(0.3);
  });

  it('keeps early wrong options to names you know', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let state = game.start(seed);
      for (let n = 1; n <= 8; n++) {
        for (const id of state.level.options) expect(feature(id).tier).toBeLessThanOrEqual(2);
        state = game.nextLevel(game.guess(state, state.level.feature).state);
      }
    }
  });

  it('runs on with no level cap', () => {
    const state = play(3, 400);
    expect(state.level.number).toBe(400);
    expect(state.status).not.toBe('over');
  });

  it('gives a life back for a right pick, never above 3, and scores 15 × the level', () => {
    let state = game.start(1);
    expect(state.lives).toBe(BLANK_ATLAS_START_LIVES);
    state = game.nextLevel(game.skip(state));
    expect(state.lives).toBe(2);
    state = game.guess(state, state.level.feature).state;
    expect(state.level.points).toBe(30);
    expect(state.lives).toBe(3);
    expect(state.bonusLife).toBe(true);
    state = game.nextLevel(state);
    state = game.guess(state, state.level.feature).state;
    expect(state.lives).toBe(BLANK_ATLAS_MAX_LIVES);
    expect(state.bonusLife).toBe(false);
    expect(state.marks).toEqual(['lost', 'flawless', 'flawless']);
    expect(state.score).toBe(30 + 45);
  });

  it('costs the level’s life for a wrong pick or a skip, and ends the run with the lives', () => {
    let state = game.start(4);
    const wrong = wrongOption(state);
    state = game.guess(state, wrong).state;
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.level.picked).toBe(wrong);
    expect(state.lives).toBe(2);
    expect(state.score).toBe(0);
    // The level is over: more picks do nothing.
    expect(game.guess(state, state.level.feature).result).toBe('unknown');
    state = game.skip(game.nextLevel(state));
    expect(state.lives).toBe(1);
    state = game.nextLevel(state);
    state = game.guess(state, wrongOption(state)).state;
    expect(state.status).toBe('over');
    expect(state.marks).toEqual(['lost', 'lost', 'lost']);
  });

  it('ignores anything that isn’t one of the options, at no cost', () => {
    const state = game.start(1);
    const notOffered = data.features.find((f) => !state.level.options.includes(f.id))!.id;
    for (const id of ['atlantis', 'haiti', notOffered]) {
      const { state: after, result } = game.guess(state, id);
      expect(result).toBe('unknown');
      expect(after).toBe(state);
    }
  });

  it('replays a run from its moves, and replayGame scores it the same', async () => {
    let state = game.start(11);
    for (let i = 0; i < 12 && state.status !== 'over'; i++) {
      if (state.status === 'level-over') state = game.nextLevel(state);
      if (i % 4 === 1) state = game.skip(state);
      else if (i % 4 === 2) state = game.guess(state, wrongOption(state)).state;
      else state = game.guess(state, state.level.feature).state;
    }
    while (state.status !== 'over') state = game.skip(state.status === 'level-over' ? game.nextLevel(state) : state);
    expect(state.moves).toContain(BLANK_ATLAS_SKIP);
    const again = replayBlankAtlas(game, 11, state.moves);
    expect(again.score).toBe(state.score);
    expect(again.status).toBe('over');
    const definition = getGame('blank-atlas')!;
    expect(await replayGame(definition, normalizeSettings({}, definition), 11, state.moves)).toEqual({ score: state.score, finished: true });
  });

  it('is an arcade game with no region to pick', () => {
    expect(usesRegion(getGame('blank-atlas')!)).toBe(false);
  });
});
