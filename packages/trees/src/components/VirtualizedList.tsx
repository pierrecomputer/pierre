/**
 * Simple fixed-height virtualizer for tree rendering inside shadow DOM.
 *
 * Since rows are a fixed height, we can skip per-item measurement and only do
 * scroll-position math.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

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

function computeRange(
  viewport: HTMLElement,
  container: HTMLElement,
  count: number,
  height: number
): [number, number] {
  if (count <= 0) {
    return [0, -1];
  }

  const scrollTop = viewport.scrollTop;
  const viewportHeight = viewport.clientHeight;
  const offset = getOffsetWithinViewport(container, viewport);

  const start = Math.max(
    0,
    Math.floor((scrollTop - offset) / height) - OVERSCAN
  );
  const end = Math.min(
    count - 1,
    Math.ceil((scrollTop - offset + viewportHeight) / height) + OVERSCAN
  );
  return [start, Math.max(start, end)];
}

export function VirtualizedList({
  itemCount,
  renderItem,
  scrollToIndex,
  itemHeight,
}: VirtualizedListProps): JSX.Element {
  'use no memo';
  const containerRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<[number, number]>([0, -1]);
  const [resolvedHeight, setResolvedHeight] = useState<number>(
    itemHeight != null && itemHeight > 0 ? itemHeight : DEFAULT_ITEM_HEIGHT
  );

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
      setResolvedHeight((prev) => (prev === nextHeight ? prev : nextHeight));
      setRange((prev) => {
        const next = computeRange(viewport, container, itemCount, nextHeight);
        return prev[0] === next[0] && prev[1] === next[1] ? prev : next;
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
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (viewport == null || container == null) return;

    const offset = getOffsetWithinViewport(container, viewport);

    const itemTop = offset + scrollToIndex * resolvedHeight;
    const itemBottom = itemTop + resolvedHeight;
    const viewTop = viewport.scrollTop;
    const viewBottom = viewTop + viewport.clientHeight;

    if (itemTop < viewTop) {
      viewport.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      viewport.scrollTop = itemBottom - viewport.clientHeight;
    }
  }, [scrollToIndex, resolvedHeight]);

  const [startIndex, endIndex] = range;
  const topSpacerHeight = Math.max(0, startIndex * resolvedHeight);
  const bottomSpacerHeight =
    endIndex >= startIndex
      ? Math.max(0, (itemCount - endIndex - 1) * resolvedHeight)
      : 0;

  // Use imperative updates for spacer heights so virtualization keeps working
  // even in environments where JSX style props may be stripped.
  useLayoutEffect(() => {
    const topSpacer = topSpacerRef.current;
    if (topSpacer != null) {
      topSpacer.style.height = `${topSpacerHeight}px`;
    }
    const bottomSpacer = bottomSpacerRef.current;
    if (bottomSpacer != null) {
      bottomSpacer.style.height = `${bottomSpacerHeight}px`;
    }
  }, [topSpacerHeight, bottomSpacerHeight]);

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
        ref={topSpacerRef}
        data-file-tree-virtualized-spacer="top"
        aria-hidden="true"
      />
      {children}
      <div
        ref={bottomSpacerRef}
        data-file-tree-virtualized-spacer="bottom"
        aria-hidden="true"
      />
    </div>
  );
}
