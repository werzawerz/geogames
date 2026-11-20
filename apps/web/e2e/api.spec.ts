// Runs against the real API (`npm run dev:api`, real migrations, in-memory
// Postgres) with the web app in API mode. Every test has a fresh browser, so a
// fresh anonymous player. In dev builds the browser checks passwords itself
// (createDevAuth); creating an account keeps the player id, as on the server.
import { test as plainTest } from '@playwright/test';
import { countries } from '@geogames/geodata';
import { arcadePools, blankAtlasGame, createCircleArcade, type ArcadeState } from '@geogames/games';
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

const newEmail = () => `player${Math.floor(Math.random() * 1e9)}@example.com`;

/** Creates an account from the header's "Sign in", and comes back to the page it started on. */
async function createAccount(page: import('@playwright/test').Page, email = newEmail(), password = 'correct horse') {
  const from = new URL(page.url()).hash;
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(from);
  return { email, password };
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
  // Capitals can be duelled too: the button shows without an account (it asks for one when pressed).
  await expect(page.getByRole('button', { name: '⚔️ Challenge a friend to these questions' })).toBeEnabled();

  // Rename, then find the score on the public leaderboard.
  await page.getByRole('link', { name: 'Leaderboard' }).click();
  const name = `Tester ${Math.floor(Math.random() * 1e6)}`;
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Display name').blur();
  await expect.poll(async () => (await page.request.get(`${API}/health`)).ok()).toBe(true);
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Global' }).click();
  // Anonymous players aren't on global leaderboards...
  await expect(page.getByText('Global leaderboards show players with an account')).toBeVisible();
  await expect(page.locator('.scores li').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Your best' }).click();
  await expect(page.locator('.scores li').first()).toContainText(String(shown));

  // ...until they make an account, with the games they played before.
  await createAccount(page);
  await page.getByRole('tab', { name: 'Global' }).click();
  await expect(page.getByText('Global leaderboards show players with an account')).toHaveCount(0);
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
  // The name settles once the server's player arrives (GET /me); read it after that.
  const me = page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith('/me'));
  await page.goto('/#/scores/capitals');
  await me;
  const input = page.getByLabel('Display name');
  await expect(input).not.toHaveValue('');
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

test('creating an account from the header shows the avatar and name, and the Profile page says signed in', async ({ page }) => {
  await page.goto('/#/');
  const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
  await expect(signIn).toBeVisible();
  const { email, password } = await createAccount(page);
  const account = page.getByRole('button', { name: /Account menu for/ });
  await expect(account.locator('.avatar')).toBeVisible();
  await expect(signIn).toHaveCount(0);

  await account.click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByText('Signed in as')).toContainText(email);
  await expect(page).toHaveTitle('Profile · GeoGames');

  // Signing out goes back to a fresh anonymous player...
  const name = await page.getByLabel('Name on leaderboards').inputValue();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(signIn).toBeVisible();
  await expect(page.getByLabel('Name on leaderboards')).not.toHaveValue(name);

  // ...and logging in comes back to the account, after a wrong password.
  await signIn.click();
  await page.getByRole('button', { name: 'Log in', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('don’t match an account');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByLabel('Name on leaderboards')).toHaveValue(name);
  await expect(page.getByText('Signed in as')).toContainText(email);
});

// Without the error-checking fixture: the refused request logs an error status.
plainTest('an email that already has an account is refused, with a pointer to log in', async ({ page }) => {
  await page.goto('/#/');
  const { email } = await createAccount(page);
  await page.getByRole('button', { name: /Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email.toUpperCase());
  await page.getByLabel('Password').fill('another password');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('already has an account. Log in instead.');
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
  await createAccount(page);
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
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the sign-in button is in the header, without sideways scrolling', async ({ page }) => {
    await page.goto('/#/');
    const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    const box = (await signIn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const scrolls = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(await scrolls()).toBe(false);

    await createAccount(page);
    expect(await scrolls()).toBe(false);
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
    expect(await scrolls()).toBe(false);
    await page.getByRole('button', { name: 'Open menu' }).click();
    expect(await scrolls()).toBe(false);
  });
});

// Duels: a run by an account holder becomes a link; a friend with no account plays the same circles once.
type Page = import('@playwright/test').Page;
type Engine = Awaited<ReturnType<typeof duelEngine>>;
const duelEngine = async () => createCircleArcade(await arcadePools());

/** Types a city and picks it from the suggestions (the country tells namesakes apart). */
async function pickCity(page: Page, engine: Engine, id: string) {
  const city = engine.cities.get(id)!;
  const country = countries.find((c) => c.id === city.countryId)!.name;
  await page.getByRole('combobox').fill(city.name);
  await page.locator('.suggestions li').filter({ hasText: country }).filter({ hasText: city.name }).first().click();
}

/** Skips until the lives are gone, going on to the next level when one is cleared. */
async function skipOut(page: Page, engine: Engine, state: ArcadeState) {
  const skip = page.getByRole('button', { name: /Skip city/ });
  while (state.status !== 'over') {
    if (state.status === 'level-clear') {
      await page.getByRole('button', { name: 'Next level' }).click();
      state = engine.nextLevel(state);
    }
    await skip.click();
    state = engine.skip(state);
  }
  return state;
}

test('a duel: an account holder challenges, an anonymous friend plays the same circles on a phone and wins', async ({ browser }) => {
  test.slow();
  const engine = await duelEngine();

  // A: an account, one city found, then out of lives; the run becomes a duel.
  const alice = await (await browser.newContext()).newPage();
  await alice.goto('/#/');
  await createAccount(alice);
  const started = alice.waitForResponse((r) => r.url().endsWith('/sessions') && r.status() === 201);
  await alice.goto('/#/duels/new');
  await alice.getByRole('link', { name: 'Duel at City Circle Arcade' }).click();
  await expect(alice.getByRole('heading', { name: 'New duel: City Circle Arcade' })).toBeVisible();
  // A game with a daily offers both; a random run is the default.
  await expect(alice.getByRole('radio', { name: /Random/ })).toHaveAttribute('aria-checked', 'true');
  await expect(alice.getByText('Play your run first')).toBeVisible();
  await alice.getByRole('button', { name: 'Play', exact: true }).click();
  const { seed } = (await (await started).json()) as { seed: number };
  await expect(alice.getByRole('combobox')).toBeVisible({ timeout: 20_000 });
  let a = engine.start(seed);
  const first = engine.top(a.level)[0]!;
  await pickCity(alice, engine, first);
  a = engine.guess(a, first).state;
  a = await skipOut(alice, engine, a);
  await alice.getByRole('button', { name: 'See final score' }).click();
  await expect(alice).toHaveURL(/#\/duel\/[2-9A-HJKMNP-Z]{8}$/);
  const link = alice.url();
  await expect(alice.locator('.big-score')).toHaveText(String(a.score));
  await expect(alice.getByRole('button', { name: 'Send the link' })).toBeVisible();
  await expect(alice.getByText('Waiting for a challenger.')).toBeVisible();

  // B: no account, on a phone. The invitation shows the stake, not the answers.
  const bobContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const bob = await bobContext.newPage();
  await bob.goto(link);
  await expect(bob.getByRole('heading', { name: /challenges you/ })).toBeVisible();
  await expect(bob.locator('.duel-invite .lead')).toContainText(`scored ${a.score} on City Circle Arcade`);
  await expect(bob.getByLabel('Your name in this duel')).toBeVisible();
  const accepted = bob.waitForResponse((r) => r.url().endsWith('/accept') && r.status() === 200);
  await bob.getByRole('button', { name: 'Play the duel' }).click();
  expect(((await (await accepted).json()) as { seed: number }).seed).toBe(seed);
  await expect(bob.locator('.duel-strip')).toContainText(`to beat: ${a.score}`);
  await expect(bob.getByRole('combobox')).toBeVisible({ timeout: 20_000 });

  // The whole question fits a 390 x 844 screen without scrolling.
  for (const selector of ['.duel-strip', '.route-status', '.world-map', '[role=combobox]']) {
    const box = (await bob.locator(selector).first().boundingBox())!;
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, selector).toBeLessThanOrEqual(844);
  }

  // A third person finds the duel taken.
  const carol = await (await browser.newContext()).newPage();
  await carol.goto(link);
  await expect(carol.getByText('Someone else already played this duel.')).toBeVisible();
  await expect(carol.getByRole('button', { name: 'Play the duel' })).toHaveCount(0);
  // And Alice is told Bob is playing.
  await alice.reload();
  await expect(alice.getByText('took your duel and is playing now')).toBeVisible();
  // No rematch until the duel is over: Alice is told before she plays a run.
  await alice.goto(link.replace('#/duel/', '#/duels/new/'));
  await expect(alice.getByText('You can ask for a rematch once this duel is finished.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await alice.goto(link);

  // Bob plays the same circles: the first city, then a reload in the middle keeps his place.
  let b = engine.start(seed);
  const [t1, t2, t3] = engine.top(b.level);
  await pickCity(bob, engine, t1!);
  b = engine.guess(b, t1!).state;
  await bob.reload();
  await expect(bob.getByRole('combobox')).toBeVisible({ timeout: 20_000 });
  await expect(bob.locator('.rank-slots .slot-found')).toHaveCount(1);
  await expect(bob.locator('.route-status')).toContainText('Level 1');
  for (const id of [t2!, t3!]) {
    await pickCity(bob, engine, id);
    b = engine.guess(b, id).state;
  }
  b = await skipOut(bob, engine, b);
  await bob.getByRole('button', { name: 'See final score' }).click();

  // The result: Bob wins, with both runs side by side, stacked on a phone.
  await expect(bob.locator('.duel-headline')).toContainText('You win!', { timeout: 15_000 });
  await expect(bob.locator('.duel-headline')).toContainText(`${b.score} to ${a.score}`);
  const cards = bob.locator('.duel-card');
  await expect(cards).toHaveCount(2);
  const one = (await cards.nth(0).boundingBox())!;
  const two = (await cards.nth(1).boundingBox())!;
  expect(two.y).toBeGreaterThanOrEqual(one.y + one.height - 1);
  await expect(bob.locator('.duel-levels tbody tr').first()).toContainText('30 ✓');
  await expect(bob.getByRole('link', { name: 'Rematch' })).toBeVisible();
  // Bob has no account, and his duels list still has it.
  await bob.goto(link.split('#')[0] + '#/duels');
  await expect(bob.locator('.duel-list')).toContainText(`Won ${b.score}–${a.score}`);

  // Alice sees the same result from her side, and the duels list.
  await alice.reload();
  await expect(alice.locator('.duel-headline')).toContainText('wins.');
  await expect(alice.locator('.duel-headline')).not.toContainText('You win');
  await alice.getByRole('link', { name: 'All duels' }).first().click();
  await expect(alice.locator('.duel-list')).toContainText(`Lost ${a.score}–${b.score}`);
  expect(await alice.evaluate(() => window.scrollY)).toBe(0);
});

// Duels of other games: the game is picked on the new-duel page, and the level table tells a skip from a clear.
type Atlas = Awaited<ReturnType<typeof blankAtlasGame>>;
type AtlasState = ReturnType<Atlas['start']>;

/** Plays one Blank Atlas level in the browser and the engine alike: the right name, a wrong one, or a skip. */
async function atlasLevel(page: Page, engine: Atlas, state: AtlasState, how: 'right' | 'wrong' | 'skip') {
  const { level } = state;
  const pick = how === 'right' ? level.feature : level.options.find((id) => id !== level.feature)!;
  if (how === 'skip') {
    await page.getByRole('button', { name: /Skip/ }).click();
    state = engine.skip(state);
  } else {
    await page.locator('.atlas-option').nth(level.options.indexOf(pick)).click();
    state = engine.guess(state, pick).state;
  }
  await page.getByRole('button', { name: state.status === 'over' ? 'See final score' : 'Next level' }).click();
  return state.status === 'over' ? state : engine.nextLevel(state);
}

test('a Blank Atlas duel: picked on the new-duel page, the friend gets the same places, and a skipped level shows as skipped', async ({ browser }) => {
  test.slow();
  const engine = await blankAtlasGame();

  // A picks Blank Atlas, clears level 1, skips level 2 and misses two more.
  const alice = await (await browser.newContext()).newPage();
  await alice.goto('/#/');
  await createAccount(alice);
  await alice.goto('/#/duels/new');
  // The games are cards, grouped like the home page.
  await expect(alice.getByRole('heading', { name: 'Duel a friend' })).toBeVisible();
  await expect(alice.locator('.duel-game-card')).toHaveCount(20);
  await alice.getByRole('link', { name: 'Duel at Blank Atlas' }).click();
  await expect(alice.getByRole('heading', { name: 'New duel: Blank Atlas' })).toBeVisible();
  // No daily for Blank Atlas, so no choice to make.
  await expect(alice.getByRole('radio')).toHaveCount(0);
  await expect(alice.getByText('gets exactly the same places')).toBeVisible();
  const started = alice.waitForResponse((r) => r.url().endsWith('/sessions') && r.status() === 201);
  await alice.getByRole('button', { name: 'Play', exact: true }).click();
  const { seed } = (await (await started).json()) as { seed: number };
  await expect(alice.locator('.atlas-option').first()).toBeVisible({ timeout: 20_000 });
  let a = engine.start(seed);
  for (const how of ['right', 'skip', 'wrong', 'wrong'] as const) a = await atlasLevel(alice, engine, a, how);
  expect(a.status).toBe('over');
  await expect(alice).toHaveURL(/#\/duel\/[2-9A-HJKMNP-Z]{8}$/, { timeout: 15_000 });
  const link = alice.url();
  await expect(alice.locator('.eyebrow')).toHaveText('Duel · Blank Atlas');
  await expect(alice.locator('.big-score')).toHaveText(String(a.score));
  await expect(alice.getByText('Reached level 4')).toBeVisible();

  // B, with no account and on a phone, is told which game and gets the same places.
  const bob = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await bob.goto(link);
  await expect(bob.locator('.duel-invite .lead')).toContainText(`scored ${a.score} on Blank Atlas and reached level 4`);
  await expect(bob.getByText('You get exactly the same places, in the same order.')).toBeVisible();
  const accepted = bob.waitForResponse((r) => r.url().endsWith('/accept') && r.status() === 200);
  await bob.getByRole('button', { name: 'Play the duel' }).click();
  expect(((await (await accepted).json()) as { seed: number }).seed).toBe(seed);
  await expect(bob.locator('.atlas-option').first()).toBeVisible({ timeout: 20_000 });
  let b = engine.start(seed);
  // The same first place, with the same four names.
  await expect(bob.locator('.atlas-option')).toHaveText(b.level.options.map((id, i) => `${i + 1}${engine.features.get(id)!.name}`));
  for (const how of ['right', 'right', 'right', 'wrong', 'wrong', 'wrong'] as const) b = await atlasLevel(bob, engine, b, how);
  expect(b.score).toBeGreaterThan(a.score);

  // Bob wins; level 2 shows Alice's skip as a skip, not a clear.
  await expect(bob.locator('.duel-headline')).toContainText('You win!', { timeout: 15_000 });
  await expect(bob.locator('.duel-headline')).toContainText(`${b.score} to ${a.score}`);
  await expect(bob.locator('.duel-result .eyebrow')).toHaveText('Duel · Blank Atlas');
  const rows = bob.locator('.duel-levels tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0).locator('td').nth(1)).toContainText('✓★');
  await expect(rows.nth(1).locator('td').nth(0)).toContainText('✓★');
  await expect(rows.nth(1).locator('td').nth(1)).toContainText('0 ↷');
  await expect(rows.nth(1).getByLabel('skipped')).toBeVisible();
  await expect(rows.nth(4).locator('td').nth(1)).toContainText('–');
  await expect(bob.locator('.duel-key')).toContainText('↷ skipped');
  await bob.goto(link.split('#')[0] + '#/duels');
  await expect(bob.locator('.duel-list')).toContainText(`Won ${b.score}–${a.score} vs`);
  await expect(bob.locator('.duel-list')).toContainText('Blank Atlas');
});

test('duels need an account: an anonymous player gets the gate, and comes back to it after creating one', async ({ page }) => {
  // Anyone can look at the games; starting one asks for an account.
  await page.goto('/#/duels/new');
  await page.getByRole('link', { name: 'Duel at Pin Drop' }).click();
  await expect(page.getByText('Duels need an account')).toBeVisible();
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.getByLabel('Email').fill(newEmail());
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/duels\/new\/pin-drop$/);
  await expect(page.getByText('Play your run first')).toBeVisible();
  // With an account, the Duels page has none yet.
  await page.getByRole('banner').getByRole('link', { name: 'Duels' }).click();
  await expect(page.getByRole('heading', { name: 'Duels' })).toBeVisible();
  await expect(page.getByText('No duels yet.')).toBeVisible();
});

test('challenging from the end of a run without an account: sign in, and that very run becomes the duel', async ({ page }) => {
  test.slow();
  await page.goto('/#/');
  const shown = await playCapitals(page);
  await page.getByRole('button', { name: '⚔️ Challenge a friend to these questions' }).click();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await page.getByLabel('Email').fill(newEmail());
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page).toHaveURL(/#\/duel\/[2-9A-HJKMNP-Z]{8}$/, { timeout: 15_000 });
  await expect(page.locator('.eyebrow')).toHaveText('Duel · Capitals');
  await expect(page.locator('.big-score')).toHaveText(String(shown));
});

test("a daily duel: today's daily for both, one try each, on the day's leaderboard", async ({ browser }) => {
  test.slow();
  const engine = await duelEngine();

  // Alice picks today's daily on the start step and plays it: it is her one daily run.
  const alice = await (await browser.newContext()).newPage();
  await alice.goto('/#/');
  await createAccount(alice);
  await alice.goto('/#/duels/new/city-circle-arcade');
  await alice.getByRole('radio', { name: /Today's daily/ }).click();
  await expect(alice.getByText('Uses your one daily try')).toBeVisible();
  const opened = alice.waitForResponse((r) => r.url().endsWith('/daily/city-circle-arcade/start') && r.status() === 200);
  await alice.getByRole('button', { name: "Play today's daily" }).click();
  const { seed } = (await (await opened).json()) as { seed: number };
  await expect(alice.getByRole('combobox')).toBeVisible({ timeout: 20_000 });
  let a = engine.start(seed);
  a = await skipOut(alice, engine, a);
  await alice.getByRole('button', { name: 'See final score' }).click();
  await expect(alice).toHaveURL(/#\/duel\/[2-9A-HJKMNP-Z]{8}$/, { timeout: 15_000 });
  const link = alice.url();
  await expect(alice.locator('.eyebrow')).toContainText('Duel · City Circle Arcade · daily of');
  // Her daily is played: the daily page shows the result, with the challenge button under it.
  await alice.goto(link.split('#')[0] + '#/daily/city-circle-arcade');
  await expect(alice.getByText("Today's result")).toBeVisible();
  await expect(alice.getByRole('button', { name: "⚔️ Challenge a friend to today's circles" })).toBeVisible();
  // Starting another daily duel reuses that result rather than playing again.
  await alice.goto(link.split('#')[0] + '#/duels/new/city-circle-arcade');
  await alice.getByRole('radio', { name: /Today's daily/ }).click();
  await expect(alice.getByText(`your ${a.score} points are the score to beat`)).toBeVisible();

  // Bob (no account) is told the duel spends his daily, plays it, and it counts as his daily.
  const bob = await (await browser.newContext()).newPage();
  await bob.goto(link);
  await expect(bob.getByText("This is today's daily challenge: playing it here uses your one daily try")).toBeVisible();
  const accepted = bob.waitForResponse((r) => r.url().endsWith('/accept') && r.status() === 200);
  await bob.getByRole('button', { name: 'Play the duel' }).click();
  expect(((await (await accepted).json()) as { seed: number }).seed).toBe(seed);
  await expect(bob.locator('.duel-strip')).toContainText("today's daily");
  await expect(bob.getByRole('combobox')).toBeVisible({ timeout: 20_000 });
  let b = engine.start(seed);
  const first = engine.top(b.level)[0]!;
  await pickCity(bob, engine, first);
  b = engine.guess(b, first).state;
  b = await skipOut(bob, engine, b);
  await bob.getByRole('button', { name: 'See final score' }).click();
  await expect(bob.locator('.duel-headline')).toContainText('You win!', { timeout: 15_000 });
  // Both played the daily, so both see the answers level by level: Bob's one city, then a skip.
  await expect(bob.locator('.duel-levels tbody tr').first()).toContainText('10 ↷');
  // Bob's one daily is used up: the daily page shows his duel score.
  await bob.goto(link.split('#')[0] + '#/daily/city-circle-arcade');
  await expect(bob.getByText("Today's result")).toBeVisible();
  await expect(bob.locator('.big-score')).toHaveText(String(b.score));

  // Carol hasn't played today's daily: she sees the scores but not the answers.
  const carol = await (await browser.newContext()).newPage();
  await carol.goto(link);
  await expect(carol.locator('.duel-headline')).toContainText(`${a.score}`);
  await expect(carol.getByText("The level-by-level answers show once you've played this daily")).toBeVisible();
  await expect(carol.locator('.duel-levels')).toHaveCount(0);
});

// Without the error-checking fixture: the 404 is logged by the browser.
plainTest('a duel link that does not exist says so', async ({ page }) => {
  await page.goto('/#/duel/ZZZZZZZZ');
  await expect(page.getByText("This duel link doesn't work")).toBeVisible();
});
