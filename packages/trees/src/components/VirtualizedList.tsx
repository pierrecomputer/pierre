/**
 * Simple fixed-height virtualizer for tree rendering inside shadow DOM.
 *
 * Since rows are a fixed height, we can skip per-item measurement and only do
 * scroll-position math.
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface VirtualizedListProps {
  itemCount: number;
  renderItem: (index: number) => JSX.Element | null;
  scrollToIndex?: number | null;
  /**
   * Optional explicit row height in px. If omitted, resolves from
   * --ft-internal-row-height (fallback 30).
   */
  itemHeight?: number;
}

const OVERSCAN = 10;
const DEFAULT_ITEM_HEIGHT = 30;
const EMPTY_RANGE: VirtualRange = { start: 0, end: -1 };

export interface VirtualRange {
  start: number;
  end: number;
}

interface VirtualWindowMetrics {
  scrollTop: number;
  viewportHeight: number;
  offset: number;
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

interface StickyWindowLayout {
  totalHeight: number;
  offsetHeight: number;
  windowHeight: number;
  stickyInset: number;
}

/**
 * Walk up from `el` (crossing shadow boundaries) to find the nearest ancestor
 * with `overflow-y: auto | scroll`. Falls back to `document.documentElement`.
 */
function findScrollableAncestor(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node != null) {
    const style = getComputedStyle(node);
    if (
      style.overflowY === 'auto' ||
      style.overflowY === 'scroll' ||
      style.overflow === 'auto' ||
      style.overflow === 'scroll'
    ) {
      return node;
    }
    if (node.parentElement != null) {
      node = node.parentElement;
    } else {
      // Cross shadow boundary
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) {
        node = root.host as HTMLElement;
      } else {
        break;
      }
    }
  }
  return document.documentElement;
}

function resolveItemHeight(
  container: HTMLElement,
  explicitItemHeight?: number
): number {
  if (explicitItemHeight != null && explicitItemHeight > 0) {
    return explicitItemHeight;
  }

  const cssValue = getComputedStyle(container)
    .getPropertyValue('--ft-internal-row-height')
    .trim();
  const parsed = Number.parseFloat(cssValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ITEM_HEIGHT;
}

function getOffsetWithinViewport(
  container: HTMLElement,
  viewport: HTMLElement
): number {
  // Try offsetParent accumulation first (fast path).
  let top = 0;
  let node: HTMLElement | null = container;
  while (node != null && node !== viewport) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node === viewport) {
    return top;
  }

  // Fallback for shadow DOM / offsetParent-chain mismatches.
  const containerTop = container.getBoundingClientRect().top;
  const viewportTop = viewport.getBoundingClientRect().top;
  return containerTop - viewportTop + viewport.scrollTop;
}

function normalizeRange(range: VirtualRange, itemCount: number): VirtualRange {
  if (itemCount <= 0 || range.end < range.start) {
    return EMPTY_RANGE;
  }
  const start = Math.max(0, Math.min(range.start, itemCount - 1));
  const end = Math.max(start, Math.min(range.end, itemCount - 1));
  return { start, end };
}

function rangesEqual(a: VirtualRange, b: VirtualRange): boolean {
  return a.start === b.start && a.end === b.end;
}

export function computeVisibleRange({
  scrollTop,
  viewportHeight,
  offset,
  itemCount,
  itemHeight,
}: VirtualWindowMetrics): VirtualRange {
  if (itemCount <= 0) {
    return EMPTY_RANGE;
  }
  const rawStart = Math.floor((scrollTop - offset) / itemHeight);
  const rawEnd =
    Math.ceil((scrollTop - offset + viewportHeight) / itemHeight) - 1;
  if (rawEnd < 0 || rawStart >= itemCount) {
    return EMPTY_RANGE;
  }
  const start = Math.max(0, rawStart);
  const end = Math.min(itemCount - 1, rawEnd);
  return { start, end };
}

function expandRange(
  range: VirtualRange,
  itemCount: number,
  overscan: number
): VirtualRange {
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
  metrics: VirtualWindowMetrics,
  currentRange: VirtualRange = EMPTY_RANGE
): VirtualRange {
  const visibleRange = computeVisibleRange(metrics);
  const normalizedCurrentRange = normalizeRange(
    currentRange,
    metrics.itemCount
  );

  if (
    normalizedCurrentRange.end >= normalizedCurrentRange.start &&
    visibleRange.start >= normalizedCurrentRange.start &&
    visibleRange.end <= normalizedCurrentRange.end
  ) {
    return normalizedCurrentRange;
  }

  return expandRange(
    visibleRange,
    metrics.itemCount,
    metrics.overscan ?? OVERSCAN
  );
}

export function computeStickyWindowLayout({
  range,
  itemCount,
  itemHeight,
  viewportHeight,
}: {
  range: VirtualRange;
  itemCount: number;
  itemHeight: number;
  viewportHeight: number;
}): StickyWindowLayout {
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
    stickyInset: Math.min(0, viewportHeight - windowHeight),
  };
}

export function VirtualizedList({
  itemCount,
  renderItem,
  scrollToIndex,
  itemHeight,
}: VirtualizedListProps): JSX.Element {
  'use no memo';
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyOffsetRef = useRef<HTMLDivElement>(null);
  const stickyWindowRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<VirtualRange>(EMPTY_RANGE);
  const [resolvedHeight, setResolvedHeight] = useState<number>(
    itemHeight != null && itemHeight > 0 ? itemHeight : DEFAULT_ITEM_HEIGHT
  );
  const [viewportHeight, setViewportHeight] = useState<number>(0);

  // Find viewport and set up scroll/resize listeners
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container == null) return;

    // VirtualizedList is rendered directly under the scroll viewport element.
    // Prefer the direct parent to avoid expensive/fragile ancestor detection.
    const viewport =
      container.parentElement ?? findScrollableAncestor(container);
    viewportRef.current = viewport;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      const nextHeight = resolveItemHeight(container, itemHeight);
      const nextViewportHeight = viewport.clientHeight;
      const offset = getOffsetWithinViewport(container, viewport);
      setResolvedHeight((prev) => (prev === nextHeight ? prev : nextHeight));
      setViewportHeight((prev) =>
        prev === nextViewportHeight ? prev : nextViewportHeight
      );
      setRange((prev) => {
        const next = computeWindowRange(
          {
            scrollTop: viewport.scrollTop,
            viewportHeight: nextViewportHeight,
            offset,
            itemCount,
            itemHeight: nextHeight,
          },
          prev
        );
        return rangesEqual(prev, next) ? prev : next;
      });
    };

    const onScroll = () => {
      update();

      // Mark the list as scrolling to suppress hover styles on items.
      // Applied to the list (inside the scroll container) so the container
      // itself still receives scroll events.
      container.dataset.isScrolling ??= '';
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      scrollTimer = setTimeout(() => {
        delete container.dataset.isScrolling;
        scrollTimer = null;
      }, 50);
    };

    update();

    viewport.addEventListener('scroll', onScroll, { passive: true });

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(viewport);

    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      delete container.dataset.isScrolling;
      ro?.disconnect();
    };
  }, [itemCount, itemHeight]);

  // Scroll focused item into view
  useLayoutEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (viewport == null || container == null) return;

    const offset = getOffsetWithinViewport(container, viewport);

    const itemTop = offset + scrollToIndex * resolvedHeight;
    const itemBottom = itemTop + resolvedHeight;
    const viewTop = viewport.scrollTop;
    const viewBottom = viewTop + viewport.clientHeight;
    let nextScrollTop = viewTop;

    if (itemTop < viewTop) {
      nextScrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      nextScrollTop = itemBottom - viewport.clientHeight;
    }

    if (nextScrollTop !== viewTop) {
      setRange((prev) => {
        const next = computeWindowRange({
          scrollTop: nextScrollTop,
          viewportHeight: viewport.clientHeight,
          offset,
          itemCount,
          itemHeight: resolvedHeight,
        });
        return rangesEqual(prev, next) ? prev : next;
      });
      viewport.scrollTop = nextScrollTop;
    }
  }, [scrollToIndex, resolvedHeight, itemCount]);

  const { totalHeight, offsetHeight, windowHeight, stickyInset } =
    computeStickyWindowLayout({
      range,
      itemCount,
      itemHeight: resolvedHeight,
      viewportHeight,
    });

  // Use imperative updates so virtualization keeps working even in
  // environments where JSX style props may be stripped.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container != null) {
      container.style.height = `${totalHeight}px`;
    }
    const stickyOffset = stickyOffsetRef.current;
    if (stickyOffset != null) {
      stickyOffset.style.height = `${offsetHeight}px`;
    }
    const stickyWindow = stickyWindowRef.current;
    if (stickyWindow != null) {
      stickyWindow.style.height = `${windowHeight}px`;
      stickyWindow.style.top = `${stickyInset}px`;
      stickyWindow.style.bottom = `${stickyInset}px`;
    }
  }, [totalHeight, offsetHeight, windowHeight, stickyInset]);

  const { start: startIndex, end: endIndex } = range;
  const children: JSX.Element[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const item = renderItem(i);
    if (item != null) {
      children.push(item);
    }
  }

  return (
    <div ref={containerRef} data-file-tree-virtualized-list="true">
      <div
        ref={stickyOffsetRef}
        data-file-tree-virtualized-sticky-offset="true"
        aria-hidden="true"
      />
      <div ref={stickyWindowRef} data-file-tree-virtualized-sticky="true">
        {children}
      </div>
    </div>
  );
}
