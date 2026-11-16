import { GAMES } from '@geogames/games';
import { expect, test } from './fixtures.ts';

const GROUP_TITLES = ['Map games', 'Routes & borders', 'Cities', 'Quick quizzes'];

test('home shows today\'s dailies and the four groups with every game', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Today's daily challenges" })).toBeVisible();
  await expect(page.locator('.daily-games a')).toHaveCount(4);
  const headings = await page.locator('.group-title').allTextContents();
  expect(headings).toEqual(GROUP_TITLES);
  await expect(page.locator('.game-card')).toHaveCount(GAMES.length);
  const mapGames = page.locator('.game-group').first().locator('.game-card h2');
  await expect(mapGames).toHaveText(['Pin Drop', 'Blank Atlas', 'River Run', 'On the Grid']);
});

test('desktop header: Games menu, Daily, About, keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('.nav-toggle')).toBeHidden();
  const games = page.getByRole('button', { name: /^Games/ });
  await expect(games).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#games-panel')).toBeHidden();
  await games.click();
  await expect(games).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#games-panel').getByRole('heading')).toHaveText(GROUP_TITLES);
  // Esc closes it and keeps focus on the button.
  await page.keyboard.press('Escape');
  await expect(page.locator('#games-panel')).toBeHidden();
  await expect(games).toBeFocused();
  // Keyboard: ArrowDown opens and focuses the first game; Enter follows it.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#games-panel a').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/play\/pin-drop$/);
  await expect(page).toHaveTitle('Pin Drop · GeoGames');
  await expect(page.locator('#games-panel')).toBeHidden();
  await page.getByRole('link', { name: 'About' }).first().click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page).toHaveTitle('About · GeoGames');
  await page.getByRole('link', { name: 'Daily', exact: true }).click();
  await expect(page).toHaveURL(/#\/daily$/);
  await expect(page).toHaveTitle('Daily challenges · GeoGames');
  await expect(page.getByRole('heading', { level: 1, name: 'Daily challenges' })).toBeVisible();
  await expect(page.locator('.daily-card')).toHaveCount(4);
  await expect(page.locator('.daily-card .daily-status').first()).toHaveText('Not played yet today');
  await page.locator('.daily-card').first().getByRole('link', { name: 'Play' }).click();
  await expect(page).toHaveURL(/#\/daily\/border-route$/);
  await page.getByRole('link', { name: '← All daily challenges' }).click();
  await expect(page).toHaveURL(/#\/daily$/);
  await page.getByRole('link', { name: /GeoGames/ }).first().click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.account-slot')).toBeVisible();
});

test('phone: links fold into an accessible hamburger menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#site-nav')).toBeHidden();
  await toggle.click();
  const close = page.getByRole('button', { name: 'Close menu' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#site-nav')).toBeVisible();
  await expect(page.locator('#site-nav').getByRole('link', { name: 'About' })).toBeVisible();
  await expect(page.locator('#site-nav').getByRole('link', { name: 'Blank Atlas' })).toBeVisible();
  const box = await close.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  // Esc closes it and returns focus to the button.
  await page.keyboard.press('Escape');
  await expect(page.locator('#site-nav')).toBeHidden();
  await expect(toggle).toBeFocused();
  // Following a link closes it.
  await toggle.click();
  await page.locator('#site-nav').getByRole('link', { name: 'Blank Atlas' }).click();
  await expect(page).toHaveURL(/#\/play\/blank-atlas$/);
  await expect(page.locator('#site-nav')).toBeHidden();
  await expect(page).toHaveTitle('Blank Atlas · GeoGames');
});

for (const [path, heading, title] of [
  ['about', 'About GeoGames', 'About · GeoGames'],
  ['privacy', 'Privacy policy', 'Privacy policy · GeoGames'],
  ['terms', 'Terms of use', 'Terms of use · GeoGames'],
  ['contact', 'Contact', 'Contact · GeoGames'],
] as const) {
  test(`#/${path} loads`, async ({ page }) => {
    await page.goto(`/#/${path}`);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page).toHaveTitle(title);
    if (path === 'privacy' || path === 'terms') {
      await expect(page.getByText('Draft – to be reviewed')).toBeVisible();
      await expect(page.getByText('[Operator name]').first()).toBeVisible();
    }
    if (path === 'about') await expect(page.getByText('World Bank World Development Indicators')).toBeVisible();
    if (path === 'contact') await expect(page.getByLabel('Your message')).toBeVisible();
  });
}

test('footer links reach the info pages', async ({ page }) => {
  await page.goto('/');
  await page.locator('.footer').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await page.locator('.footer').getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/#\/terms$/);
});

test('no horizontal scroll at 390px on home and info pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['', 'daily', 'about', 'privacy', 'terms', 'contact']) {
    await page.goto(`/#/${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `#/${path}`).toBeLessThanOrEqual(0);
  }
  await page.getByRole('button', { name: 'Open menu' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'open menu').toBeLessThanOrEqual(0);
});
