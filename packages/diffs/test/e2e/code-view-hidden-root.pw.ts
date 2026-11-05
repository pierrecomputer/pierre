import { expect, type Page, test } from '@playwright/test';

// The fixture's window helpers (see fixtures/code-view-hidden-root.html).
declare global {
  interface Window {
    __hiddenRootReady?: boolean;
    __hiddenRoot?: {
      hide(): void;
      show(): void;
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

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/code-view-hidden-root.html');
  await page.waitForFunction(() => window.__hiddenRootReady === true);
}

// Scrolled to the top, the first rendered row must be line 1, sitting at the
// top of the root, and no row may have collapsed to zero height.
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
