/**
 * Simple fixed-height virtualizer for tree rendering inside shadow DOM.
 *
 * Since all rows have the same height (--ft-internal-row-height, default 30px),
 * we skip per-item measurement entirely and just do scroll-position math.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface VirtualizedListProps {
  itemCount: number;
  itemHeight: number;
  renderItem: (index: number) => JSX.Element;
  scrollToIndex?: number | null;
}

const OVERSCAN = 10;

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

function computeRange(
  viewport: HTMLElement,
  container: HTMLElement,
  count: number,
  height: number
): [number, number] {
  const scrollTop = viewport.scrollTop;
  const viewportHeight = viewport.clientHeight;
  const containerTop = container.getBoundingClientRect().top;
  const viewportTop = viewport.getBoundingClientRect().top;
  const offset = containerTop - viewportTop + scrollTop;

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
  itemHeight,
  renderItem,
  scrollToIndex,
}: VirtualizedListProps): JSX.Element {
  'use no memo';
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);

  // Find viewport and set up scroll/resize listeners
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container == null) return;

    const viewport = findScrollableAncestor(container);
    viewportRef.current = viewport;

    const update = () => {
      setRange(computeRange(viewport, container, itemCount, itemHeight));
    };

    update();

    viewport.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(viewport);

    return () => {
      viewport.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [itemCount, itemHeight]);

  // Scroll focused item into view
  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0) return;
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (viewport == null || container == null) return;

    const containerTop = container.getBoundingClientRect().top;
    const viewportTop = viewport.getBoundingClientRect().top;
    const offset = containerTop - viewportTop + viewport.scrollTop;

    const itemTop = offset + scrollToIndex * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const viewTop = viewport.scrollTop;
    const viewBottom = viewTop + viewport.clientHeight;

    if (itemTop < viewTop) {
      viewport.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      viewport.scrollTop = itemBottom - viewport.clientHeight;
    }
  }, [scrollToIndex, itemHeight]);

  const totalSize = itemCount * itemHeight;
  const [startIndex, endIndex] = range;

  const children: JSX.Element[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    children.push(
      <div
        key={i}
        style={`position:absolute;top:${i * itemHeight}px;left:0;width:100%;height:${itemHeight}px;display:flex`}
      >
        {renderItem(i)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={`position:relative;width:100%;height:${totalSize}px;flex-shrink:0;overflow-anchor:none`}
    >
      {children}
    </div>
  );
}
