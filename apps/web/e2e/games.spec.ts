import { countries, getCountry, queryCountries } from '@geogames/geodata';
import { loadGreatCircles } from '@geogames/geodata/cities';
import { loadRivers } from '@geogames/geodata/rivers';
import { loadLandGrid } from '@geogames/geodata/land-grid';
import { geoNaturalEarth1 } from 'd3-geo';
import { loadNativeNames } from '@geogames/geodata/native-names';
import { BLANK_ATLAS_KIND_LABELS } from '@geogames/geodata/blank-atlas';
import {
  DEFAULT_SETTINGS,
  GAMES,
  HARD_MODE_GUESSES,
  arcadePools,
  blankAtlasGame,
  citySizeStops,
  createCircleArcade,
  formatPopulationShort,
  circleCities,
  createCircleGame,
  createHigherLowerGame,
  loadPool,
  createGreatCircle,
  createBorderBlitz,
  createMysteryCountry,
  createPinDrop,
  createHalfway,
  createRiverRun,
  createOnTheGrid,
  formatCoordinates,
  createNativeTongue,
  riverChoices,
  createClockwork,
  CLOCK_DATES,
  clockworkCountries,
  clockPlace,
  formatClock,
  type ClockState,
  halfwayPools,
  distanceKm,
  createRouteGame,
  dailyDate,
  dailySeed,
  getGame,
  hintText,
  quizItems,
  routeCountries,
  type CircleDefinition,
  type HigherLowerDefinition,
  type QuizDefinition,
} from '@geogames/games';
import type { Page } from '@playwright/test';
import { expect, openGame, playRounds, setCitySize, test } from './fixtures.ts';

test('home lists every game', async ({ page }) => {
  await page.goto('/');
  for (const game of GAMES) await expect(page.getByRole('heading', { name: game.title })).toBeVisible();
});

test('every game card has its picture, with real shapes drawn in it', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.game-card');
  await expect(cards).toHaveCount(GAMES.length);
  for (let i = 0; i < GAMES.length; i++) {
    const art = cards.nth(i).locator('svg.card-art');
    await expect(art, GAMES[i]!.id).toBeVisible();
    expect(await art.locator(':is(path, rect, circle, ellipse)').count(), GAMES[i]!.id).toBeGreaterThan(0);
  }
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

test('border route: a perfect run clears all 20 levels', async ({ page }) => {
  // Plays all 20 levels: about 25 s alone, far longer beside every other test.
  test.setTimeout(300_000);
  const engine = createRouteGame({ countries: routeCountries(), rounds: 5 });
  const idByName = new Map(countries.map((c) => [c.name, c.id]));
  const nameById = new Map(countries.map((c) => [c.id, c.name]));

  await openGame(page, 'border-route');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.world-map')).toBeVisible({ timeout: 15_000 });

  for (let round = 1; round <= 20; round++) {
    await expect(page.locator('.route-status')).toContainText(`Level ${round} of 20`);
    const [start, end] = await page.locator('.route-end').allTextContents();
    const minimal = Number(await page.locator('.route-hint strong').textContent());
    const route = engine.shortestRoute({ start: idByName.get(start!)!, end: idByName.get(end!)!, minimal });
    for (const id of route.slice(1, -1)) {
      await page.getByRole('combobox').fill(nameById.get(id)!);
      await page.getByRole('combobox').press('Enter');
    }
    await expect(page.locator('.route-summary.solved')).toContainText(`Connected! +${10 * round}`);
    await page.getByRole('button', { name: round < 20 ? 'Next level' : 'See final score' }).click();
  }

  await expect(page.locator('.big-score')).toHaveText('2100');
  await expect(page.getByText('You connected all 20 routes!')).toBeVisible();
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

test('border route, hard: only your countries have borders, and the route length stays secret until the end', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createRouteGame({ countries: routeCountries(), rounds: 20, hard: true });
  const nameById = new Map(countries.map((c) => [c.id, c.name]));
  const { puzzle } = engine.current(engine.start(2 ** 31));

  await openGame(page, 'border-route');
  const difficulty = page.getByRole('radiogroup', { name: 'Difficulty' });
  await expect(difficulty.getByRole('radio', { name: 'Easy' })).toHaveAttribute('aria-checked', 'true');
  await difficulty.getByRole('radio', { name: 'Hard' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.region-tag')).toHaveText('Arcade · Hard');

  // Other countries' borders aren't even in the page.
  await expect(page.locator('.map-country')).toHaveCount(2);
  await expect(page.locator('.map-country[data-id]')).toHaveCount(0);

  // Nothing gives the length away: same count for any route, and no number of steps.
  const hint = page.locator('.route-hint');
  await expect(hint).toHaveText(`${HARD_MODE_GUESSES} guesses left`);
  await expect(page.locator('.route-message')).not.toContainText(/\d/);
  await expect(page.locator('.route-summary')).toHaveCount(0);

  // A country off the route costs a guess, and stays off the map.
  const route = engine.shortestRoute(puzzle);
  const borderingStart = engine.frontier(engine.current(engine.start(2 ** 31)));
  const off = countries.find((c) => engine.graph.has(c.id) && !borderingStart.has(c.id) && !route.includes(c.id))!;
  await input.fill(off.name);
  await input.press('Enter');
  await expect(page.locator('.route-message')).toHaveText(`${off.name} doesn't border your route. That cost you a guess.`);
  await expect(hint).toHaveText(`${HARD_MODE_GUESSES - 1} guesses left`);
  await expect(page.locator('.map-country')).toHaveCount(2);
  await expect(page.locator('.guess-miss')).toContainText(off.name);
  // The same one again is free.
  await input.fill(off.name);
  await input.press('Enter');
  await expect(page.locator('.route-message')).toHaveText('Already guessed.');
  await expect(hint).toHaveText(`${HARD_MODE_GUESSES - 1} guesses left`);

  // A guess adds its own borders and nothing else.
  const steps = route.slice(1, -1);
  await input.fill(nameById.get(steps[0]!)!);
  await input.press('Enter');
  await expect(page.locator('.map-country')).toHaveCount(3);
  if (steps.length > 1) await expect(hint).toHaveText(`${HARD_MODE_GUESSES - 2} guesses left`);

  // At the end, the shortest route is told.
  for (const id of steps.slice(1)) {
    await input.fill(nameById.get(id)!);
    await input.press('Enter');
  }
  // One miss: 2 points off.
  await expect(page.locator('.route-summary.solved')).toContainText('Connected! +8');
  await expect(page.locator('.route-summary.solved')).toContainText(`Shortest route: ${route.map((id) => nameById.get(id)).join(' → ')}`);
  await expect(hint).toContainText(`Shortest route: ${puzzle.minimal}`);
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

test('daily challenge: one try, resumes after a reload, and the result can be shared', async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const game = getGame('border-route')!;
  const seed = await dailySeed(game.id, dailyDate());
  const engine = createRouteGame({ countries: routeCountries(), rounds: 20 });
  const nameById = new Map(countries.map((c) => [c.id, c.name]));
  let state = engine.start(seed);

  await page.goto('/#/');
  await page.locator('.daily').getByRole('link', { name: 'Border Route' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 15_000 });
  // No setup: everyone has the same settings, and this is today's run.
  const { puzzle } = engine.current(state);
  await expect(page.locator('.route-end')).toHaveText([nameById.get(puzzle.start)!, nameById.get(puzzle.end)!]);

  // Clear level 1.
  for (const id of engine.shortestRoute(puzzle).slice(1, -1)) {
    await input.fill(nameById.get(id)!);
    await input.press('Enter');
    state = engine.guess(state, id).state;
  }
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextRound(state);

  // On level 2, guess a detour, then reload: the run carries on rather than restarting.
  const level2 = engine.current(state).puzzle;
  // Any guess that doesn't finish the level: some days' level 2 has no detour at all.
  const frontier = [...engine.frontier(engine.current(state))];
  const detour =
    frontier.find((id) => engine.classify(level2, id) !== 'optimal') ??
    frontier.find((id) => engine.current(engine.guess(state, id).state).status !== 'solved')!;
  await input.fill(nameById.get(detour)!);
  await input.press('Enter');
  state = engine.guess(state, detour).state;
  await page.reload();
  await expect(page.locator('.route-status')).toContainText('Level 2 of 20', { timeout: 15_000 });
  await expect(page.locator('.guess')).toHaveCount(1);

  // Run out of guesses.
  while (state.status === 'playing') {
    const puzzleNow = engine.current(state).puzzle;
    const next = [...engine.frontier(engine.current(state))].sort(
      (a, b) => Number(engine.classify(puzzleNow, a) === 'far') - Number(engine.classify(puzzleNow, b) === 'far'),
    );
    const wrong = next.reverse().find((id) => {
      const after = engine.guess(state, id).state;
      return engine.current(after).status !== 'solved';
    });
    if (!wrong) throw new Error('no way to avoid solving this route');
    await input.fill(nameById.get(wrong)!);
    await input.press('Enter');
    state = engine.guess(state, wrong).state;
  }
  await page.getByRole('button', { name: 'See final score' }).click();
  const score = String(state.score);
  await expect(page.locator('.big-score')).toHaveText(score);
  await expect(page.getByText('You reached level 2 of 20.')).toBeVisible();
  await expect(page.locator('.daily-share-line')).toHaveText('🟩🟥');

  // A shareable result, without naming a single country.
  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toContain(`GeoGames daily ${dailyDate()}`);
  expect(shared).toContain(`Border Route: ${score} points`);
  expect(shared).toContain('🟩🟥');
  expect(shared).not.toContain(nameById.get(puzzle.start)!);

  // One try: coming back shows the result, and the home page says so.
  await page.reload();
  await expect(page.locator('.big-score')).toHaveText(score);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.goto('/#/');
  await expect(page.locator('.daily').getByRole('link', { name: 'Border Route' })).toContainText(`today: ${score}`);
});

test('border route: Western Sahara is typeable, and a run has no region to pick', async ({ page }) => {
  await openGame(page, 'border-route');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.map-country[data-id="ESH"]')).toHaveClass(/tone-base/);
  await input.fill('Western Sah');
  await expect(page.locator('.suggestions li').filter({ hasText: 'Western Sahara' })).toHaveCount(1);
});

test('border route: running out of guesses ends the run at once', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createRouteGame({ countries: routeCountries(), rounds: 20, hard: true });
  let state = engine.start(2 ** 31);
  const nameById = new Map(countries.map((c) => [c.id, c.name]));

  await openGame(page, 'border-route');
  await page.getByRole('radiogroup', { name: 'Difficulty' }).getByRole('radio', { name: 'Hard' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 15_000 });

  // Twelve different countries off the route.
  const start = engine.current(state).puzzle;
  const frontier = engine.frontier(engine.current(state));
  const wrong = countries
    .filter((c) => engine.graph.has(c.id) && !frontier.has(c.id) && c.id !== start.start && c.id !== start.end)
    .slice(0, HARD_MODE_GUESSES);
  for (const c of wrong) {
    await input.fill(nameById.get(c.id)!);
    await input.press('Enter');
    state = engine.guess(state, c.id).state;
  }
  await expect(page.locator('.route-summary.failed')).toContainText('Out of guesses');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toHaveText('0');
  await expect(page.getByText('You reached level 1 of 20.')).toBeVisible();
  expect(state.status).toBe('over');
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

test('pin drop: clicking places a pin, shows how far off, and the budget ends the run', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await openGame(page, 'pin-drop');
  await page.getByRole('button', { name: 'Start game' }).click();
  const map = page.locator('.world-map.pickable');
  await expect(map).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.pin-prompt')).toContainText('Where is');
  const box = (await map.boundingBox())!;

  // No labels to read the answer from.
  await expect(page.locator('.map-label')).toHaveCount(0);

  let cities = 0;
  for (; cities < 30; cities++) {
    // The middle of the Pacific edge of the map: wrong by a lot, every time.
    await page.mouse.click(box.x + 8, box.y + box.height * 0.5);
    const final = page.getByRole('button', { name: 'See final score' });
    const next = page.getByRole('button', { name: 'Next city' });
    await expect(final.or(next)).toBeVisible();
    await expect(page.locator('.route-summary-title')).toContainText('km off');
    await expect(page.locator('.pin-guess')).toHaveCount(1);
    await expect(page.locator('.pin-line')).toHaveCount(1);
    await expect(page.locator('.marker-found text')).not.toHaveText('');
    if (await final.isVisible()) {
      await final.click();
      break;
    }
    await next.click();
    await expect(page.locator('.pin-guess')).toHaveCount(0);
  }
  expect(cities).toBeLessThan(10);
  await expect(page.locator('.big-score')).toBeVisible();
  await expect(page.getByText(/You reached city \d+\./)).toBeVisible();
});

test('pin drop: zooms in far enough for a precise pin, and the pin lands where clicked', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await openGame(page, 'pin-drop');
  await page.getByRole('button', { name: 'Start game' }).click();
  const map = page.locator('.world-map.pickable');
  await expect(map).toBeVisible({ timeout: 20_000 });
  const box = (await map.boundingBox())!;
  const layer = map.locator(':scope > g').first();
  const scale = async () => Number(/scale\(([\d.e-]+)\)/.exec((await layer.getAttribute('transform'))!)![1]);

  // Beyond the 20x other maps stop at: keep zooming until the button gives up.
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  let last = 0;
  for (let i = 0; i < 14 && (await scale()) !== last; i++) {
    last = await scale();
    await zoomIn.click();
    await page.waitForTimeout(30);
  }
  expect(await scale()).toBeGreaterThan(50);
  expect(await scale()).toBeLessThanOrEqual(60);

  // Zoomed all the way in, the pin still lands where the click was: the middle of the map.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.route-summary-title')).toContainText('km off');
  expect(Math.abs(Number(await page.locator('.pin-guess').getAttribute('cx')) - 480)).toBeLessThan(2);
});

test('daily challenge: pin drop resumes after a reload and shares its marks', async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const engine = createPinDrop(await arcadePools());
  const seed = await dailySeed('pin-drop', dailyDate());
  const first = engine.cities.get(engine.start(seed).city)!;

  await page.goto('/#/');
  await page.locator('.daily').getByRole('link', { name: 'Pin Drop' }).click();
  const map = page.locator('.world-map');
  await expect(map).toBeVisible({ timeout: 20_000 });
  // Today's city for everyone, with no setup screen.
  await expect(page.locator('.pin-prompt')).toContainText(first.name);
  const box = (await map.boundingBox())!;

  await page.mouse.click(box.x + 8, box.y + box.height * 0.5);
  const result = page.locator('.route-summary-title');
  await expect(result).toContainText('km off');
  const before = await result.innerText();
  await page.reload();
  // The pin from before the reload still counts: same result, not a fresh start.
  await expect(result).toHaveText(before, { timeout: 20_000 });

  for (let i = 0; i < 20; i++) {
    const final = page.getByRole('button', { name: 'See final score' });
    if (await final.isVisible()) {
      await final.click();
      break;
    }
    const next = page.getByRole('button', { name: 'Next city' });
    if (await next.isVisible()) await next.click();
    await page.mouse.click(box.x + 8, box.y + box.height * 0.5);
    await expect(final.or(next)).toBeVisible();
  }
  await expect(page.locator('.daily-share-line')).toHaveText(/^[🎯🟩🟧🟥]+$/u);

  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toContain('Pin Drop:');
  expect(shared).not.toContain(first.name);

  await page.reload();
  await expect(page.locator('.big-score')).toBeVisible();
  await expect(page.locator('.world-map')).toHaveCount(0);
});

test('great circle: name the countries on the line, in any order, until the lives run out', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const { puzzles } = await loadGreatCircles();
  const engine = createGreatCircle({ puzzles, countries: queryCountries(), rounds: 20 });
  const nameOf = (id: string) => countries.find((c) => c.id === id)!.name;
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const { puzzle } = state;

  await openGame(page, 'great-circle');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });

  // The line, its two ends and one blank per country; no names given away.
  await expect(page.locator('.route-end')).toHaveText([puzzle.from.name, puzzle.to.name]);
  await expect(page.locator('.gc-line')).toHaveAttribute('d', /.{10}/);
  await expect(page.locator('.gc-slots li')).toHaveCount(puzzle.via.length);
  await expect(page.locator('.gc-slots')).not.toContainText(nameOf(puzzle.via[0]!));
  // Only the two end countries are drawn: no other border is in the page at all.
  await expect(page.locator('.world-map .map-country')).toHaveCount(2);
  await expect(page.locator('.map-label')).toHaveCount(0);

  // A wrong country costs a life, and the same one again doesn't.
  const wrong = countries.find(
    (c) => queryCountries().includes(c) && !puzzle.via.includes(c.id) && c.id !== puzzle.from.countryId && c.id !== puzzle.to.countryId,
  )!;
  await input.fill(wrong.name);
  await input.press('Enter');
  state = engine.guess(state, wrong.id).state;
  await expect(page.locator('.route-message')).toContainText(`doesn't cross ${wrong.name}`);
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(4);

  // Last country first: the order doesn't matter, and each lands in its place along the line.
  for (const id of [...puzzle.via].reverse()) {
    await input.fill(nameOf(id));
    await input.press('Enter');
    state = engine.guess(state, id).state;
  }
  await expect(page.locator('.gc-slots li').first()).toContainText(nameOf(puzzle.via[0]!));
  await expect(page.locator('.route-summary.solved')).toContainText('Level 1 cleared!');
  await expect(page.locator('.bonus-life')).toHaveCount(0);
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);
  await expect(page.locator('.route-status')).toContainText('Level 2 of 20');

  // Skips use up the lives, and the run ends.
  while (state.status !== 'over') {
    if (state.status === 'level-clear') {
      await page.getByRole('button', { name: 'Next level' }).click();
      state = engine.nextLevel(state);
    }
    await page.getByRole('button', { name: /Skip country/ }).click();
    state = engine.skip(state);
  }
  await expect(page.locator('.route-summary.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toHaveText(String(state.score));
  await expect(page.getByText(`You reached level ${state.level} of 20.`)).toBeVisible();
});

test('mystery country: wrong guesses give clues, and running out ends the run', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const pool = queryCountries();
  const engine = createMysteryCountry({ countries: pool, rounds: 20 });
  let state = engine.start(Math.floor(0.5 * 2 ** 32));

  await openGame(page, 'mystery-country');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.route-status')).toContainText('Level 1 of 20');
  await expect(page.locator('.mystery-left')).toHaveText('6');
  // Nothing is drawn before the first guess: no borders, and no sign of the answer.
  await expect(page.locator('.world-map .map-country')).toHaveCount(0);
  await expect(page.locator('.mystery-clues')).toHaveCount(0);

  const guess = async (name: string) => {
    await input.fill(name);
    await input.press('Enter');
  };
  const wrongs = pool.filter((c) => c.id !== state.target && c.subregion !== getCountry(state.target)!.subregion).slice(0, 5);
  await guess(wrongs[0]!.name);
  await expect(page.locator('.mystery-row:not(.mystery-head)')).toHaveCount(1);
  await expect(page.locator('.mystery-row:not(.mystery-head)')).toContainText(wrongs[0]!.name);
  await expect(page.locator('.mystery-left')).toHaveText('5');
  await expect(page.locator('.world-map .map-country')).toHaveCount(1);
  await expect(page.locator('.mystery-clues')).toHaveCount(0);

  // More clues as the guesses go, without naming the answer.
  await guess(wrongs[1]!.name);
  const target = getCountry(state.target)!;
  await expect(page.locator('.mystery-clues')).toContainText(target.landlocked ? 'Landlocked' : 'Has a coast');
  await guess(wrongs[2]!.name);
  await expect(page.locator('.mystery-clues')).toContainText(target.subregion!);
  await expect(page.locator('.mystery-clues')).not.toContainText('Capital');
  await guess(wrongs[3]!.name);
  await guess(wrongs[4]!.name);
  await expect(page.locator('.mystery-clues')).toContainText(`Capital: ${target.capitals[0]}`);
  await expect(page.locator('.mystery-left')).toHaveText('1');

  // Right on the last guess: the fewest points, and on to the next level.
  await guess(target.name);
  await expect(page.locator('.route-summary.solved')).toContainText(`It's ${target.name}!`);
  for (const w of wrongs) state = engine.guess(state, w.id).state;
  state = engine.guess(state, target.id).state;
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);
  await expect(page.locator('.route-status')).toContainText('Level 2 of 20');
  await expect(page.locator('.mystery-row')).toHaveCount(0);

  // Six wrong guesses end the run and reveal the country.
  const next = getCountry(state.target)!;
  const misses = pool.filter((c) => c.id !== next.id).slice(0, 6);
  for (const w of misses) await guess(w.name);
  await expect(page.locator('.route-summary.failed')).toContainText(`It was ${next.name}.`);
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toHaveText(String(state.score));
  await expect(page.getByText('You reached level 2 of 20.')).toBeVisible();
});

test('border blitz: name every neighbour against the clock; a wrong answer costs a life for the run, and time', async ({ page }) => {
  test.slow();
  await page.clock.install();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createBorderBlitz({ countries: routeCountries(), rounds: 20 });
  const nameOf = (id: string) => getCountry(id)!.name;
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const target = state.target;

  await openGame(page, 'border-blitz');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.route-status')).toContainText('Level 1 of 20');
  await expect(page.locator('.blitz-prompt')).toContainText(`Name every neighbour of ${nameOf(target)}`);
  await expect(page.locator('.blitz-prompt')).toContainText(`0 of ${state.neighbours.length} found`);
  // Only the country itself is drawn: no borders, and no neighbour named anywhere.
  await expect(page.locator('.world-map .map-country')).toHaveCount(1);
  await expect(page.locator('.map-label')).toHaveText([nameOf(target)]);
  await expect(page.locator('.blitz-slots li')).toHaveCount(state.neighbours.length);
  await expect(page.locator('.blitz-slots')).toHaveText(/^\?+$/);

  const guess = async (id: string) => {
    await input.fill(nameOf(id));
    await input.press('Enter');
    state = engine.guess(state, id).state;
  };
  const seconds = async () => Number((await page.locator('.blitz-clock-text').textContent())!.replace(' s', ''));

  // A wrong country costs a life and two seconds; the country itself is free.
  const wrong = queryCountries().find((c) => c.id !== target && !state.neighbours.includes(c.id) && !engine.throughTerritory(target, c.id))!;
  const before = await seconds();
  await guess(wrong.id);
  await expect(page.locator('.route-message')).toContainText(`${wrong.name} doesn't border ${nameOf(target)}`);
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(2);
  expect(await seconds()).toBeLessThanOrEqual(before - 2);
  await input.fill(nameOf(target));
  await input.press('Enter');
  await expect(page.locator('.route-message')).toContainText('itself');
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(2);

  // Every neighbour, in any order: each is drawn as it's found.
  for (const id of [...state.neighbours].reverse()) await guess(id);
  await expect(page.locator('.route-summary.solved')).toContainText('Level 1 cleared!');
  await expect(page.locator('.blitz-slots .slot-found')).toHaveCount(state.neighbours.length);
  // Not flawless, so no bonus; the seconds left are banked as points.
  await expect(page.locator('.bonus-life')).toHaveCount(0);
  const spare = Number((await page.locator('.route-summary').getByText(/s to spare/).textContent())!.match(/(\d+) s to spare/)![1]);
  state = engine.claimTime(state, spare);
  await expect(page.locator('.route-summary')).toContainText(`+${spare * 2}`);
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);
  await expect(page.locator('.route-status')).toContainText('Level 2 of 20');
  // Lives carry over: the one lost on level 1 stays lost.
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(2);

  // One neighbour, then the clock runs out: the run ends and shows what was missed.
  await guess(state.neighbours[0]!);
  await expect(page.locator('.blitz-prompt')).toContainText(`1 of ${state.neighbours.length} found`);
  await page.clock.fastForward('02:00');
  state = engine.timeout(state);
  await expect(page.locator('.route-summary.failed')).toContainText("Time's up!");
  await expect(page.locator('.route-summary')).toContainText(nameOf(state.neighbours[1]!));
  // Every missed neighbour is named on the map, however close the names sit.
  const missed = state.neighbours.slice(1).map(nameOf);
  await expect(page.locator('.blitz-missed-label, .city-marker.marker-outside')).toHaveCount(missed.length);
  expect((await page.locator('.blitz-missed-label, .city-marker.marker-outside').allTextContents()).sort()).toEqual([...missed].sort());
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toHaveText(String(state.score));
  await expect(page.getByText('You reached level 2 of 20.')).toBeVisible();
});

test('border blitz: lives earned back, the count hidden from level 11, giving up, and the answers in view', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install();
  await page.addInitScript(() => {
    Math.random = () => 0.25;
  });
  const engine = createBorderBlitz({ countries: routeCountries(), rounds: 20 });
  const nameOf = (id: string) => getCountry(id)!.name;
  let state = engine.start(Math.floor(0.25 * 2 ** 32));

  await openGame(page, 'border-blitz');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  // The answers sit beside the map, above the fold.
  const slots = (await page.locator('.blitz-slots').boundingBox())!;
  expect(slots.y + 40).toBeLessThan(900);

  // Ten flawless levels: lives grow from 3 to the cap of 5.
  for (let level = 1; level <= 10; level++) {
    for (const id of state.neighbours) {
      await input.fill(nameOf(id));
      await input.press('Enter');
      state = engine.guess(state, id).state;
    }
    await expect(page.locator('.route-summary.solved')).toContainText(`Level ${level} cleared!`);
    await expect(page.locator('.bonus-life')).toContainText('Flawless!');
    await page.getByRole('button', { name: 'Next level' }).click();
    state = engine.nextLevel(state);
  }
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(5);

  // Level 11: no count and no blank tiles, only what's found.
  await expect(page.locator('.route-status')).toContainText('Level 11 of 20');
  await expect(page.locator('.blitz-count')).not.toContainText(/\d+ of \d+/);
  await expect(page.locator('.blitz-slots li')).toHaveCount(0);
  await input.fill(nameOf(state.neighbours[0]!));
  await input.press('Enter');
  await expect(page.locator('.blitz-slots li')).toHaveCount(1);

  // Giving up ends the run at once and shows what was missed.
  await page.getByRole('button', { name: 'Give up' }).click();
  await expect(page.locator('.route-summary.failed')).toContainText('You gave up.');
  await expect(page.locator('.blitz-slots li')).toHaveCount(state.neighbours.length);
});

test('border blitz: territory owners are free, microstates get a dot, and a saved clock carries on', async ({ page }) => {
  test.slow();
  const engine = createBorderBlitz({ countries: routeCountries(), rounds: 20 });
  /** A seed whose first level asks `id`; Math.random is pinned so the game picks it. */
  const seedFor = (id: string) => {
    for (let s = 1; ; s++) if (engine.start(s).target === id) return s;
  };
  const startWith = async (seed: number, before?: string) => {
    await page.addInitScript(
      ([r, clock]) => {
        Math.random = () => r;
        // Not on about:blank, which has no storage.
        if (clock && location.protocol.startsWith('http')) localStorage.setItem('geogames:border-blitz-clock', clock);
      },
      [seed / 2 ** 32, before ?? ''] as const,
    );
    // A fresh page load each time: going to the same hash wouldn't reload the app.
    await page.goto('about:blank');
    await openGame(page, 'border-blitz');
    await page.getByRole('button', { name: 'Start game' }).click();
    // The prompt, not the input: with a deadline already passed, the level ends at once.
    await expect(page.locator('.blitz-prompt')).toBeVisible({ timeout: 20_000 });
  };
  const name = async (country: string) => {
    await page.getByRole('combobox').fill(country);
    await page.getByRole('combobox').press('Enter');
  };

  // Spain: the UK meets it only at Gibraltar, so naming it is a free pass.
  await startWith(seedFor('ESP'));
  await expect(page.locator('.blitz-prompt')).toContainText('Spain');
  await name('United Kingdom');
  await expect(page.locator('.route-message')).toContainText('only through Gibraltar');
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(3);

  // Switzerland: Liechtenstein is too small to see, so it's drawn as a labelled dot.
  await startWith(seedFor('CHE'));
  await name('Liechtenstein');
  await expect(page.locator('.city-marker.marker-found')).toHaveText('Liechtenstein');
  await expect(page.locator('.map-label')).not.toContainText(['Liechtenstein']);

  // A deadline saved for this level that has already passed: time's up at once, no fresh clock.
  const seed = seedFor('BEL');
  await startWith(seed, JSON.stringify({ seed, level: 1, at: Date.now() - 1000 }));
  await expect(page.locator('.route-summary.failed')).toContainText("Time's up!");
});

test('daily challenge: mystery country resumes after a reload and shares without spoilers', async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pool = queryCountries();
  const engine = createMysteryCountry({ countries: pool, rounds: 20 });
  const seed = await dailySeed('mystery-country', dailyDate());
  const first = getCountry(engine.start(seed).target)!;

  await page.goto('/#/');
  await page.locator('.daily').getByRole('link', { name: 'Mystery Country' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });

  const wrong = pool.filter((c) => c.id !== first.id).slice(0, 6);
  await input.fill(wrong[0]!.name);
  await input.press('Enter');
  await expect(page.locator('.mystery-left')).toHaveText('5');
  await page.reload();
  // The guess from before the reload still counts.
  await expect(page.locator('.mystery-left')).toHaveText('5', { timeout: 20_000 });
  await expect(page.locator('.mystery-row:not(.mystery-head)')).toContainText(wrong[0]!.name);

  // Solve it in two, then lose the next level.
  await input.fill(first.name);
  await input.press('Enter');
  await page.getByRole('button', { name: 'Next level' }).click();
  const second = getCountry(engine.nextLevel(engine.guess(engine.guess(engine.start(seed), wrong[0]!.id).state, first.id).state).target)!;
  for (const w of pool.filter((c) => c.id !== second.id).slice(0, 6)) {
    await input.fill(w.name);
    await input.press('Enter');
  }
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.daily-share-line')).toHaveText('2️⃣🟥');

  await page.getByRole('button', { name: 'Copy result' }).click();
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toContain('Mystery Country:');
  expect(shared).not.toContain(first.name);
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

test('halfway: misses are free until the third, a skip costs a life, and the run ends with the lives', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createHalfway(await halfwayPools());
  const cityNamed = (name: string) => [...engine.cities.values()].filter((c) => c.name === name).sort((a, b) => b.population - a.population)[0]!;
  const nameOf = (id: string) => engine.cities.get(id)!.name;
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const { level } = state;
  // Cities far from most midpoints, unique enough to type.
  const far = ['Sydney', 'Lima', 'Santiago', 'Johannesburg', 'Auckland', 'Honolulu', 'Anchorage', 'Perth'].map(cityNamed);
  const farFrom = (s: typeof state) => far.filter((c) => distanceKm(c.latlng, s.level.midpoint) > 3000);
  const lives = page.locator('.lives .life:not(.lost)');

  await openGame(page, 'halfway');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });

  // The two cities and the line between them; no borders, no midpoint, no answer.
  await expect(page.locator('.route-end')).toHaveText([nameOf(level.from), nameOf(level.to)]);
  await expect(page.locator('.gc-line')).toHaveAttribute('d', /.{10}/);
  await expect(page.locator('.world-map .map-country')).toHaveCount(0);
  await expect(page.locator('.halfway-mid, .circle-area')).toHaveCount(0);
  await expect(page.locator('.route-status')).toContainText('Within 300 km');
  expect(await page.content()).not.toContain(nameOf(level.fair[0]!));

  // A far city: free, but it says how far it was and puts its dot on the map.
  const miss = farFrom(state)[0]!;
  await input.fill(miss.name);
  await input.press('Enter');
  state = engine.guess(state, miss.id).state;
  const missKm = new Intl.NumberFormat('en').format(Math.round(state.level.guesses[0]!.km));
  await expect(page.locator('.route-message')).toContainText(`${miss.name} is ${missKm} km from the midpoint`);
  await expect(page.locator('.route-message')).toContainText('1 more free miss');
  await expect(lives).toHaveCount(3);
  await expect(page.locator('.halfway-misses')).toHaveText('1');
  await expect(page.locator('.marker-outside text')).toContainText(miss.name);
  await expect(page.locator('.halfway-guesses')).toContainText(miss.name);

  // The nearest well-known city clears it, and the midpoint and radius appear.
  const answer = engine.cities.get(level.fair[0]!)!;
  await input.fill(answer.name);
  await input.press('Enter');
  state = engine.guess(state, answer.id).state;
  await expect(page.locator('.route-summary.solved')).toContainText(`${answer.name} is`);
  await expect(page.locator('.route-summary.solved')).toContainText(`from the midpoint! +${state.level.points}`);
  await expect(page.locator('.halfway-mid')).toHaveCount(1);
  await expect(page.locator('.circle-area')).toHaveCount(1);
  // Every nearby city's dot has its name.
  const nearbyDots = await page.locator('.marker-nearby circle').count();
  expect(nearbyDots).toBeGreaterThan(0);
  await expect(page.locator('.marker-nearby text')).toHaveCount(nearbyDots);
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);
  await expect(page.locator('.route-status')).toContainText('Level 2');
  await expect(page.locator('.route-end')).toHaveText([nameOf(state.level.from), nameOf(state.level.to)]);

  // A skip costs a life, ends the level and shows the answer.
  await page.getByRole('button', { name: /Skip/ }).click();
  state = engine.skip(state);
  await expect(page.locator('.route-summary.failed')).toContainText('Skipped: −1 ♥');
  await expect(page.locator('.route-summary.failed')).toContainText('You could have said');
  await expect(page.locator('.halfway-mid')).toHaveCount(1);
  await expect(lives).toHaveCount(state.lives);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Three misses cost one life between them, then the next level starts.
  for (const city of farFrom(state).slice(0, 3)) {
    await input.fill(city.name);
    await input.press('Enter');
    state = engine.guess(state, city.id).state;
  }
  expect(state.status).toBe('level-over');
  await expect(page.locator('.route-summary.failed')).toContainText('3 misses: −1 ♥');
  await expect(lives).toHaveCount(state.lives);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Skips until the lives are gone.
  while (state.status !== 'over') {
    if (state.status === 'level-over') {
      await page.getByRole('button', { name: 'Next level' }).click();
      state = engine.nextLevel(state);
    }
    await page.getByRole('button', { name: /Skip/ }).click();
    state = engine.skip(state);
  }
  await expect(page.locator('.route-summary.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toBeVisible();
  await expect(page.locator('.eyebrow')).toContainText('Game over');
  await expect(page.getByText(`You reached level ${state.level.number}.`)).toBeVisible();
  // Nothing to set up for Halfway, so no "Change settings".
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change settings' })).toHaveCount(0);
});

test('halfway: with the names hidden, the two cities can be typed but count as a plain miss, and the run goes past 20', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createHalfway(await halfwayPools());
  const typed = (id: string) => {
    const c = engine.cities.get(id)!;
    return `${c.name}, ${getCountry(c.countryId)!.name}`;
  };
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  await openGame(page, 'halfway');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });
  while (state.level.number < 16) {
    await input.fill(typed(state.level.fair[0]!));
    await input.press('Enter');
    await page.getByRole('button', { name: 'Next level' }).click();
    state = engine.nextLevel(engine.guess(state, state.level.fair[0]!).state);
  }
  await expect(page.locator('.route-end')).toHaveText(['?', '?']);
  const end = engine.cities.get(state.level.from)!;
  await expect(page.locator('.world-map')).not.toContainText(end.name);
  // The hidden city is offered like any other, and naming it is a normal far guess: a free miss.
  await input.fill(end.name);
  await expect(page.getByRole('option').first()).toContainText(end.name);
  await input.fill(typed(end.id));
  await input.press('Enter');
  state = engine.guess(state, end.id).state;
  await expect(page.locator('.route-message')).toContainText(`${end.name} is`);
  await expect(page.locator('.halfway-misses')).toHaveText('1');
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(state.lives);

  // No last level: the run goes on past 20.
  while (state.level.number < 21) {
    await input.fill(typed(state.level.fair[0]!));
    await input.press('Enter');
    await page.getByRole('button', { name: 'Next level' }).click();
    state = engine.nextLevel(engine.guess(state, state.level.fair[0]!).state);
  }
  await expect(page.locator('.route-status')).toContainText('Level 21');
  await expect(page.locator('.route-status')).toContainText('Within 120 km');
  await expect(page.locator('.route-end')).toHaveText(['?', '?']);
});

/** Picks a time on the Clockwork picker: the hour button, then the minute chip. */
async function pickTime(page: Page, minutes: number) {
  await page.locator('.clock-hour').nth(Math.floor(minutes / 60)).click();
  await page.locator('.clock-minute').nth((minutes % 60) / 15).click();
  await expect(page.locator('.clock-chosen')).toContainText(`= ${formatClock(minutes)}`);
}

test('clockwork: pick the local time; earlier or later after a miss, a skip costs a life, and the run ends with the lives', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createClockwork({ countries: clockworkCountries() });
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const nameOf = (s: ClockState) => {
    const place = clockPlace(s.level.place);
    return place.city ? `${place.city.name}, ${getCountry(place.country)!.name}` : getCountry(place.country)!.name;
  };
  const lives = page.locator('.lives .life:not(.lost)');
  const check = page.getByRole('button', { name: 'Check' });

  await openGame(page, 'clockwork');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Change settings/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.clock-hour')).toHaveCount(24, { timeout: 20_000 });

  // The question, the place lit up, no text box, and no answer in the page.
  const utc = formatClock(state.level.utcHour * 60);
  await expect(page.locator('.clock-given')).toHaveText(`It’s ${utc} UTC on ${CLOCK_DATES[state.level.date]!.label}.`);
  await expect(page.locator('.clock-question')).toContainText(nameOf(state));
  await expect(page.locator('.world-map .map-country')).toHaveCount(1);
  await expect(page.locator('.clock-meridian')).toHaveCount(24);
  await expect(page.locator('.clock-answer')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  // The UTC hour is marked as the reference; nothing is chosen yet, so Check waits.
  await expect(page.locator('.clock-hour-utc')).toHaveText(utc.slice(0, 2));
  await expect(check).toBeDisabled();

  // An hour tap means :00, and the time shows with the offset it implies.
  const late = (state.level.answer + 60) % 1440;
  await page.locator('.clock-hour').nth(Math.floor(late / 60)).click();
  await expect(page.locator('.clock-chosen')).toContainText(`= ${formatClock(Math.floor(late / 60) * 60)}`);
  await pickTime(page, late);
  await check.click();
  state = engine.guess(state, late).state;
  await expect(page.locator('.route-message')).toContainText(`It’s earlier than ${formatClock(late)}. 1 more free miss.`);
  await expect(page.locator('.clock-misses')).toHaveText('1');
  await expect(page.locator('.clock-hour').nth(Math.floor(late / 60))).toHaveClass(/tried/);
  await expect(page.locator('.clock-hour').nth(Math.floor(late / 60))).toContainText('↓');
  await expect(lives).toHaveCount(3);
  await expect(check).toBeDisabled();

  // The right time clears it, not flawless after a miss.
  await pickTime(page, state.level.answer);
  await check.click();
  state = engine.guess(state, state.level.answer).state;
  await expect(page.locator('.route-summary.solved')).toContainText(`Right! ${formatClock(state.level.answer)}`);
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  await expect(page.locator('.clock-guesses')).toContainText('↓ earlier');
  await expect(page.locator('.bonus-life')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // A skip costs a life and shows the answer.
  await expect(page.locator('.clock-question')).toContainText(nameOf(state));
  await page.getByRole('button', { name: /Skip/ }).click();
  state = engine.skip(state);
  await expect(page.locator('.route-summary.failed')).toContainText('Skipped: −1 ♥');
  await expect(page.locator('.clock-answer')).toContainText(`It’s ${formatClock(state.level.answer)} in ${nameOf(state)}`);
  await expect(lives).toHaveCount(2);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Three misses cost one life, no more.
  for (let i = 1; i <= 3; i++) {
    const wrong = (state.level.answer + 120 * i) % 1440;
    await pickTime(page, wrong);
    await check.click();
    state = engine.guess(state, wrong).state;
  }
  await expect(page.locator('.route-summary.failed')).toContainText('3 misses: −1 ♥');
  await expect(lives).toHaveCount(1);
  await page.getByRole('button', { name: 'Next level' }).click();

  // The last life goes, and the run ends.
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page.locator('.route-summary.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.getByText('Game over')).toBeVisible();
  await expect(page.getByText('You reached level 4.')).toBeVisible();
});

test('clockwork: plays from the keyboard, and everything fits with no scroll on desktop and phone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createClockwork({ countries: clockworkCountries() });
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  await openGame(page, 'clockwork');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.clock-hour')).toHaveCount(24, { timeout: 20_000 });
  const chosen = page.locator('.clock-chosen');
  const allInView = async () => {
    for (const part of ['.route-status', '.clock-given', '.clock-question', '.map-frame', '.clock-hours', '.clock-minutes', '.clock-check', '.clock-skip']) {
      await expect(page.locator(part), part).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  };
  await allInView();

  // Arrows step from the UTC time, an hour, or 15 minutes with Shift; Escape clears.
  await page.keyboard.press('ArrowUp');
  await expect(chosen).toContainText(`= ${formatClock(state.level.utcHour * 60 + 60)}`);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(chosen).toContainText(`= ${formatClock(state.level.utcHour * 60 + 45)}`);
  await page.keyboard.press('Escape');
  await expect(chosen).toHaveText('Pick an hour');

  // Typed digits make a time; Enter checks it, and Enter again goes on.
  for (let i = 0; i < 3; i++) {
    const answer = formatClock(state.level.answer);
    await page.keyboard.type(answer.replace(':', ''));
    await expect(chosen).toContainText(`= ${answer}`);
    await page.keyboard.press('Enter');
    state = engine.guess(state, state.level.answer).state;
    await expect(page.locator('.route-summary.solved')).toContainText(`Right! ${answer}`);
    const next = page.getByRole('button', { name: 'Next level' });
    await expect(next).toBeFocused();
    await expect(page.locator('.clock-question')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.keyboard.press('Enter');
    state = engine.nextLevel(state);
    await expect(page.locator('.clock-chosen')).toHaveText('Pick an hour');
    await allInView();
  }

  // Enter on a focused Skip skips, even with a time picked: it isn't taken as a guess.
  await page.locator('.clock-hour').nth((Math.floor(state.level.answer / 60) + 3) % 24).click();
  await page.locator('.clock-skip').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.route-summary.failed')).toContainText('Skipped: −1 ♥');
  await expect(page.locator('.clock-guesses')).toHaveCount(0);
  await expect(page.locator('.lives .life:not(.lost)')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await expect(page.locator('.clock-chosen')).toHaveText('Pick an hour');

  // A phone: the same, with no scroll and no on-screen keyboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await allInView();
  const box = await page.locator('.clock-hour').first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
test('blank atlas: pick the lit-up feature from four; a wrong pick shows where it really is and costs a life, like a skip', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = await blankAtlasGame();
  const nameOf = (id: string) => engine.features.get(id)!.name;
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const lives = page.locator('.lives .life:not(.lost)');
  const options = page.locator('.atlas-option');

  await openGame(page, 'blank-atlas');
  await expect(page.getByRole('radio', { name: /Europe/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(options.first()).toBeVisible({ timeout: 20_000 });

  // The feature is lit up on shaded relief, with no borders, no text box and four names of its kind.
  const target = engine.features.get(state.level.feature)!;
  await expect(page.locator('.atlas-prompt')).toContainText(`Which ${BLANK_ATLAS_KIND_LABELS[target.kind].toLowerCase()} is lit up?`);
  await expect(page.locator('.atlas-target')).toHaveAttribute('d', /.{10}/);
  await expect(page.locator('.map-terrain')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.world-map .map-country')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(options).toHaveText(state.level.options.map((id, i) => `${i + 1}${nameOf(id)}`));

  // Key 1–4 picks: the right one gives +15 × the level and keeps lives full.
  await page.keyboard.press(String(state.level.options.indexOf(target.id) + 1));
  state = engine.guess(state, target.id).state;
  await expect(page.locator('.atlas-result.solved')).toContainText(`Right! +${state.level.points}`);
  await expect(page.locator('.option-right')).toContainText(target.name);
  await expect(page.locator('.atlas-found')).toHaveCount(1);
  await expect(page.locator('.marker-found text')).toContainText(target.name);
  await expect(page.locator('.route-status')).toContainText(`Score ${state.score}`);
  // The Next button has the focus, so Enter goes on.
  await page.keyboard.press('Enter');
  state = engine.nextLevel(state);
  await expect(page.locator('.route-status')).toContainText('Level 2');

  // A wrong pick (a tap) ends the level at once: −1 ♥, and the one picked is drawn where it really is.
  const wrong = state.level.options.find((id) => id !== state.level.feature)!;
  await options.nth(state.level.options.indexOf(wrong)).click();
  state = engine.guess(state, wrong).state;
  await expect(page.locator('.atlas-result.failed')).toContainText(`Not`);
  await expect(page.locator('.atlas-result.failed')).toContainText('shown in red');
  await expect(page.locator('.option-wrong')).toContainText(nameOf(wrong));
  await expect(page.locator('.option-right')).toContainText(nameOf(state.level.feature));
  await expect(page.locator('.atlas-guess')).toHaveCount(1);
  await expect(page.locator('.atlas-lost')).toHaveCount(1);
  await expect(page.locator('.marker-outside text')).toContainText(nameOf(wrong));
  await expect(lives).toHaveCount(2);
  await expect(options.first()).toBeDisabled();
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // A skip costs a life too and names the answer.
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page.locator('.atlas-result.failed')).toContainText('Skipped: −1 ♥');
  await expect(page.locator('.atlas-result.failed')).toContainText(nameOf(state.level.feature));
  state = engine.skip(state);
  await expect(lives).toHaveCount(1);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // A right pick gives a lost life back.
  await page.keyboard.press(String(state.level.options.indexOf(state.level.feature) + 1));
  state = engine.guess(state, state.level.feature).state;
  await expect(page.locator('.atlas-result.solved')).toContainText('+1 ♥');
  await expect(lives).toHaveCount(2);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Skips until the lives are gone.
  while (state.status !== 'over') {
    if (state.status === 'level-over') {
      await page.getByRole('button', { name: 'Next level' }).click();
      state = engine.nextLevel(state);
    }
    await page.getByRole('button', { name: /Skip/ }).click();
    state = engine.skip(state);
  }
  await expect(page.locator('.atlas-result.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.big-score')).toBeVisible();
  await expect(page.getByText(`You reached level ${state.level.number}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change settings' })).toHaveCount(0);
});

for (const [device, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`blank atlas: the question, map, options and Skip fit a ${viewport.width}×${viewport.height} ${device} screen with no scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    await openGame(page, 'blank-atlas');
    await page.getByRole('button', { name: 'Start game' }).click();
    const options = page.locator('.atlas-option');
    await expect(options.first()).toBeVisible({ timeout: 20_000 });
    const inView = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
    };
    for (const selector of ['.route-status', '.atlas-prompt', '.world-map', '.atlas-option >> nth=3', '.atlas-skip']) await inView(selector);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // Options are big enough to tap, two by two on a phone.
    const first = (await options.nth(0).boundingBox())!;
    const second = (await options.nth(1).boundingBox())!;
    const third = (await options.nth(2).boundingBox())!;
    expect(first.height).toBeGreaterThanOrEqual(44);
    if (device === 'phone') {
      expect(second.y).toBeCloseTo(first.y, 0);
      expect(third.y).toBeGreaterThan(first.y + first.height - 1);
    } else {
      expect(third.y).toBeCloseTo(first.y, 0);
    }
    // After a pick, the result and the Next button still fit.
    await page.keyboard.press('1');
    await inView('.atlas-result');
    await inView('.atlas-result .btn');
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}

test('river-run: the river draws itself, a wrong name shows that river, and a skip, the line reaching its end or 3 misses each cost a life', async ({ page }) => {
  test.slow();
  await page.clock.install();
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const data = await loadRivers();
  const engine = createRiverRun(data);
  const nameOf = (id: string) => engine.rivers.get(id)!.name;
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  // Great rivers with names no other river's starts with, to type as wrong guesses.
  const wrongFor = (s: typeof state) =>
    ['nile', 'amazon', 'volga', 'mekong', 'thames', 'murray'].filter((id) => id !== s.level.river && !s.level.guesses.some((g) => g.id === id));
  const lives = page.locator('.lives .life:not(.lost)');

  await openGame(page, 'river-run');
  await page.getByRole('button', { name: 'Start game' }).click();
  const input = page.getByRole('combobox');
  await expect(input).toBeVisible({ timeout: 20_000 });

  // The line grows from the source; no borders, and nothing names the river.
  const line = page.locator('.river-line');
  await expect(line).toHaveAttribute('d', /.{10}/);
  const early = (await line.getAttribute('d'))!.length;
  await page.clock.runFor(4000);
  await expect.poll(async () => (await line.getAttribute('d'))!.length).toBeGreaterThan(early);
  await expect(page.locator('.world-map .map-country')).toHaveCount(0);
  await expect(page.locator('.river-label')).toHaveCount(0);
  expect(await page.content()).not.toContain(nameOf(state.level.river));

  // A wrong name is free, and that river is drawn in grey.
  const miss = wrongFor(state)[0]!;
  await input.fill(nameOf(miss));
  await input.press('Enter');
  state = engine.guess(state, miss, 0.1).state;
  await expect(page.locator('.route-message')).toContainText(`Not the ${nameOf(miss)}`);
  await expect(page.locator('.route-message')).toContainText('1 more free miss');
  await expect(page.locator('.river-wrong')).toHaveCount(1);
  await expect(page.locator('.river-misses')).toHaveText('1');
  await expect(lives).toHaveCount(3);

  // The right name clears it, typed with a "River" after it, and the whole river is shown with its name and length.
  const answer = data.rivers.find((r) => r.id === state.level.river)!;
  await input.fill(`${answer.name} River`);
  await input.press('Enter');
  await expect(page.locator('.route-summary.solved')).toContainText(`The ${answer.name}, with`);
  await expect(page.locator('.route-summary.solved')).toContainText(`About ${new Intl.NumberFormat('en').format(answer.lengthKm)} km long.`);
  await expect(page.locator('.river-label')).toHaveText(answer.name);
  await expect(page.locator('.route-status')).not.toContainText('Score 0');
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(engine.guess(state, state.level.river, 0.2).state);
  await expect(page.locator('.route-status')).toContainText('Level 2');

  // A skip costs a life and names the river.
  await page.getByRole('button', { name: /Skip/ }).click();
  state = engine.skip(state);
  await expect(page.locator('.route-summary.failed')).toContainText('Skipped: −1 ♥');
  await expect(page.locator('.route-summary.failed')).toContainText(`It was the ${nameOf(state.level.river)}`);
  await expect(lives).toHaveCount(2);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Left to reach its end, the river costs a life like a skip.
  await page.clock.runFor(state.level.seconds * 1000 + 1000);
  state = engine.timeout(state);
  await expect(page.locator('.route-summary.failed')).toContainText('It reached its end unnamed: −1 ♥');
  await expect(lives).toHaveCount(1);
  await page.getByRole('button', { name: 'Next level' }).click();
  state = engine.nextLevel(state);

  // Three misses cost the last life, and the run ends.
  for (const id of wrongFor(state).slice(0, 3)) {
    await input.fill(nameOf(id));
    await input.press('Enter');
    state = engine.guess(state, id, 0.1).state;
  }
  expect(state.status).toBe('over');
  await expect(page.locator('.route-summary.failed')).toContainText('3 misses: −1 ♥');
  await expect(page.locator('.route-summary.failed')).toContainText('Out of lives');
  await page.getByRole('button', { name: 'See final score' }).click();
  await expect(page.locator('.eyebrow')).toContainText('Game over');
  await expect(page.getByText('You reached level 4.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change settings' })).toHaveCount(0);
});

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`river-run (${label}): four names from half drawn, keys 1–4 pick, and it all fits with no scrolling`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(viewport);
    await page.clock.install();
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    const data = await loadRivers();
    const engine = createRiverRun(data);
    const seed = Math.floor(0.5 * 2 ** 32);
    let state = engine.start(seed);
    const lives = page.locator('.lives .life:not(.lost)');
    const inView = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
    };

    await openGame(page, 'river-run');
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.getByRole('combobox')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.river-choices')).toHaveCount(0);
    for (const selector of ['.route-status', '.world-map', '[role=combobox]']) await inView(selector);

    // Past half drawn, four real names, each a big enough target, with everything still in view.
    await page.clock.runFor(state.level.seconds * 550);
    const options = page.locator('.river-choice');
    await expect(options).toHaveCount(4);
    const choices = riverChoices(data.rivers, state.level.river, 1, seed);
    await expect(options).toHaveText(choices.map((id) => new RegExp(engine.rivers.get(id)!.name)));
    for (let i = 0; i < 4; i++) expect((await options.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const selector of ['.route-status', '.world-map', '[role=combobox]', '.river-choices', '.arcade-actions']) await inView(selector);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (label === 'phone') expect((await page.locator('.world-map').boundingBox())!.height).toBeGreaterThan(280);

    // The right key: half points, and Enter goes on.
    await page.keyboard.press(String(choices.indexOf(state.level.river) + 1));
    await expect(page.locator('.route-summary.solved')).toContainText('(picked: half points)');
    await inView('.route-summary');
    await expect(page.getByRole('button', { name: 'Next level' })).toBeFocused();
    await page.keyboard.press('Enter');
    state = engine.nextLevel(engine.guess(state, state.level.river, 0.55, true).state);
    await expect(page.locator('.route-status')).toContainText('Level 2');

    // A wrong pick costs the life at once.
    await page.clock.runFor(state.level.seconds * 550);
    const second = riverChoices(data.rivers, state.level.river, 2, seed);
    await expect(options).toHaveCount(4);
    await page.keyboard.press(String(second.findIndex((id) => id !== state.level.river) + 1));
    await expect(page.locator('.route-summary.failed')).toContainText('A wrong pick: −1 ♥');
    await expect(lives).toHaveCount(2);
  });
}

test('on the grid: click the coordinates; a miss shows the way, three misses or a skip cost a life, a find on the first click gives one back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const engine = createOnTheGrid({ grid: await loadLandGrid(), countries: queryCountries() });
  let state = engine.start(Math.floor(0.5 * 2 ** 32));
  const lives = page.locator('.lives .life:not(.lost)');
  const map = page.locator('.world-map.pickable');
  const inView = async () => {
    for (const part of ['.route-status', '.grid-prompt', '.map-frame', '.grid-actions, .grid-result']) await expect(page.locator(part), part).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  };
  // Where a coordinate is on the screen with the map unzoomed: the same projection WorldMap builds.
  const project = async ([lat, lng]: readonly [number, number]) => {
    const box = (await map.boundingBox())!;
    const p = geoNaturalEarth1()
      .rotate([0, 0])
      .fitExtent([[48, 48], [912, 492]], { type: 'Sphere' })([lng, lat])!;
    const s = Math.min(box.width / 960, box.height / 540);
    return { x: box.x + box.width / 2 + (p[0] - 480) * s, y: box.y + box.height / 2 + (p[1] - 270) * s };
  };

  await openGame(page, 'on-the-grid');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(map).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.grid-coords')).toHaveText(formatCoordinates(state.level.target));
  // Level 1 draws a line every 10°, with their degrees; the answer isn't in the page before it is revealed.
  expect(await page.locator('.grid-line').count()).toBeGreaterThan(20);
  await expect(page.locator('.grid-label').first()).toContainText('°');
  await expect(page.locator('.marker-found')).toHaveCount(0);
  await inView();

  // Three clicks in the Pacific edge: each shows the way and the distance, the third costs the life.
  const edge = async () => {
    const box = (await map.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + box.height * 0.5);
  };
  await edge();
  await expect(page.locator('.grid-hint')).toContainText('km off');
  await expect(page.locator('.grid-arrow')).toHaveCount(1);
  await expect(page.locator('.grid-hint')).toContainText('2 clicks left');
  await edge();
  await expect(page.locator('.grid-hint')).toContainText('Last click');
  await edge();
  await expect(page.locator('.grid-result.failed')).toContainText('Not found: −1 ♥');
  await expect(page.locator('.grid-result')).toContainText(formatCoordinates(state.level.target));
  await expect(page.locator('.marker-found text')).toHaveText(formatCoordinates(state.level.target));
  await expect(lives).toHaveCount(2);
  // Three misses or a skip end a level the same way, and the next spot comes from the same place.
  state = engine.skip(state);
  await expect(page.getByRole('button', { name: 'Next level' })).toBeFocused();
  await inView();
  await page.keyboard.press('Enter');
  state = engine.nextLevel(state);

  // Level 2: the spot's own position is a find on the first click, and gives the life back.
  await expect(page.locator('.grid-coords')).toHaveText(formatCoordinates(state.level.target));
  const at = await project(state.level.target);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.grid-result.solved')).toContainText('Found it!');
  await expect(page.locator('.grid-result')).toContainText('Flawless! +1 ♥');
  await expect(lives).toHaveCount(3);
  await page.keyboard.press('Enter');

  // A skip costs a life, and the phone fits too.
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page.locator('.grid-result.failed')).toContainText('Skipped: −1 ♥');
  await expect(lives).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.setViewportSize({ width: 390, height: 844 });
  await inView();
  const skip = (await page.getByRole('button', { name: /Skip/ }).boundingBox())!;
  expect(skip.height).toBeGreaterThanOrEqual(44);
});
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 720 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`native-tongue (${label}): the name in its own script, a wrong guess shows its own name, a skip costs a life, and it all fits with no scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Math.random = () => 0.5;
    });
    const { names } = await loadNativeNames();
    const nativeOf = new Map(names.map((n) => [n.id, n]));
    const engine = createNativeTongue({ names, countries: queryCountries() });
    let state = engine.start(Math.floor(0.5 * 2 ** 32));
    const lives = page.locator('.lives .life:not(.lost)');
    const inView = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
    };
    const guess = async (id: string) => {
      const input = page.getByRole('combobox');
      await input.fill(getCountry(id)!.name);
      await input.press('Enter');
    };

    await openGame(page, 'native-tongue');
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.locator('.tongue-name')).toHaveText(nativeOf.get(state.level.country)!.name, { timeout: 20_000 });
    for (const selector of ['.route-status', '.tongue-name', '[role=combobox]', '.tongue-skip']) await inView(selector);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // No bare map during the question; and no hint before a miss.
    await expect(page.locator('.world-map')).toHaveCount(0);
    await expect(page.locator('.tongue-hint')).toHaveText('');
    const inputBox = (await page.getByRole('combobox').boundingBox())!;
    // "Congo" offers both Congos rather than picking one.
    await page.getByRole('combobox').fill('Congo');
    await expect(page.getByRole('option').filter({ hasText: 'DR Congo' })).toHaveCount(1);
    await expect(page.getByRole('option').filter({ hasText: 'Republic of the Congo' })).toHaveCount(1);
    await page.getByRole('combobox').fill('');
    // The page never says which country it is before the end of the level.
    expect(await page.locator('.tongue-game').innerHTML()).not.toContain(getCountry(state.level.country)!.name);

    // A wrong guess shows what that country calls itself, and costs a free miss.
    const wrong = ['BRA', 'CAN', 'JPN'].find((id) => id !== state.level.country)!;
    await guess(wrong);
    await expect(page.locator('.tongue-wrong')).toContainText(getCountry(wrong)!.name);
    await expect(page.locator('.tongue-wrong')).toContainText(nativeOf.get(wrong)!.name);
    await expect(page.locator('.tongue-misses')).toHaveText('1');
    await expect(page.locator('.tongue-hint')).toHaveText(`Hint: it’s in ${nativeOf.get(state.level.country)!.language}.`);
    // The input stays where it was under the player's thumb.
    expect(await page.getByRole('combobox').boundingBox()).toEqual(inputBox);
    await inView('.tongue-wrong');
    await inView('[role=combobox]');

    // The right country: points for the second try, and Enter goes on from the focused button.
    await guess(state.level.country);
    await expect(page.locator('.route-summary.solved')).toContainText(getCountry(state.level.country)!.name);
    await inView('.route-summary');
    // The map arrives with the answer, lit up, and everything still fits.
    await inView('.world-map');
    await inView('.tongue-name');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('button', { name: 'Next level' })).toBeFocused();
    await page.keyboard.press('Enter');
    state = engine.nextLevel(engine.guess(engine.guess(state, wrong).state, state.level.country).state);
    await expect(page.locator('.route-status')).toContainText('Level 2');
    await expect(page.locator('.tongue-name')).toHaveText(nativeOf.get(state.level.country)!.name);

    // A skip costs a life, and shows the answer.
    await page.getByRole('button', { name: /Skip/ }).click();
    await expect(page.locator('.route-summary.failed')).toContainText('Skipped: −1 ♥');
    await expect(page.locator('.route-summary.failed')).toContainText(getCountry(state.level.country)!.name);
    await expect(lives).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Change settings' })).toHaveCount(0);

    // Out of lives ends the run.
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Next level' }).click();
      await page.getByRole('button', { name: /Skip/ }).click();
    }
    await expect(page.getByRole('button', { name: 'See final score' })).toBeVisible();
  });
}
