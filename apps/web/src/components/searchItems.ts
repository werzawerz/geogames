import { getCountry, type Country, type CountryId } from '@geogames/geodata';
import type { CircleCity } from '@geogames/games';
import type { SearchItem } from './search.ts';

/** Everyday names the source data doesn't list. */
const NICKNAMES: Record<CountryId, readonly string[]> = {
  USA: ['America', 'United States', 'U.S.', 'U.S.A.'],
  GBR: ['Britain', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  NLD: ['Holland'],
  CZE: ['Czech Republic'],
  MMR: ['Burma'],
  CIV: ["Côte d'Ivoire", 'Ivory Coast'],
  ARE: ['UAE', 'Emirates'],
  COD: ['DRC', 'Congo-Kinshasa'],
  COG: ['Congo-Brazzaville'],
  KOR: ['Korea'],
  TUR: ['Türkiye'],
  SWZ: ['Swaziland'],
  MKD: ['Macedonia'],
  CPV: ['Cape Verde'],
  TLS: ['East Timor'],
};

/** Every way a player might write a country: names, ISO codes, "US"/"UK"-style short forms, nicknames. */
function countryNames(country: Country): string[] {
  return [country.name, country.officialName, country.id, country.iso2, ...country.aliases, ...(NICKNAMES[country.id] ?? [])];
}

/** Search entries for cities: country names narrow the list ("San Jose USA"), bigger cities first. */
export function cityItems(cities: Iterable<CircleCity>): SearchItem[] {
  const scopes = new Map<CountryId, string[]>();
  return [...cities].map((c) => {
    const country = getCountry(c.countryId);
    let scope = scopes.get(c.countryId);
    if (!scope && country) scopes.set(c.countryId, (scope = countryNames(country)));
    return {
      id: c.id,
      label: c.name,
      detail: country?.name,
      iso2: country?.iso2,
      aliases: c.aliases,
      scope,
      weight: c.population,
    };
  });
}

/** Search entries for countries, including their names in other languages (Deutschland, Magyarország). */
export function countryItems(ids: Iterable<CountryId>): SearchItem[] {
  return [...ids].flatMap((id) => {
    const c = getCountry(id);
    if (!c) return [];
    const aliases = [...new Set([...countryNames(c), ...Object.values(c.translations)])].filter((a) => a !== c.name);
    return [{ id, label: c.name, iso2: c.iso2, aliases, weight: c.metrics.population?.value ?? 0 }];
  });
}
