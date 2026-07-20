import { expect, type Page, test } from '@playwright/test';

const ADDITIONS = '[data-code][data-additions] [data-content]';
const DELETIONS = '[data-code][data-deletions] [data-content]';
const ADDITIONS_GUTTER = '[data-code][data-additions] [data-gutter]';

async function openFixture(
  page: Page,
  options: { gutterUtility?: boolean; lineSelection?: boolean } = {}
): Promise<void> {
  const query = [
    options.gutterUtility === true ? 'gutterUtility' : '',
    options.lineSelection === true ? 'lineSelection' : '',
  ]
    .filter(Boolean)
    .join('&');
  await page.goto(
    `/test/e2e/fixtures/edit.html${query === '' ? '' : `?${query}`}`
  );
  await page.waitForFunction(() => window.__editReady === true);
}

const canUndo = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__editor?.canUndo ?? false);
const canRedo = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__editor?.canRedo ?? false);
const changeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__editorEvents?.length ?? 0);

// Real user path: a plain click into the editable additions column places the
// caret, then typing flows through the genuine keyboard -> beforeinput ->
// onChange pipeline. This guards the shadow-selection fallback in
// src/editor/editor.ts: the pinned Chromium here lacks
// Selection.getComposedRanges, so the editor reads the caret via
// ShadowRoot.getSelection() instead. Without that fallback a click left the
// caret unseeded and every keystroke was silently dropped.
async function clickIntoAdditions(page: Page): Promise<void> {
  await page.locator(ADDITIONS).click();
}

test.describe('edit mode', () => {
  test('a plain click seeds the caret so typing works (regression)', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');

    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
  });

  test('additions are editable while deletions stay read-only', async ({
    page,
  }) => {
    await openFixture(page);

    await expect(page.locator(ADDITIONS)).toHaveAttribute(
      'contenteditable',
      'true'
    );
    // The deleted (old-file) column is never editable.
    await expect(page.locator(DELETIONS)).not.toHaveAttribute(
      'contenteditable',
      'true'
    );

    const deletionText = await page.locator(DELETIONS).textContent();

    // Editing the additions column must not disturb the read-only deletions.
    await clickIntoAdditions(page);
    await page.keyboard.type('Z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');

    await expect(page.locator(DELETIONS)).toHaveText(deletionText ?? '');
  });

  test('typing inserts text, fires onChange, and enables undo', async ({
    page,
  }) => {
    await openFixture(page);

    expect(await changeCount(page)).toBe(0);
    expect(await canUndo(page)).toBe(false);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');

    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
    await expect.poll(() => canUndo(page)).toBe(true);
  });

  test('undo and redo round-trip a typed edit', async ({ page }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => canUndo(page)).toBe(true);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(ADDITIONS)).not.toContainText('Z');
    await expect.poll(() => canRedo(page)).toBe(true);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');
  });

  test('editor owns gutter selection when line selection is enabled', async ({
    page,
  }) => {
    await openFixture(page, { lineSelection: true });

    const from = await page
      .locator(`${ADDITIONS_GUTTER} [data-column-number="1"]`)
      .boundingBox();
    const to = await page
      .locator(`${ADDITIONS_GUTTER} [data-column-number="3"]`)
      .boundingBox();
    if (from == null || to == null) {
      throw new Error('missing additions gutter rows');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 5,
    });
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const selection = window.__editor?.getState().selections?.at(-1);
          return selection == null
            ? null
            : { start: selection.start, end: selection.end };
        })
      )
      .toEqual({
        start: { line: 0, character: 0 },
        end: { line: 2, character: 21 },
      });
    await expect(page.locator('[data-selected-line]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__selectionChanges ?? [])).toEqual(
      []
    );
  });

  test('programmatic refocus accepts the first input after a gutter gesture', async ({
    page,
  }) => {
    await openFixture(page, { gutterUtility: true, lineSelection: true });

    // A real deletion-gutter click creates a native read-only selection while
    // leaving the editor without its own text selection.
    const deletedGutter = page.locator(
      '[data-code][data-deletions] [data-gutter] [data-column-number="2"]'
    );
    const deletedGutterBox = await deletedGutter.boundingBox();
    if (deletedGutterBox == null) {
      throw new Error('missing deleted gutter');
    }
    await page.mouse.click(
      deletedGutterBox.x + 2,
      deletedGutterBox.y + deletedGutterBox.height / 2
    );

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toContain('removed');
    await expect
      .poll(() =>
        page.evaluate(() => window.__editor?.getState().selections?.length ?? 0)
      )
      .toBe(0);
    await expect(page.locator('pre[data-deleted-text-selection]')).toHaveCount(
      1
    );
    await expect(page.locator('[data-selected-line]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__selectionChanges ?? [])).toEqual(
      []
    );

    // The utility gesture uses the same selection-preservation path as diff
    // line selection, but there is no editor selection to preserve here.
    const additionsGutter = page.locator(
      '[data-code]:not([data-deletions]) [data-gutter] [data-column-number="2"]'
    );
    await additionsGutter.hover();
    const utility = additionsGutter.locator('[data-utility-button]');
    await expect(utility).toBeVisible();
    await utility.click();
    await expect(additionsGutter).toHaveAttribute(
      'data-selected-line',
      'single'
    );

    const before = await page.evaluate(() => window.__editor?.getText() ?? '');
    const changesBefore = await changeCount(page);
    await page.locator('[data-fixtures-index]').focus();
    await page.evaluate(() => window.__editor?.focus());

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('diffs-container')?.shadowRoot;
          const content = root?.querySelector(
            '[data-code]:not([data-deletions]) [data-content]'
          );
          return root?.activeElement === content;
        })
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    await page.keyboard.type('Z');

    await expect
      .poll(() => page.evaluate(() => window.__editor?.getText() ?? ''))
      .not.toBe(before);
    await expect
      .poll(() => page.evaluate(() => window.__editor?.getText() ?? ''))
      .toContain('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(changesBefore);
  });
});
