import { describe, expect, it } from 'vitest';
import { countries, dataset, getCountry, queryCountries } from './index.ts';
import { validateDataset } from './validate.ts';

describe('dataset', () => {
  it('passes integrity validation', () => {
    expect(validateDataset(dataset).errors).toEqual([]);
  });

  it('covers every UN member state', () => {
    expect(countries.filter((c) => c.sovereignty === 'un-member')).toHaveLength(193);
  });

  it('normalizes Kosovo to XKX, including borders', () => {
    expect(getCountry('XKX')?.name).toBe('Kosovo');
    expect(getCountry('SRB')?.borders).toContain('XKX');
  });

  it('gives every default-pool country a population', () => {
    const pool = queryCountries();
    expect(pool.length).toBe(197);
    expect(pool.every((c) => (c.metrics.population?.value ?? 0) > 0)).toBe(true);
  });
});
