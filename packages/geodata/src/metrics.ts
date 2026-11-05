import type { MetricId } from './types.ts';

export interface MetricDefinition {
  id: MetricId;
  label: string;
  unit: string;
  /** Phrases for comparison games: "Does B have more/fewer ___ than A?" */
  more: string;
  less: string;
  format: (value: number) => string;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

const usd = (v: number) => `$${compact.format(v)}`;

export const METRICS: Record<MetricId, MetricDefinition> = {
  population: {
    id: 'population',
    label: 'Population',
    unit: 'people',
    more: 'More people',
    less: 'Fewer people',
    format: (v) => full.format(v),
  },
  area: {
    id: 'area',
    label: 'Area',
    unit: 'km²',
    more: 'Larger',
    less: 'Smaller',
    // Tiny states (Vatican City is 0.44 km²) need decimals.
    format: (v) => `${(v < 10 ? oneDecimal : full).format(v)} km²`,
  },
  populationDensity: {
    id: 'populationDensity',
    label: 'Population density',
    unit: 'people/km²',
    more: 'Denser',
    less: 'Sparser',
    format: (v) => `${oneDecimal.format(v)} /km²`,
  },
  gdp: {
    id: 'gdp',
    label: 'GDP',
    unit: 'USD',
    more: 'Higher GDP',
    less: 'Lower GDP',
    format: usd,
  },
  gdpPerCapita: {
    id: 'gdpPerCapita',
    label: 'GDP per capita',
    unit: 'USD',
    more: 'Richer',
    less: 'Poorer',
    format: (v) => `$${full.format(v)}`,
  },
  lifeExpectancy: {
    id: 'lifeExpectancy',
    label: 'Life expectancy',
    unit: 'years',
    more: 'Longer',
    less: 'Shorter',
    format: (v) => `${oneDecimal.format(v)} years`,
  },
};
