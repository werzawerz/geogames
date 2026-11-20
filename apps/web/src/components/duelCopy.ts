import { ROUTE_MODES, describeSettings, usesRegion, usesRouteMode, type GameDefinition, type GameSettings } from '@geogames/games';

/** The settings a duel is played with, in a line, for games with any besides City Circle Arcade's data (it has its own line). */
export function settingsNote(game: GameDefinition, settings: GameSettings): string | null {
  if (usesRegion(game)) return `Settings: ${describeSettings(settings, game)}`;
  if (usesRouteMode(game)) return `Difficulty: ${ROUTE_MODES.find((m) => m.id === settings.routeMode)!.label}`;
  return null;
}
