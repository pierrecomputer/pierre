import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(
  page: Page,
  theme?: { name: string; type: 'dark' | 'light' }
): Promise<void> {
  const query =
    theme == null
      ? ''
      : `?theme=${encodeURIComponent(theme.name)}&themeType=${theme.type}`;
  await page.goto(`/test/e2e/fixtures/theme.html${query}`);
  await page.waitForFunction(() => window.__themeReady === true);
  await page.evaluate(() => document.fonts.ready);
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

async function captureLineHighlightState(
  page: Page,
  state: E2ELineHighlightState
): Promise<Buffer> {
  await page.evaluate((nextState) => {
    window.__setLineHighlightState?.(nextState);
  }, state);

  const row = page.locator('[data-content] > [data-line="2"]');
  const selected = state === 'selected' || state === 'both';
  const active = state === 'active' || state === 'both';
  await expect
    .poll(() =>
      row.evaluate((element) => ({
        active: element.hasAttribute('data-editor-active-line'),
        selected: element.hasAttribute('data-selected-line'),
      }))
    )
    .toEqual({ active, selected });

  return row.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}

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

test.describe('theme line highlights', () => {
  const themes = [
    { name: 'min-dark', type: 'dark' },
    { name: 'dark-plus', type: 'dark' },
    { name: 'github-dark', type: 'dark' },
    { name: 'github-light', type: 'light' },
    { name: 'nord', type: 'dark' },
  ] as const;

  for (const theme of themes) {
    test(`${theme.name} keeps active and selected line states distinct`, async ({
      page,
    }) => {
      await openFixture(page, theme);

      const none = await captureLineHighlightState(page, 'none');
      const selected = await captureLineHighlightState(page, 'selected');
      const active = await captureLineHighlightState(page, 'active');
      const both = await captureLineHighlightState(page, 'both');

      expect(active.equals(none)).toBe(false);
      expect(both.equals(selected)).toBe(false);
      expect(both.equals(active)).toBe(false);
    });
  }
});
