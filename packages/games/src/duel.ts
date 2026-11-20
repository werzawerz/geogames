import { DUEL_GAMES } from './api-contract.ts';
import { getGame, type GameDefinition } from './catalog.ts';
import type { GameSettings } from './settings.ts';

/**
 * What both players of a duel get the same of, for "same circles, one try":
 * the thing a level of the game is about, in the plural.
 */
const DUEL_THINGS: Readonly<Record<string, string>> = {
  'city-circle-arcade': 'circles',
  'city-circle': 'circles',
  'border-route': 'routes',
  'pin-drop': 'cities',
  halfway: 'city pairs',
  'great-circle': 'lines',
  'border-blitz': 'countries',
  'mystery-country': 'mystery countries',
  'river-run': 'rivers',
  'blank-atlas': 'places',
  'on-the-grid': 'coordinates',
  clockwork: 'clocks',
  'native-tongue': 'names',
  'supply-chain': 'commodities',
  'higher-lower-population': 'countries',
  'higher-lower-area': 'countries',
  'higher-lower-gdp-per-capita': 'countries',
  'higher-lower-city-population': 'cities',
  flags: 'flags',
  capitals: 'questions',
};

export const duelThings = (game: GameDefinition): string => DUEL_THINGS[game.id] ?? 'levels';

/** Games whose runs are a streak of questions, not levels: a duel compares their scores only. */
export const duelHasLevels = (game: GameDefinition): boolean => game.kind !== 'higher-lower' && game.kind !== 'quiz';

/**
 * Whether a run of this game with these settings can become a duel. City Circle's
 * own circles can't: each player places theirs, so they wouldn't play the same ones.
 */
export function canDuel(game: GameDefinition, settings: Pick<GameSettings, 'circlePlacement'>): boolean {
  if (!DUEL_GAMES.includes(game.id) || game.status !== 'live') return false;
  return !(game.kind === 'circle' && settings.circlePlacement === 'custom');
}

/** The settings a new duel of this game is played with: the player's own, where the duel allows them. */
export function duelSettings(settings: GameSettings): GameSettings {
  return settings.circlePlacement === 'custom' ? { ...settings, circlePlacement: 'random' } : settings;
}

/** The games a duel can be played on, the default first. */
export const duelGames = (): GameDefinition[] => DUEL_GAMES.map((id) => getGame(id)!).filter((g) => g?.status === 'live');
