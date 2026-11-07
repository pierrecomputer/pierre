import { expect, type Page, test } from '@playwright/test';

// The fixture's window helpers (see fixtures/code-view-hidden-root.html).
declare global {
  interface Window {
    __hiddenRootReady?: boolean;
    __hiddenRoot?: {
      hide(): void;
      show(): void;
      replaceContents(tag: string): void;
      replaceContentsWhileHiddenForOneFrame(tag: string): void;
      scrollToLine(lineNumber: number): void;
      firstRowText(): string;
      zeroHeights(): number;
      measuredRows(): number;
      // Rendered rows as [line number, top relative to the root, height].
      rows(): [number, number, number][];
      scrollTop(): number;
    };
  }
}

// Lets the ResizeObserver and the render queue react to a layout change.
async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function openFixture(page: Page, query = ''): Promise<void> {
  await page.goto(`/test/e2e/fixtures/code-view-hidden-root.html${query}`);
  await page.waitForFunction(() => window.__hiddenRootReady === true);
}

// Scrolled to the top, the first rendered row must be line 1, sitting at the
// top of the root, no row may have collapsed to zero height, and every
// rendered row must have a measured, non-zero height in the cache.
async function expectRenderedFromTheTop(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__hiddenRoot!.rows()[0]?.[0]))
    .toBe(1);
  expect(await page.evaluate(() => window.__hiddenRoot!.scrollTop())).toBe(0);
  const rows = await page.evaluate(() => window.__hiddenRoot!.rows());
  expect(rows[0][1]).toBeLessThan(40);
  for (const [line, , height] of rows) {
    expect(height, `line ${line}`).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => window.__hiddenRoot!.zeroHeights())).toBe(0);
  // Measuring can land a frame after the rows do.
  await expect
    .poll(() => page.evaluate(() => window.__hiddenRoot!.measuredRows()))
    .toBe(rows.length);
}

test('CodeView renders from line 1 after being hidden, resized and shown', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openFixture(page);
  await expectRenderedFromTheTop(page);

  await page.evaluate(() => window.__hiddenRoot!.hide());
  await twoFrames(page);
  // A narrower root re-wraps every line while the CodeView can't measure.
  await page.setViewportSize({ width: 600, height: 600 });
  await twoFrames(page);
  await page.evaluate(() => window.__hiddenRoot!.show());

  await expectRenderedFromTheTop(page);
});

// `content-visibility: hidden` keeps the subtree's layout, so nothing reads as
// zero while hidden and the ResizeObserver stays quiet when the root comes
// back. Items set while hidden must still be rendered when it does.
test('CodeView under content-visibility: hidden renders items set while hidden', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openFixture(page, '?hide=content-visibility');
  await expectRenderedFromTheTop(page);

  await page.evaluate(() => window.__hiddenRoot!.hide());
  await twoFrames(page);
  await page.evaluate(() => window.__hiddenRoot!.replaceContents('-replaced'));
  await twoFrames(page);
  await page.evaluate(() => window.__hiddenRoot!.show());

  await expect
    .poll(() => page.evaluate(() => window.__hiddenRoot!.firstRowText()))
    .toContain('-replaced');
  await expectRenderedFromTheTop(page);
});

// A root hidden only for the frame its render runs in is never reported hidden
// by the ResizeObserver, so that render goes ahead with every row reading as
// 0px. Those zeros must not be cached, and the rows must be measured once the
// root is back.
test('CodeView hidden only during its render frame still renders and measures', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openFixture(page);
  await expectRenderedFromTheTop(page);

  await page.evaluate(() =>
    window.__hiddenRoot!.replaceContentsWhileHiddenForOneFrame('-replaced')
  );

  await expect
    .poll(() => page.evaluate(() => window.__hiddenRoot!.firstRowText()))
    .toContain('-replaced');
  await expectRenderedFromTheTop(page);
});

// A hidden root can't be scrolled, so the request is refused with an error
// rather than kept around.
test('CodeView refuses a scroll request while hidden', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openFixture(page);
  await expectRenderedFromTheTop(page);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  await page.evaluate(() => window.__hiddenRoot!.hide());
  await twoFrames(page);
  await page.evaluate(() => window.__hiddenRoot!.scrollToLine(120));
  await page.evaluate(() => window.__hiddenRoot!.show());
  await twoFrames(page);

  expect(errors).toEqual([
    'CodeView.requestScroll: the root has no layout, scroll request ignored',
  ]);
  await expectRenderedFromTheTop(page);
});
