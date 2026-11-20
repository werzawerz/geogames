import { SOVEREIGN, countryProminence, getCountry, queryCountries, type City, type Continent, type Country } from '@geogames/geodata';
import { cityIndex, loadCities, loadCityProper, loadSmallCities, playableCityCount } from '@geogames/geodata/cities';
import type { GameDefinition, HigherLowerDefinition, QuizDefinition } from './catalog.ts';
import type { CircleCity, CircleGameOptions } from './circle.ts';
import type { ArcadeOptions } from './circle-arcade.ts';
import type { QuizItem } from './choice-quiz.ts';
import { buildBorderGraph, routableCountries } from './route.ts';
import { DEFAULT_SETTINGS, MIN_POOL_SIZE, REGIONS, normalizeSettings, type GameSettings, type Region } from './settings.ts';

export type PoolItem = Country | City;

export function continentOf(item: PoolItem): Continent | undefined {
  return 'countryId' in item ? getCountry(item.countryId)?.continent : item.continent;
}

/**
 * The items a game draws from. Lives here, not in the UI, so a server replaying
 * a game for score verification uses exactly the same pool. City files load
 * lazily, and only the ones the settings need.
 */
export async function loadPool(
  game: HigherLowerDefinition,
  settings: GameSettings = DEFAULT_SETTINGS,
): Promise<readonly PoolItem[]> {
  const { region } = settings;
  switch (game.subject) {
    case 'country': {
      const all = queryCountries({ requireMetrics: [game.metric] });
      return region === 'world' ? all : all.filter((c) => c.continent === region);
    }
    case 'city':
      return loadCities({
        minPopulation: settings.cityMinPopulation,
        continents: region === 'world' ? undefined : [region],
      });
  }
}

/** Countries a border-route game in this region can use (borders outside the region don't count). */
export function routeCountries(settings: GameSettings = DEFAULT_SETTINGS): Country[] {
  // Territories with land borders can be passed through (Mauritania → Western
  // Sahara → Morocco); puzzles still start and end at sovereign countries.
  const all = queryCountries({ sovereignty: [...SOVEREIGN, 'territory'] }).filter(
    (c) => c.sovereignty !== 'territory' || c.borders.length > 0,
  );
  return settings.region === 'world' ? all : all.filter((c) => c.continent === settings.region);
}

/** City Circle counts every playable city: the UN data goes down to 50k. */
export const CIRCLE_MIN_POPULATION = cityIndex.minPopulation;

/**
 * City Circle pools: every playable city worldwide counts (circles cross
 * borders), from major.json plus the slim small-city rows, so no continent
 * files are needed. Circles are only placed around cities in the chosen region.
 */
export async function circleCities(settings: GameSettings = DEFAULT_SETTINGS): Promise<Pick<CircleGameOptions, 'cities' | 'centers'>> {
  const [major, small] = await Promise.all([loadCities({ minPopulation: cityIndex.majorMinPopulation }), loadSmallCities()]);
  const cities: CircleCity[] = [
    ...major.map((c) => ({ id: c.id, name: c.name, countryId: c.countryId, latlng: c.latlng, population: c.metrics.population!.value, aliases: c.aliases, includes: c.includes })),
    ...small.map(
      ([id, name, countryId, population, lat, lng, aliases]): CircleCity => ({ id, name, countryId, latlng: [lat, lng], population, aliases }),
    ),
  ];
  const centers = settings.region === 'world' ? cities : cities.filter((c) => getCountry(c.countryId)?.continent === settings.region);
  return { cities, centers };
}

/**
 * City Circle Arcade pools: every playable city, plus the well-known ones
 * (the world's most visited cities, by Euromonitor's international arrivals),
 * from the dataset the player chose.
 */
export async function arcadePools(settings: GameSettings = DEFAULT_SETTINGS): Promise<ArcadeOptions> {
  if (settings.cityData === 'proper') {
    const { cities, tourismRank } = await loadCityProper();
    return {
      cities: cities.map(
        ([id, name, countryId, population, lat, lng, aliases]): CircleCity => ({ id, name, countryId, latlng: [lat, lng], population, aliases }),
      ),
      famous: new Set(Object.keys(tourismRank)),
    };
  }
  const { cities } = await circleCities();
  return { cities, famous: new Set(Object.keys(cityIndex.tourismRank)) };
}

/**
 * Halfway pools: Pin Drop's cities, plus every country and territory, so a
 * city in Hong Kong or Puerto Rico has a continent and a scope too.
 */
export async function halfwayPools(): Promise<ArcadeOptions & { countries: Country[]; tourismRank: Readonly<Record<string, number>> }> {
  return {
    ...(await arcadePools()),
    tourismRank: cityIndex.tourismRank,
    countries: queryCountries({ sovereignty: [...SOVEREIGN, 'territory'] }),
  };
}

/** Share of a region's countries asked on Easy: the best-known ones. */
export const EASY_SHARE = 0.4;

/**
 * Quiz questions for the region and difficulty.
 * - Easy: the best-known EASY_SHARE of the region (at least MIN_POOL_SIZE); wrong options from anywhere in it.
 * - Medium: every country; wrong options from the same continent.
 * - Hard: every country; wrong options from the same subregion first.
 */
export function quizItems(game: QuizDefinition, settings: GameSettings = DEFAULT_SETTINGS): QuizItem[] {
  const all = queryCountries();
  let pool = (settings.region === 'world' ? all : all.filter((c) => c.continent === settings.region)).filter(
    (c) => game.quiz !== 'capital' || c.capitals.length > 0,
  );
  if (settings.difficulty === 'easy') {
    const prominence = countryProminence(pool);
    const count = Math.max(MIN_POOL_SIZE, Math.round(pool.length * EASY_SHARE));
    pool = [...pool].sort((a, b) => prominence.get(b.id)! - prominence.get(a.id)!).slice(0, count);
  }
  const groupsOf = (c: Country): string[] =>
    settings.difficulty === 'hard'
      ? [c.subregion ?? c.continent, c.continent]
      : settings.difficulty === 'medium'
        ? [c.continent]
        : [];
  return pool.map((c) => ({
    id: c.id,
    answer: game.quiz === 'capital' ? c.capitals[0]! : c.name,
    accepted: game.quiz === 'capital' ? c.capitals : [c.name],
    groups: groupsOf(c),
  }));
}

/**
 * How many items each region would offer if the player switched to it, without
 * loading city files. City sizes are snapped to what each region allows.
 */
export function poolSizes(game: GameDefinition, settings: GameSettings = DEFAULT_SETTINGS): Record<Region, number> {
  const sizes = Object.fromEntries(REGIONS.map((r) => [r.id, 0])) as Record<Region, number>;
  if (game.kind === 'higher-lower' && game.subject === 'city') {
    for (const r of REGIONS) {
      const { cityMinPopulation } = normalizeSettings({ ...settings, region: r.id }, game);
      sizes[r.id] = playableCityCount(r.id, cityMinPopulation);
    }
    return sizes;
  }
  if (game.kind === 'circle-arcade') {
    sizes.world = playableCityCount('world', CIRCLE_MIN_POPULATION);
    return sizes;
  }
  if (game.kind === 'circle') {
    for (const r of REGIONS) sizes[r.id] = playableCityCount(r.id, CIRCLE_MIN_POPULATION);
    return sizes;
  }
  if (game.kind === 'quiz') {
    for (const r of REGIONS) sizes[r.id] = quizItems(game, { ...settings, region: r.id }).length;
    return sizes;
  }
  if (game.kind === 'pin-drop' || game.kind === 'halfway' || game.kind === 'great-circle' || game.kind === 'mystery-country' || game.kind === 'border-blitz' || game.kind === 'clockwork' || game.kind === 'blank-atlas' || game.kind === 'river-run' || game.kind === 'native-tongue' || game.kind === 'supply-chain' || game.kind === 'on-the-grid' || game.kind === 'region-run') {
    // No region to choose, and the setup screen doesn't show a count.
    sizes.world = MIN_POOL_SIZE;
    return sizes;
  }
  if (game.kind === 'route') {
    for (const r of REGIONS) {
      const routable = routableCountries(buildBorderGraph(routeCountries({ ...settings, region: r.id })));
      sizes[r.id] = routable.filter((id) => getCountry(id)?.sovereignty !== 'territory').length;
    }
    return sizes;
  }
  const all = queryCountries({ requireMetrics: [game.metric] });
  sizes.world = all.length;
  for (const c of all) if (c.continent in sizes) sizes[c.continent]++;
  return sizes;
}
