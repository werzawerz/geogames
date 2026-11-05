import type { CityDataset, Dataset } from './types.ts';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Integrity checks run at build time and in tests. Errors block the build. */
export function validateDataset(dataset: Dataset): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const iso2 = new Set<string>();

  for (const c of dataset.countries) {
    if (!/^[A-Z]{3}$/.test(c.id)) errors.push(`${c.id}: id is not an alpha-3 code`);
    if (ids.has(c.id)) errors.push(`${c.id}: duplicate id`);
    if (iso2.has(c.iso2)) errors.push(`${c.id}: duplicate iso2 ${c.iso2}`);
    ids.add(c.id);
    iso2.add(c.iso2);

    if (!c.name.trim()) errors.push(`${c.id}: empty name`);
    const [lat, lng] = c.latlng;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push(`${c.id}: latlng out of range`);

    for (const [metric, v] of Object.entries(c.metrics)) {
      if (!Number.isFinite(v.value) || v.value < 0) errors.push(`${c.id}: invalid ${metric} ${v.value}`);
      if (v.source === 'manual' && !v.note) errors.push(`${c.id}: manual ${metric} without citation`);
    }

    if (c.sovereignty !== 'territory') {
      if (!c.metrics.population) errors.push(`${c.id}: sovereign country without population`);
      if (!c.metrics.area) errors.push(`${c.id}: sovereign country without area`);
      if (c.capitals.length === 0) warnings.push(`${c.id}: sovereign country without capital`);
    }
  }

  const byId = new Map(dataset.countries.map((c) => [c.id, c]));
  for (const c of dataset.countries) {
    for (const b of c.borders) {
      const other = byId.get(b);
      if (!other) errors.push(`${c.id}: border references unknown id ${b}`);
      else if (!other.borders.includes(c.id)) warnings.push(`${c.id}: border with ${b} is not symmetric`);
    }
  }

  return { errors, warnings };
}

/** Integrity checks for the city dataset; `countries` is the dataset the cities link into. */
export function validateCities(dataset: CityDataset, countries: Dataset): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const countryIds = new Set(countries.countries.map((c) => c.id));
  const ids = new Set<string>();
  const labels = new Map<string, string>();

  for (const c of dataset.cities) {
    if (ids.has(c.id)) errors.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (!c.name.trim()) errors.push(`${c.id}: empty name`);
    if (!countryIds.has(c.countryId)) errors.push(`${c.id}: unknown country ${c.countryId}`);
    const [lat, lng] = c.latlng;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push(`${c.id}: latlng out of range`);
    for (const [metric, v] of Object.entries(c.metrics)) {
      if (!Number.isFinite(v.value) || v.value <= 0) errors.push(`${c.id}: invalid ${metric} ${v.value}`);
    }
    if (!c.metrics.population) errors.push(`${c.id}: missing population`);

    // Two playable cities that look identical on a card would be unfair.
    if (c.quality.verified) {
      const label = `${c.name}|${c.countryId}|${c.admin1 ?? ''}`;
      const other = labels.get(label);
      if (other) warnings.push(`${c.id}: same name, country and region as ${other} (${c.name})`);
      labels.set(label, c.id);
    }
  }
  return { errors, warnings };
}
