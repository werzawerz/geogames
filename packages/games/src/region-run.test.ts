import { describe, expect, it } from 'vitest';
import { REGIONS_VERSION, divisionCoordinates, loadRegions } from '@geogames/geodata/regions';
import { DATASET_VERSION, replayGame } from './replay.ts';
import { getGame } from './catalog.ts';
import {
  REGION_COUNTRY_GAP,
  REGION_MAX_LIVES,
  REGION_MISSES,
  REGION_PLANS,
  REGION_SKIP,
  createRegionRun,
  regionPlan,
  replayRegionRun,
  type RegionState,
} from './region-run.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const data = await loadRegions();
const game = createRegionRun({ countries: data.countries });
const definition = getGame('region-run')!;
const nameOf = new Map(data.countries.flatMap((c) => c.divisions.map((d) => [d.id, d.name] as const)));
const divisionOf = new Map(data.countries.flatMap((c) => c.divisions.map((d) => [d.id, { ...d, country: c }] as const)));
const SEEDS = 40;

/** A division of the level's country that isn't the answer and wasn't tried. */
const wrongFor = (s: RegionState) =>
  game.countries.get(s.level.country)!.divisions.find((d) => d.id !== s.level.division && !s.level.guesses.includes(d.id))!.id;
const right = (s: RegionState) => game.guess(s, s.level.division).state;

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

describe('region run data', () => {
  it('has countries in three tiers with only visible, named targets', () => {
    expect(data.countries.length).toBeGreaterThanOrEqual(25);
    for (const tier of [1, 2, 3] as const) expect(data.countries.filter((c) => c.tier === tier).length, `tier ${tier}`).toBeGreaterThan(3);
    expect(data.countries.filter((c) => c.tier === 1).map((c) => c.id).sort()).toEqual(['AUS', 'CAN', 'DEU', 'USA']);
    const ids = data.countries.flatMap((c) => c.divisions.map((d) => d.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of data.countries) {
      expect(c.divisions.filter((d) => d.target).length, c.id).toBeGreaterThanOrEqual(5);
      const names = c.divisions.map((d) => d.name.toLowerCase());
      expect(new Set(names).size, `${c.id} names`).toBe(names.length);
      for (const d of c.divisions) {
        expect(d.name.length, d.id).toBeGreaterThan(1);
        expect(d.fame >= 0 && d.fame <= 1, d.id).toBe(true);
        // Never asked: too small to see, or in dispute.
        if (!d.target) expect(d.fame, d.id).toBe(0);
      }
    }
  });

  it('never asks about disputed or tiny places', () => {
    const target = (id: string) => divisionOf.get(id)!.target;
    for (const id of ['IND-Jammu-and-Kashmir', 'IND-Ladakh', 'IND-Arunachal-Pradesh', 'USA-Rhode-Island', 'DEU-Bremen', 'DEU-Berlin', 'AUS-Australian-Capital-Territory']) expect(divisionOf.has(id), id).toBe(true);
    for (const id of ['IND-Jammu-and-Kashmir', 'IND-Ladakh', 'IND-Arunachal-Pradesh', 'USA-Rhode-Island', 'DEU-Bremen', 'DEU-Berlin', 'AUS-Australian-Capital-Territory']) expect(target(id), id).toBe(false);
    for (const id of ['USA-Texas', 'USA-Alaska', 'CAN-Ontario', 'AUS-Queensland', 'DEU-Bayern']) expect(target(id), id).toBe(true);
  });

  it('decodes outlines that stay on the map and close', () => {
    for (const c of data.countries) {
      for (const d of c.divisions) {
        const polygons = divisionCoordinates(c, d);
        expect(polygons.length, d.id).toBeGreaterThan(0);
        for (const rings of polygons) {
          for (const ring of rings) {
            expect(ring.length, d.id).toBeGreaterThanOrEqual(4);
            expect(ring[0]).toEqual(ring.at(-1));
            for (const [lng, lat] of ring) expect(Math.abs(lng) <= 180 && Math.abs(lat) <= 90, d.id).toBe(true);
          }
        }
      }
    }
  });

  it('is part of the dataset version', () => {
    expect(DATASET_VERSION).toContain(`regions${REGIONS_VERSION}`);
  });
});

describe('region run', () => {
  it('is a no-settings arcade game', () => {
    expect(usesRegion(definition)).toBe(false);
    expect(normalizeSettings({ region: 'Asia' }, definition).region).toBe('world');
  });

  it('is deterministic for a seed and differs between seeds', () => {
    expect(playPerfect(5, 12).levels).toEqual(playPerfect(5, 12).levels);
    expect(playPerfect(5, 12).levels.map((l) => l.division)).not.toEqual(playPerfect(6, 12).levels.map((l) => l.division));
  });

  it('asks the same levels whatever the player does', () => {
    // A duel needs this: the puzzles come from the seed, not from the moves.
    const asked = (play: (s: RegionState) => RegionState) => {
      let s = game.start(77);
      const out: string[] = [];
      for (let i = 0; i < 25; i++) {
        out.push(s.level.division);
        s = play(s);
        if (s.status === 'over') break;
        s = game.nextLevel(s);
      }
      return out;
    };
    const perfect = asked(right);
    // Two misses then the answer keep every life, and a skip every fourth level costs some: the levels asked don't change.
    let n = 0;
    const mixed = asked((s) => (n++ % 4 === 3 ? game.skip(s) : game.guess(game.guess(game.guess(s, wrongFor(s)).state, wrongFor(game.guess(s, wrongFor(s)).state)).state, s.level.division).state));
    expect(mixed.length).toBeGreaterThan(5);
    expect(mixed).toEqual(perfect.slice(0, mixed.length));
  });

  it('plans four bands, the tiers and fame opening up as levels go on', () => {
    expect(regionPlan(1).minFame).toEqual({ 1: 0.6 });
    expect(regionPlan(8).band).toBe(1);
    expect(regionPlan(9).band).toBe(2);
    expect(regionPlan(21).band).toBe(3);
    expect(regionPlan(36).band).toBe(4);
    expect(regionPlan(500).band).toBe(4);
    for (let i = 1; i < REGION_PLANS.length; i++) {
      const [a, b] = [REGION_PLANS[i - 1]!, REGION_PLANS[i]!];
      for (const tier of [1, 2, 3] as const) expect(b.minFame[tier] ?? Infinity).toBeLessThanOrEqual(a.minFame[tier] ?? Infinity);
    }
  });

  it('keeps early levels to the four best-known countries and well-known divisions, over many seeds', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 8).levels) {
        expect(['USA', 'CAN', 'AUS', 'DEU'], `seed ${seed}`).toContain(level.country);
        expect(divisionOf.get(level.division)!.fame, `${seed} ${level.division}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it('brings in the other tiers by level, over many seeds', () => {
    const seen = { 2: new Set<string>(), 3: new Set<string>() };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 60);
      levels.forEach((l) => {
        const tier = divisionOf.get(l.division)!.country.tier;
        if (l.number <= 8) expect(tier).toBe(1);
        if (l.number <= 20) expect(tier, `level ${l.number}`).toBeLessThanOrEqual(2);
        if (tier > 1) seen[tier].add(l.country);
      });
    }
    expect(seen[2].size).toBeGreaterThanOrEqual(7);
    expect(seen[3].size).toBeGreaterThanOrEqual(10);
  });

  it('asks only targets, never repeats a division, and spaces out the countries', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 150);
      expect(new Set(levels.map((l) => l.division)).size, `seed ${seed}`).toBe(levels.length);
      levels.forEach((l, i) => {
        expect(divisionOf.get(l.division)!.target).toBe(true);
        expect(divisionOf.get(l.division)!.country.id).toBe(l.country);
        if (i > 0) expect(l.country, `seed ${seed} level ${l.number}`).not.toBe(levels[i - 1]!.country);
        if (l.number > 8) {
          const recent = levels.slice(Math.max(0, i - REGION_COUNTRY_GAP), i).map((x) => x.country);
          expect(recent, `seed ${seed} level ${l.number}`).not.toContain(l.country);
        }
      });
    }
  });

  it('goes on past a thousand levels without repeating a target while any is left', () => {
    const total = data.countries.reduce((n, c) => n + c.divisions.filter((d) => d.target).length, 0);
    const { levels } = playPerfect(3, total + 5);
    expect(new Set(levels.slice(0, total).map((l) => l.division)).size).toBe(total);
  });

  it('scores 10 × the level, less for misses, half as much again when flawless', () => {
    let s = game.start(9);
    s = right(s);
    expect(s.level).toMatchObject({ status: 'cleared', points: 15, flawless: true });
    s = game.nextLevel(s);
    s = game.guess(s, wrongFor(s)).state;
    s = right(s);
    expect(s.level.points).toBe(12); // 20 × 0.6
    expect(s.level.flawless).toBe(false);
    s = game.nextLevel(s);
    s = game.guess(game.guess(s, wrongFor(s)).state, wrongFor(game.guess(s, wrongFor(s)).state)).state;
    s = right(s);
    expect(s.level.points).toBe(9); // 30 × 0.3
    expect(s.score).toBe(15 + 12 + 9);
    expect(s.marks).toEqual(['flawless', 'cleared', 'missed']);
  });

  it('costs one life for three wrong guesses, and a flawless level gives one back, never above 3', () => {
    let s = game.start(11);
    for (let i = 1; i < REGION_MISSES; i++) {
      const r = game.guess(s, wrongFor(s));
      expect(r.result).toBe('wrong');
      s = r.state;
      expect(s.lives).toBe(3);
    }
    const lost = game.guess(s, wrongFor(s));
    expect(lost.result).toBe('lost');
    expect(lost.state).toMatchObject({ lives: 2, status: 'level-over' });
    expect(lost.state.level.status).toBe('lost');
    expect(lost.state.marks).toEqual(['lost']);
    // A flawless level gives it back; at 3 lives the bonus changes nothing.
    let t = right(game.nextLevel(lost.state));
    expect(t.lives).toBe(REGION_MAX_LIVES);
    expect(t.bonusLife).toBe(true);
    t = right(game.nextLevel(t));
    expect(t.lives).toBe(REGION_MAX_LIVES);
    expect(t.bonusLife).toBe(false);
  });

  it('costs a life for a skip, and ends the run at none', () => {
    let s = game.start(12);
    for (let i = 0; i < 3; i++) {
      expect(s.status).toBe('playing');
      s = game.skip(s);
      expect(s.lives).toBe(2 - i);
      if (s.status === 'level-over') s = game.nextLevel(s);
    }
    expect(s.status).toBe('over');
    expect(s.moves).toEqual([REGION_SKIP, REGION_SKIP, REGION_SKIP]);
    expect(game.skip(s)).toBe(s);
    expect(game.guess(s, 'USA-Texas').result).toBe('unknown');
  });

  it('never loses two lives in one level', () => {
    let s = game.start(13);
    while (s.level.guesses.length < REGION_MISSES && s.status === 'playing') s = game.guess(s, wrongFor(s)).state;
    expect(s.lives).toBe(2);
    expect(game.skip(s)).toBe(s);
    expect(game.guess(s, wrongFor(s)).result).toBe('unknown');
  });

  it('takes a division of another country as a free "elsewhere", and a repeat as nothing', () => {
    const s = game.start(14);
    const other = data.countries.find((c) => c.id !== s.level.country)!.divisions[0]!.id;
    const elsewhere = game.guess(s, other);
    expect(elsewhere).toEqual({ state: s, result: 'elsewhere' });
    expect(game.guess(s, 'nowhere').result).toBe('unknown');
    const once = game.guess(s, wrongFor(s));
    expect(game.guess(once.state, once.state.level.guesses[0]!)).toEqual({ state: once.state, result: 'repeat' });
  });

  it('replays a run from its moves, and rejects nothing it does not understand', async () => {
    let s = game.start(15);
    for (let i = 0; i < 30 && s.status !== 'over'; i++) {
      if (i % 5 === 4) s = game.skip(s);
      else {
        if (i % 3 === 1) s = game.guess(s, wrongFor(s)).state;
        s = right(s);
      }
      if (s.status === 'level-over') s = game.nextLevel(s);
    }
    while (s.status !== 'over') s = game.skip(s.status === 'level-over' ? game.nextLevel(s) : s);
    const replayed = replayRegionRun(game, 15, s.moves);
    expect(replayed.score).toBe(s.score);
    expect(replayed.status).toBe('over');
    expect(replayed.moves).toEqual(s.moves);
    expect(await replayGame(definition, normalizeSettings({}, definition), 15, s.moves)).toEqual({ score: s.score, finished: true });
    expect(await replayGame(definition, normalizeSettings({}, definition), 15, s.moves.slice(0, 3))).toMatchObject({ finished: false });
    // Names of divisions on levels it isn't asking cost nothing and change nothing.
    const withNoise = replayRegionRun(game, 15, ['XXX-nowhere', ...s.moves.slice(0, 4)]);
    expect(withNoise.moves).toEqual(s.moves.slice(0, 4));
  });

  it('shows names for the answer: every target has one', () => {
    for (let seed = 1; seed <= 5; seed++) for (const l of playPerfect(seed, 30).levels) expect(nameOf.get(l.division)).toBeTruthy();
  });
});
