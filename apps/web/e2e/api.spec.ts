// Runs against the real API (`npm run dev:api`, real migrations, in-memory
// Postgres) with the web app in API mode. Every test has a fresh browser, so a
// fresh anonymous player. The dev API's made-up sign-in stands in for Google:
// it keeps the player id, as linking Google does.
import { test as plainTest } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// Follows playwright.config.ts: E2E_PORT_BASE moves every test port.
const API = `http://localhost:${Number(process.env.E2E_PORT_BASE ?? 5319) + 2}/api`;

/** Plays a capitals game: picks the first option until the three lives are gone. */
async function playCapitals(page: import('@playwright/test').Page) {
  await page.goto('/#/play/capitals');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.quiz-option').first()).toBeVisible({ timeout: 15_000 });
  const over = page.locator('.big-score');
  while (!(await over.isVisible())) {
    const option = page.locator('.quiz-option:enabled').first();
    if (await option.isVisible()) await option.click().catch(() => {});
    await page.waitForTimeout(150);
  }
  return Number(await over.innerText());
}

/** What "Sign in with Google" does in dev builds (createDevAuth); the page reloads as after the redirect. */
async function signInDev(page: import('@playwright/test').Page) {
  await page.evaluate(() => localStorage.setItem('geogames:dev-google', 'true'));
  await page.reload();
}

test('a game runs on a server seed, and its verified score reaches the global leaderboard once the player signs in', async ({ page }) => {
  test.slow();
  const sessions: { seed: number }[] = [];
  page.on('response', async (res) => {
    if (res.url().endsWith('/sessions') && res.status() === 201) sessions.push(await res.json());
  });
  const finishes: { score: number }[] = [];
  page.on('response', async (res) => {
    if (res.url().endsWith('/finish') && res.status() === 200) finishes.push(await res.json());
  });

  await page.goto('/#/');
  const shown = await playCapitals(page);
  await expect.poll(() => finishes.length).toBe(1);
  expect(sessions).toHaveLength(1);
  // What the page shows is what the server computed by replaying.
  expect(finishes[0]!.score).toBe(shown);
  await expect(page.locator('.score-notice')).toHaveCount(0);

  // Rename, then find the score on the public leaderboard.
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  const name = `Tester ${Math.floor(Math.random() * 1e6)}`;
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Display name').blur();
  await expect.poll(async () => (await page.request.get(`${API}/health`)).ok()).toBe(true);
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Global' }).click();
  // Anonymous players aren't on global leaderboards...
  await expect(page.getByText('Global leaderboards show players who signed in')).toBeVisible();
  await expect(page.locator('.scores li').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Your best' }).click();
  await expect(page.locator('.scores li').first()).toContainText(String(shown));

  // ...until they sign in, with the games they played before.
  await signInDev(page);
  await page.getByRole('tab', { name: 'Global' }).click();
  await expect(page.getByText('Global leaderboards show players who signed in')).toHaveCount(0);
  if (shown > 0) {
    await expect(page.locator('.scores li').filter({ hasText: name })).toContainText(String(shown));
  }
});

test('plays are unlimited, and nothing mentions plans', async ({ page }) => {
  test.slow();
  for (let plays = 6; plays > 0; plays--) {
    await page.goto('/#/');
    await page.goto('/#/play/capitals');
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.locator('.quiz-option').first()).toBeVisible();
  }
  await page.goto('/#/');
  await page.reload();
  await expect(page.locator('body')).not.toContainText(/premium|plays left|free plays/i);
});

// Without the error-checking fixture: browsers log every error status to the console.
plainTest('an offensive display name is refused, and the old one kept', async ({ page }) => {
  await page.goto('/#/scores/capitals');
  const input = page.getByLabel('Display name');
  const before = await input.inputValue();
  await input.fill('Sh1thead');
  await input.blur();
  await expect(page.getByRole('alert')).toContainText('That name isn’t allowed');
  await expect(input).toHaveValue(before);
  await input.fill('Nice Name');
  await input.blur();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.topbar')).toContainText('Nice Name');
});

test('the daily challenge is the same run for everyone', async ({ browser }) => {
  test.slow();
  const ends = async (page: import('@playwright/test').Page) => {
    await page.goto('/#/daily/border-route');
    await expect(page.getByRole('combobox')).toBeVisible({ timeout: 15_000 });
    return page.locator('.route-end').allTextContents();
  };
  const first = await browser.newContext();
  const second = await browser.newContext();
  const alice = await first.newPage();
  const bob = await second.newPage();
  const routeOfAlice = await ends(alice);
  expect(await ends(bob)).toEqual(routeOfAlice);
  await first.close();
  await second.close();
});

plainTest('the daily challenge asks to try again when the server is unreachable, and recovers', async ({ page }) => {
  let down = true;
  await page.route(`${API}/**`, (route) => (down ? route.abort() : route.continue()));
  await page.goto('/#/daily/border-route');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('combobox')).toBeVisible({ timeout: 15_000 });
});

// Without the error-checking fixture: browsers log every error status to the console.
plainTest('a page on old game data is asked to reload', async ({ page }) => {
  await page.route(`${API}/sessions`, (route) =>
    route.fulfill({ status: 409, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"update-required"}' }),
  );
  await page.goto('/#/play/capitals');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});

plainTest('games stay playable when the server is unreachable, and say the score is not saved', async ({ page }) => {
  plainTest.slow();
  await page.route(`${API}/**`, (route) => route.abort());
  const shown = await playCapitals(page);
  await expect(page.locator('.score-notice.score-offline')).toContainText("wasn't saved online");
  // The score is kept in this browser instead.
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.locator('.scores li').first()).toContainText(String(shown));
  await page.getByRole('tab', { name: 'Global' }).click();
  await expect(page.getByText("The global leaderboard isn't available right now.")).toBeVisible();
});
