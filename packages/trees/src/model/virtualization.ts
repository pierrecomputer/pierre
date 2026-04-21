import { FILE_TREE_DENSITY_PRESETS } from './density';
import type {
  FileTreeRange,
  FileTreeStickyWindowLayout,
  FileTreeViewportMetrics,
} from './types';

export const FILE_TREE_DEFAULT_ITEM_HEIGHT =
  FILE_TREE_DENSITY_PRESETS.default.itemHeight;
export const FILE_TREE_DEFAULT_OVERSCAN = 10;
export const FILE_TREE_DEFAULT_VIEWPORT_HEIGHT = 420;
export const EMPTY_RANGE: FileTreeRange = { start: 0, end: -1 };

function normalizeRange(
  range: FileTreeRange,
  itemCount: number
): FileTreeRange {
  if (itemCount <= 0 || range.end < range.start) {
    return EMPTY_RANGE;
  }

  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  const end = Math.max(start, Math.min(range.end, itemCount - 1));
  return { start, end };
}

export function rangesEqual(
  left: FileTreeRange,
  right: FileTreeRange
): boolean {
  return left.start === right.start && left.end === right.end;
}

export function computeVisibleRange({
  itemCount,
  itemHeight,
  scrollTop,
  viewportHeight,
}: FileTreeViewportMetrics): FileTreeRange {
  if (itemCount <= 0) {
    return EMPTY_RANGE;
  }

  const rawStart = Math.floor(scrollTop / itemHeight);
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight) - 1;
  if (rawEnd < 0 || rawStart >= itemCount) {
    return EMPTY_RANGE;
  }

  return {
    start: Math.max(0, rawStart),
    end: Math.min(itemCount - 1, rawEnd),
  };
}

function expandRange(
  range: FileTreeRange,
  itemCount: number,
  overscan: number
): FileTreeRange {
  if (range.end < range.start || itemCount <= 0) {
    return EMPTY_RANGE;
  }

  return normalizeRange(
    {
      start: range.start - overscan,
      end: range.end + overscan,
    },
    itemCount
  );
}

export function computeWindowRange(
  metrics: FileTreeViewportMetrics,
  currentRange: FileTreeRange = EMPTY_RANGE
): FileTreeRange {
  const visibleRange = computeVisibleRange(metrics);
  const normalizedCurrent = normalizeRange(currentRange, metrics.itemCount);

  if (
    normalizedCurrent.end >= normalizedCurrent.start &&
    visibleRange.start >= normalizedCurrent.start &&
    visibleRange.end <= normalizedCurrent.end
  ) {
    return normalizedCurrent;
  }

  return expandRange(
    visibleRange,
    metrics.itemCount,
    metrics.overscan ?? FILE_TREE_DEFAULT_OVERSCAN
  );
}

export function computeStickyWindowLayout({
  itemCount,
  itemHeight,
  range,
  viewportHeight,
}: {
  itemCount: number;
  itemHeight: number;
  range: FileTreeRange;
  viewportHeight: number;
}): FileTreeStickyWindowLayout {
  const totalHeight = Math.max(0, itemCount * itemHeight);
  if (range.end < range.start) {
    return {
      totalHeight,
      offsetHeight: 0,
      windowHeight: 0,
      stickyInset: 0,
    };
  }

  const offsetHeight = range.start * itemHeight;
  const windowHeight = (range.end - range.start + 1) * itemHeight;

  return {
    totalHeight,
    offsetHeight,
    windowHeight,
    // The sticky window is usually taller than the viewport once overscan is
    // included, so a negative inset keeps the full overscanned slice pinned.
    stickyInset: Math.min(0, viewportHeight - windowHeight),
  };
}
