import { createRng, pick, type Rng } from './rng.ts';

/** One question's subject, e.g. a country with its capital as the answer. */
export interface QuizItem {
  id: string;
  /** The answer shown as an option. */
  answer: string;
  /** Every label that counts as correct (e.g. all of South Africa's capitals); never used as a wrong option. */
  accepted: readonly string[];
  /** Similarity groups, closest first (subregion, continent). Wrong options come from the closest group that has enough. */
  groups: readonly string[];
}

export interface QuizQuestion {
  itemId: string;
  options: readonly string[];
  correctIndex: number;
}

export interface QuizState {
  readonly seed: number;
  readonly rngState: number;
  readonly question: QuizQuestion;
  readonly score: number;
  readonly lives: number;
  readonly status: 'answering' | 'revealed' | 'over';
  /** The option picked for the current question, once answered. */
  readonly picked: number | null;
  readonly recent: readonly string[];
  /** Chosen option indexes in order; with the seed this replays the game. */
  readonly moves: readonly number[];
}

export interface ChoiceQuizOptions {
  items: readonly QuizItem[];
  lives: number;
  optionCount?: number;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Endless multiple-choice quiz: a point per correct answer, a life lost per
 * wrong one. Items don't repeat until most of the pool has been asked.
 */
export function createChoiceQuiz({ items, lives, optionCount = 4 }: ChoiceQuizOptions) {
  if (items.length < optionCount) throw new Error(`quiz needs at least ${optionCount} items`);
  const byId = new Map(items.map((i) => [i.id, i]));
  const window = Math.min(50, items.length - 1);

  function wrongOptions(rng: Rng, item: QuizItem): string[] {
    const isWrong = (other: QuizItem) => other.id !== item.id && !item.accepted.includes(other.answer);
    const chosen: string[] = [];
    // Closest group first, then wider ones, then anything.
    const tiers = [...item.groups.map((g) => items.filter((o) => o.groups.includes(g))), items];
    for (const tier of tiers) {
      const candidates = shuffle(rng, tier.filter(isWrong).map((o) => o.answer)).filter((a) => !chosen.includes(a));
      chosen.push(...candidates.slice(0, optionCount - 1 - chosen.length));
      if (chosen.length === optionCount - 1) break;
    }
    return chosen;
  }

  function ask(rng: Rng, recent: readonly string[]): QuizQuestion {
    const fresh = items.filter((i) => !recent.includes(i.id));
    const item = pick(rng, fresh.length > 0 ? fresh : items);
    const options = shuffle(rng, [item.answer, ...wrongOptions(rng, item)]);
    return { itemId: item.id, options, correctIndex: options.indexOf(item.answer) };
  }

  return {
    items: byId,
    lives,

    start(seed: number): QuizState {
      const rng = createRng(seed);
      const question = ask(rng, []);
      return {
        seed,
        rngState: rng.state,
        question,
        score: 0,
        lives,
        status: 'answering',
        picked: null,
        recent: [question.itemId],
        moves: [],
      };
    },

    answer(state: QuizState, index: number): QuizState {
      if (state.status !== 'answering' || index < 0 || index >= state.question.options.length) return state;
      const correct = index === state.question.correctIndex;
      const livesLeft = correct ? state.lives : state.lives - 1;
      return {
        ...state,
        score: correct ? state.score + 1 : state.score,
        lives: livesLeft,
        picked: index,
        status: livesLeft <= 0 ? 'over' : 'revealed',
        moves: [...state.moves, index],
      };
    },

    next(state: QuizState): QuizState {
      if (state.status !== 'revealed') return state;
      const rng = createRng(state.rngState);
      const question = ask(rng, state.recent);
      return {
        ...state,
        rngState: rng.state,
        question,
        status: 'answering',
        picked: null,
        recent: [...state.recent, question.itemId].slice(-window),
      };
    },
  };
}

export type ChoiceQuiz = ReturnType<typeof createChoiceQuiz>;

/** Replays answers from a seed; this is what a server uses to verify a score. */
export function replayChoiceQuiz(quiz: ChoiceQuiz, seed: number, moves: readonly number[], observe?: (state: QuizState, move: number) => void): QuizState {
  let state = quiz.start(seed);
  for (const index of moves) {
    if (state.status === 'over') break;
    state = quiz.next(quiz.answer(state, index));
    observe?.(state, index);
  }
  return state;
}
