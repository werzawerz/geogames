import { describe, expect, it } from 'vitest';
import type { CountryShape } from '@geogames/geodata/shapes';
import { nearestOutlinePoint, wrongGuessHint } from './hint.ts';

/** A square country from 0° to 10° in both directions. */
const square: CountryShape = {
  type: 'Feature',
  properties: { id: 'SQR' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
};

describe('wrongGuessHint', () => {
  it('measures to the nearest edge of the country, not its middle', () => {
    const { km, at } = nearestOutlinePoint(square, [5, 20]);
    expect(at[1]).toBe(10);
    // The nearest vertex is (10°E, 10°N) or (10°E, 0°N); either is far closer than the middle at 5°E.
    expect(km).toBeLessThan(1400);
  });

  it('says which way and how far', () => {
    const hint = wrongGuessHint({ name: 'Squareland', shape: square, centre: [5, 5], spot: [5, 30], neighbour: false });
    expect(hint).toMatch(/^Squareland: the spot is about [\d,]+ km to the (east|north-east|south-east)\.$/);
  });

  it('tells a neighbour apart: just across the border when close', () => {
    const near = wrongGuessHint({ name: 'Squareland', shape: square, centre: [5, 5], spot: [5, 11], neighbour: true });
    expect(near).toBe('Squareland: close! The spot is just across the border, to the east.');
    const far = wrongGuessHint({ name: 'Squareland', shape: square, centre: [5, 5], spot: [5, 40], neighbour: true });
    expect(far).toMatch(/^Squareland is a neighbour: the spot is about [\d,]+ km to the east\.$/);
  });

  it('falls back to the middle when the country has no outline', () => {
    const hint = wrongGuessHint({ name: 'Tinyland', shape: undefined, centre: [0, 0], spot: [10, 0], neighbour: false });
    expect(hint).toBe('Tinyland: the spot is about 1,100 km to the north.');
  });
});
