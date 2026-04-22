import { expect, type Page, test, type TestInfo } from '@playwright/test';

// Keep this regression directly invokable, but out of the default e2e sweep.
// It locks internal debug hooks and tiny scroll steps so sticky-row trigger
// alignment failures stay deterministic instead of turning into manual demo QA.

type StickyElementIdentity = {
  dataset: {
    fileTreeVirtualizedRoot?: string;
    fileTreeVirtualizedScroll?: string;
    fileTreeVirtualizedSticky?: string;
    type?: string;
  };
  role: string | null;
  tagName: string;
};

type StickyPositioningSnapshot = {
  contain: string | null;
  display: string | null;
  left: string | null;
  marginBottom: string | null;
  marginTop: string | null;
  position: string | null;
  right: string | null;
  top: string | null;
  transform: string | null;
};

type StickyLayerSnapshot = {
  style: StickyPositioningSnapshot;
};

type StickyContextMenuSample = {
  anchorAncestorChain: Array<{
    identity: StickyElementIdentity;
    offsetTop: number;
    scrollTop: number;
    style: StickyPositioningSnapshot;
  }>;
  anchorComputedStyle: StickyPositioningSnapshot | null;
  anchorInlineStyle: {
    left: string | null;
    position: string | null;
    right: string | null;
    top: string | null;
    transform: string | null;
  };
  anchorOffsetParent: StickyElementIdentity | null;
  anchorRectTopWithinOffsetParent: number | null;
  anchorRectTopWithinRoot: number | null;
  anchorRectTopWithinScroll: number | null;
  anchorStyleTop: number | null;
  anchorVisible: boolean;
  driftFromRectWithinRoot: number | null;
  driftFromRectWithinScroll: number | null;
  driftFromStyleWithinRoot: number | null;
  driftFromStyleWithinScroll: number | null;
  driftFromTriggerWithinRoot: number | null;
  driftFromTriggerWithinScroll: number | null;
  rowMounted: boolean;
  rowTopWithinRoot: number | null;
  rowTopWithinScroll: number | null;
  scrollTop: number;
  stickyPaths: string[];
  stickyWindow: StickyLayerSnapshot | null;
  triggerRectTopWithinRoot: number | null;
  triggerRectTopWithinScroll: number | null;
  triggerVisible: boolean;
  virtualizedList: StickyLayerSnapshot | null;
};

type StickyContextMenuCandidate = {
  depth: number;
  path: string;
  scrollTop: number;
  stickyCount: number;
  stickyPaths: string[];
};

type StickyContextMenuStepDeltas = {
  immediate: {
    anchorRectTopWithinRoot: number | null;
    anchorRectTopWithinScroll: number | null;
    anchorStyleTop: number | null;
    driftFromRectWithinRoot: number | null;
    driftFromRectWithinScroll: number | null;
    driftFromTriggerWithinRoot: number | null;
    driftFromTriggerWithinScroll: number | null;
    rowTopWithinRoot: number | null;
    rowTopWithinScroll: number | null;
    triggerRectTopWithinRoot: number | null;
    triggerRectTopWithinScroll: number | null;
  };
  scrollTop: number;
  settled: {
    anchorRectTopWithinRoot: number | null;
    anchorRectTopWithinScroll: number | null;
    anchorStyleTop: number | null;
    driftFromRectWithinRoot: number | null;
    driftFromRectWithinScroll: number | null;
    driftFromTriggerWithinRoot: number | null;
    driftFromTriggerWithinScroll: number | null;
    rowTopWithinRoot: number | null;
    rowTopWithinScroll: number | null;
    triggerRectTopWithinRoot: number | null;
    triggerRectTopWithinScroll: number | null;
  };
};

type StickyContextMenuStep = {
  before: StickyContextMenuSample;
  deltas: StickyContextMenuStepDeltas;
  immediate: StickyContextMenuSample;
  label: string;
  settled: StickyContextMenuSample;
  targetScrollTop: number;
};

type StickyContextMenuMeasurement = {
  baseline: StickyContextMenuSample;
  candidate: StickyContextMenuCandidate;
  diagnosis: {
    anchorMovesWithoutInlineTopChange: boolean;
    anchorOffsetParent: StickyElementIdentity | null;
    stickyWindowTransform: string | null;
    virtualizedListTransform: string | null;
  };
  screenshotPaths: {
    before: string;
    immediate: string;
    step: string;
  } | null;
  steps: StickyContextMenuStep[];
};

type StickyHoverSuppressionSample = {
  anchorDisplay: string | null;
  anchorVisible: boolean;
  menuPath: string | null;
  rowBackgroundColor: string | null;
  rowContextHovered: boolean;
  rowMatchesHover: boolean;
  rowMounted: boolean;
  rowPointerEvents: string | null;
  rootIsScrolling: boolean;
  triggerDisplay: string | null;
  triggerVisible: boolean;
  virtualizedListIsScrolling: boolean;
};

type StickyContextMenuDispatchResult = {
  defaultPrevented: boolean;
  menuPath: string | null;
};

type StickyRowRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

declare global {
  interface Window {
    __stickyContextMenuDriftFixtureReady?: boolean;
    __stickyContextMenuDriftProbe?: {
      dispatchStickyContextMenu: (
        path: string
      ) => StickyContextMenuDispatchResult;
      findScenarioCandidate: (options?: {
        maxScrollTop?: number;
        minDepth?: number;
        minStickyCount?: number;
        settleFrames?: number;
        step?: number;
      }) => Promise<StickyContextMenuCandidate | null>;
      hoverRow: (path: string) => void;
      nextFrames: (count?: number) => Promise<void>;
      runScenario: (
        path: string,
        scrollTops: readonly number[],
        settleFrames?: number
      ) => Promise<
        Array<{
          before: StickyContextMenuSample;
          immediate: StickyContextMenuSample;
          scrollTop: number;
          settled: StickyContextMenuSample;
        }>
      >;
      sampleHoverSuppression: (path: string) => StickyHoverSuppressionSample;
      setScrollSuppressionDisabled: (disabled: boolean) => void;
      setScrollTop: (scrollTop: number) => void;
      setTriggerPath: (path: string | null) => void;
    };
  }
}

const mismatchTolerance = 0.5;
const settleFrames = 2;
const scenarioSteps = [
  { delta: 2, label: 'down-2' },
  { delta: 4, label: 'down-4' },
  { delta: 1, label: 'up-1' },
] as const;

const delta = (next: number | null, previous: number | null): number | null => {
  if (next == null || previous == null) {
    return null;
  }

  return next - previous;
};

const nextFrames = async (
  page: Page,
  count: number = settleFrames
): Promise<void> => {
  await page.evaluate((nextCount) => {
    return window.__stickyContextMenuDriftProbe?.nextFrames(nextCount);
  }, count);
};

const setScrollTop = async (page: Page, scrollTop: number): Promise<void> => {
  await page.evaluate((nextScrollTop) => {
    window.__stickyContextMenuDriftProbe?.setScrollTop(nextScrollTop);
  }, scrollTop);
};

// Uses real pointer movement for native :hover coverage; the fixture-level
// hover hook only covers React's context-hover state.
const getStickyRowRect = async (
  page: Page,
  path: string
): Promise<StickyRowRect> => {
  const rect = await page.evaluate((nextPath) => {
    const host = document.querySelector('file-tree-container');
    const shadowRoot = host?.shadowRoot;
    const row = Array.from(
      shadowRoot?.querySelectorAll(
        'button[data-file-tree-sticky-row="true"]'
      ) ?? []
    ).find((button): button is HTMLButtonElement => {
      return (
        button instanceof HTMLButtonElement &&
        button.dataset.fileTreeStickyPath === nextPath
      );
    });
    if (!(row instanceof HTMLButtonElement)) {
      return null;
    }

    const rowRect = row.getBoundingClientRect();
    return {
      height: rowRect.height,
      left: rowRect.left,
      top: rowRect.top,
      width: rowRect.width,
    };
  }, path);

  expect(rect).not.toBeNull();
  if (rect == null) {
    throw new Error(`Missing sticky row for ${path}.`);
  }

  return rect;
};

const toMeasuredStep = (
  rawStep: {
    before: StickyContextMenuSample;
    immediate: StickyContextMenuSample;
    scrollTop: number;
    settled: StickyContextMenuSample;
  },
  label: string
): StickyContextMenuStep => {
  const { before, immediate, scrollTop, settled } = rawStep;

  return {
    before,
    deltas: {
      immediate: {
        anchorRectTopWithinRoot: delta(
          immediate.anchorRectTopWithinRoot,
          before.anchorRectTopWithinRoot
        ),
        anchorRectTopWithinScroll: delta(
          immediate.anchorRectTopWithinScroll,
          before.anchorRectTopWithinScroll
        ),
        anchorStyleTop: delta(immediate.anchorStyleTop, before.anchorStyleTop),
        driftFromRectWithinRoot: delta(
          immediate.driftFromRectWithinRoot,
          before.driftFromRectWithinRoot
        ),
        driftFromRectWithinScroll: delta(
          immediate.driftFromRectWithinScroll,
          before.driftFromRectWithinScroll
        ),
        driftFromTriggerWithinRoot: delta(
          immediate.driftFromTriggerWithinRoot,
          before.driftFromTriggerWithinRoot
        ),
        driftFromTriggerWithinScroll: delta(
          immediate.driftFromTriggerWithinScroll,
          before.driftFromTriggerWithinScroll
        ),
        rowTopWithinRoot: delta(
          immediate.rowTopWithinRoot,
          before.rowTopWithinRoot
        ),
        rowTopWithinScroll: delta(
          immediate.rowTopWithinScroll,
          before.rowTopWithinScroll
        ),
        triggerRectTopWithinRoot: delta(
          immediate.triggerRectTopWithinRoot,
          before.triggerRectTopWithinRoot
        ),
        triggerRectTopWithinScroll: delta(
          immediate.triggerRectTopWithinScroll,
          before.triggerRectTopWithinScroll
        ),
      },
      scrollTop: immediate.scrollTop - before.scrollTop,
      settled: {
        anchorRectTopWithinRoot: delta(
          settled.anchorRectTopWithinRoot,
          before.anchorRectTopWithinRoot
        ),
        anchorRectTopWithinScroll: delta(
          settled.anchorRectTopWithinScroll,
          before.anchorRectTopWithinScroll
        ),
        anchorStyleTop: delta(settled.anchorStyleTop, before.anchorStyleTop),
        driftFromRectWithinRoot: delta(
          settled.driftFromRectWithinRoot,
          before.driftFromRectWithinRoot
        ),
        driftFromRectWithinScroll: delta(
          settled.driftFromRectWithinScroll,
          before.driftFromRectWithinScroll
        ),
        driftFromTriggerWithinRoot: delta(
          settled.driftFromTriggerWithinRoot,
          before.driftFromTriggerWithinRoot
        ),
        driftFromTriggerWithinScroll: delta(
          settled.driftFromTriggerWithinScroll,
          before.driftFromTriggerWithinScroll
        ),
        rowTopWithinRoot: delta(
          settled.rowTopWithinRoot,
          before.rowTopWithinRoot
        ),
        rowTopWithinScroll: delta(
          settled.rowTopWithinScroll,
          before.rowTopWithinScroll
        ),
        triggerRectTopWithinRoot: delta(
          settled.triggerRectTopWithinRoot,
          before.triggerRectTopWithinRoot
        ),
        triggerRectTopWithinScroll: delta(
          settled.triggerRectTopWithinScroll,
          before.triggerRectTopWithinScroll
        ),
      },
    },
    immediate,
    label,
    settled,
    targetScrollTop: scrollTop,
  };
};

const runScenario = async (
  page: Page,
  path: string,
  scrollTops: readonly number[]
): Promise<StickyContextMenuStep[]> => {
  const steps = await page.evaluate(
    ({ path: nextPath, scrollTops: nextScrollTops, nextSettleFrames }) => {
      return (
        window.__stickyContextMenuDriftProbe?.runScenario(
          nextPath,
          nextScrollTops,
          nextSettleFrames
        ) ?? null
      );
    },
    { path, scrollTops, nextSettleFrames: settleFrames }
  );

  expect(steps).not.toBeNull();
  if (steps == null) {
    throw new Error(`Missing sticky drift scenario for ${path}`);
  }

  return steps.map((step, index) => {
    const scenarioStep = scenarioSteps[index];
    if (scenarioStep == null) {
      throw new Error(`Missing sticky drift label for step ${index}`);
    }

    return toMeasuredStep(step, scenarioStep.label);
  });
};

const captureMismatchScreenshots = async (
  page: Page,
  testInfo: TestInfo,
  path: string,
  step: StickyContextMenuStep
): Promise<StickyContextMenuMeasurement['screenshotPaths']> => {
  await page.evaluate(
    ({ beforeScrollTop, lockedPath }) => {
      const probe = window.__stickyContextMenuDriftProbe;
      probe?.setTriggerPath(lockedPath);
      probe?.setScrollTop(beforeScrollTop);
    },
    { beforeScrollTop: step.before.scrollTop, lockedPath: path }
  );
  await nextFrames(page);

  const beforePath = testInfo.outputPath(`${step.label}-before.png`);
  await page.screenshot({ fullPage: true, path: beforePath });

  await setScrollTop(page, step.targetScrollTop);
  const immediatePath = testInfo.outputPath(`${step.label}-immediate.png`);
  await page.screenshot({ fullPage: true, path: immediatePath });

  return {
    before: beforePath,
    immediate: immediatePath,
    step: step.label,
  };
};

test.describe('sticky context-menu drift fixture @diagnostic', () => {
  test('keeps the floating trigger aligned to the deepest sticky row during tiny scroll steps', async ({
    page,
  }, testInfo) => {
    await page.goto(
      '/test/e2e/fixtures/file-tree-sticky-context-menu-scroll-drift.html'
    );
    await page.waitForFunction(
      () => window.__stickyContextMenuDriftFixtureReady === true
    );

    const candidate = await page.evaluate(async (nextSettleFrames) => {
      return (
        (await window.__stickyContextMenuDriftProbe?.findScenarioCandidate({
          maxScrollTop: 3000,
          minDepth: 4,
          minStickyCount: 3,
          settleFrames: nextSettleFrames,
          step: 30,
        })) ?? null
      );
    }, settleFrames);

    expect(candidate).not.toBeNull();
    if (candidate == null) {
      return;
    }

    const targetPath = candidate.stickyPaths.at(-1) ?? candidate.path;

    await page.evaluate(
      ({ path, scrollTop }) => {
        const probe = window.__stickyContextMenuDriftProbe;
        probe?.setScrollSuppressionDisabled(true);
        probe?.setScrollTop(scrollTop);
        probe?.setTriggerPath(path);
      },
      { path: targetPath, scrollTop: candidate.scrollTop }
    );
    const steps = await runScenario(
      page,
      targetPath,
      scenarioSteps.map(
        ({ delta: stepDelta }) => candidate.scrollTop + stepDelta
      )
    );
    const baselineStep = steps[0];
    expect(baselineStep).toBeDefined();
    if (baselineStep == null) {
      throw new Error('Missing sticky drift baseline step');
    }
    const baseline = baselineStep.before;

    const maxImmediateDrift = Math.max(
      ...steps.map((step) =>
        Math.max(
          Math.abs(step.deltas.immediate.driftFromRectWithinRoot ?? 0),
          Math.abs(step.deltas.immediate.driftFromTriggerWithinRoot ?? 0)
        )
      )
    );
    const screenshotStep = steps.find((step) => {
      return (
        Math.max(
          Math.abs(step.deltas.immediate.driftFromRectWithinRoot ?? 0),
          Math.abs(step.deltas.immediate.driftFromTriggerWithinRoot ?? 0)
        ) > mismatchTolerance
      );
    });
    const screenshotPaths =
      screenshotStep == null
        ? null
        : await captureMismatchScreenshots(
            page,
            testInfo,
            targetPath,
            screenshotStep
          );

    const measurement: StickyContextMenuMeasurement = {
      baseline,
      candidate,
      diagnosis: {
        anchorMovesWithoutInlineTopChange: steps.some((step) => {
          return (
            Math.abs(step.deltas.immediate.anchorRectTopWithinRoot ?? 0) > 0 &&
            Math.abs(step.deltas.immediate.anchorStyleTop ?? 0) === 0
          );
        }),
        anchorOffsetParent: baseline.anchorOffsetParent,
        stickyWindowTransform: baseline.stickyWindow?.style.transform ?? null,
        virtualizedListTransform:
          baseline.virtualizedList?.style.transform ?? null,
      },
      screenshotPaths,
      steps,
    };

    await page.evaluate((value) => {
      const report = document.querySelector('[data-sticky-drift-report]');
      if (report instanceof HTMLPreElement) {
        report.textContent = JSON.stringify(value, null, 2);
      }
    }, measurement);

    expect(candidate.stickyCount).toBeGreaterThanOrEqual(3);
    expect(targetPath).not.toBe('');
    expect(baseline.triggerVisible).toBe(true);
    expect(baseline.anchorVisible).toBe(true);
    expect(baseline.rowMounted).toBe(true);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.immediate.rowMounted).toBe(true);
    expect(steps[0]?.immediate.anchorVisible).toBe(true);
    expect(steps[0]?.immediate.triggerVisible).toBe(true);
    expect(maxImmediateDrift).toBeLessThanOrEqual(mismatchTolerance);

    const reportText = await page
      .locator('[data-sticky-drift-report]')
      .innerText();
    expect(reportText).toContain(targetPath);
    expect(reportText).toContain('anchorOffsetParent');
    expect(reportText).toContain('stickyWindowTransform');
    expect(reportText).toContain('down-2');
  });
});

test.describe('sticky focused row context-menu regressions', () => {
  test('suppresses sticky hover and context-menu opening while scrolling', async ({
    page,
  }) => {
    await page.goto(
      '/test/e2e/fixtures/file-tree-sticky-context-menu-scroll-drift.html'
    );
    await page.waitForFunction(
      () => window.__stickyContextMenuDriftFixtureReady === true
    );

    const candidate = await page.evaluate(async (nextSettleFrames) => {
      return (
        (await window.__stickyContextMenuDriftProbe?.findScenarioCandidate({
          maxScrollTop: 3000,
          minDepth: 4,
          minStickyCount: 3,
          settleFrames: nextSettleFrames,
          step: 30,
        })) ?? null
      );
    }, settleFrames);
    expect(candidate).not.toBeNull();
    if (candidate == null) {
      return;
    }

    const hoverPath = candidate.stickyPaths[0];
    expect(hoverPath).toBeDefined();
    if (hoverPath == null) {
      throw new Error('Missing sticky row path to hover.');
    }

    await setScrollTop(page, candidate.scrollTop);
    await page.waitForTimeout(80);
    await nextFrames(page);

    const resting = await page.evaluate((path) => {
      return (
        window.__stickyContextMenuDriftProbe?.sampleHoverSuppression(path) ??
        null
      );
    }, hoverPath);
    expect(resting).not.toBeNull();
    if (resting == null) {
      return;
    }
    expect(resting.rowMounted).toBe(true);
    expect(resting.rootIsScrolling).toBe(false);
    expect(resting.virtualizedListIsScrolling).toBe(false);

    const stickyRect = await getStickyRowRect(page, hoverPath);
    await page.mouse.move(
      stickyRect.left + stickyRect.width / 2,
      stickyRect.top + stickyRect.height / 2
    );
    await page.evaluate((path) => {
      window.__stickyContextMenuDriftProbe?.hoverRow(path);
    }, hoverPath);
    await nextFrames(page);

    const hovered = await page.evaluate((path) => {
      return (
        window.__stickyContextMenuDriftProbe?.sampleHoverSuppression(path) ??
        null
      );
    }, hoverPath);
    expect(hovered).not.toBeNull();
    if (hovered == null) {
      return;
    }
    expect(hovered.rowContextHovered).toBe(true);
    expect(hovered.rowPointerEvents).toBe('auto');
    expect(hovered.anchorVisible).toBe(true);
    expect(hovered.triggerVisible).toBe(true);
    expect(hovered.rowBackgroundColor).not.toBe(resting.rowBackgroundColor);

    const scrolling = await page.evaluate(
      ({ path, scrollTop }) => {
        const probe = window.__stickyContextMenuDriftProbe;
        probe?.setScrollTop(scrollTop);
        return probe?.sampleHoverSuppression(path) ?? null;
      },
      { path: hoverPath, scrollTop: candidate.scrollTop + 2 }
    );
    expect(scrolling).not.toBeNull();
    if (scrolling == null) {
      return;
    }
    expect(scrolling.rootIsScrolling).toBe(true);
    expect(scrolling.virtualizedListIsScrolling).toBe(true);
    expect(scrolling.rowPointerEvents).toBe('none');
    expect(scrolling.rowBackgroundColor).toBe(resting.rowBackgroundColor);
    expect(scrolling.anchorDisplay).toBe('none');

    const contextMenuAttempt = await page.evaluate((path) => {
      return (
        window.__stickyContextMenuDriftProbe?.dispatchStickyContextMenu(path) ??
        null
      );
    }, hoverPath);
    expect(contextMenuAttempt).not.toBeNull();
    expect(contextMenuAttempt?.defaultPrevented).toBe(true);
    await nextFrames(page);

    const afterContextMenuAttempt = await page.evaluate((path) => {
      return (
        window.__stickyContextMenuDriftProbe?.sampleHoverSuppression(path) ??
        null
      );
    }, hoverPath);
    expect(afterContextMenuAttempt?.menuPath).toBeNull();
    expect(contextMenuAttempt?.menuPath).toBeNull();
  });

  test('does not restore the trigger to a parked focused row after hover clears', async ({
    page,
  }) => {
    await page.goto(
      '/test/e2e/fixtures/file-tree-sticky-context-menu-scroll-drift.html'
    );
    await page.waitForFunction(
      () => window.__stickyContextMenuDriftFixtureReady === true
    );

    const focusedPath = await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const row = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((button) => {
        return (
          button instanceof HTMLButtonElement &&
          button.dataset.fileTreeStickyRow !== 'true' &&
          button.dataset.itemParked !== 'true' &&
          button.dataset.itemType === 'file'
        );
      });
      if (!(row instanceof HTMLButtonElement) || row.dataset.itemPath == null) {
        throw new Error('Expected a visible file row to focus.');
      }

      row.click();
      return row.dataset.itemPath;
    });
    await nextFrames(page);

    await page.evaluate(
      ({ scrollTop }) => {
        window.__stickyContextMenuDriftProbe?.setScrollTop(scrollTop);
      },
      { scrollTop: 1500 }
    );
    await nextFrames(page);
    await page.waitForFunction((path) => {
      const host = document.querySelector('file-tree-container');
      const parkedRow = host?.shadowRoot?.querySelector<HTMLButtonElement>(
        `button[data-item-path="${path}"][data-item-parked="true"]`
      );
      return parkedRow instanceof HTMLButtonElement;
    }, focusedPath);
    await page.waitForTimeout(80);
    await nextFrames(page);

    const hoveredPath = await page.evaluate((path) => {
      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const row = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((button) => {
        return (
          button instanceof HTMLButtonElement &&
          button.dataset.fileTreeStickyRow !== 'true' &&
          button.dataset.itemParked !== 'true' &&
          button.dataset.itemPath !== path
        );
      });
      if (!(row instanceof HTMLButtonElement) || row.dataset.itemPath == null) {
        throw new Error('Expected a visible row to hover.');
      }

      row.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, composed: true })
      );
      return row.dataset.itemPath;
    }, focusedPath);
    await nextFrames(page);

    await expect(
      page.locator(
        'file-tree-container button[data-type="context-menu-trigger"]'
      )
    ).toHaveAttribute('data-visible', 'true');

    await page.evaluate(() => {
      const host = document.querySelector('file-tree-container');
      const root = host?.shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );
      root?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    });
    await nextFrames(page);

    await expect(
      page.locator(
        'file-tree-container button[data-type="context-menu-trigger"]'
      )
    ).toHaveAttribute('data-visible', 'false');
    await expect(
      page.locator('file-tree-container [data-type="context-menu-anchor"]')
    ).toHaveAttribute('data-visible', 'false');

    expect(hoveredPath).not.toBe(focusedPath);
  });

  test('clears visual focus after a focused row is parked and restored', async ({
    page,
  }) => {
    await page.goto(
      '/test/e2e/fixtures/file-tree-sticky-context-menu-scroll-drift.html'
    );
    await page.waitForFunction(
      () => window.__stickyContextMenuDriftFixtureReady === true
    );

    const focusedPath = await page.evaluate(() => {
      const outsideButton = document.createElement('button');
      outsideButton.dataset.testOutsideFocus = 'true';
      outsideButton.type = 'button';
      outsideButton.textContent = 'Outside focus';
      document.body.append(outsideButton);

      const host = document.querySelector('file-tree-container');
      const shadowRoot = host?.shadowRoot;
      const row = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((button) => {
        return (
          button instanceof HTMLButtonElement &&
          button.dataset.fileTreeStickyRow !== 'true' &&
          button.dataset.itemParked !== 'true' &&
          button.dataset.itemType === 'file'
        );
      });
      if (!(row instanceof HTMLButtonElement) || row.dataset.itemPath == null) {
        throw new Error('Expected a visible file row to focus.');
      }

      row.click();
      return row.dataset.itemPath;
    });
    await nextFrames(page);

    await page.evaluate(
      ({ scrollTop }) => {
        window.__stickyContextMenuDriftProbe?.setScrollTop(scrollTop);
      },
      { scrollTop: 1500 }
    );
    await nextFrames(page);
    await page.waitForFunction((path) => {
      const host = document.querySelector('file-tree-container');
      const parkedRow = host?.shadowRoot?.querySelector<HTMLButtonElement>(
        `button[data-item-path="${path}"][data-item-parked="true"]`
      );
      return parkedRow instanceof HTMLButtonElement;
    }, focusedPath);
    await page.waitForTimeout(80);
    await nextFrames(page);

    await page.evaluate(() => {
      window.__stickyContextMenuDriftProbe?.setScrollTop(0);
    });
    await page.waitForTimeout(80);
    await nextFrames(page);

    await expect(
      page.locator(
        `file-tree-container button[data-item-path="${focusedPath}"][data-item-focused="true"]`
      )
    ).toHaveCount(1);

    await page.locator('[data-test-outside-focus="true"]').focus();
    await nextFrames(page);

    await expect(
      page.locator('file-tree-container button[data-item-focused="true"]')
    ).toHaveCount(0);
    await expect(
      page.locator(
        'file-tree-container button[data-type="context-menu-trigger"]'
      )
    ).toHaveAttribute('data-visible', 'false');
  });
});
