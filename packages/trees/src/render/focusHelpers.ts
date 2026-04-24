import {
  computeFocusedRowScrollIntoView,
  computeViewportOffsetScrollTop,
} from './scrollTarget';

export function focusElement(element: HTMLElement | null): boolean {
  if (element == null || !element.isConnected) {
    return false;
  }
  if (element === document.body || element === document.documentElement) {
    return false;
  }

  element.focus({ preventScroll: true });
  const rootNode = element.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    return rootNode.activeElement === element;
  }

  return document.activeElement === element;
}

// Reads the actual focused element from the tree's shadow root so focus sync
// logic can work even when document.activeElement points at the host.
export function getActiveTreeElement(
  rootElement: HTMLElement
): HTMLElement | null {
  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    const activeElement = rootNode.activeElement;
    return activeElement instanceof HTMLElement ? activeElement : null;
  }

  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement &&
    rootElement.contains(activeElement)
    ? activeElement
    : null;
}

export function readMeasuredViewportHeight(
  scrollElement: HTMLElement | null,
  fallbackViewportHeight: number
): number {
  if (scrollElement == null) {
    return fallbackViewportHeight;
  }

  const rectHeight = scrollElement.getBoundingClientRect().height;
  if (rectHeight > 0) {
    return rectHeight;
  }

  return scrollElement.clientHeight > 0
    ? scrollElement.clientHeight
    : fallbackViewportHeight;
}

export function getCachedViewportHeight(
  cachedViewportHeight: number | null,
  fallbackViewportHeight: number
): number {
  return cachedViewportHeight != null && cachedViewportHeight > 0
    ? cachedViewportHeight
    : fallbackViewportHeight;
}

// ResizeObserver exposes box sizes without forcing an extra layout read. Use
// that value to refresh the viewport-height cache, falling back to the direct
// measurement only in environments that omit the border-box size.
export function getResizeObserverViewportHeight(
  entry: ResizeObserverEntry
): number | null {
  const borderBoxSize = entry.borderBoxSize;
  const firstBorderBoxSize: ResizeObserverSize = Array.isArray(borderBoxSize)
    ? borderBoxSize[0]
    : borderBoxSize;

  if (
    firstBorderBoxSize != null &&
    Number.isFinite(firstBorderBoxSize.blockSize) &&
    firstBorderBoxSize.blockSize > 0
  ) {
    return firstBorderBoxSize.blockSize;
  }

  return entry.contentRect.height > 0 ? entry.contentRect.height : null;
}

// Thin imperative wrapper around `computeFocusedRowScrollIntoView`. The numeric
// contract lives in the pure helper; this function just applies the returned
// scrollTop, if any, and reports whether a write happened.
export function scrollFocusedRowIntoView(
  scrollElement: HTMLElement,
  focusedIndex: number,
  itemHeight: number,
  viewportHeight: number,
  topInset: number = 0
): boolean {
  const nextScrollTop = computeFocusedRowScrollIntoView({
    currentScrollTop: scrollElement.scrollTop,
    focusedIndex,
    itemHeight,
    topInset,
    viewportHeight,
  });
  if (nextScrollTop == null) {
    return false;
  }

  scrollElement.scrollTop = nextScrollTop;
  return true;
}

// Thin imperative wrapper around `computeViewportOffsetScrollTop`. Used when a
// logical state change (search closing, sticky-row click) should restore the
// focused row to a specific vertical offset inside the viewport.
export function scrollFocusedRowToViewportOffset(
  scrollElement: HTMLElement,
  focusedIndex: number,
  itemHeight: number,
  viewportHeight: number,
  totalHeight: number,
  targetViewportOffset: number
): boolean {
  const nextScrollTop = computeViewportOffsetScrollTop({
    currentScrollTop: scrollElement.scrollTop,
    focusedIndex,
    itemHeight,
    targetViewportOffset,
    totalHeight,
    viewportHeight,
  });
  if (nextScrollTop == null) {
    return false;
  }

  scrollElement.scrollTop = nextScrollTop;
  return true;
}

export function getParkedFocusedRowOffset(
  focusedIndex: number,
  itemHeight: number,
  range: { start: number; end: number },
  windowHeight: number
): number | null {
  if (range.end < range.start) {
    return null;
  }

  if (focusedIndex < range.start) {
    return -itemHeight;
  }

  if (focusedIndex > range.end) {
    return windowHeight;
  }

  return null;
}
