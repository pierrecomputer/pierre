import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getText() ?? '');

test.describe('multi-cursor and indentation', () => {
  // Adding a caret with a modifier-click can't be simulated in the pinned
  // headless Chromium: selectionchange fires before pointerdown there, so the
  // editor can't reserve the prior caret before the new one lands. We instead
  // seed two carets through the public setSelections API and drive real
  // keyboard input, which exercises the multi-caret edit pipeline itself.
  test('typing with multiple carets edits every caret', async ({ page }) => {
    await openFixture(page);

    await page.locator(CONTENT).click();
    await page.evaluate(() => {
      const editor = window.__editor;
      if (editor == null) {
        throw new Error('editor missing');
      }
      editor.focus();
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
          direction: 'none',
        },
      ]);
    });

    await page.keyboard.type('Z');

    // Both carets receive the keystroke, so two Z's are inserted.
    await expect
      .poll(async () => (await contents(page)).split('Z').length - 1)
      .toBe(2);
  });

  test('Tab indents selected lines and Shift+Tab outdents them', async ({
    page,
  }) => {
    await openFixture(page);
    const original = await contents(page);

    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Tab');

    // Every non-empty line gains a leading indent unit (tab or spaces).
    await expect
      .poll(async () =>
        (await contents(page))
          .split('\n')
          .filter((line) => line.length > 0)
          .every((line) => /^(\t| {2,})/.test(line))
      )
      .toBe(true);

    // Re-focus and re-select every line so the outdent applies to the whole
    // file regardless of where the indent left the selection. The explicit click
    // guarantees the content surface holds focus before the select-all, which
    // otherwise races the async re-render under parallel worker pressure.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => contents(page)).toBe(original);
  });
});
