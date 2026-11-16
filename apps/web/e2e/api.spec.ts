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
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Nice Name');
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

test('signing in from the header shows the avatar and name, and the Profile page says signed in', async ({ page }) => {
  await page.goto('/#/');
  const signIn = page.getByRole('button', { name: 'Sign in with Google' });
  await expect(signIn).toBeVisible();
  await signIn.click();
  const account = page.getByRole('button', { name: /Account menu for/ });
  await expect(account).toBeVisible();
  await expect(account.locator('.avatar')).toBeVisible();
  await expect(signIn).toHaveCount(0);

  await account.click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText('Signed in as')).toContainText('dev@example.com');
  await expect(page).toHaveTitle('Profile · GeoGames');

  // Signing out goes back to a fresh anonymous player.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

// Without the error-checking fixture: browsers log every error status to the console.
plainTest('the Profile page refuses an offensive name and keeps the old one', async ({ page }) => {
  await page.goto('/#/profile');
  const input = page.getByLabel('Name on leaderboards');
  const before = await input.inputValue();
  await input.fill('Sh1thead');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('alert')).toContainText('That name isn’t allowed');
  await input.fill('Nice Name');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Name saved.')).toBeVisible();
  expect(before).not.toBe('Nice Name');
  await page.reload();
  await expect(input).toHaveValue('Nice Name');
});

test('the contact form sends a message', async ({ page }) => {
  let sent: { message?: string; email?: string; page?: string } | null = null;
  page.on('request', (req) => {
    if (req.url().endsWith('/feedback') && req.method() === 'POST') sent = req.postDataJSON();
  });
  await page.goto('/#/contact');
  const send = page.getByRole('button', { name: 'Send message' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Your message').fill('Great games, thanks!');
  await expect(page.getByText('20 / 2000')).toBeVisible();
  await page.getByLabel('Email (optional)').fill('fan@example.com');
  await send.click();
  await expect(page.getByText('Thank you, your message was sent.')).toBeVisible();
  expect(sent).toMatchObject({ message: 'Great games, thanks!', email: 'fan@example.com', page: '#/contact' });
});

test('deleting the account needs DELETE typed, and leaves a fresh anonymous player', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('permanently deletes');
  const confirm = dialog.getByRole('button', { name: 'Delete everything' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type DELETE/).fill('delete');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type DELETE/).fill('DELETE');
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the sign-in button is in the header, without sideways scrolling', async ({ page }) => {
    await page.goto('/#/');
    const signIn = page.getByRole('button', { name: 'Sign in with Google' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toContainText('Sign in');
    await expect(signIn.locator('.g-long')).toBeHidden();
    const box = (await signIn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const scrolls = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(await scrolls()).toBe(false);

    await signIn.click();
    await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
    expect(await scrolls()).toBe(false);
    await page.getByRole('button', { name: 'Open menu' }).click();
    expect(await scrolls()).toBe(false);
  });
});
