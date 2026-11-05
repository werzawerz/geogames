import { load, save } from './storage.ts';

/** Anonymous local identity; becomes an account id once auth exists. */
export interface Player {
  id: string;
  name: string;
}

export function loadPlayer(): Player {
  const existing = load<Player | null>('player', null);
  if (existing) return existing;
  const player = { id: crypto.randomUUID(), name: `Explorer ${Math.floor(1000 + Math.random() * 9000)}` };
  save('player', player);
  return player;
}

export function savePlayer(player: Player): void {
  save('player', player);
}
