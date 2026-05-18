// Pure scroll-target arithmetic for the virtualized file tree. Extracting these
// keeps every numeric edge case (clamp to zero, clamp to max, top inset,
// already-in-view short circuit) unit-testable without a real scroll element.
//
// Each function returns the `scrollTop` the caller should apply, or `null` when
// no change is required. Callers that currently own a scroll element perform
// the single imperative write.

import type { FileTreeScrollOffset } from '../model/publicTypes';

export type FileTreeScrollTargetInput = {
  focusedIndex: number;
  itemHeight: number;
  viewportHeight: number;
};

export type FileTreeMinimalScrollIntoViewInput = FileTreeScrollTargetInput & {
  currentScrollTop: number;
  topInset?: number;
};

// Minimal adjustment to bring the focused row fully inside the viewport while
// respecting a `topInset` (the sticky overlay height). Returns `null` when the
// row is already visible.
export function computeFocusedRowScrollIntoView(
  input: FileTreeMinimalScrollIntoViewInput
): number | null {
  const {
    currentScrollTop,
    focusedIndex,
    itemHeight,
    topInset = 0,
    viewportHeight,
  } = input;

  if (focusedIndex < 0) {
    return null;
  }

  const effectiveInset = Math.max(0, topInset);
  const itemTop = focusedIndex * itemHeight;
  const itemBottom = itemTop + itemHeight;
  const currentViewportTop = currentScrollTop + effectiveInset;

  if (itemTop < currentViewportTop) {
    const nextScrollTop = Math.max(0, itemTop - effectiveInset);
    return nextScrollTop === currentScrollTop ? null : nextScrollTop;
  }

  if (itemBottom > currentScrollTop + viewportHeight) {
    const nextScrollTop = itemBottom - viewportHeight;
    return nextScrollTop === currentScrollTop ? null : nextScrollTop;
  }

  return null;
}

export type FileTreeOffsetScrollInput = FileTreeScrollTargetInput & {
  currentScrollTop: number;
  offset: FileTreeScrollOffset;
  topInset?: number;
  totalHeight: number;
};

// Resolves a programmatic scroll target for a focused row. `nearest` mirrors
// scroll-into-view, while `top` and `center` align inside the unobscured
// viewport below any sticky overlay.
export function computeFocusedRowScrollTopForOffset(
  input: FileTreeOffsetScrollInput
): number | null {
  const {
    currentScrollTop,
    focusedIndex,
    itemHeight,
    offset,
    topInset = 0,
    totalHeight,
    viewportHeight,
  } = input;

  if (offset === 'nearest') {
    return computeFocusedRowScrollIntoView({
      currentScrollTop,
      focusedIndex,
      itemHeight,
      topInset,
      viewportHeight,
    });
  }

  if (focusedIndex < 0) {
    return null;
  }

  const effectiveInset = Math.max(0, topInset);
  const itemTop = focusedIndex * itemHeight;
  const visibleHeight = Math.max(0, viewportHeight - effectiveInset);
  const targetViewportOffset =
    offset === 'center'
      ? effectiveInset + Math.max(0, (visibleHeight - itemHeight) / 2)
      : effectiveInset;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const nextScrollTop = Math.max(
    0,
    Math.min(itemTop - targetViewportOffset, maxScrollTop)
  );
  return nextScrollTop === currentScrollTop ? null : nextScrollTop;
}

export type FileTreeViewportOffsetScrollInput = FileTreeScrollTargetInput & {
  currentScrollTop: number;
  totalHeight: number;
  targetViewportOffset: number;
};

// Places the focused row at a specific viewport offset (used when restoring
// state after search closes or after a sticky-row click collapses ancestors).
// Returns `null` when the row already sits inside the offset viewport band or
// when the resulting scrollTop is unchanged.
export function computeViewportOffsetScrollTop(
  input: FileTreeViewportOffsetScrollInput
): number | null {
  const {
    currentScrollTop,
    focusedIndex,
    itemHeight,
    targetViewportOffset,
    totalHeight,
    viewportHeight,
  } = input;

  if (focusedIndex < 0) {
    return null;
  }

  const effectiveOffset = Math.max(0, targetViewportOffset);
  const itemTop = focusedIndex * itemHeight;
  const itemBottom = itemTop + itemHeight;
  const currentViewportTop = currentScrollTop + effectiveOffset;
  const currentViewportBottom = currentScrollTop + viewportHeight;

  if (itemTop >= currentViewportTop && itemBottom <= currentViewportBottom) {
    return null;
  }

  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const preservedScrollTop = Math.max(
    0,
    Math.min(itemTop - effectiveOffset, maxScrollTop)
  );
  return preservedScrollTop === currentScrollTop ? null : preservedScrollTop;
}
