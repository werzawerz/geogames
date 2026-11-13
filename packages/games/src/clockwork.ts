import { queryCountries, type Country } from '@geogames/geodata';
import { CLOCK_OFFSETS } from './clockwork-offsets.ts';
import { CLOCK_PLACES, type ClockPlace } from './clockwork-places.ts';
import { createRng, pick, type Rng } from './rng.ts';

export { CLOCK_DATES } from './clockwork-dates.ts';
export { CLOCK_TZDB } from './clockwork-offsets.ts';
export { CLOCK_PLACES, type ClockKind, type ClockPlace } from './clockwork-places.ts';

/**
 * Clockwork: it's a given time in UTC on a given date, and a country (or a
 * named city in a country with several zones) lights up. Type the local time
 * there. A wrong time says whether the answer is earlier or later. Two wrong
 * times are free; the third, or a skip, costs a life and ends the level. The
 * run has no end but the lives.
 *
 * Each band adds a skill rather than making the last one more obscure:
 * 1. Clocks that follow longitude, on a winter date with no daylight saving.
 * 2. Clocks that don't: China on one zone, Spain on Central European Time,
 *    India's half hour.
 * 3. Winter or summer dates, so daylight saving matters, the south doing it the
 *    other way round, and the places that dropped it.
 * 4. Dates between one country's clock change and another's, and the oddities
 *    (Nepal's quarter hour, the Chatham Islands). This band holds from there,
 *    with fewer free misses late on so a run ends.
 *
 * Offsets come from a table generated from the IANA database for fixed dates
 * (clockwork-offsets.ts), never from the runtime's time zone data, so a server
 * replay gives the same answers as the player's browser.
 */

export interface ClockPlan {
  /** First level this plan applies to. */
  from: number;
  band: 1 | 2 | 3 | 4;
  /** Indexes into CLOCK_DATES the level's date is picked from. */
  dates: readonly number[];
  /** Wrong times that lose the level: the last of them costs a life. */
  misses: number;
}

export const CLOCK_PLANS: readonly ClockPlan[] = [
  { from: 1, band: 1, dates: [0], misses: 3 },
  { from: 7, band: 2, dates: [0], misses: 3 },
  { from: 15, band: 3, dates: [0, 1], misses: 3 },
  { from: 25, band: 4, dates: [0, 1, 2, 3], misses: 3 },
  { from: 30, band: 4, dates: [0, 1, 2, 3], misses: 2 },
  { from: 45, band: 4, dates: [0, 1, 2, 3], misses: 1 },
];

export const clockPlan = (level: number): ClockPlan => [...CLOCK_PLANS].reverse().find((p) => level >= p.from)!;

export const CLOCK_START_LIVES = 3;
export const CLOCK_MAX_LIVES = 3;
/** A cleared level is worth this × the level number, less for each miss. */
export const CLOCK_POINTS_PER_LEVEL = 10;
/** Share of the points kept after 0, 1 or 2 misses. */
const MISS_SHARE = [1, 0.6, 0.3];
/** A flawless level earns this share of its points again, and a life. */
export const CLOCK_FLAWLESS_SHARE = 0.5;
/** A place isn't asked again within this many levels. */
export const CLOCK_REPEAT_GAP = 30;
const DAY = 24 * 60;
const SKIP = 'skip';
export const CLOCK_SKIP = SKIP;

export type ClockGuessResult = 'right' | 'earlier' | 'later' | 'repeat' | 'invalid';
export type ClockMark = 'flawless' | 'cleared' | 'missed' | 'lost';

export interface ClockLevel {
  number: number;
  place: string;
  /** Index into CLOCK_DATES. */
  date: number;
  /** The reference time, a whole hour in UTC. */
  utcHour: number;
  /** The local time there, in minutes after midnight. */
  answer: number;
  /** The place's offset from UTC on the date, in minutes. */
  offset: number;
  /** Times tried, in minutes after midnight. */
  guesses: readonly number[];
  status: 'playing' | 'cleared' | 'lost';
  points: number;
  flawless: boolean;
}

export interface ClockState {
  readonly seed: number;
  readonly rngState: number;
  readonly level: ClockLevel;
  readonly lives: number;
  readonly score: number;
  /** 'level-over': the level is done and shows its answer, with lives left for the next. */
  readonly status: 'playing' | 'level-over' | 'over';
  /** True when the level just ended earned a life back. */
  readonly bonusLife: boolean;
  readonly marks: readonly ClockMark[];
  /** Places asked so far, oldest first. */
  readonly past: readonly string[];
  /** Times as HH:MM and skips, in order; with the seed this replays the game. */
  readonly moves: readonly string[];
}

/** "17:30" for 1050; any number of minutes wraps into the day. */
export function formatClock(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "UTC+5:30", "UTC−3", "UTC" for an offset in minutes. */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const a = Math.abs(minutes);
  return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

/**
 * Reads what a player typed as a time of day: "17:30", "17.30", "1730", "930",
 * "9", "5:30pm", "12am". Null when it isn't one.
 */
export function parseClock(text: string): number | null {
  // "5.30 p.m." → "5.30pm": spaces go, and dots but the one before the minutes.
  const compact = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\.(?!\d)/g, '');
  // One or two digits for the hour; "930" backtracks to 9 and 30.
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(compact);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  if (minutes > 59) return null;
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3].startsWith('p') ? 12 : 0);
  }
  if (hours > 24 || (hours === 24 && minutes > 0)) return null;
  return (hours * 60 + minutes) % DAY;
}

const placeById = new Map(CLOCK_PLACES.map((p) => [p.id, p]));
export const clockPlace = (id: string): ClockPlace => placeById.get(id)!;
export const clockOffset = (place: ClockPlace, date: number): number => CLOCK_OFFSETS[place.zone]![date]!;
/** Whether the place's clock changes over the year. */
export const hasDaylightSaving = (place: ClockPlace) => new Set(CLOCK_OFFSETS[place.zone]).size > 1;
/** Whether the place is on its summer time on a date. */
const onSummerTime = (place: ClockPlace, date: number) => clockOffset(place, date) > Math.min(...CLOCK_OFFSETS[place.zone]!);

/** The countries a Clockwork place may be in: territories too, for Greenland. */
export const clockworkCountries = () => queryCountries({ sovereignty: ['un-member', 'un-observer', 'partially-recognized', 'territory'] });

export function createClockwork({ countries }: { countries: readonly Country[] }) {
  const byId = new Map(countries.map((c) => [c.id, c]));
  const remote = (p: ClockPlace) => {
    const c = byId.get(p.country);
    return c?.continent === 'Africa' || c?.subregion === 'Caribbean';
  };
  const places = CLOCK_PLACES.filter((p) => byId.has(p.country));
  const seasonal = (p: ClockPlace) => p.kind === 'seasons' || hasDaylightSaving(p);

  /**
   * The places a level may ask, as groups with the chance of each, for the
   * band's skill. A group that comes out empty is passed over.
   */
  function groups(band: ClockPlan['band'], date: number): { share: number; places: ClockPlace[] }[] {
    const standard = places.filter((p) => !onSummerTime(p, date));
    switch (band) {
      case 1:
        return [{ share: 1, places: standard.filter((p) => p.kind === 'longitude' && p.tier === 1 && !remote(p)) }];
      case 2:
        return [
          { share: 0.7, places: standard.filter((p) => p.kind === 'exception') },
          { share: 0.3, places: standard.filter((p) => p.kind === 'longitude') },
        ];
      case 3:
        return [
          { share: 0.6, places: places.filter((p) => p.kind !== 'odd' && seasonal(p)) },
          { share: 0.4, places: places.filter((p) => p.kind !== 'odd' && !seasonal(p)) },
        ];
      case 4:
        // Between two clock changes, the clock changes are the point.
        return date >= 2
          ? [
              { share: 0.75, places: places.filter(seasonal) },
              { share: 0.25, places: places.filter((p) => !seasonal(p)) },
            ]
          : [
              { share: 0.2, places: places.filter((p) => p.kind === 'odd') },
              { share: 0.45, places: places.filter(seasonal) },
              { share: 0.35, places: places.filter((p) => !seasonal(p) && p.kind !== 'odd') },
            ];
    }
  }

  function nextPlace(rng: Rng, plan: ClockPlan, date: number, past: readonly string[]): ClockPlace {
    const recent = new Set(past.slice(-CLOCK_REPEAT_GAP));
    const previous = past.length ? clockPlace(past[past.length - 1]!) : null;
    // Straight after Germany, Italy (the same country, or the same answer) would feel like the same level again.
    const apart = (p: ClockPlace) =>
      !previous || (p.country !== previous.country && clockOffset(p, date) !== clockOffset(previous, date));
    const roll = rng.next();
    let sum = 0;
    const ordered = groups(plan.band, date);
    const chosen = ordered.find((g) => (sum += g.share) > roll) ?? ordered[ordered.length - 1]!;
    // The chosen group first; if the run has used it up, the band's others, then any place,
    // and only then a repeat of the country or answer just asked.
    const all = ordered.flatMap((g) => g.places);
    for (const fits of [(p: ClockPlace) => !recent.has(p.id) && apart(p), (p: ClockPlace) => !recent.has(p.id)]) {
      for (const pool of [chosen.places, all, places]) {
        const candidates = pool.filter(fits);
        if (candidates.length) return pick(rng, candidates);
      }
    }
    return pick(rng, places);
  }

  function makeLevel(rng: Rng, number: number, past: readonly string[]): ClockLevel {
    const plan = clockPlan(number);
    const date = pick(rng, plan.dates);
    const place = nextPlace(rng, plan, date, past);
    // Early on, a time in the working day, so the answer rarely crosses midnight.
    const utcHour = plan.band === 1 ? 9 + Math.floor(rng.next() * 7) : Math.floor(rng.next() * 24);
    const offset = clockOffset(place, date);
    return {
      number,
      place: place.id,
      date,
      utcHour,
      offset,
      answer: (((utcHour * 60 + offset) % DAY) + DAY) % DAY,
      guesses: [],
      status: 'playing',
      points: 0,
      flawless: false,
    };
  }

  function endLevel(state: ClockState, level: ClockLevel, lives: number, mark: ClockMark, move: string): ClockState {
    return {
      ...state,
      level,
      lives,
      bonusLife: lives > state.lives,
      score: state.score + level.points,
      status: lives > 0 ? 'level-over' : 'over',
      marks: [...state.marks, mark],
      moves: [...state.moves, move],
    };
  }

  return {
    places,

    start(seed: number): ClockState {
      const rng = createRng(seed);
      const level = makeLevel(rng, 1, []);
      return {
        seed,
        rngState: rng.state,
        level,
        lives: CLOCK_START_LIVES,
        score: 0,
        status: 'playing',
        bonusLife: false,
        marks: [],
        past: [level.place],
        moves: [],
      };
    },

    /** A time of day, in minutes after midnight. */
    guess(state: ClockState, minutes: number): { state: ClockState; result: ClockGuessResult } {
      const { level } = state;
      if (state.status !== 'playing' || !Number.isInteger(minutes) || minutes < 0 || minutes >= DAY) return { state, result: 'invalid' };
      if (level.guesses.includes(minutes)) return { state, result: 'repeat' };
      const guesses = [...level.guesses, minutes];
      const move = formatClock(minutes);
      if (minutes === level.answer) {
        const missed = guesses.length - 1;
        const flawless = missed === 0;
        const base = CLOCK_POINTS_PER_LEVEL * level.number;
        const points = Math.round(base * MISS_SHARE[missed]! + (flawless ? base * CLOCK_FLAWLESS_SHARE : 0));
        const lives = flawless ? Math.min(CLOCK_MAX_LIVES, state.lives + 1) : state.lives;
        const mark = flawless ? 'flawless' : missed === 1 ? 'cleared' : 'missed';
        return { result: 'right', state: endLevel(state, { ...level, guesses, status: 'cleared', points, flawless }, lives, mark, move) };
      }
      // The shorter way round the clock: 23:00 is "earlier" than a guess of 01:00.
      const diff = ((((level.answer - minutes) % DAY) + DAY + DAY / 2) % DAY) - DAY / 2;
      const result = diff < 0 ? 'earlier' : 'later';
      if (guesses.length >= clockPlan(level.number).misses) {
        return { result, state: endLevel(state, { ...level, guesses, status: 'lost' }, state.lives - 1, 'lost', move) };
      }
      return { result, state: { ...state, level: { ...level, guesses }, moves: [...state.moves, move] } };
    },

    /** Gives up on the level for a life. */
    skip(state: ClockState): ClockState {
      if (state.status !== 'playing') return state;
      return endLevel(state, { ...state.level, status: 'lost' }, state.lives - 1, 'lost', SKIP);
    },

    /** Starts the next level after one ends with lives left. */
    nextLevel(state: ClockState): ClockState {
      if (state.status !== 'level-over') return state;
      const rng = createRng(state.rngState);
      const level = makeLevel(rng, state.level.number + 1, state.past);
      return { ...state, rngState: rng.state, level, status: 'playing', bonusLife: false, past: [...state.past, level.place] };
    },
  };
}

export type Clockwork = ReturnType<typeof createClockwork>;

/** Replays a move log from a seed; this is what a server uses to verify a score. */
export function replayClockwork(game: Clockwork, seed: number, moves: readonly string[]): ClockState {
  let state = game.start(seed);
  for (const move of moves) {
    if (state.status === 'level-over') state = game.nextLevel(state);
    if (state.status === 'over') break;
    if (move === SKIP) state = game.skip(state);
    else {
      const minutes = /^\d\d:\d\d$/.test(move) ? parseClock(move) : null;
      if (minutes === null) continue;
      state = game.guess(state, minutes).state;
    }
  }
  return state;
}
