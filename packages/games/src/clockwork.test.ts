import { describe, expect, it } from 'vitest';
import { getGame } from './catalog.ts';
import {
  CLOCK_DATES,
  CLOCK_MAX_LIVES,
  CLOCK_PLACES,
  CLOCK_REPEAT_GAP,
  CLOCK_SKIP,
  clockOffset,
  clockPlace,
  clockPlan,
  clockworkCountries,
  createClockwork,
  formatClock,
  formatOffset,
  hasDaylightSaving,
  parseClock,
  replayClockwork,
  type ClockLevel,
  type ClockState,
} from './clockwork.ts';
import { CLOCK_OFFSETS } from './clockwork-offsets.ts';
import { replayGame } from './replay.ts';
import { normalizeSettings, usesRegion } from './settings.ts';

const countries = clockworkCountries();
const game = createClockwork({ countries });
const byId = new Map(countries.map((c) => [c.id, c]));
const definition = getGame('clockwork')!;
const SEEDS = 60;

/** A wrong time for the level, not tried yet. */
const wrong = (state: ClockState) => {
  for (let t = state.level.answer + 60; ; t += 60) {
    const m = t % 1440;
    if (m !== state.level.answer && !state.level.guesses.includes(m)) return m;
  }
};

/** Clears `count` levels with the right time first go: a run never ends by itself. */
const playPerfect = (seed: number, count = 30) => {
  let state = game.start(seed);
  const levels: ClockLevel[] = [];
  while (levels.length < count) {
    levels.push(state.level);
    state = game.guess(state, state.level.answer).state;
    if (levels.length < count) state = game.nextLevel(state);
  }
  return { state, levels };
};

describe('clockwork data', () => {
  it('has an offset for every place on every date, from the pinned table', () => {
    for (const p of CLOCK_PLACES) {
      expect(CLOCK_OFFSETS[p.zone], p.zone).toHaveLength(CLOCK_DATES.length);
      for (const o of CLOCK_OFFSETS[p.zone]!) expect(Math.abs(o % 15), p.zone).toBe(0);
    }
  });

  it('knows the textbook offsets', () => {
    const day = (label: string) => CLOCK_DATES.findIndex((d) => d.label === label);
    const at = (id: string, label: string) => clockOffset(clockPlace(id), day(label));
    expect(at('jpn', '12 January')).toBe(540);
    expect(at('ind', '12 January')).toBe(330);
    expect(at('npl', '14 July')).toBe(345);
    expect(at('chn', '14 July')).toBe(480);
    expect(at('esp-madrid', '12 January')).toBe(60);
    expect(at('esp-madrid', '14 July')).toBe(120);
    // The south does it the other way round.
    expect(at('nzl-auckland', '12 January')).toBe(780);
    expect(at('nzl-auckland', '14 July')).toBe(720);
    expect(at('usa-phoenix', '14 July')).toBe(-420);
    expect(at('pry', '12 January')).toBe(-180);
    expect(at('chl-easter', '14 July')).toBe(-360);
  });

  it('picks dates for what they test', () => {
    const on = (season: string) => CLOCK_DATES.map((d, i) => [d, i] as const).filter(([d]) => d.season === season).map(([, i]) => i);
    const at = (id: string, date: number) => clockOffset(clockPlace(id), date);
    expect(new Set(CLOCK_DATES.map((d) => d.label)).size).toBe(CLOCK_DATES.length);
    for (const d of on('winter')) expect([at('gbr', d), at('usa-new-york', d), at('aus-sydney', d)], CLOCK_DATES[d]!.label).toEqual([0, -300, 660]);
    for (const d of on('summer')) expect([at('gbr', d), at('usa-new-york', d), at('aus-sydney', d)], CLOCK_DATES[d]!.label).toEqual([60, -240, 600]);
    // The US has changed its clocks, Europe hasn't, the south is still on summer time.
    for (const d of on('us-first')) expect([at('gbr', d), at('usa-new-york', d), at('chl-santiago', d)], CLOCK_DATES[d]!.label).toEqual([0, -240, -180]);
    // Europe has changed back, the US hasn't.
    for (const d of on('eu-first')) expect([at('deu', d), at('usa-chicago', d), at('nzl-auckland', d)], CLOCK_DATES[d]!.label).toEqual([60, -300, 780]);
    // Around the south's changes: Europe on summer time throughout.
    const south = on('south-change').map((d) => [CLOCK_DATES[d]!.label, at('aus-sydney', d), at('nzl-auckland', d), at('egy', d), at('fra', d)]);
    expect(south).toEqual([
      ['1 April', 660, 780, 120, 120],
      ['9 April', 600, 720, 120, 120],
      ['16 April', 600, 720, 120, 120],
      ['28 April', 600, 720, 180, 120],
      ['29 September', 600, 780, 180, 120],
      ['1 October', 600, 780, 180, 120],
    ]);
  });

  it('asks only about countries big enough to see, each in the data', () => {
    for (const p of CLOCK_PLACES) {
      const c = byId.get(p.country);
      expect(c, p.id).toBeDefined();
      expect(c!.metrics.area?.value ?? 0, p.id).toBeGreaterThan(10_000);
    }
    expect(new Set(CLOCK_PLACES.map((p) => p.id)).size).toBe(CLOCK_PLACES.length);
  });

  it('names a city for every country with more than one zone, and only one zone per unnamed country', () => {
    const zones = new Map<string, Set<string>>();
    for (const p of CLOCK_PLACES) zones.set(p.country, (zones.get(p.country) ?? new Set()).add(p.zone));
    for (const p of CLOCK_PLACES) if (zones.get(p.country)!.size > 1) expect(p.city, p.id).toBeDefined();
    // Countries the IANA database splits into zones, even when only one is asked.
    for (const country of ['USA', 'CAN', 'RUS', 'AUS', 'BRA', 'MEX', 'IDN', 'CHL', 'ECU', 'ESP', 'PRT', 'NZL', 'MNG', 'GRL', 'PNG']) {
      for (const p of CLOCK_PLACES.filter((q) => q.country === country)) expect(p.city, p.id).toBeDefined();
    }
  });
});

describe('time input', () => {
  it('reads the ways people type a time', () => {
    expect(parseClock('17:30')).toBe(1050);
    expect(parseClock('17.30')).toBe(1050);
    expect(parseClock('1730')).toBe(1050);
    expect(parseClock('930')).toBe(570);
    expect(parseClock('9')).toBe(540);
    expect(parseClock(' 09:05 ')).toBe(545);
    expect(parseClock('5:30pm')).toBe(1050);
    expect(parseClock('5.30 p.m.')).toBe(1050);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('12pm')).toBe(720);
    expect(parseClock('24:00')).toBe(0);
    expect(parseClock('0:45')).toBe(45);
    for (const bad of ['', '25:00', '12:60', 'noon', '13pm', '1:2', '12345']) expect(parseClock(bad), bad).toBeNull();
  });

  it('formats times and offsets', () => {
    expect(formatClock(1050)).toBe('17:30');
    expect(formatClock(-60)).toBe('23:00');
    expect(formatOffset(330)).toBe('UTC+5:30');
    expect(formatOffset(-210)).toBe('UTC−3:30');
    expect(formatOffset(0)).toBe('UTC');
    expect(formatOffset(-300)).toBe('UTC−5');
  });
});

describe('clockwork', () => {
  it('is deterministic for a seed', () => {
    expect(playPerfect(4).state).toEqual(playPerfect(4).state);
    expect(playPerfect(1).levels).not.toEqual(playPerfect(2).levels);
  });

  it('works the answer out from the UTC time and the offset', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed).levels) {
        expect(level.offset).toBe(clockOffset(clockPlace(level.place), level.date));
        expect(level.answer).toBe((((level.utcHour * 60 + level.offset) % 1440) + 1440) % 1440);
      }
    }
  });

  it('ramps the skill: longitude, then exceptions, then seasons, then the clock-change dates and oddities', () => {
    const seen = { band1: new Set<string>(), band2: [] as string[], band3: [] as string[], band4: [] as ClockLevel[] };
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const level of playPerfect(seed, 40).levels) {
        const place = clockPlace(level.place);
        const band = clockPlan(level.number).band;
        if (band === 1) {
          // Famous places whose clock follows longitude, on standard time, outside Africa and the Caribbean.
          expect(place.kind, place.id).toBe('longitude');
          expect(place.tier).toBe(1);
          expect(CLOCK_DATES[level.date]!.season).toBe('winter');
          expect(level.offset).toBe(Math.min(...CLOCK_OFFSETS[place.zone]!));
          expect(byId.get(place.country)!.continent).not.toBe('Africa');
          expect(Math.abs(level.offset % 60)).toBe(0);
          seen.band1.add(place.id);
        } else if (band === 2) {
          expect(CLOCK_DATES[level.date]!.season).toBe('winter');
          expect(level.offset).toBe(Math.min(...CLOCK_OFFSETS[place.zone]!));
          expect(['longitude', 'exception']).toContain(place.kind);
          // Belgium and the Netherlands aren't exceptions, and band 2 doesn't fall back on Europe.
          if (place.kind === 'longitude') expect(byId.get(place.country)!.continent, place.id).not.toBe('Europe');
          seen.band2.push(place.kind);
        } else if (band === 3) {
          expect(['winter', 'summer']).toContain(CLOCK_DATES[level.date]!.season);
          expect(place.kind).not.toBe('odd');
          seen.band3.push(hasDaylightSaving(place) || place.kind === 'seasons' ? 'seasonal' : 'plain');
        } else seen.band4.push(level);
      }
    }
    // Many different openings, not the same few.
    expect(seen.band1.size).toBeGreaterThan(25);
    const share = (list: string[], kind: string) => list.filter((k) => k === kind).length / list.length;
    expect(share(seen.band2, 'exception')).toBeGreaterThan(0.75);
    expect(share(seen.band3, 'seasonal')).toBeGreaterThan(0.75);
    // Band 4 uses every kind of date, many dates in all, and asks the oddities.
    expect(new Set(seen.band4.map((l) => CLOCK_DATES[l.date]!.season)).size).toBe(5);
    expect(new Set(seen.band4.map((l) => l.date)).size).toBeGreaterThan(20);
    // Not just Europe, North America and the big names.
    const continents = new Set(seen.band4.map((l) => byId.get(clockPlace(l.place).country)!.continent));
    expect(continents.size).toBeGreaterThanOrEqual(6);
    expect(seen.band4.some((l) => clockPlace(l.place).kind === 'odd')).toBe(true);
    // In band 3, places really are asked on their summer time.
    expect(seen.band4.some((l) => l.offset > Math.min(...CLOCK_OFFSETS[clockPlace(l.place).zone]!))).toBe(true);
  });

  it(`doesn't ask a place again within ${CLOCK_REPEAT_GAP} levels, nor the same country or answer twice in a row`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { levels } = playPerfect(seed, 80);
      levels.forEach((level, i) => {
        const recent = levels.slice(Math.max(0, i - CLOCK_REPEAT_GAP), i).map((l) => l.place);
        expect(recent, `seed ${seed} level ${i + 1}`).not.toContain(level.place);
        const previous = levels[i - 1];
        if (previous) {
          expect(clockPlace(level.place).country).not.toBe(clockPlace(previous.place).country);
          expect(level.offset === previous.offset && level.date === previous.date, `seed ${seed} level ${i + 1}`).toBe(false);
        }
      });
    }
  });

  it('says earlier or later, the short way round the clock', () => {
    const state = game.start(3);
    const { answer } = state.level;
    expect(game.guess(state, (answer + 60) % 1440).result).toBe('earlier');
    expect(game.guess(state, (answer + 1380) % 1440).result).toBe('later');
    expect(game.guess(state, (answer + 30) % 1440).result).toBe('earlier');
  });

  it('scores a first-go answer as flawless, with half again and a life back, up to 3', () => {
    let state = game.start(5);
    state = game.skip(state);
    expect(state.lives).toBe(2);
    state = game.nextLevel(state);
    state = game.guess(state, state.level.answer).state;
    expect(state.level.flawless).toBe(true);
    expect(state.level.points).toBe(30);
    expect(state.lives).toBe(3);
    expect(state.bonusLife).toBe(true);
    state = game.nextLevel(state);
    state = game.guess(state, state.level.answer).state;
    expect(state.lives).toBe(CLOCK_MAX_LIVES);
    expect(state.bonusLife).toBe(false);
    expect(state.score).toBe(30 + 45);
    expect(state.marks).toEqual(['lost', 'flawless', 'flawless']);
  });

  it('lets two misses go free; the third costs one life and ends the level', () => {
    let state = game.start(6);
    state = game.guess(state, wrong(state)).state;
    state = game.guess(state, wrong(state)).state;
    expect(state.status).toBe('playing');
    expect(state.lives).toBe(3);
    const right = game.guess(state, state.level.answer).state;
    expect(right.level.points).toBe(3);
    expect(right.marks).toEqual(['missed']);
    state = game.guess(state, wrong(state)).state;
    expect(state.status).toBe('level-over');
    expect(state.level.status).toBe('lost');
    expect(state.lives).toBe(2);
    expect(state.score).toBe(0);
  });

  it("doesn't charge for a repeated time or nonsense", () => {
    let state = game.start(7);
    state = game.guess(state, wrong(state)).state;
    const again = game.guess(state, state.level.guesses[0]!);
    expect(again.result).toBe('repeat');
    expect(again.state).toBe(state);
    expect(game.guess(state, 1440).result).toBe('invalid');
    expect(game.guess(state, 1.5).result).toBe('invalid');
  });

  it('allows fewer free misses once dates matter: one from level 15, none from level 45', () => {
    expect(clockPlan(14).misses).toBe(3);
    expect(clockPlan(15).misses).toBe(2);
    expect(clockPlan(44).misses).toBe(2);
    expect(clockPlan(45).misses).toBe(1);
    const mid = game.nextLevel(playPerfect(10, 15).state);
    const once = game.guess(mid, wrong(mid)).state;
    expect(once.status).toBe('playing');
    const twice = game.guess(once, wrong(once)).state;
    expect(twice.level.status).toBe('lost');
    expect(twice.lives).toBe(mid.lives - 1);
    let { state } = playPerfect(8, 45);
    state = game.nextLevel(state);
    expect(state.level.number).toBe(46);
    state = game.guess(state, wrong(state)).state;
    expect(state.level.status).toBe('lost');
  });

  it('ends the run when the lives are gone, and has no last level', async () => {
    let { state } = playPerfect(9, 100);
    expect(state.level.number).toBe(100);
    for (let i = 0; i < 3; i++) state = game.skip(game.nextLevel(state));
    expect(state.status).toBe('over');
    expect(state.lives).toBe(0);
    expect(game.nextLevel(state)).toBe(state);
    expect(replayClockwork(game, 9, state.moves)).toEqual(state);
    expect(await replayGame(definition, normalizeSettings({}, definition), 9, state.moves)).toEqual({ score: state.score, finished: true });
  });

  it('replays a run with misses, and a server gets the same score', async () => {
    for (const seed of [11, 12, 13]) {
      let state = game.start(seed);
      while (state.status !== 'over') {
        if (state.status === 'level-over') state = game.nextLevel(state);
        const n = state.level.number;
        if (n % 4 === 0) state = game.skip(state);
        else if (n % 3 === 0) state = game.guess(game.guess(state, wrong(state)).state, state.level.answer).state;
        else if (n % 5 === 0) for (let i = 0; i < 3 && state.status === 'playing'; i++) state = game.guess(state, wrong(state)).state;
        else state = game.guess(state, state.level.answer).state;
      }
      expect(replayClockwork(game, seed, state.moves)).toEqual(state);
      expect(await replayGame(definition, normalizeSettings({}, definition), seed, state.moves)).toEqual({ score: state.score, finished: true });
      expect(state.moves.every((m) => m === CLOCK_SKIP || /^\d\d:\d\d$/.test(m))).toBe(true);
    }
  });

  it('ignores moves it doesn’t know when replaying', () => {
    const state = game.start(14);
    expect(replayClockwork(game, 14, ['nonsense', '99:99'])).toEqual(state);
  });

  it('has no region to pick', () => {
    expect(usesRegion(definition)).toBe(false);
  });
});
