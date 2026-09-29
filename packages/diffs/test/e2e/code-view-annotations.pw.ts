import { expect, type Page, test } from '@playwright/test';

interface ViewportMeasurement {
  scrollTop: number;
  logicalScrollTop: number;
  scrollHeight: number;
  anchorTop: number;
  viewportHeight: number;
}

// Track a code line above all annotations so inserting below it should leave
// both the line's viewport position and the root's scroll position unchanged.
function measureViewport(page: Page): Promise<ViewportMeasurement> {
  return page.evaluate(() => {
    const fixture = window.__annotationScroll;
    const root = fixture?.root;
    const line = root
      ?.querySelector('diffs-container')
      ?.shadowRoot?.querySelector(
        '[data-code]:not([data-deletions]) [data-line="180"]'
      );
    if (fixture == null || root == null || line == null) {
      throw new Error('Missing annotation fixture root or anchor line.');
    }
    return {
      scrollTop: root.scrollTop,
      logicalScrollTop: fixture.getScrollTop(),
      scrollHeight: root.scrollHeight,
      anchorTop:
        line.getBoundingClientRect().top - root.getBoundingClientRect().top,
      viewportHeight: root.clientHeight,
    };
  });
}

// Position against the measured scroll range and wait for CodeView to consume
// the scroll event before an annotation update captures its anchor.
async function setDistanceFromBottom(
  page: Page,
  distance: number
): Promise<void> {
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
      root.scrollHeight - root.clientHeight - root.scrollTop === distance &&
      fixture.getScrollTop() === root.scrollTop
    );
  }, distance);
}

// Capture consecutive frames inside the browser so a later correction cannot
// hide a transient jump or disagreement between the model and DOM scroll state.
function shrinkAnnotationAndMeasureFrames(
  page: Page,
  height: 0 | 40
): Promise<ViewportMeasurement[]> {
  return page.evaluate(async (height) => {
    const fixture = window.__annotationScroll;
    if (fixture == null) throw new Error('Missing annotation fixture.');
    if (height === 0) {
      fixture.clearAnnotations();
    } else {
      fixture.resizeAnnotations(height);
    }
    const { root } = fixture;
    const frames = [];
    for (let index = 0; index < 4; index++) {
      await new Promise(requestAnimationFrame);
      const line = root
        .querySelector('diffs-container')
        ?.shadowRoot?.querySelector(
          '[data-code]:not([data-deletions]) [data-line="180"]'
        );
      if (line == null) throw new Error('Missing anchor line.');
      frames.push({
        scrollTop: root.scrollTop,
        logicalScrollTop: fixture.getScrollTop(),
        scrollHeight: root.scrollHeight,
        anchorTop:
          line.getBoundingClientRect().top - root.getBoundingClientRect().top,
        viewportHeight: root.clientHeight,
      });
    }
    return frames;
  }, height);
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
  fileAnnotation = false,
  query = ''
): Promise<void> {
  await page.goto(
    `/test/e2e/fixtures/code-view-annotations.html?type=${type}&fileAnnotation=${fileAnnotation}${query}`
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
  test('remeasures annotations across split and unified layout changes', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await openMeasuredFixture(page, 'diff');
    const before = await measureViewport(page);
    await page.evaluate(() =>
      window.__annotationScroll?.setDiffStyle('unified')
    );
    await page.waitForFunction(
      (height) =>
        (window.__annotationScroll?.root.scrollHeight ?? 0) > height + 3000,
      before.scrollHeight
    );
    await page.evaluate(() =>
      window.__annotationScroll?.scrollToLine(200, 'instant')
    );
    await expect(page.locator('[data-test-annotation]')).toBeVisible();
    await waitForAnnotationHeight(page, 80);
    await page.evaluate(() => window.__annotationScroll?.resizeAnnotations(40));
    await waitForAnnotationHeight(page, 40);
    await page.evaluate(() => window.__annotationScroll?.setDiffStyle('split'));
    await page.waitForFunction(
      (height) =>
        (window.__annotationScroll?.root.scrollHeight ?? Infinity) < height,
      before.scrollHeight + 500
    );
    await page.evaluate(() =>
      window.__annotationScroll?.scrollToLine(200, 'instant')
    );
    await expect(page.locator('[data-test-annotation]')).toBeVisible();
    await waitForAnnotationHeight(page, 40);
    expect((await measureViewport(page)).scrollHeight).toBe(
      before.scrollHeight - 40
    );
    expect(
      await page.evaluate(() => window.__annotationScroll?.getScrollTop())
    ).toBe(
      await page.evaluate(() => window.__annotationScroll?.root.scrollTop)
    );
    expect(errors).toEqual([]);
  });

  for (const type of ['file', 'diff'] as const) {
    for (const { name, query } of [
      { name: 'controlled React props', query: '&react=controlled' },
      { name: 'imperative React ref', query: '&react=imperative' },
    ]) {
      test(`reconciles annotation additions, resizing, and removal through ${name} (${type})`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await openMeasuredFixture(page, type, false, query);
        await setDistanceFromBottom(page, 100);
        const before = await measureViewport(page);
        await page.evaluate(() => window.__annotationScroll?.addAnnotation());
        await waitForAnnotationHeight(page, 200);
        expect((await measureViewport(page)).scrollHeight).toBe(
          before.scrollHeight + 120
        );
        for (const height of [40, 0] as const) {
          const frames = await shrinkAnnotationAndMeasureFrames(page, height);
          for (const frame of frames) {
            expect.soft(frame.anchorTop).toBeCloseTo(before.anchorTop, 1);
            expect.soft(frame.scrollTop).toBe(before.scrollTop);
            expect.soft(frame.logicalScrollTop).toBe(frame.scrollTop);
          }
          await waitForAnnotationHeight(page, height * 2);
          await expect(page.locator('[data-test-annotation]')).toHaveCount(
            height === 0 ? 0 : 2
          );
          const after = await measureViewport(page);
          expect(after.scrollHeight).toBe(
            before.scrollHeight - 80 + height * 2
          );
          expect(after.anchorTop).toBeCloseTo(before.anchorTop, 1);
          expect(after.scrollTop).toBe(before.scrollTop);
          expect(after.logicalScrollTop).toBe(after.scrollTop);
        }
        expect(errors).toEqual([]);
      });
    }

    test(`keeps CodeView's item annotations authoritative over child setters (${type})`, async ({
      page,
    }) => {
      await openMeasuredFixture(page, type);
      const before = await measureViewport(page);
      await page.evaluate(async () => {
        window.__annotationScroll?.setChildAnnotations();
        await new Promise(requestAnimationFrame);
      });
      await expect(page.locator('[data-test-annotation]')).toHaveCount(1);
      expect(
        await page.evaluate(() =>
          window.__annotationScroll?.getMeasuredAnnotationHeight()
        )
      ).toBe(80);
      expect(await measureViewport(page)).toEqual(before);
    });

    test(`moves and removes annotations through editor document changes (${type})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await openMeasuredFixture(page, type, false, '&edit=true');
      await page.waitForFunction(() =>
        window.__annotationScroll?.isEditorReady()
      );
      await setDistanceFromBottom(page, 100);
      const before = await measureViewport(page);
      await page.evaluate(() =>
        window.__annotationScroll?.editAnnotationLine(false)
      );
      await page.waitForFunction(
        () => window.__annotationScroll?.getEditorAnnotationLines()?.[0] === 191
      );
      await waitForAnnotationHeight(page, 80);
      const moved = await measureViewport(page);
      expect(moved.scrollHeight).toBe(before.scrollHeight + 20);
      expect(moved.anchorTop).toBeCloseTo(before.anchorTop, 1);
      expect(moved.logicalScrollTop).toBe(moved.scrollTop);
      await page.evaluate(() =>
        window.__annotationScroll?.editAnnotationLine(true)
      );
      await page.waitForFunction(
        () =>
          window.__annotationScroll?.getEditorAnnotationLines()?.length === 0
      );
      await waitForAnnotationHeight(page, 0);
      await expect(page.locator('[data-test-annotation]')).toHaveCount(0);
      await page.waitForFunction(
        (height) => window.__annotationScroll?.root.scrollHeight === height,
        before.scrollHeight - 80
      );
      const removed = await measureViewport(page);
      expect(removed.scrollHeight).toBe(before.scrollHeight - 80);
      expect(removed.anchorTop).toBeCloseTo(before.anchorTop, 1);
      expect(removed.logicalScrollTop).toBe(removed.scrollTop);
      expect(errors).toEqual([]);
    });

    for (const behavior of ['instant', 'smooth'] as const) {
      test(`reaches a growing scroll target with ${behavior} scrolling (${type})`, async ({
        page,
      }) => {
        await openMeasuredFixture(page, type);
        const before = await measureViewport(page);
        await page.evaluate(() => window.__annotationScroll?.setLineCount(400));
        // Replacement highlighting is asynchronous; the new lines must enter
        // the displayed layout before a line scroll target can resolve them.
        await page.waitForFunction(
          (height) =>
            (window.__annotationScroll?.root.scrollHeight ?? 0) > height,
          before.scrollHeight + 3000
        );
        await page.evaluate((behavior) => {
          const fixture = window.__annotationScroll;
          if (fixture == null) throw new Error('Missing annotation fixture.');
          fixture.scrollToLine(400, behavior);
        }, behavior);
        await expect(page.locator('[data-line="400"]').last()).toBeVisible();
        await page.waitForFunction(() => {
          const fixture = window.__annotationScroll;
          if (fixture == null) return false;
          const { root } = fixture;
          const last = root
            .querySelector('diffs-container')
            ?.shadowRoot?.querySelector(
              '[data-code]:not([data-deletions]) [data-line="400"]'
            );
          // A diff's final line includes its "No newline" metadata row in
          // the scroll target height; plain files have no such trailing row.
          const metadata = last?.nextElementSibling;
          const targetEnd =
            metadata != null && metadata.hasAttribute('data-no-newline')
              ? metadata
              : last;
          return (
            targetEnd != null &&
            Math.abs(
              targetEnd.getBoundingClientRect().bottom -
                root.getBoundingClientRect().bottom
            ) <= 1 &&
            Math.abs(fixture.getScrollTop() - root.scrollTop) <= 1
          );
        });
        expect(
          await page.evaluate(() => window.__annotationScroll?.root.scrollTop)
        ).toBeGreaterThan(before.scrollHeight);
      });
    }

    test(`shrinks the scroll range after shorter content and item removal (${type})`, async ({
      page,
    }) => {
      await openMeasuredFixture(page, type);
      const before = await measureViewport(page);
      await page.evaluate(() => window.__annotationScroll?.setLineCount(100));
      await expect(page.locator('[data-line="100"]').last()).toBeVisible();
      const shorter = await page.evaluate(() => {
        const fixture = window.__annotationScroll;
        if (fixture == null) throw new Error('Missing annotation fixture.');
        return {
          height: fixture.root.scrollHeight,
          top: fixture.root.scrollTop,
          logical: fixture.getScrollTop(),
          viewport: fixture.root.clientHeight,
        };
      });
      expect(shorter.height).toBeLessThan(before.scrollHeight - 80);
      expect(shorter.top).toBe(shorter.height - shorter.viewport);
      expect(shorter.logical).toBe(shorter.top);
      await page.evaluate(() => window.__annotationScroll?.addTail());
      await page.waitForFunction(
        (height) => (window.__annotationScroll?.root.scrollTop ?? 0) > height,
        shorter.height
      );
      await page.evaluate(() => window.__annotationScroll?.removeTail());
      await page.waitForFunction(
        (height) => window.__annotationScroll?.root.scrollHeight === height,
        shorter.height
      );
      expect(
        await page.evaluate(() => window.__annotationScroll?.root.scrollTop)
      ).toBe(shorter.top);
      expect(
        await page.evaluate(() => window.__annotationScroll?.getScrollTop())
      ).toBe(shorter.top);
    });

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

    for (const distance of [0, 20, 100]) {
      test(`preserves the anchor or clamps to the bottom when annotations shrink ${distance}px from the bottom (${type})`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await openMeasuredFixture(page, type);
        await setDistanceFromBottom(page, distance);
        await expect(page.locator('[data-test-annotation]')).toBeVisible();
        let before = await measureViewport(page);
        expect(before.anchorTop).toBeGreaterThan(0);
        expect(before.anchorTop).toBeLessThan(before.viewportHeight);

        for (const height of [40, 0] as const) {
          await test.step(
            height === 0
              ? 'remove the final annotation'
              : 'shrink the annotation',
            async () => {
              // Both changes remove 40px below our anchor. Its position can stay
              // fixed unless the smaller scroll range forces a bottom clamp.
              const expectedHeight = before.scrollHeight - 40;
              const expectedScrollTop = Math.min(
                before.scrollTop,
                expectedHeight - before.viewportHeight
              );
              const expectedAnchorTop =
                before.anchorTop + before.scrollTop - expectedScrollTop;
              const frames = await shrinkAnnotationAndMeasureFrames(
                page,
                height
              );
              for (const frame of frames) {
                expect.soft(frame.scrollHeight).toBe(expectedHeight);
                expect.soft(frame.scrollTop).toBe(expectedScrollTop);
                expect.soft(frame.logicalScrollTop).toBe(frame.scrollTop);
                expect.soft(frame.anchorTop).toBeCloseTo(expectedAnchorTop, 1);
              }
              await waitForAnnotationHeight(page, height);
              await expect(page.locator('[data-test-annotation]')).toHaveCount(
                height === 0 ? 0 : 1
              );
              before = await measureViewport(page);
              expect(before.scrollHeight).toBe(expectedHeight);
              expect(before.scrollTop).toBe(expectedScrollTop);
              expect(before.logicalScrollTop).toBe(before.scrollTop);
              expect(before.anchorTop).toBeCloseTo(expectedAnchorTop, 1);
              expect(errors).toEqual([]);
            }
          );
        }
      });
    }

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
        await setDistanceFromBottom(page, distance);
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
