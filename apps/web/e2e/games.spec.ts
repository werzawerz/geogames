import { countries } from '@geogames/geodata';
import {
  DEFAULT_SETTINGS,
  GAMES,
  arcadePools,
  citySizeStops,
  createCircleArcade,
  formatPopulationShort,
  circleCities,
  createCircleGame,
  createHigherLowerGame,
  loadPool,
  createRouteGame,
  getGame,
  hintText,
  quizItems,
  routeCountries,
  type CircleDefinition,
  type HigherLowerDefinition,
  type QuizDefinition,
} from '@geogames/games';
import { expect, openGame, playRounds, setCitySize, test } from './fixtures.ts';

test('home lists every game', async ({ page }) => {
  await page.goto('/');
  for (const game of GAMES) await expect(page.getByRole('heading', { name: game.title })).toBeVisible();
});

for (const game of GAMES.filter((g) => g.kind === 'higher-lower' && g.status === 'live')) {
  test(`${game.id}: starts, reveals answers and records a score`, async ({ page }) => {
    await openGame(page, game.id);
    await page.getByRole('button', { name: 'Start game' }).click();

    await expect(page.locator('.hl-card')).toHaveCount(2);
    await expect(page.locator('.hl-flag img').first()).toBeVisible();
    await playRounds(page, 50);

    await expect(page.getByText('Game over')).toBeVisible({ timeout: 5000 });
    await page.getByRole('link', { name: 'Leaderboard' }).click();
    await expect(page.locator('.scores li')).toHaveCount(1);
  });
}

test('cities: Europe with 300k+ plays from the continent pool', async ({ page }) => {
  await openGame(page, 'higher-lower-city-population');
  await page.getByRole('radio', { name: /Europe/ }).click();
  await setCitySize(page, '300k');
  await expect(page.getByText(/^\d+ cities in play$/)).toBeVisible();

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.region-tag')).toHaveText('Europe · cities 300k+');
  await expect(page.locator('.hl-card')).toHaveCount(2);
  await playRounds(page, 2);
});

test('cities: Asia with 100k+ loads the big continent file', async ({ page }) => {
  await openGame(page, 'higher-lower-city-population');
  await page.getByRole('radio', { name: /Asia/ }).click();
  await setCitySize(page, '100k');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.hl-card')).toHaveCount(2, { timeout: 15_000 });
  await playRounds(page, 2);
});

test('cities: world never goes below 300k, small regions only offer sizes with enough cities', async ({ page }) => {
  await openGame(page, 'higher-lower-city-population');
  await expect(page.locator('.size-ticks span').first()).toHaveText('300k');

  await page.getByRole('radio', { name: /Oceania/ }).click();
  const stops = citySizeStops('Oceania').map(formatPopulationShort);
  expect(stops.length).toBeLessThan(citySizeStops('Europe').length);
  await expect(page.locator('.size-ticks span')).toHaveText(stops);
});

test('settings are remembered per game', async ({ page }) => {
  await openGame(page, 'higher-lower-area');
  await page.getByRole('radio', { name: /South America/ }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: /South America/ })).toHaveAttribute('aria-checked', 'true');
});

test('border route: a perfect game scores 50', async ({ page }) => {
  // Plays a whole game; allow for a busy machine running both test servers.
  test.slow();
  const engine = createRouteGame({ countries: routeCountries(), rounds: 5 });
  const idByName = new Map(countries.map((c) => [c.name, c.id]));
  const nameById = new Map(countries.map((c) => [c.id, c.name]));

  await openGame(page, 'border-route');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.world-map')).toBeVisible({ timeout: 15_000 });

  for (let round = 1; round <= 5; round++) {
    const [start, end] = await page.locator('.route-end').allTextContents();
    const minimal = Number(await page.locator('.route-hint strong').textContent());
    const route = engine.shortestRoute({ start: idByName.get(start!)!, end: idByName.get(end!)!, minimal });
    for (const id of route.slice(1, -1)) {
      await page.getByRole('combobox').fill(nameById.get(id)!);
      await page.getByRole('combobox').press('Enter');
    }
    await expect(page.locator('.route-summary.solved')).toContainText('Connected! +10');
    await page.getByRole('button', { name: round < 5 ? 'Next route' : 'See final score' }).click();
  }

  await expect(page.locator('.big-score')).toHaveText('50');
});

test('border route: shows borders, moves country by country, rejects the rest', async ({ page }) => {
  const engine = createRouteGame({ countries: routeCountries(), rounds: 5 });
  const idByName = new Map(countries.map((c) => [c.name, c.id]));
  const nameById = new Map(countries.map((c) => [c.id, c.name]));

  await openGame(page, 'border-route');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 15_000 });
  // The whole political map is drawn, not just the puzzle countries.
  expect(await page.locator('.map-country.tone-base').count()).toBeGreaterThan(150);

  const [start, end] = await page.locator('.route-end').allTextContents();
  await input.fill(start!);
  await input.press('Enter');
  await expect(page.locator('.route-message')).toHaveText("That's the start or the goal.");

  // A country not bordering the route is refused and costs nothing.
  const startId = idByName.get(start!)!;
  const far = countries.find((c) => engine.graph.has(c.id) && !engine.graph.get(startId)!.includes(c.id) && c.name !== end && c.id !== startId)!;
  const hint = await page.locator('.route-hint').textContent();
  await input.fill(far.name);
  await input.press('Enter');
  await expect(page.locator('.route-message')).toHaveText(`${far.name} doesn't border your route yet. Go country by country.`);
  await expect(page.locator('.route-hint')).toHaveText(hint!);
  await expect(page.locator('.guess')).toHaveCount(0);

  // A neighbour of the start is accepted and coloured.
  const neighbour = engine.graph.get(startId)!.find((id) => nameById.get(id) !== end)!;
  await input.fill(nameById.get(neighbour)!);
  await input.press('Enter');
  await expect(page.locator('.guess')).toHaveCount(1);
  await expect(page.locator('.map-highlight.tone-optimal, .map-highlight.tone-near, .map-highlight.tone-far')).toHaveCount(1);
});

test('capitals: right answers score, three wrong ones end the game', async ({ page }) => {
  // Plays a whole game; allow for a busy machine running both test servers.
  test.slow();
  await openGame(page, 'capitals');
  await page.getByRole('button', { name: 'Start game' }).click();

  for (let i = 0; i < 3; i++) {
    const countryName = await page.locator('.quiz-subject').textContent();
    const capitals = countries.find((c) => c.name === countryName)!.capitals;
    const options = await page.locator('.quiz-option').evaluateAll((els) => els.map((e) => e.lastChild?.textContent ?? ''));
    await page.getByRole('button', { name: options.find((o) => capitals.includes(o))!, exact: true }).click();
    await expect(page.locator('.quiz-feedback')).toHaveText('Correct!');
    await expect(page.locator('.quiz-option:enabled')).toHaveCount(4, { timeout: 5000 });
  }
  await expect(page.locator('.quiz-status strong')).toHaveText('3');

  for (let lives = 3; lives > 0; lives--) {
    const countryName = await page.locator('.quiz-subject').textContent();
    const capitals = countries.find((c) => c.name === countryName)!.capitals;
    const options = await page.locator('.quiz-option').evaluateAll((els) => els.map((e) => e.lastChild?.textContent ?? ''));
    const wrong = options.findIndex((o) => !capitals.includes(o));
    await page.locator('.quiz-option').nth(wrong).click();
    await expect(page.locator('.quiz-feedback')).toHaveText(/^It’s /);
    if (lives > 1) await expect(page.locator('.quiz-option:enabled')).toHaveCount(4, { timeout: 5000 });
  }
  await expect(page.locator('.big-score')).toHaveText('3', { timeout: 5000 });
});

test('flags: shows a flag with four country options and keyboard answers', async ({ page }) => {
  await openGame(page, 'flags');
  await page.getByRole('radio', { name: /Europe/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.quiz-flag-big img')).toBeVisible();
  const options = await page.locator('.quiz-option').allTextContents();
  const europe = new Set(countries.filter((c) => c.continent === 'Europe').map((c) => c.name));
  expect(options.map((o) => o.slice(1)).every((name) => europe.has(name))).toBe(true);

  // Answer with the keyboard until all lives are gone.
  while (!(await page.locator('.big-score').isVisible())) {
    if (await page.locator('.quiz-option:enabled').count()) await page.keyboard.press('1');
    await page.waitForTimeout(200);
  }
  await expect(page.getByText(/Game over · Europe/)).toBeVisible();
});

test('capitals: easy asks only well-known countries and has its own leaderboard', async ({ page }) => {
  const easy = new Set(
    quizItems(getGame('capitals') as QuizDefinition, { ...DEFAULT_SETTINGS, difficulty: 'easy' }).map(
      (i) => countries.find((c) => c.id === i.id)!.name,
    ),
  );
  await openGame(page, 'capitals');
  await page.getByRole('radio', { name: 'Easy' }).click();
  await expect(page.getByText('Well-known countries; wrong options from anywhere.')).toBeVisible();
  await expect(page.getByText(`${easy.size} countries in play`)).toBeVisible();
  await page.getByRole('button', { name: 'Start game' }).click();

  while (!(await page.locator('.big-score').isVisible())) {
    if (await page.locator('.quiz-option:enabled').count()) {
      expect(easy.has((await page.locator('.quiz-subject').textContent())!)).toBe(true);
      await page.keyboard.press('1');
    }
    await page.waitForTimeout(200);
  }
  await expect(page.getByText('Game over · Whole world · Easy')).toBeVisible();
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page).toHaveURL(/#\/scores\/capitals\/world-easy$/);
  await expect(page.getByRole('radio', { name: 'Easy' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.scores li')).toHaveCount(1);
});

test('city circle: perfect game with one miss scores 15', async ({ page }) => {
  // Plays a whole game; allow for a busy machine running both test servers.
  test.slow();
  // Fix the page's randomness so the seed is known: randomSeed() = floor(0.5 * 2^32).
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const definition = getGame('city-circle') as CircleDefinition;
  const { rounds, target, misses } = definition;
  const engine = createCircleGame({ ...(await circleCities()), rounds, target, misses, radiusKm: 0, placement: 'random' });
  let state = engine.start(2 ** 31);

  await openGame(page, 'city-circle');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-area')).toHaveCount(1);

  const guess = async (id: string) => {
    const city = engine.cities.get(id)!;
    const country = countries.find((c) => c.id === city.countryId)!.name;
    await input.fill(city.name);
    await page.locator('.suggestions li').filter({ hasText: country }).filter({ hasText: city.name }).first().click();
    state = engine.guess(state, id).state;
  };

  for (let round = 1; round <= 3; round++) {
    const { puzzle } = engine.current(state)!;
    if (round === 1) {
      const outside = [...engine.cities.keys()].find((id) => !puzzle.inside.includes(id))!;
      await guess(outside);
      await expect(page.locator('.route-message')).toContainText('is outside the circle.');
      await expect(page.locator('.marker-outside')).toHaveCount(1);
      // The guess table shows the miss with its population and distance.
      const row = page.locator('.guess-table tbody tr');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(engine.cities.get(outside)!.name);
      await expect(row).toContainText(new Intl.NumberFormat('en').format(engine.cities.get(outside)!.population));
      await expect(row.locator('.result-outside')).toContainText(/Outside · \d+ km away/);
    }
    for (const id of engine.top(puzzle)) await guess(id);
    await expect(page.locator('.route-summary.solved')).toContainText('All 5 found!');
    await expect(page.locator('.rank-slots .slot-found')).toHaveCount(5);
    await page.getByRole('button', { name: round < 3 ? 'Next circle' : 'See final score' }).click();
    if (round < 3) state = engine.nextRound(state);
  }
  await expect(page.locator('.big-score')).toHaveText('15');
});

test('city circle: small cities count as normal guesses, and giving up reveals the answers', async ({ page }) => {
  await openGame(page, 'city-circle');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });

  // Prešov (76k) is in the game: it lands in the guess table with its population.
  await input.fill('Prešov');
  await page.locator('.suggestions li').filter({ hasText: 'Slovakia' }).first().click();
  const row = page.locator('.guess-table tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('76,161');

  await page.getByRole('button', { name: 'Give up this circle' }).click();
  await expect(page.locator('.route-summary.failed')).toContainText('of 5 found');
  await expect(page.locator('.rank-slots .slot-name.muted')).toHaveCount(0);
  await expect(page.locator('.marker-missed').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next circle' })).toBeVisible();
});

test('city circle: placing your own circle', async ({ page }) => {
  await openGame(page, 'city-circle');
  await page.getByRole('radio', { name: /Europe/ }).click();
  await page.getByRole('radio', { name: 'I’ll place it' }).click();
  await page.getByRole('slider').fill('250');
  await expect(page.locator('.size-value')).toContainText('Radius 250 km · small circles leaderboard');
  await page.getByRole('button', { name: 'Start game' }).click();

  const map = page.locator('.world-map.pickable');
  await expect(map).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-prompt')).toContainText('radius 250 km');
  // Somewhere over central Europe: the middle of a Europe-framed map.
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.55, y: box.height * 0.6 } });
  await expect(page.locator('.place-bar')).toContainText(/\d+ cit(y|ies) of 50k\+ inside/);
  const play = page.getByRole('button', { name: 'Play this circle' });
  if (await play.isDisabled()) {
    await map.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  }
  await play.click();
  await expect(page.locator('.circle-prompt')).toContainText('radius 250 km');
  await expect(page.getByRole('combobox')).toBeVisible();
  await expect(page.locator('.rank-slots li')).toHaveCount(5);
});

test('city circle: random circles with a chosen radius', async ({ page }) => {
  await openGame(page, 'city-circle');
  await page.getByRole('radio', { name: 'Choose' }).click();
  await page.getByRole('slider').fill('900');
  await expect(page.locator('.size-value')).toContainText('Radius 900 km · large circles leaderboard');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.circle-prompt')).toContainText('radius 900 km', { timeout: 20_000 });
  await expect(page.locator('.region-tag')).toHaveText('Whole world · radius 900 km');
});

test('maps zoom with buttons and wheel, keep labels readable, and reset', async ({ page }) => {
  await openGame(page, 'border-route');
  await page.getByRole('button', { name: 'Start game' }).click();
  const map = page.locator('.world-map');
  await expect(map).toBeVisible({ timeout: 15_000 });
  const layer = map.locator(':scope > g').first();
  const labelSize = () => page.locator('.map-label').first().evaluate((el) => el.getBoundingClientRect().height);
  const before = await labelSize();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(layer).toHaveAttribute('transform', /scale\(1\.6\)/);
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(/scale\(([\d.]+)\)/.exec((await layer.getAttribute('transform'))!)![1])).toBeGreaterThan(1.6);
  // Labels don't grow with the map.
  expect(Math.abs((await labelSize()) - before)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(layer).toHaveAttribute('transform', 'translate(0,0) scale(1)');
});

test('city circle: zoomed placement lands where clicked, and dragging does not place', async ({ page }) => {
  await openGame(page, 'city-circle');
  await page.getByRole('radio', { name: /Europe/ }).click();
  await page.getByRole('radio', { name: 'I’ll place it' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const map = page.locator('.world-map.pickable');
  await expect(map).toBeVisible({ timeout: 20_000 });
  const box = (await map.boundingBox())!;

  // Drag to pan after zooming in: no circle appears.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.circle-area')).toHaveCount(0);

  // A click places the circle centred on the click point, even while zoomed.
  const click = { x: box.width * 0.55, y: box.height * 0.5 };
  await map.click({ position: click });
  const circle = (await page.locator('.circle-area').boundingBox())!;
  expect(Math.abs(circle.x + circle.width / 2 - (box.x + click.x))).toBeLessThan(4);
  expect(Math.abs(circle.y + circle.height / 2 - (box.y + click.y))).toBeLessThan(8);
});

test('higher or lower: never repeats, and a perfect run ends when every country was shown', async ({ page }) => {
  test.slow(); // 11 reveals of 1.6 s each
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const definition = getGame('higher-lower-population') as HigherLowerDefinition;
  const pool = await loadPool(definition, { ...DEFAULT_SETTINGS, region: 'South America' });
  const engine = createHigherLowerGame({ metric: 'population', pool });
  let state = engine.start(2 ** 31);

  await openGame(page, 'higher-lower-population');
  await page.getByRole('radio', { name: /South America/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const shown = new Set<string>();
  while (state.status !== 'over') {
    await expect(page.locator('.btn-up')).toBeVisible();
    const names = await page.locator('.hl-name').allTextContents();
    expect(names).toEqual([state.current.name, state.challenger.name]);
    for (const n of names) shown.add(n);
    const guess = engine.valueOf(state.challenger) >= engine.valueOf(state.current) ? 'higher' : 'lower';
    await page.keyboard.press(guess === 'higher' ? 'ArrowUp' : 'ArrowDown');
    state = engine.next(engine.guess(state, guess));
  }

  await expect(page.locator('.big-score')).toHaveText('11', { timeout: 10_000 });
  await expect(page.getByText('Perfect run: you went through all 12 countries!')).toBeVisible();
  expect(shown.size).toBe(12);
});

test('border route: Western Sahara is typeable and only dimmed outside its region', async ({ page }) => {
  for (const [region, tone] of [
    ['Africa', 'tone-base'],
    ['Europe', 'tone-outside'],
  ] as const) {
    await page.goto('/'); // leave the running game so the setup screen opens again
    await openGame(page, 'border-route');
    await page.getByRole('radio', { name: new RegExp(region) }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    const input = page.getByRole('combobox');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-country[data-id="ESH"]')).toHaveClass(new RegExp(tone));
    if (region === 'Africa') {
      await input.fill('Western Sah');
      await expect(page.locator('.suggestions li').filter({ hasText: 'Western Sahara' })).toHaveCount(1);
    }
  }
});

test('city circle arcade: perfect level earns a life, misses are free, skips cost lives, game ends at zero', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createCircleArcade(await arcadePools());
  let state = engine.start(2 ** 31);

  await openGame(page, 'city-circle-arcade');
  await expect(page.getByRole('radiogroup', { name: 'Region' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-prompt')).toContainText('Name the top 3 cities');

  const pick = async (id: string) => {
    const city = engine.cities.get(id)!;
    const country = countries.find((c) => c.id === city.countryId)!.name;
    await input.fill(city.name);
    await page.locator('.suggestions li').filter({ hasText: country }).filter({ hasText: city.name }).first().click();
    state = engine.guess(state, id).state;
  };

  // Level 1, perfectly: +1 life.
  for (const id of engine.remaining(state.level)) await pick(id);
  await expect(page.locator('.route-summary.solved')).toContainText('Level 1 cleared!');
  await expect(page.locator('.bonus-life')).toHaveText('Perfect level! +1 ♥');
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Level 2: a hint shows the country flag and first letter; a wrong guess is free, a skip costs a life.
  await page.getByRole('button', { name: /Hint/ }).click();
  await expect(page.locator('.slot-hinted .flag')).toBeVisible();
  state = engine.hint(state);
  const hinted = engine.cities.get(Object.keys(state.level.hints)[0]!)!;
  await expect(page.locator('.slot-hinted .slot-letters')).toHaveText(hintText(hinted.name, 1));
  expect(hintText(hinted.name, 1)[0]).not.toBe(hinted.name[0]);
  const outsider = [...engine.cities.keys()].find((id) => !state.level.puzzle.inside.includes(id))!;
  await pick(outsider);
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(6);
  const skip = page.getByRole('button', { name: /Skip city/ });
  while (state.status !== 'over') {
    if (state.status === 'level-clear') {
      await page.getByRole('button', { name: 'Next level' }).click();
      state = engine.nextLevel(state);
    }
    await skip.click();
    state = engine.skip(state);
    if (state.status !== 'over') await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(state.lives);
  }
  await expect(page.locator('.route-summary.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toHaveText(String(state.score));
  const circles = state.cleared === 1 ? 'circle' : 'circles';
  await expect(page.getByText(`You reached level ${state.level.number} and cleared ${state.cleared} ${circles}.`)).toBeVisible();
});

test('city circle arcade: choosing the city data sets the search and the rules, and is remembered', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const pools = await arcadePools({ ...DEFAULT_SETTINGS, cityData: 'proper' });
  const engine = createCircleArcade(pools);
  await openGame(page, 'city-circle-arcade');
  const data = page.getByRole('radiogroup', { name: 'City data' });
  await expect(data.getByRole('radio', { name: 'Metro areas' })).toHaveAttribute('aria-checked', 'true');
  await data.getByRole('radio', { name: 'City proper' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.region-tag')).toHaveText('Arcade · City proper');
  await expect(page.getByText('as the city itself')).toBeVisible();

  // Yokohama is a city of its own here, not an alias of Tokyo.
  await input.fill('Yokohama');
  const first = page.locator('.suggestions li').first();
  await expect(first).toContainText('Yokohama');
  await expect(first.locator('.suggestion-via')).toHaveCount(0);

  // The first level is the one this dataset and seed produce.
  const state = engine.start(2 ** 31);
  const city = engine.cities.get(engine.top(state.level)[0]!)!;
  await input.fill(city.name);
  await page.locator('.suggestions li').filter({ hasText: city.name }).first().click();
  await expect(page.locator('.rank-slots .slot-found')).toHaveCount(1);

  // The choice is remembered for the next game.
  await page.goto('/#/');
  await openGame(page, 'city-circle-arcade');
  await expect(page.getByRole('radiogroup', { name: 'City data' }).getByRole('radio', { name: 'City proper' })).toHaveAttribute('aria-checked', 'true');
});

test('maps zoom out past the starting view to show the whole world, and reset back', async ({ page }) => {
  await openGame(page, 'city-circle-arcade');
  await page.getByRole('button', { name: 'Start game' }).click();
  const map = page.locator('.world-map');
  await expect(map).toBeVisible({ timeout: 20_000 });
  const layer = map.locator(':scope > g').first();
  const scale = async () => Number(/scale\(([\d.e-]+)\)/.exec((await layer.getAttribute('transform'))!)![1]);

  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  await expect(zoomOut).toBeEnabled();
  for (let i = 0; i < 12 && (await zoomOut.isEnabled()); i++) await zoomOut.click();
  // Fully zoomed out: the button disables once the whole globe fits.
  await expect(zoomOut).toBeDisabled();
  // Level 1 circles can be up to 3000 km, so the start may already show a quarter of the globe.
  expect(await scale()).toBeLessThan(0.5);

  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(layer).toHaveAttribute('transform', 'translate(0,0) scale(1)');
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
});

test('city search: absorbed cities, a country after the name, and misspellings', async ({ page }) => {
  await openGame(page, 'city-circle-arcade');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  const first = page.locator('.suggestions li').first();

  await input.fill('San Jose USA');
  await expect(first).toContainText('San Jose');
  await expect(first).toContainText('United States');
  // A city inside a bigger agglomeration finds the agglomeration.
  await input.fill('Yokohama');
  await expect(first).toContainText('Tokyo');
  await expect(first.locator('.suggestion-via')).toHaveText('Yokohama');
  await input.fill('Kiev');
  await expect(first).toContainText('Kyiv');
  await input.fill('Amstredam');
  await expect(first).toContainText('Amsterdam');
  // Hungarian names, for big and small cities alike.
  await input.fill('Pozsony');
  await expect(first).toContainText('Bratislava');
  await expect(first.locator('.suggestion-via')).toHaveText('Pozsony');
  await input.fill('Ungvar');
  await expect(first).toContainText('Uzhhorod');
});
