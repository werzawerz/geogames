import { describe, expect, it } from 'vitest';
import { getCountry } from '@geogames/geodata';
import { getGame, type QuizDefinition } from './catalog.ts';
import { createChoiceQuiz, replayChoiceQuiz, type QuizState } from './choice-quiz.ts';
import { quizItems } from './pools.ts';
import { DEFAULT_SETTINGS, MIN_POOL_SIZE, REGIONS } from './settings.ts';

const capitals = getGame('capitals') as QuizDefinition;
const flags = getGame('flags') as QuizDefinition;
const quiz = createChoiceQuiz({ items: quizItems(capitals), lives: 3 });

const answerRight = (s: QuizState) => quiz.next(quiz.answer(s, s.question.correctIndex));
const answerWrong = (s: QuizState) => quiz.next(quiz.answer(s, (s.question.correctIndex + 1) % s.question.options.length));

describe('choice quiz', () => {
  it('asks four distinct options with exactly one accepted answer', () => {
    let s = quiz.start(5);
    for (let i = 0; i < 100; i++) {
      const item = quiz.items.get(s.question.itemId)!;
      expect(new Set(s.question.options).size).toBe(4);
      const accepted = s.question.options.filter((o) => item.accepted.includes(o));
      expect(accepted).toEqual([s.question.options[s.question.correctIndex]]);
      s = answerRight(s);
    }
    expect(s.score).toBe(100);
  });

  it('picks wrong options from the same continent on medium', () => {
    const s = quiz.start(1);
    const country = getCountry(s.question.itemId)!;
    const sameContinent = quizItems(capitals).filter((i) => getCountry(i.id)!.continent === country.continent).map((i) => i.answer);
    expect(s.question.options.every((o) => sameContinent.includes(o))).toBe(true);
  });

  it('ends after the last life and replays to the same score', () => {
    let s = quiz.start(9);
    s = answerRight(s);
    s = answerWrong(s);
    s = answerRight(s);
    s = answerWrong(s);
    s = answerWrong(s);
    expect(s.status).toBe('over');
    expect(s.score).toBe(2);
    expect(s.lives).toBe(0);
    expect(replayChoiceQuiz(quiz, 9, s.moves).score).toBe(2);
  });

  it('accepts any of several capitals but never offers another as a wrong option', () => {
    const zaf = quizItems(capitals).find((i) => i.id === 'ZAF')!;
    expect(zaf.accepted).toEqual(['Pretoria', 'Bloemfontein', 'Cape Town']);
    expect(quizItems(capitals).find((i) => i.id === 'KAZ')!.answer).toBe('Astana');
  });

  it('builds a flags quiz from country names', () => {
    const items = quizItems(flags, { ...DEFAULT_SETTINGS, region: 'Europe' });
    expect(items.find((i) => i.id === 'HUN')!.answer).toBe('Hungary');
    expect(items.every((i) => getCountry(i.id)!.continent === 'Europe')).toBe(true);
  });

  it('hard draws wrong options from the same subregion', () => {
    const hard = createChoiceQuiz({ items: quizItems(capitals, { ...DEFAULT_SETTINGS, difficulty: 'hard' }), lives: 3 });
    let s = hard.start(4);
    let sameSubregion = 0;
    for (let i = 0; i < 50; i++) {
      const sub = getCountry(s.question.itemId)!.subregion;
      const subAnswers = quizItems(capitals).filter((it) => getCountry(it.id)!.subregion === sub).map((it) => it.answer);
      if (s.question.options.filter((o) => subAnswers.includes(o)).length === 4) sameSubregion++;
      s = hard.next(hard.answer(s, s.question.correctIndex));
    }
    // Small subregions top up from the continent, so most (not all) questions are fully local.
    expect(sameSubregion).toBeGreaterThan(25);
  });

  it('easy asks only well-known countries, in every region', () => {
    const easyWorld = quizItems(capitals, { ...DEFAULT_SETTINGS, difficulty: 'easy' }).map((i) => i.id);
    expect(easyWorld).toEqual(expect.arrayContaining(['USA', 'CHN', 'DEU', 'BRA', 'TWN']));
    expect(easyWorld).not.toContain('TUV');
    for (const r of REGIONS) {
      expect(quizItems(capitals, { ...DEFAULT_SETTINGS, region: r.id, difficulty: 'easy' }).length).toBeGreaterThanOrEqual(MIN_POOL_SIZE);
    }
  });
});
