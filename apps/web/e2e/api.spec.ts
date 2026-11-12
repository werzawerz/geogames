// Runs against the real API (`npm run dev:api`, real migrations, in-memory
// Postgres) with the web app in API mode. Every test has a fresh browser, so a
// fresh player. The daily limit is 3 here (see playwright.config.ts).
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

test('a game runs on a server seed, and its verified score reaches the global leaderboard', async ({ page }) => {
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
  await expect(page.locator('.topbar').getByText(/\/3 plays/)).toBeVisible();

  const shown = await playCapitals(page);
  await expect.poll(() => finishes.length).toBe(1);
  expect(sessions).toHaveLength(1);
  // What the page shows is what the server computed by replaying.
  expect(finishes[0]!.score).toBe(shown);
  await expect(page.locator('.topbar').getByText('2/3 plays')).toBeVisible();

  // Rename, then find the score on the public leaderboard.
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  const name = `Tester ${Math.floor(Math.random() * 1e6)}`;
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Display name').blur();
  await expect.poll(async () => (await page.request.get(`${API}/health`)).ok()).toBe(true);
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Global' }).click();
  if (shown > 0) {
    await expect(page.locator('.scores li').filter({ hasText: name })).toContainText(String(shown));
  }
  await page.getByRole('tab', { name: 'Your best' }).click();
  await expect(page.locator('.scores li').first()).toContainText(String(shown));
});

test('the server enforces the daily limit', async ({ page }) => {
  test.slow();
  for (let plays = 3; plays > 0; plays--) {
    await page.goto('/#/');
    await page.goto('/#/play/capitals');
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(page.locator('.quiz-option').first()).toBeVisible();
  }
  // A reload doesn't help, and neither would clearing a local counter.
  await page.goto('/#/');
  await page.reload();
  await expect(page.locator('.topbar').getByText('0/3 plays')).toBeVisible();
  await page.goto('/#/play/capitals');
  await expect(page.getByText("You've used today's free plays")).toBeVisible();
});

test('the daily challenge is the same run for everyone, one try each, and spends no free play', async ({ browser }) => {
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

  // Starting it left all free plays.
  await alice.goto('/#/');
  await alice.reload();
  await expect(alice.locator('.topbar').getByText('3/3 plays')).toBeVisible();
  await first.close();
  await second.close();
});

test('there is no simulated subscription with a server', async ({ page }) => {
  await page.goto('/#/premium');
  await expect(page.getByText("Payments aren't wired up yet.")).toBeVisible();
  await expect(page.getByRole('button', { name: /Premium|Free \(dev\)/ })).toHaveCount(0);
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
  await expect(page.locator('.score-notice')).toContainText("isn't on the leaderboard");
  // The score is kept in this browser instead.
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  await expect(page.locator('.scores li').first()).toContainText(String(shown));
  await page.getByRole('tab', { name: 'Global' }).click();
  await expect(page.getByText("The global leaderboard isn't available right now.")).toBeVisible();
});
