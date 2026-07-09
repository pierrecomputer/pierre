import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/theme.html');
  await page.waitForFunction(() => window.__themeReady === true);
}

const selections = (page: Page): Promise<E2ESelection[] | undefined> =>
  page.evaluate(() => window.__editor?.getState().selections);

// Reads the rendered text color of the first content token, which differs
// between the dark and light themes.
const tokenColor = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    const token = root?.querySelector('[data-content] [data-char]');
    return token != null ? getComputedStyle(token).color : '';
  });

test.describe('theme switching', () => {
  test('toggling the theme changes the rendered token colors', async ({
    page,
  }) => {
    await openFixture(page);

    const darkColor = await tokenColor(page);
    await page.locator('[data-toggle-theme]').click();

    await expect.poll(() => tokenColor(page)).not.toBe(darkColor);
  });

  test('a text selection is preserved across a theme switch', async ({
    page,
  }) => {
    await openFixture(page);

    // Build a real selection with the keyboard, then capture it.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowRight');
    }
    const before = await selections(page);
    expect(before?.[0]).toBeDefined();
    expect(before?.[0]?.start).not.toEqual(before?.[0]?.end);

    await page.locator('[data-toggle-theme]').click();

    // The selection must not move when only the theme changes.
    await expect.poll(() => selections(page)).toEqual(before);
  });
});
