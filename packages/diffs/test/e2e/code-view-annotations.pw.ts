import { expect, type Page, test } from '@playwright/test';

interface ViewportMeasurement {
  scrollTop: number;
  scrollHeight: number;
  anchorTop: number;
  viewportHeight: number;
}

// Track a code line above all annotations so inserting below it should leave
// both the line's viewport position and the root's scroll position unchanged.
function measureViewport(page: Page): Promise<ViewportMeasurement> {
  return page.evaluate(() => {
    const root = window.__annotationScroll?.root;
    const line = root
      ?.querySelector('diffs-container')
      ?.shadowRoot?.querySelector(
        '[data-code]:not([data-deletions]) [data-line="180"]'
      );
    if (root == null || line == null) {
      throw new Error('Missing annotation fixture root or anchor line.');
    }
    return {
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      anchorTop:
        line.getBoundingClientRect().top - root.getBoundingClientRect().top,
      viewportHeight: root.clientHeight,
    };
  });
}

// Wait for annotation height to reach CodeView's layout model, not just for
// the annotation element to exist before its first measurement.
async function waitForAnnotationHeight(
  page: Page,
  height: number
): Promise<void> {
  await page.waitForFunction(
    (height) =>
      window.__annotationScroll?.getMeasuredAnnotationHeight() === height,
    height
  );
}

test.describe('CodeView annotation scroll anchoring', () => {
  for (const type of ['file', 'diff'] as const) {
    for (const { name, distance, multiple } of [
      { name: 'at the bottom', distance: 0, multiple: false },
      { name: 'near the bottom', distance: 20, multiple: false },
      { name: 'with multiple comments', distance: 0, multiple: true },
      { name: 'away from the bottom', distance: 100, multiple: false },
    ]) {
      test(`preserves the viewport when adding an annotation ${name} (${type})`, async ({
        page,
      }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(
          `/test/e2e/fixtures/code-view-annotations.html?type=${type}&multiple=${multiple}`
        );
        await expect(page.locator('[data-line="1"]').first()).toBeVisible();
        await page.evaluate(() => {
          const fixture = window.__annotationScroll;
          if (fixture == null) throw new Error('Missing annotation fixture.');
          fixture.root.scrollTop = fixture.root.scrollHeight;
        });

        const existingHeight = multiple ? 120 : 80;
        const existingCount = multiple ? 2 : 1;
        await expect(page.locator('[data-test-annotation]')).toHaveCount(
          existingCount
        );
        await waitForAnnotationHeight(page, existingHeight);

        // The first scroll reveals the annotations; their measurements grow
        // the range. Position against that measured range before reproducing.
        await page.evaluate((distance) => {
          const fixture = window.__annotationScroll;
          if (fixture == null) throw new Error('Missing annotation fixture.');
          const { root } = fixture;
          root.scrollTop = root.scrollHeight - root.clientHeight - distance;
        }, distance);
        await page.waitForFunction((distance) => {
          const fixture = window.__annotationScroll;
          if (fixture == null) return false;
          const { root } = fixture;
          return (
            root.scrollHeight - root.clientHeight - root.scrollTop ===
              distance && fixture.getScrollTop() === root.scrollTop
          );
        }, distance);
        const before = await measureViewport(page);
        expect(before.anchorTop).toBeGreaterThan(0);
        expect(before.anchorTop).toBeLessThan(before.viewportHeight);

        await page.evaluate(() => window.__annotationScroll?.addAnnotation());
        await expect(page.locator('[data-test-annotation]')).toHaveCount(
          existingCount + 1
        );
        await expect(
          page
            .locator('[data-test-annotation]')
            .filter({ hasText: 'New composer' })
        ).toBeVisible();
        await waitForAnnotationHeight(page, existingHeight + 120);
        const after = await measureViewport(page);

        expect(after.scrollHeight - before.scrollHeight).toBe(120);
        expect(pageErrors).toEqual([]);
        expect.soft(after.scrollTop).toBe(before.scrollTop);
        expect.soft(after.anchorTop).toBeCloseTo(before.anchorTop, 1);
      });
    }
  }
});
