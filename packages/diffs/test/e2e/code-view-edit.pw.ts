import { expect, type Page, test } from '@playwright/test';

// The editable content column of the one file item in the CodeView fixture.
const CONTENT = 'diffs-container [data-code] [data-content]';

async function openFileSession(page: Page): Promise<void> {
  await page.goto(
    '/test/e2e/fixtures/code-view-annotations.html?type=file&edit=true&fileAnnotation=false'
  );
  await page.waitForFunction(() => window.__annotationScroll != null);
  await page.waitForFunction(
    (selector) =>
      document
        .querySelector('diffs-container')
        ?.shadowRoot?.querySelector<HTMLElement>(selector)
        ?.isContentEditable === true,
    CONTENT.replace('diffs-container ', '')
  );
}

// The text of the first row and the caret's column in it, read from the
// native selection the way the editor reads it.
function firstRow(page: Page): Promise<{ text: string; caret: number }> {
  return page.evaluate(() => {
    // ShadowRoot.getSelection is non-standard and missing from the DOM types.
    const shadow:
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null
      | undefined = document.querySelector('diffs-container')?.shadowRoot;
    const row = shadow?.querySelector('[data-content] > [data-line="1"]');
    const selection = shadow?.getSelection?.() ?? document.getSelection();
    if (row == null || selection == null || selection.anchorNode == null) {
      throw new Error('missing the first row or the selection');
    }
    const range = document.createRange();
    range.setStart(row, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { text: row.textContent ?? '', caret: range.toString().length };
  });
}

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

test.describe('CodeView edit session', () => {
  // A keystroke's rows are patched in the virtualizer's frame, after the
  // editor placed the caret in them. Typing faster than the frame must not
  // move the caret, or later characters land earlier in the line.
  test('fast typing keeps the caret at the end of the line', async ({
    page,
  }) => {
    await openFileSession(page);
    const row = page.locator(`${CONTENT} > [data-line="1"]`);
    await row.click();
    await page.keyboard.press('End');
    const before = await firstRow(page);
    expect(before).toEqual({ text: 'const line1 = 1;', caret: 16 });

    const typed = 'abcdefghijklmnop';
    await page.keyboard.type(typed, { delay: 0 });
    await twoFrames(page);

    const after = await firstRow(page);
    expect(after.text).toBe(`const line1 = 1;${typed}`);
    expect(after.caret).toBe(after.text.length);
  });
});
