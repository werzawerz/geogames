import { useEffect, useMemo, useState } from 'react';
import { getCountry } from '@geogames/geodata';
import { createChoiceQuiz, quizItems, replayChoiceQuiz, type QuizDefinition } from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import type { GameScreenProps } from '../types.ts';

const REVEAL_MS = 1200;

/** Multiple-choice quiz (capitals, flags): four options, a point per right answer, lives for wrong ones. */
export function QuizScreen({ game, settings, seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<QuizDefinition>) {
  const quiz = useMemo(
    () => createChoiceQuiz({ items: quizItems(game, settings), lives: game.lives }),
    [game, settings],
  );
  // A run left part-way (a duel, after a reload) picks up where it was.
  const [state, setState] = useState(() => replayChoiceQuiz(quiz, seed, (initialMoves ?? []).map(Number)));
  useEffect(() => onMovesChange?.(state.moves.map(String)), [state.moves, onMovesChange]);
  const { question, picked } = state;
  const country = getCountry(question.itemId)!;

  useEffect(() => {
    if (state.status === 'answering') return;
    const timer = setTimeout(() => {
      if (state.status === 'revealed') setState(quiz.next(state));
      else onGameOver({ score: state.score, moves: state.moves.map(String) });
    }, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [state, quiz, onGameOver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) setState((s) => quiz.answer(s, n - 1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [quiz]);

  const toneOf = (i: number) => {
    if (picked === null) return '';
    if (i === question.correctIndex) return 'correct';
    return i === picked ? 'wrong' : 'dim';
  };

  return (
    <div className="quiz">
      <div className="quiz-status">
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
        <span className="lives" aria-label={`${state.lives} of ${quiz.lives} lives left`}>
          {Array.from({ length: quiz.lives }, (_, i) => (
            <span key={i} className={i < state.lives ? 'life' : 'life lost'} aria-hidden="true">
              ♥
            </span>
          ))}
        </span>
      </div>

      <section className="quiz-prompt" key={question.itemId}>
        {game.quiz === 'flag' ? (
          <>
            <Flag iso2={country.iso2} className="quiz-flag-big" />
            <h2>Which country’s flag is this?</h2>
          </>
        ) : (
          <>
            <Flag iso2={country.iso2} className="quiz-flag" />
            <h2>
              What is the capital of <span className="quiz-subject">{country.name}</span>?
            </h2>
          </>
        )}
      </section>

      <div className="quiz-options">
        {question.options.map((option, i) => (
          <button
            key={option}
            className={`btn quiz-option ${toneOf(i)}`}
            onClick={() => setState(quiz.answer(state, i))}
            disabled={picked !== null}
          >
            <span className="quiz-key" aria-hidden="true">
              {i + 1}
            </span>
            {option}
          </button>
        ))}
      </div>

      <p className="quiz-feedback" role="status">
        {picked === null
          ? 'Tip: press 1–4 to answer.'
          : picked === question.correctIndex
            ? 'Correct!'
            : `It’s ${question.options[question.correctIndex]}.`}
      </p>
    </div>
  );
}
