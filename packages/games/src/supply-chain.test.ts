import { describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { getCountry, queryCountries } from '@geogames/geodata';
import { SUPPLY_CHAIN_VERSION, loadSupplyChain } from '@geogames/geodata/supply-chain';
import { getGame } from './catalog.ts';
import {
  CHAIN_MAX_LIVES,
  CHAIN_MAX_OVERLAP,
  CHAIN_MIN_SHARE,
  CHAIN_SKIP,
  chainPlan,
  createSupplyChain,
  replaySupplyChain,
  type ChainState,
} from './supply-chain.ts';
import { routeScopes } from './route.ts';
import { DATASET_VERSION, replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const data = await loadSupplyChain();
const countries = queryCountries();
const game = createSupplyChain({ commodities: data.commodities, countries });
const kindOf = (id: string) => data.commodities.find((c) => c.id === id)!;
const definition = getGame('supply-chain')!;
const SEEDS = 60;
/** The commodities with enough real producers to be asked. */
const askable = data.commodities.filter((c) => game.answers(c.id, 5));

/** A country that counts for the level, not found yet. */
const right = (state: ChainState) => game.answers(state.level.commodity, state.level.number)!.accepted.find((id) => !state.level.found.includes(id))!;
/** A country that doesn't count (nor is a dependency), not tried yet. */
const wrong = (state: ChainState) => {
  const accepted = new Set(game.answers(state.level.commodity, state.level.number)!.accepted);
  return countries.find((c) => c.sovereignty !== 'territory' && !accepted.has(c.id) && !state.level.guesses.includes(c.id))!.id;
};

/** Clears `count` levels first go. */
const playPerfect = (seed: number, count = 40) => {
  let state = game.start(seed);
  const levels = [];
  while (levels.length < count) {
    levels.push(state.level);
    while (state.status === 'playing') state = game.guess(state, right(state)).state;
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
};

describe('the data', () => {
  it('records its sources, years and licences', () => {
    expect(SUPPLY_CHAIN_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(DATASET_VERSION).toContain(SUPPLY_CHAIN_VERSION);
    expect(Object.keys(data.sources).sort()).toEqual(['eia', 'faostat', 'usgs']);
    for (const s of Object.values(data.sources)) expect(s.licence && s.url && s.year && s.name).toBeTruthy();
    expect(data.sources.faostat!.licence).toBe('CC BY 4.0');
  });

  it('has real countries, biggest first, with shares that add up to at most the world', () => {
    expect(new Set(data.commodities.map((c) => c.id)).size).toBe(data.commodities.length);
    for (const c of data.commodities) {
      expect(data.sources[c.source], c.id).toBeDefined();
      expect(c.year, c.id).toBeTruthy();
      expect(c.producers.length, c.id).toBeGreaterThanOrEqual(3);
      c.producers.forEach((p, i) => {
        expect(getCountry(p.id), `${c.id} ${p.id}`).toBeDefined();
        expect(p.value, c.id).toBeGreaterThan(0);
        if (i) expect(p.value, c.id).toBeLessThanOrEqual(c.producers[i - 1]!.value);
      });
      expect(c.producers.reduce((s, p) => s + p.share, 0), c.id).toBeLessThan(1.05);
    }
  });

  it('gets the famous leaders right', () => {
    const top = (id: string, n = 3) => kindOf(id).producers.slice(0, n).map((p) => p.id);
    expect(top('coffee', 2)).toEqual(['BRA', 'VNM']);
    expect(top('cocoa', 1)).toEqual(['CIV']);
    expect(top('oil', 3)).toEqual(['USA', 'RUS', 'SAU']);
    expect(top('cobalt', 1)).toEqual(['COD']);
    expect(top('rare-earths', 1)).toEqual(['CHN']);
    expect(top('gold', 1)).toEqual(['CHN']);
    expect(top('maize', 2)).toEqual(['USA', 'CHN']);
    expect(top('nickel', 2)).toEqual(['IDN', 'PHL']);
    expect(top('copper', 3)).toEqual(['CHL', 'COD', 'PER']);
  });

  it('is small enough to bundle', () => {
    expect(statSync(new URL('../../geodata/data/supply-chain.json', import.meta.url)).size).toBeLessThan(100_000);
  });
});

describe('what a level asks', () => {
  it('counts the top N and anything within a tenth of the Nth', () => {
    for (const c of askable) {
      const a = game.answers(c.id, 1_000)!;
      expect(a.need, c.id).toBeGreaterThanOrEqual(3);
      expect(a.accepted.length, c.id).toBeGreaterThanOrEqual(a.need);
      // No producer outside the set out-produces the last one inside it.
      const inside = c.producers.filter((p) => a.accepted.includes(p.id));
      const rest = c.producers.filter((p) => !a.accepted.includes(p.id) && getCountry(p.id)!.sovereignty !== 'territory' && p.share >= CHAIN_MIN_SHARE);
      for (const out of rest) expect(out.value, `${c.id} ${out.id}`).toBeLessThan(inside[inside.length - 1]!.value);
    }
  });

  it('never asks for a country with under 3% of the world, or a dependency', () => {
    for (const c of askable) {
      for (const id of game.answers(c.id, 5)!.accepted) {
        expect(c.producers.find((p) => p.id === id)!.share, `${c.id} ${id}`).toBeGreaterThanOrEqual(CHAIN_MIN_SHARE);
        expect(getCountry(id)!.sovereignty, `${c.id} ${id}`).not.toBe('territory');
      }
    }
  });

  it('has plenty to ask, from every source', () => {
    expect(askable.length).toBeGreaterThan(90);
    for (const tier of [1, 2, 3]) expect(askable.filter((c) => c.tier === tier).length).toBeGreaterThanOrEqual(20);
    for (const kind of ['farm', 'mine', 'energy']) expect(askable.filter((c) => c.kind === kind).length).toBeGreaterThanOrEqual(8);
  });

  it('lets coffee count Colombia as well as Indonesia, which are within a tenth', () => {
    const a = game.answers('coffee', 3)!;
    expect(a.need).toBe(3);
    expect(a.accepted.slice(0, 4)).toEqual(['BRA', 'VNM', 'IDN', 'COL']);
  });

  it('leaves the dependency out of nickel but keeps its place in the ranking', () => {
    expect(game.answers('nickel', 5)!.accepted).not.toContain('NCL');
    expect(game.rank('nickel', 'NCL')).toBe(5);
  });
});

describe('the level plan', () => {
  it('is deterministic for a seed', () => {
    expect(game.start(7)).toEqual(game.start(7));
    expect(playPerfect(7, 12).levels.map((l) => l.commodity)).toEqual(playPerfect(7, 12).levels.map((l) => l.commodity));
  });

  it('asks a different commodity every level of a run', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ids = playPerfect(seed, 40).levels.map((l) => l.commodity);
      expect(new Set(ids).size, `seed ${seed}`).toBe(ids.length);
    }
  });

  it('opens on famous goods, with the top 3 and nobody in Africa or the Caribbean', () => {
    const { isRemote } = routeScopes(countries);
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 8).levels) {
        expect(kindOf(level.commodity).tier, `seed ${seed} ${level.commodity}`).toBe(1);
        expect(level.need).toBe(3);
        for (const id of game.answers(level.commodity, level.number)!.accepted) expect(isRemote(id), `${level.commodity} ${id}`).toBe(false);
      }
    }
  });

  it('asks for more producers, and from rarer goods, as it goes', () => {
    expect(chainPlan(1).size).toBe(3);
    expect(chainPlan(9).size).toBe(4);
    expect(chainPlan(15).size).toBe(5);
    expect(chainPlan(21).band).toBe(3);
    const tiers = [0, 0, 0, 0];
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 30).levels.slice(21)) tiers[kindOf(level.commodity).tier]!++;
    }
    expect(tiers[3]! + tiers[2]!).toBeGreaterThan(tiers[1]! * 3);
    expect(tiers[3]).toBeGreaterThan(0);
  });

  it('keeps a level from sharing more than half its answers with the last three, nearly always', () => {
    let checked = 0;
    let over = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 25);
      levels.forEach((l, i) => {
        const a = game.answers(l.commodity, l.number)!;
        for (const before of levels.slice(Math.max(0, i - 3), i)) {
          const b = game.answers(before.commodity, before.number)!;
          const shared = a.accepted.filter((c) => b.accepted.includes(c)).length;
          if (shared / Math.min(a.need, b.need) > CHAIN_MAX_OVERLAP) over++;
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(1000);
    // China, India and the United States lead so much that the odd level has to share; the rule gives way only then.
    expect(over / checked).toBeLessThan(0.06);
  });

  it('does not ask the same sort of thing twice in a row, where it can help it', () => {
    let same = 0;
    let pairs = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const kinds = playPerfect(seed, 25).levels.map((l) => kindOf(l.commodity).kind);
      kinds.forEach((k, i) => {
        if (i) {
          pairs++;
          if (k === kinds[i - 1]) same++;
        }
      });
    }
    expect(same / pairs).toBeLessThan(0.1);
  });

  it('squeezes the free misses late in the run', () => {
    expect([1, 20, 21, 35, 36, 80].map((n) => chainPlan(n).misses)).toEqual([3, 3, 2, 2, 1, 1]);
  });
});

describe('playing', () => {
  it('finds producers in any order, with no cost for a right guess', () => {
    const state = game.start(3);
    const accepted = game.answers(state.level.commodity, 1)!.accepted;
    const a = game.guess(state, accepted[1]!);
    expect(a.result).toBe('found');
    expect(a.state.level.found).toEqual([accepted[1]]);
    expect(a.state.status).toBe('playing');
    expect(game.guess(a.state, accepted[1]!).result).toBe('repeat');
  });

  it('clears a level on the Nth producer, and scores it by level and misses', () => {
    let state = game.start(3);
    const { need } = state.level;
    while (state.status === 'playing') state = game.guess(state, right(state)).state;
    expect(state.level.status).toBe('cleared');
    expect(state.level.found).toHaveLength(need);
    expect(state.level.flawless).toBe(true);
    // (5 + level) a producer, and half as much again for a flawless level.
    expect(state.level.points).toBe(Math.round(6 * need * 1.5));
    expect(state.score).toBe(state.level.points);
    expect(state.marks).toEqual(['flawless']);

    let slip = game.start(3);
    slip = game.guess(slip, wrong(slip)).state;
    while (slip.status === 'playing') slip = game.guess(slip, right(slip)).state;
    expect(slip.level.flawless).toBe(false);
    expect(slip.level.points).toBe(Math.round(6 * need * 0.7));
    expect(slip.marks).toEqual(['cleared']);
  });

  it('gives a life back for a flawless level, never above 3, and none for a slip', () => {
    let state = game.start(5);
    state = game.skip(state);
    expect(state.lives).toBe(2);
    state = game.nextLevel(state);
    while (state.status === 'playing') state = game.guess(state, right(state)).state;
    expect(state.lives).toBe(3);
    expect(state.bonusLife).toBe(true);
    state = game.nextLevel(state);
    while (state.status === 'playing') state = game.guess(state, right(state)).state;
    expect(state.lives).toBe(CHAIN_MAX_LIVES);
    expect(state.bonusLife).toBe(false);

    let slip = game.start(5);
    slip = game.skip(slip);
    slip = game.nextLevel(slip);
    slip = game.guess(slip, wrong(slip)).state;
    while (slip.status === 'playing') slip = game.guess(slip, right(slip)).state;
    expect(slip.lives).toBe(2);
  });

  it('loses one life for three wrong guesses, and ends the level', () => {
    let state = game.start(8);
    for (let i = 0; i < 2; i++) {
      const r = game.guess(state, wrong(state));
      expect(r.result).toBe('wrong');
      state = r.state;
      expect(state.status).toBe('playing');
      expect(state.lives).toBe(3);
    }
    state = game.guess(state, wrong(state)).state;
    expect(state.lives).toBe(2);
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.marks).toEqual(['lost']);
    // Nothing more is taken on that level.
    expect(game.guess(state, wrong(state)).result).toBe('unknown');
    expect(game.skip(state)).toBe(state);
  });

  it('pays half for what was found when the level is lost', () => {
    let state = game.start(8);
    state = game.guess(state, right(state)).state;
    state = game.skip(state);
    expect(state.level.points).toBe(Math.round(6 * 0.5));
    expect(state.score).toBe(state.level.points);
  });

  it('counts a wrong country in the top ten as a miss and says its place', () => {
    const state = game.start(8);
    const { commodity } = state.level;
    const ranked = kindOf(commodity).producers;
    const accepted = new Set(game.answers(commodity, 1)!.accepted);
    const near = ranked.find((p, i) => !accepted.has(p.id) && i < 10 && getCountry(p.id)!.sovereignty !== 'territory');
    if (near) {
      expect(game.rank(commodity, near.id)).toBe(ranked.indexOf(near) + 1);
      expect(game.guess(state, near.id).result).toBe('wrong');
    }
    expect(game.rank(commodity, 'ATA')).toBeNull();
  });

  it('rejects dependencies and ids that are not countries', () => {
    const state = game.start(1);
    expect(game.guess(state, 'NCL').result).toBe('unknown');
    expect(game.guess(state, 'XXX').result).toBe('unknown');
    expect(game.guess(state, 'NCL').state).toBe(state);
  });

  it('ends the run when the lives are gone, and a level never costs more than one', () => {
    let state = game.start(2);
    let levels = 0;
    while (state.status !== 'over' && levels < 10) {
      const before = state.lives;
      for (let i = 0; i < 5 && state.status === 'playing'; i++) state = game.guess(state, wrong(state)).state;
      expect(before - state.lives).toBe(1);
      if (state.status === 'level-over') state = game.nextLevel(state);
      levels++;
    }
    expect(state.status).toBe('over');
    expect(state.lives).toBe(0);
    expect(levels).toBe(3);
  });

  it('has no cap: a perfect run goes on past level 40', () => {
    const { state } = playPerfect(11, 60);
    expect(state.level.number).toBe(60);
    expect(state.lives).toBe(3);
  });
});

describe('replay', () => {
  it('rebuilds the same state from the moves', () => {
    let state = game.start(21);
    for (let i = 0; i < 25 && state.status !== 'over'; i++) {
      if (i % 6 === 3) state = game.skip(state);
      else if (i % 4 === 1) state = game.guess(state, wrong(state)).state;
      else state = game.guess(state, right(state)).state;
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    const again = replaySupplyChain(game, 21, state.moves);
    expect(again.score).toBe(state.score);
    expect(again.lives).toBe(state.lives);
    expect(again.level).toEqual(state.level);
    expect(state.moves).toContain(CHAIN_SKIP);
  });

  it('is scored by the server the same way', async () => {
    const settings = normalizeSettings({}, definition);
    let state = game.start(33);
    for (let i = 0; i < 40 && state.status !== 'over'; i++) {
      state = i % 5 === 4 ? game.skip(state) : game.guess(state, i % 3 === 1 ? wrong(state) : right(state)).state;
      if (state.status === 'level-over') state = game.nextLevel(state);
    }
    expect(state.score).toBeGreaterThan(0);
    const result = await replayGame(definition, settings, 33, state.moves);
    expect(result.score).toBe(state.score);
    expect(result.finished).toBe(state.status === 'over');
  });

  it('has no regions to choose', () => {
    expect(usesRegion(definition)).toBe(false);
  });
});
