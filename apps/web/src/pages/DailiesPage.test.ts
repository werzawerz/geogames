import { describe, expect, it } from 'vitest';
import { untilNext } from './DailiesPage.tsx';

describe('untilNext', () => {
  it('counts down to midnight UTC', () => {
    expect(untilNext(new Date('2026-11-16T18:47:00Z'))).toBe('5h 13m');
    expect(untilNext(new Date('2026-11-16T23:59:30Z'))).toBe('1m');
    expect(untilNext(new Date('2026-11-16T00:00:00Z'))).toBe('24h 0m');
  });
});
