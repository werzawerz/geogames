import { describe, expect, it } from 'vitest';
import { geoDistance } from 'd3-geo';
import { createBorderBlitz, routeCountries } from '@geogames/games';
import { loadWorldShapes } from '@geogames/geodata/shapes';
import { frameFor } from './frame.ts';

const DEGREES = 180 / Math.PI;

describe('border blitz map frame', async () => {
  const shapes = await loadWorldShapes();
  const game = createBorderBlitz({ countries: routeCountries(), rounds: 20 });

  /** How far inside the frame the neighbour's nearest point is, in degrees (negative: out of view). */
  const frames = new Map(game.askable.map((id) => [id, frameFor(shapes, id, game.neighboursOf(id))]));
  const inside = (target: string, neighbour: string) => {
    const { centre, radius } = frames.get(target)!;
    const shape = shapes.countries.get(neighbour)!;
    const polygons = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates;
    const nearest = Math.min(...polygons.flatMap((p) => p[0]!.map((v) => geoDistance(centre, v as [number, number]) * DEGREES)));
    return radius - nearest;
  };

  it('shows Papua New Guinea and Timor-Leste on Indonesia’s map', () => {
    expect(inside('IDN', 'PNG')).toBeGreaterThan(1);
    expect(inside('IDN', 'TLS')).toBeGreaterThan(1);
  });

  it('keeps every neighbour of every country in view, with room to spare', () => {
    const out: string[] = [];
    for (const target of game.askable) {
      for (const n of game.neighboursOf(target)) if (inside(target, n) < 1) out.push(`${target}→${n}`);
    }
    expect(out).toEqual([]);
  });

  it('leaves small countries a small frame', () => {
    expect(frameFor(shapes, 'BEL', game.neighboursOf('BEL')).radius).toBeLessThan(10);
    expect(frameFor(shapes, 'SVK', game.neighboursOf('SVK')).radius).toBeLessThan(15);
  });
});
