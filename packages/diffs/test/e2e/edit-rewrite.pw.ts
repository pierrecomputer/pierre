import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getState().file.contents ?? '');
const changeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__editorEvents?.length ?? 0);

test.describe('rewrite the whole editable file', () => {
  test('selecting all, deleting, and typing new code emits the new file', async ({
    page,
  }) => {
    await openFixture(page);

    // Select everything and clear it.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect.poll(() => contents(page)).toBe('');

    // Type a fresh multi-line file (Enter for the line break).
    await page.keyboard.type('const rewritten = true;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('export default rewritten;');

    await expect
      .poll(() => contents(page))
      .toBe('const rewritten = true;\nexport default rewritten;');
    // None of the original content survives the rewrite.
    await expect.poll(() => contents(page)).not.toContain('foo');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
  });
});
