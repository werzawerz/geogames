import { describe, expect, it } from 'vitest';
import { queryCountries } from '@geogames/geodata';
import { createHigherLowerGame, replayHigherLower, type Comparable, type Guess, type HigherLowerState } from './higher-lower.ts';

const pool = queryCountries({ requireMetrics: ['population'] });
const game = createHigherLowerGame({ metric: 'population', pool });
const pop = (c: Comparable) => c.metrics.population!.value;
const rightGuess = (s: HigherLowerState): Guess => (pop(s.challenger) >= pop(s.current) ? 'higher' : 'lower');
const wrongGuess = (s: HigherLowerState): Guess => (rightGuess(s) === 'higher' ? 'lower' : 'higher');

describe('higher-lower', () => {
  it('is deterministic for a seed', () => {
    const a = game.start(42);
    const b = game.start(42);
    expect([a.current.id, a.challenger.id]).toEqual([b.current.id, b.challenger.id]);
  });

  it('scores a correct guess and moves the challenger into place', () => {
    const s0 = game.start(1);
    const s1 = game.guess(s0, rightGuess(s0));
    expect(s1.status).toBe('revealed');
    expect(s1.score).toBe(1);
    const s2 = game.next(s1);
    expect(s2.current.id).toBe(s0.challenger.id);
    expect(s2.challenger.id).not.toBe(s2.current.id);
    expect(s2.status).toBe('guessing');
  });

  it('ends the game on a wrong guess', () => {
    const s0 = game.start(7);
    const s1 = game.guess(s0, wrongGuess(s0));
    expect(s1.status).toBe('over');
    expect(s1.score).toBe(0);
    expect(game.next(s1)).toBe(s1);
  });

  it('keeps challengers apart from the current value', () => {
    let s = game.start(123);
    for (let i = 0; i < 25; i++) {
      const ratio = pop(s.challenger) / pop(s.current);
      expect(ratio >= 1.1 || ratio <= 1 / 1.1).toBe(true);
      s = game.next(game.guess(s, rightGuess(s)));
    }
  });

  it('never repeats an item and ends, completed, when the pool is used up', () => {
    const small = createHigherLowerGame({ metric: 'population', pool: pool.filter((c) => c.continent === 'South America') });
    let s = small.start(5);
    const seen = [s.current.id];
    while (s.status !== 'over') {
      seen.push(s.challenger.id);
      s = small.next(small.guess(s, rightGuess(s)));
    }
    expect(s.completed).toBe(true);
    expect(s.score).toBe(small.pool.length - 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(small.pool.length);
  });

  it('a wrong answer ends the game without completing it', () => {
    const s = game.guess(game.start(8), wrongGuess(game.start(8)));
    expect(s.status).toBe('over');
    expect(s.completed).toBe(false);
  });

  it('replays a guess log to the same score', () => {
    let s = game.start(99);
    for (let i = 0; i < 10; i++) s = game.next(game.guess(s, rightGuess(s)));
    s = game.guess(s, wrongGuess(s));
    const replayed = replayHigherLower(game, 99, s.guesses);
    expect(replayed.score).toBe(10);
    expect(replayed.status).toBe('over');
  });
});
