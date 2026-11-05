import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails if the page logs a console error or throws. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors, 'browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens a game's setup screen. */
export async function openGame(page: Page, gameId: string) {
  await page.goto(`/#/play/${gameId}`);
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
}

/**
 * Guesses "higher" until the game ends or `maxRounds` reveals have passed.
 * Returns how many guesses were correct.
 */
export async function playRounds(page: Page, maxRounds: number): Promise<number> {
  let correct = 0;
  for (let i = 0; i < maxRounds; i++) {
    await page.locator('.btn-up').click();
    const caption = page.locator('.hl-card.correct, .hl-card.wrong');
    await expect(caption).toBeVisible();
    if (await page.locator('.hl-card.wrong').count()) return correct;
    correct++;
    // The next round starts when fresh buttons appear.
    await expect(page.locator('.btn-up')).toBeVisible({ timeout: 5000 });
  }
  return correct;
}

/** Moves a range slider until its label reads `label` (e.g. "300k"). */
export async function setCitySize(page: Page, label: string) {
  const slider = page.getByRole('slider');
  const value = page.locator('.size-value strong');
  const stops = await page.locator('.size-ticks span').allTextContents();
  const target = stops.indexOf(label);
  expect(target, `slider stop ${label} in ${stops.join(', ')}`).toBeGreaterThanOrEqual(0);
  await slider.fill(String(target));
  await expect(value).toHaveText(`${label}+`);
}
