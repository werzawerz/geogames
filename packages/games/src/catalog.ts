import type { MetricId } from '@geogames/geodata';

export type GameKind = GameDefinition['kind'];

/** What the game's items are; decides which pool is loaded and how cards are drawn. */
export type Subject = 'country' | 'city';

interface BaseDefinition {
  id: string;
  subject: Subject;
  title: string;
  tagline: string;
  /** `coming-soon` games are listed as teasers but can't be started. */
  status: 'live' | 'coming-soon';
}

export interface HigherLowerDefinition extends BaseDefinition {
  kind: 'higher-lower';
  metric: MetricId;
  /** Shown under values so players know what is measured. */
  valueNote?: string;
}

export interface RouteDefinition extends BaseDefinition {
  kind: 'route';
  subject: 'country';
  /** Levels in a run; failing one ends it sooner. */
  rounds: number;
}

export interface QuizDefinition extends BaseDefinition {
  kind: 'quiz';
  subject: 'country';
  /** What is asked: a country's capital, or which country a flag belongs to. */
  quiz: 'capital' | 'flag';
  lives: number;
}

export interface CircleDefinition extends BaseDefinition {
  kind: 'circle';
  subject: 'city';
  /** Circles per game. */
  rounds: number;
  /** How many of the most populous cities to find per circle. */
  target: number;
  /** Wrong guesses allowed per circle. */
  misses: number;
}

export interface CircleArcadeDefinition extends BaseDefinition {
  kind: 'circle-arcade';
  subject: 'city';
}

export interface PinDropDefinition extends BaseDefinition {
  kind: 'pin-drop';
  subject: 'city';
}

export interface HalfwayDefinition extends BaseDefinition {
  kind: 'halfway';
  subject: 'city';
}

export interface GreatCircleDefinition extends BaseDefinition {
  kind: 'great-circle';
  subject: 'country';
  /** Levels in a run. */
  rounds: number;
}

export interface BorderBlitzDefinition extends BaseDefinition {
  kind: 'border-blitz';
  subject: 'country';
  /** Levels in a run. */
  rounds: number;
}

export interface ClockworkDefinition extends BaseDefinition {
  kind: 'clockwork';
  subject: 'country';
}

export interface MysteryCountryDefinition extends BaseDefinition {
  kind: 'mystery-country';
  subject: 'country';
  /** Levels in a run. */
  rounds: number;
}

/** Static description of a game mode; the web app maps `kind` to a UI component. */
export type GameDefinition =
  | HigherLowerDefinition
  | RouteDefinition
  | QuizDefinition
  | CircleDefinition
  | CircleArcadeDefinition
  | PinDropDefinition
  | HalfwayDefinition
  | GreatCircleDefinition
  | MysteryCountryDefinition
  | BorderBlitzDefinition
  | ClockworkDefinition;

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'higher-lower-population',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Population',
    tagline: 'Does the next country have more or fewer people?',
    status: 'live',
    metric: 'population',
  },
  {
    id: 'higher-lower-area',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Area',
    tagline: 'Is the next country bigger or smaller?',
    status: 'live',
    metric: 'area',
  },
  {
    id: 'higher-lower-gdp-per-capita',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Wealth',
    tagline: 'Is the next country richer or poorer per person?',
    status: 'live',
    metric: 'gdpPerCapita',
  },
  {
    id: 'higher-lower-city-population',
    kind: 'higher-lower',
    subject: 'city',
    title: 'Higher or Lower: Cities',
    tagline: 'Do more people live in the next city?',
    status: 'live',
    metric: 'population',
    valueNote: 'Metro area · UN estimate for 2025',
  },
  {
    id: 'border-route',
    kind: 'route',
    subject: 'country',
    title: 'Border Route',
    tagline: 'Connect two countries through as few neighbours as possible. How far can you get?',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'capitals',
    kind: 'quiz',
    subject: 'country',
    quiz: 'capital',
    title: 'Capitals',
    tagline: 'Name the capital, from Paris to Paramaribo.',
    status: 'live',
    lives: 3,
  },
  {
    id: 'flags',
    kind: 'quiz',
    subject: 'country',
    quiz: 'flag',
    title: 'Flags',
    tagline: 'Whose flag is it?',
    status: 'live',
    lives: 3,
  },
  {
    id: 'city-circle-arcade',
    kind: 'circle-arcade',
    subject: 'city',
    title: 'City Circle Arcade',
    tagline: 'Endless circles, getting smaller and harder. How far can you get?',
    status: 'live',
  },
  {
    id: 'border-blitz',
    kind: 'border-blitz',
    subject: 'country',
    title: 'Border Blitz',
    tagline: 'A country lights up on a map without borders. Name all its neighbours before the clock runs out.',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'mystery-country',
    kind: 'mystery-country',
    subject: 'country',
    title: 'Mystery Country',
    tagline: 'Every wrong guess gives a clue: how far, which way, how big. Work out the country.',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'great-circle',
    kind: 'great-circle',
    subject: 'country',
    title: 'Great Circle',
    tagline: 'A straight line runs between two cities. Which countries does it cross?',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'clockwork',
    kind: 'clockwork',
    subject: 'country',
    title: 'Clockwork',
    tagline: 'It’s 12:00 UTC. A country lights up. What time is it there?',
    status: 'live',
  },
  {
    id: 'pin-drop',
    kind: 'pin-drop',
    subject: 'city',
    title: 'Pin Drop',
    tagline: 'Click where the city is. Every kilometre off eats into your budget.',
    status: 'live',
  },
  {
    id: 'halfway',
    kind: 'halfway',
    subject: 'city',
    title: 'Halfway',
    tagline: 'Name a city halfway between two others. Paris and Berlin? Try Frankfurt.',
    status: 'live',
  },
  {
    id: 'city-circle',
    kind: 'circle',
    subject: 'city',
    title: 'City Circle: Free Play',
    tagline: 'Pick your region, radius or own circles, and name the five biggest cities.',
    status: 'live',
    rounds: 3,
    target: 5,
    misses: 5,
  },
];

export function getGame(id: string): GameDefinition | undefined {
  return GAMES.find((g) => g.id === id);
}
