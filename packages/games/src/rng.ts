/**
 * Seedable PRNG (mulberry32). Its whole state is one 32-bit integer, so game
 * states can carry it and stay pure, replayable and verifiable server-side.
 */
export interface Rng {
  next(): number;
  readonly state: number;
}

export function createRng(state: number): Rng {
  let a = state >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return a;
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[Math.floor(rng.next() * items.length)]!;
}
