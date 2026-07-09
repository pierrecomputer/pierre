import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';
const PANEL = '[data-search-panel]';
const SEARCH_INPUT = '[data-search-panel] input[data-search]';
const REPLACE_INPUT = '[data-search-panel] input[data-replace]';
const MATCHES = '[data-search-panel] [data-matches]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getState().file.contents ?? '');

// Focus the editor surface, then open the search panel with the real shortcut.
// The panel container is a zero-height CSS grid wrapper (its cells are laid out
// individually), so wait on the visible search input rather than the wrapper.
async function openSearchPanel(page: Page): Promise<void> {
  await page.locator(CONTENT).click();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(SEARCH_INPUT)).toBeVisible();
}

test.describe('find and replace', () => {
  test('Cmd/Ctrl+F opens the panel and reports match counts', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');

    // "foo" appears four times across the three lines.
    await expect(page.locator(MATCHES)).toContainText('4');
    await expect(
      page.locator('[data-search-panel] [data-no-matches]')
    ).toHaveCount(0);

    await page.locator(SEARCH_INPUT).fill('nope');
    await expect(page.locator(MATCHES)).toContainText('No results');
  });

  test('switching to replace mode and Replace All rewrites every match', async ({
    page,
  }) => {
    await openFixture(page);
    await openSearchPanel(page);

    await page.locator(SEARCH_INPUT).fill('foo');
    // Cmd/Ctrl+Alt+F toggles the panel into find/replace mode in place.
    await page.keyboard.press('ControlOrMeta+Alt+f');
    await expect(page.locator('[data-search-grid]')).toHaveAttribute(
      'data-mode',
      'replace'
    );

    await page.locator(REPLACE_INPUT).fill('qux');
    await page
      .locator('[data-replace-actions] button[aria-label="Replace All"]')
      .click();

    await expect.poll(() => contents(page)).toContain('const qux = 1;');
    await expect.poll(() => contents(page)).toContain('const bar = qux + qux;');
    await expect.poll(() => contents(page)).not.toContain('foo');
  });
});
