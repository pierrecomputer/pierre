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

// Reveal the existing comment and wait for its height to enter the cache before
// exercising changes that must replace or remove that cached measurement.
async function openMeasuredFixture(
  page: Page,
  type: 'file' | 'diff',
  fileAnnotation = false
): Promise<void> {
  await page.goto(
    `/test/e2e/fixtures/code-view-annotations.html?type=${type}&fileAnnotation=${fileAnnotation}`
  );
  await expect(page.locator('[data-line="1"]').first()).toBeVisible();
  if (fileAnnotation) {
    await page.waitForFunction(
      () => (window.__annotationScroll?.getFirstLineTop() ?? 0) >= 100
    );
  }
  await page.evaluate(() => {
    const fixture = window.__annotationScroll;
    if (fixture == null) throw new Error('Missing annotation fixture.');
    fixture.root.scrollTop = fixture.root.scrollHeight;
  });
  await expect(page.locator('[data-test-annotation]')).toHaveCount(
    fileAnnotation ? 2 : 1
  );
  await waitForAnnotationHeight(page, 80);
}

test.describe('CodeView annotation scroll anchoring', () => {
  for (const type of ['file', 'diff'] as const) {
    test(`keeps every frame stable when removing an offscreen file annotation (${type})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await openMeasuredFixture(page, type, true);
      const firstLineTop = await page.evaluate(() =>
        window.__annotationScroll?.getFirstLineTop()
      );
      expect(firstLineTop).toBeGreaterThanOrEqual(100);
      await expect(page.locator('[data-line="1"]')).toHaveCount(0);
      const before = await measureViewport(page);

      // Sample each frame rather than just the settled position: a diff can
      // recover on its next render while still flashing at the wrong offset.
      const frames = await page.evaluate(async () => {
        const fixture = window.__annotationScroll;
        if (fixture == null) throw new Error('Missing annotation fixture.');
        fixture.removeFileAnnotation();
        const frames = [];
        for (let index = 0; index < 4; index++) {
          await new Promise(requestAnimationFrame);
          const line = fixture.root
            .querySelector('diffs-container')
            ?.shadowRoot?.querySelector(
              '[data-code]:not([data-deletions]) [data-line="180"]'
            );
          if (line == null) throw new Error('Missing anchor line.');
          frames.push({
            anchorTop:
              line.getBoundingClientRect().top -
              fixture.root.getBoundingClientRect().top,
            scrollTop: fixture.root.scrollTop,
            logicalScrollTop: fixture.getScrollTop(),
          });
        }
        return frames;
      });
      for (const frame of frames) {
        expect.soft(frame.anchorTop).toBeCloseTo(before.anchorTop, 1);
        expect.soft(frame.scrollTop).toBe(before.scrollTop);
        expect.soft(frame.logicalScrollTop).toBe(frame.scrollTop);
      }
      expect.soft(errors).toEqual([]);
      expect((await measureViewport(page)).scrollHeight).toBe(
        before.scrollHeight
      );

      // The retained estimate must disappear once the file's top is rendered.
      await page.evaluate(() => {
        const fixture = window.__annotationScroll;
        if (fixture == null) throw new Error('Missing annotation fixture.');
        fixture.root.scrollTop = 0;
      });
      await page.waitForFunction(
        (top) => window.__annotationScroll?.getFirstLineTop() === top,
        firstLineTop! - 100
      );
      expect(
        await page.evaluate(() => window.__annotationScroll?.root.scrollHeight)
      ).toBe(before.scrollHeight - 100);
      expect(errors).toEqual([]);
    });

    test(`remeasures a resized annotation and removes the final annotation height (${type})`, async ({
      page,
    }) => {
      await openMeasuredFixture(page, type);
      const before = await measureViewport(page);

      await page.evaluate(() =>
        window.__annotationScroll?.resizeAnnotations(40)
      );
      await waitForAnnotationHeight(page, 40);
      expect((await measureViewport(page)).scrollHeight).toBe(
        before.scrollHeight - 40
      );

      await page.evaluate(() => window.__annotationScroll?.clearAnnotations());
      await expect(page.locator('[data-test-annotation]')).toHaveCount(0);
      await waitForAnnotationHeight(page, 0);
      expect((await measureViewport(page)).scrollHeight).toBe(
        before.scrollHeight - 80
      );
    });

    test(`corrects a removed offscreen annotation when its row renders again (${type})`, async ({
      page,
    }) => {
      await openMeasuredFixture(page, type);
      const before = await measureViewport(page);
      await page.evaluate(() => {
        const fixture = window.__annotationScroll;
        if (fixture == null) throw new Error('Missing annotation fixture.');
        fixture.root.scrollTop = 0;
      });
      // Annotation content can remain in the light DOM after its shadow-DOM
      // row is virtualized away. Check the row itself before removing it.
      await expect(page.locator('[data-line="190"]')).toHaveCount(0);
      await page.evaluate(async () => {
        window.__annotationScroll?.clearAnnotations();
        // Let the scheduled render consume the new list while the removed
        // annotation's row is still outside the rendered window.
        await new Promise(requestAnimationFrame);
      });
      expect(
        await page.evaluate(() =>
          window.__annotationScroll?.getMeasuredAnnotationHeight()
        )
      ).toBe(80);

      await page.evaluate(() => {
        const fixture = window.__annotationScroll;
        if (fixture == null) throw new Error('Missing annotation fixture.');
        fixture.root.scrollTop = fixture.root.scrollHeight;
      });
      await waitForAnnotationHeight(page, 0);
      expect((await measureViewport(page)).scrollHeight).toBe(
        before.scrollHeight - 80
      );
    });

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
