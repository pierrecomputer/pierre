import { expect, type Page, test } from '@playwright/test';

// Edit mode over a diff whose unchanged regions collapse: a 60-line file with
// changes at lines 10 and 50, so lines 15-45 sit in a collapsed gap between
// two hunks. Both diff styles run every case — the unified view rebuilds its
// content column via innerHTML on edits, a named regression risk.

const CONTENT = '[data-code]:not([data-deletions]) [data-content]';

async function openFixture(page: Page, diffStyle: 'split' | 'unified') {
  await page.goto(
    `/test/e2e/fixtures/edit-collapsed.html?diffStyle=${diffStyle}`
  );
  await page.waitForFunction(() => window.__editReady === true);
}

const renderedLines = (page: Page): Promise<number[]> =>
  page.evaluate(() => window.__renderedLines?.() ?? []);

const caretLine = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => window.__caretLine?.());

const scrollTop = (page: Page): Promise<number> =>
  page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);

function row(page: Page, lineNumber: number) {
  return page.locator(
    `${CONTENT} [data-line="${lineNumber}"]:not([data-line-type="change-deletion"])`
  );
}

for (const diffStyle of ['split', 'unified'] as const) {
  test.describe(`collapsed regions during edit (${diffStyle})`, () => {
    test('entering edit mode keeps the gap collapsed', async ({ page }) => {
      await openFixture(page, diffStyle);

      const lines = await renderedLines(page);
      expect(lines.length).toBeLessThan(60);
      expect(lines).not.toContain(30);
      // Both hunks render.
      expect(lines).toContain(10);
      expect(lines).toContain(50);
    });

    test('a reverted hunk persists until exit, then collapses away', async ({
      page,
    }) => {
      await openFixture(page, diffStyle);

      // Rewrite line 10 back to its old-side text.
      await row(page, 10).click();
      await page.evaluate(() => {
        window.__editor?.applyEdits(
          [
            {
              range: {
                start: { line: 9, character: 0 },
                end: { line: 9, character: 'line 10 changed'.length },
              },
              newText: 'line 10',
            },
          ],
          true
        );
      });
      await expect(row(page, 10)).toHaveText('line 10');

      // The reverted hunk persists as a context-only region mid-session.
      const lines = await renderedLines(page);
      expect(lines).toContain(10);
      expect(lines).not.toContain(30);

      // Genuine session end: the reverted region collapses away.
      await page.evaluate(() => window.__editor?.cleanUp());
      await expect
        .poll(async () => (await renderedLines(page)).includes(10))
        .toBe(false);
      const after = await renderedLines(page);
      expect(after).toContain(50);
    });

    test('arrow-down skips the collapsed gap like a code fold', async ({
      page,
    }) => {
      await openFixture(page, diffStyle);

      // Caret on line 14 (zero-based 13), the last rendered line of hunk 1.
      await row(page, 14).click();
      await expect.poll(() => caretLine(page)).toBe(13);

      await page.keyboard.press('ArrowDown');
      await expect.poll(() => caretLine(page)).toBe(45);

      await page.keyboard.press('ArrowUp');
      await expect.poll(() => caretLine(page)).toBe(13);

      // Horizontal motion at the boundary skips the gap too: ArrowRight at
      // the line's end lands at the next renderable line's start, ArrowLeft
      // at a line's start lands at the previous renderable line's end.
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => caretLine(page)).toBe(45);

      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => caretLine(page)).toBe(13);
    });

    test('search navigation to a hidden match reveals it', async ({ page }) => {
      await openFixture(page, diffStyle);

      await row(page, 10).click();
      await page.keyboard.press('ControlOrMeta+f');
      const searchInput = page.locator(
        '[data-search-panel] input[data-search]'
      );
      await expect(searchInput).toBeVisible();
      await searchInput.fill('line 30');
      await searchInput.press('Enter');

      await expect(row(page, 30)).toBeVisible();
      const lines = await renderedLines(page);
      expect(lines).toContain(30);
      // Only the gap containing the match expands (the reveal step is
      // distance + expansionLineCount, which covers this whole gap); other
      // collapsed regions stay collapsed.
      expect(lines).not.toContain(57);
    });

    test('separator expansion mid-edit keeps the viewport and accepts typing', async ({
      page,
    }) => {
      await openFixture(page, diffStyle);

      await row(page, 10).click();
      const scrollBefore = await scrollTop(page);

      // Separator rows render in several columns; some copies hide their
      // buttons via CSS, so click the first visible one for this gap.
      const expandButton = page
        .locator('[data-separator][data-expand-index="1"] [data-expand-button]')
        .locator('visible=true')
        .first();
      await expandButton.click();
      await expect(row(page, 30)).toBeVisible();
      expect(await scrollTop(page)).toBe(scrollBefore);

      // Type into the newly revealed context line; the edit lands and the
      // caret row stays visible.
      await row(page, 30).click();
      await page.keyboard.press('Home');
      await page.keyboard.type('typed ');
      await expect(row(page, 30)).toHaveText('typed line 30');
      await expect(row(page, 30)).toBeInViewport();
      expect(await scrollTop(page)).toBe(scrollBefore);
    });

    test('a programmatic replace into the gap materializes a rendered hunk', async ({
      page,
    }) => {
      await openFixture(page, diffStyle);

      await row(page, 10).click();
      const scrollBefore = await scrollTop(page);

      // Mirrors search replaceAll: a buffer edit with no caret involvement
      // into a line hidden inside the collapsed gap.
      await page.evaluate(() => {
        window.__editor?.applyEdits(
          [
            {
              range: {
                start: { line: 29, character: 0 },
                end: { line: 29, character: 'line 30'.length },
              },
              newText: 'REPLACED',
            },
          ],
          true
        );
      });

      await expect(row(page, 30)).toHaveText('REPLACED');
      expect(await scrollTop(page)).toBe(scrollBefore);
      // The caret stays where it was (line 10's row is still on screen).
      await expect(row(page, 10)).toBeInViewport();
    });

    test('undo and redo round-trip with collapse live', async ({ page }) => {
      await openFixture(page, diffStyle);

      await row(page, 50).click();
      await page.keyboard.press('Home');
      await page.keyboard.type('Z');
      await expect(row(page, 50)).toContainText('Zline 50');

      await page.keyboard.press('ControlOrMeta+z');
      await expect(row(page, 50)).not.toContainText('Zline 50');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(row(page, 50)).toContainText('Zline 50');

      // The gap never opened along the way.
      expect(await renderedLines(page)).not.toContain(30);
    });
  });
}
