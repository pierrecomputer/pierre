import { expect, type Locator, type Page } from '@playwright/test';

// Shared test utilities for scrolling the virtualized tree until a specific
// path is pinned in the sticky overlay. The drag-and-drop and rename suites
// both need this to exercise sticky-row interactions, so the step-size,
// ceiling, and detection logic live here instead of in each .pw.ts file.

export type StickyRowState = {
  readonly stickyPaths: readonly string[];
  readonly visiblePaths: readonly string[];
};

declare global {
  interface Window {
    __getStickyPaths?: () => string[];
    __getVisiblePaths?: () => string[];
    __setScrollTop?: (scrollTop: number) => Promise<void>;
  }
}

function readStickyRowState(page: Page): Promise<StickyRowState> {
  return page.evaluate<StickyRowState>(() => ({
    stickyPaths: window.__getStickyPaths?.() ?? [],
    visiblePaths: window.__getVisiblePaths?.() ?? [],
  }));
}

export type StepUntilStickyOptions = {
  /** Start scroll offset in pixels. */
  readonly startScrollTop?: number;
  /** Maximum scroll offset to try before giving up. */
  readonly maxScrollTop?: number;
  /** Increment per step; tune against the tree's row height. */
  readonly step?: number;
};

// Scrolls the virtualized list in fixed increments until `stickyPath` is
// mirrored in the sticky overlay AND the extra predicate returns true. Returns
// the final scrollTop so tests can fail with a specific offset when the
// predicate never becomes satisfied. Fixture HTML must expose
// `window.__setScrollTop`, `__getStickyPaths`, and `__getVisiblePaths`.
export async function scrollUntilSticky(
  page: Page,
  stickyPath: string,
  predicate: (state: StickyRowState) => boolean = () => true,
  {
    startScrollTop = 8,
    maxScrollTop = 600,
    step = 8,
  }: StepUntilStickyOptions = {}
): Promise<number> {
  for (
    let scrollTop = startScrollTop;
    scrollTop <= maxScrollTop;
    scrollTop += step
  ) {
    await page.evaluate(async (nextScrollTop) => {
      await window.__setScrollTop?.(nextScrollTop);
    }, scrollTop);
    const state = await readStickyRowState(page);
    if (state.stickyPaths.includes(stickyPath) && predicate(state)) {
      return scrollTop;
    }
  }

  throw new Error(
    `scrollUntilSticky: ${stickyPath} never satisfied predicate within scrollTop <= ${maxScrollTop}.`
  );
}

// Convenience wrapper when the caller also needs a sibling path to stay
// visible (e.g. "drag row X onto sticky folder Y" tests need both anchors).
export function scrollUntilStickyWithVisible(
  page: Page,
  stickyPath: string,
  visiblePath: string,
  options?: StepUntilStickyOptions
): Promise<number> {
  return scrollUntilSticky(
    page,
    stickyPath,
    (state) => state.visiblePaths.includes(visiblePath),
    options
  );
}

export type ScrollByClientHeightOptions = {
  /** Upper bound on how many half-viewport scrolls to attempt. */
  readonly maxAttempts?: number;
};

// Polls-and-scrolls inside the fixture by repeatedly advancing the scroll
// element by half its client height until the requested locator materializes.
// Used by the rename suite, which needs to land on the exact sticky element
// that `expect()` watches rather than a scroll offset.
export async function scrollUntilLocatorPresent(
  treeLocator: Locator,
  target: Locator,
  { maxAttempts = 40 }: ScrollByClientHeightOptions = {}
): Promise<Locator> {
  const scrollViewport = treeLocator.locator(
    '[data-file-tree-virtualized-scroll="true"]'
  );

  let attempt = 0;
  await expect
    .poll(async () => {
      if ((await target.count()) > 0) {
        return true;
      }

      if (attempt >= maxAttempts) {
        return false;
      }

      attempt += 1;
      return scrollViewport.evaluate(async (element) => {
        const nextScrollTop = Math.min(
          element.scrollTop + Math.max(element.clientHeight / 2, 30),
          element.scrollHeight - element.clientHeight
        );
        if (nextScrollTop <= element.scrollTop) {
          return false;
        }
        element.scrollTop = nextScrollTop;
        element.dispatchEvent(new Event('scroll'));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        return false;
      });
    })
    .toBe(true);

  return target;
}
