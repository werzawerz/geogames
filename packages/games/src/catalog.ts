import type { MetricId } from '@geogames/geodata';

export type GameKind = GameDefinition['kind'];

/** What the game's items are; decides which pool is loaded and how cards are drawn. */
export type Subject = 'country' | 'city' | 'feature';

/** Sections of the home page and the Games menu, in display order. */
export const GROUPS = [
  { id: 'map', title: 'Map games' },
  { id: 'routes', title: 'Routes & borders' },
  { id: 'cities', title: 'Cities' },
  { id: 'quizzes', title: 'Quick quizzes' },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];

interface BaseDefinition {
  id: string;
  /** Which home page section the game is listed in. Every new game declares one. */
  group: GroupId;
  subject: Subject;
  title: string;
  tagline: string;
  /** `coming-soon` games are listed as teasers but can't be started. */
  status: 'live' | 'coming-soon';
}

export interface HigherLowerDefinition extends BaseDefinition {
  kind: 'higher-lower';
  subject: 'country' | 'city';
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

export interface BlankAtlasDefinition extends BaseDefinition {
  kind: 'blank-atlas';
  /** Physical features: seas, ranges, deserts, lakes, islands. */
  subject: 'feature';
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

export interface RiverRunDefinition extends BaseDefinition {
  kind: 'river-run';
  subject: 'country';
}

export interface OnTheGridDefinition extends BaseDefinition {
  kind: 'on-the-grid';
  subject: 'country';
}

export interface NativeTongueDefinition extends BaseDefinition {
  kind: 'native-tongue';
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
  | ClockworkDefinition
  | BlankAtlasDefinition
  | RiverRunDefinition
  | OnTheGridDefinition
  | NativeTongueDefinition;

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'pin-drop',
    group: 'map',
    kind: 'pin-drop',
    subject: 'city',
    title: 'Pin Drop',
    tagline: 'Click where the city is. Every kilometre off eats into your budget.',
    status: 'live',
  },
  {
    id: 'blank-atlas',
    group: 'map',
    kind: 'blank-atlas',
    subject: 'feature',
    title: 'Blank Atlas',
    tagline: 'A sea, a mountain range or a desert lights up on a map with no labels. Name it.',
    status: 'live',
  },
  {
    id: 'river-run',
    group: 'map',
    kind: 'river-run',
    subject: 'country',
    title: 'River Run',
    tagline: 'A river draws itself from its source to the sea. Name it before it gets there.',
    status: 'live',
  },
  {
    id: 'on-the-grid',
    group: 'map',
    kind: 'on-the-grid',
    subject: 'country',
    title: 'On the Grid',
    tagline: '23°S, 47°W: which country is there? Only a blind map to go on.',
    status: 'live',
  },
  {
    id: 'border-route',
    group: 'routes',
    kind: 'route',
    subject: 'country',
    title: 'Border Route',
    tagline: 'Connect two countries through as few neighbours as possible. How far can you get?',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'border-blitz',
    group: 'routes',
    kind: 'border-blitz',
    subject: 'country',
    title: 'Border Blitz',
    tagline: 'A country lights up on a map without borders. Name all its neighbours before the clock runs out.',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'great-circle',
    group: 'routes',
    kind: 'great-circle',
    subject: 'country',
    title: 'Great Circle',
    tagline: 'A straight line runs between two cities. Which countries does it cross?',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'halfway',
    group: 'routes',
    kind: 'halfway',
    subject: 'city',
    title: 'Halfway',
    tagline: 'Name a city halfway between two others. Paris and Berlin? Try Frankfurt.',
    status: 'live',
  },
  {
    id: 'city-circle-arcade',
    group: 'cities',
    kind: 'circle-arcade',
    subject: 'city',
    title: 'City Circle Arcade',
    tagline: 'Endless circles, getting smaller and harder. How far can you get?',
    status: 'live',
  },
  {
    id: 'city-circle',
    group: 'cities',
    kind: 'circle',
    subject: 'city',
    title: 'City Circle: Free Play',
    tagline: 'Pick your region, radius or own circles, and name the five biggest cities.',
    status: 'live',
    rounds: 3,
    target: 5,
    misses: 5,
  },
  {
    id: 'higher-lower-population',
    group: 'quizzes',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Population',
    tagline: 'Does the next country have more or fewer people?',
    status: 'live',
    metric: 'population',
  },
  {
    id: 'higher-lower-area',
    group: 'quizzes',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Area',
    tagline: 'Is the next country bigger or smaller?',
    status: 'live',
    metric: 'area',
  },
  {
    id: 'higher-lower-gdp-per-capita',
    group: 'quizzes',
    kind: 'higher-lower',
    subject: 'country',
    title: 'Higher or Lower: Wealth',
    tagline: 'Is the next country richer or poorer per person?',
    status: 'live',
    metric: 'gdpPerCapita',
  },
  {
    id: 'higher-lower-city-population',
    group: 'quizzes',
    kind: 'higher-lower',
    subject: 'city',
    title: 'Higher or Lower: Cities',
    tagline: 'Do more people live in the next city?',
    status: 'live',
    metric: 'population',
    valueNote: 'Metro area · UN estimate for 2025',
  },
  {
    id: 'flags',
    group: 'quizzes',
    kind: 'quiz',
    subject: 'country',
    quiz: 'flag',
    title: 'Flags',
    tagline: 'Whose flag is it?',
    status: 'live',
    lives: 3,
  },
  {
    id: 'capitals',
    group: 'quizzes',
    kind: 'quiz',
    subject: 'country',
    quiz: 'capital',
    title: 'Capitals',
    tagline: 'Name the capital, from Paris to Paramaribo.',
    status: 'live',
    lives: 3,
  },
  {
    id: 'mystery-country',
    group: 'quizzes',
    kind: 'mystery-country',
    subject: 'country',
    title: 'Mystery Country',
    tagline: 'Every wrong guess gives a clue: how far, which way, how big. Work out the country.',
    status: 'live',
    rounds: 20,
  },
  {
    id: 'clockwork',
    group: 'quizzes',
    kind: 'clockwork',
    subject: 'country',
    title: 'Clockwork',
    tagline: 'It’s 12:00 UTC. A country lights up. What time is it there?',
    status: 'live',
  },
  {
    id: 'native-tongue',
    group: 'quizzes',
    kind: 'native-tongue',
    subject: 'country',
    title: 'Native Tongue',
    tagline: 'A country’s own name for itself is on screen: Ελλάδα, Suomi, България. Which country is it?',
    status: 'live',
  },
];

export function getGame(id: string): GameDefinition | undefined {
  return GAMES.find((g) => g.id === id);
}

/** Live games per group, in group order. Groups with no live game are left out. */
export function gamesByGroup(): { id: GroupId; title: string; games: GameDefinition[] }[] {
  return GROUPS.map((g) => ({ ...g, games: GAMES.filter((x) => x.group === g.id && x.status === 'live') })).filter((g) => g.games.length > 0);
}
