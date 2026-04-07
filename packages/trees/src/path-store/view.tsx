/** @jsxImportSource preact */
import type { JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { Icon } from '../components/Icon';
import { MiddleTruncate, Truncate } from '../components/OverflowText';
import { PathStoreTreesController } from './controller';
import type {
  PathStoreTreesDirectoryHandle,
  PathStoreTreesItemHandle,
  PathStoreTreesViewProps,
  PathStoreTreesVisibleRow,
} from './types';
import {
  computeStickyWindowLayout,
  computeWindowRange,
  PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  PATH_STORE_TREES_DEFAULT_OVERSCAN,
  PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
  rangesEqual,
} from './virtualization';

function formatFlattenedSegments(
  row: PathStoreTreesVisibleRow
): JSX.Element | string {
  'use no memo';
  const segments = row.flattenedSegments;
  if (segments == null || segments.length === 0) {
    return row.name;
  }

  return (
    <span data-item-flattened-subitems>
      {segments.map((segment, index) => (
        <span key={segment.path}>
          <span data-item-flattened-subitem={segment.path}>
            <Truncate>{segment.name}</Truncate>
          </span>
          {index < segments.length - 1 ? ' / ' : ''}
        </span>
      ))}
    </span>
  );
}

function isPathStoreTreesDirectoryHandle(
  item: PathStoreTreesItemHandle | null
): item is PathStoreTreesDirectoryHandle {
  return item != null && 'toggle' in item;
}

function renderStyledRow(
  controller: PathStoreTreesController,
  row: PathStoreTreesVisibleRow,
  itemHeight: number
): JSX.Element {
  const targetPath = row.isFlattened
    ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
      row.path)
    : row.path;
  const item = controller.getItem(targetPath);
  const directoryItem = isPathStoreTreesDirectoryHandle(item) ? item : null;

  return (
    <button
      key={row.path}
      type="button"
      data-type="item"
      data-item-type={row.hasChildren ? 'folder' : 'file'}
      aria-label={row.path}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      onClick={directoryItem == null ? undefined : () => directoryItem.toggle()}
      tabIndex={-1}
      style={{ minHeight: `${itemHeight}px` }}
    >
      {row.depth > 0 ? (
        <div data-item-section="spacing">
          {Array.from({ length: row.depth }).map((_, index) => (
            <div key={index} data-item-section="spacing-item" />
          ))}
        </div>
      ) : null}
      <div data-item-section="icon">
        {row.hasChildren ? (
          <Icon name="file-tree-icon-chevron" />
        ) : (
          <Icon name="file-tree-icon-file" />
        )}
      </div>
      <div data-item-section="content">
        {row.isFlattened ? (
          formatFlattenedSegments(row)
        ) : (
          <MiddleTruncate minimumLength={5} split="extension">
            {row.name}
          </MiddleTruncate>
        )}
      </div>
    </button>
  );
}

function renderRangeChildren(
  controller: PathStoreTreesController,
  range: { start: number; end: number },
  itemHeight: number
): JSX.Element[] {
  if (range.end < range.start) {
    return [];
  }

  return controller
    .getVisibleRows(range.start, range.end)
    .map((row) => renderStyledRow(controller, row, itemHeight));
}

/**
 * New path-store-specific always-virtualized renderer. It borrows the sticky
 * window idea from the legacy virtualizer without reusing its code.
 */
export function PathStoreTreesView({
  controller,
  itemHeight = PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  overscan = PATH_STORE_TREES_DEFAULT_OVERSCAN,
  viewportHeight = PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
}: PathStoreTreesViewProps): JSX.Element {
  'use no memo';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [itemCount, setItemCount] = useState(() =>
    controller.getVisibleCount()
  );
  const [resolvedViewportHeight, setResolvedViewportHeight] =
    useState<number>(viewportHeight);
  const [range, setRange] = useState(() =>
    computeWindowRange({
      itemCount: controller.getVisibleCount(),
      itemHeight,
      overscan,
      scrollTop: 0,
      viewportHeight,
    })
  );

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement == null) {
      return;
    }

    const update = (): void => {
      const nextItemCount = controller.getVisibleCount();
      const nextViewportHeight =
        scrollElement.clientHeight > 0
          ? scrollElement.clientHeight
          : viewportHeight;
      const maxScrollTop = Math.max(
        0,
        nextItemCount * itemHeight - nextViewportHeight
      );
      // Collapse can shrink total height under the current scroll position, so
      // clamp scrollTop before recomputing the visible window range.
      if (scrollElement.scrollTop > maxScrollTop) {
        scrollElement.scrollTop = maxScrollTop;
      }
      const scrollTop = Math.min(scrollElement.scrollTop, maxScrollTop);
      setItemCount((previousCount) =>
        previousCount === nextItemCount ? previousCount : nextItemCount
      );
      setResolvedViewportHeight((previousHeight) =>
        previousHeight === nextViewportHeight
          ? previousHeight
          : nextViewportHeight
      );
      setRange((previousRange) => {
        const nextRange = computeWindowRange(
          {
            itemCount: nextItemCount,
            itemHeight,
            overscan,
            scrollTop,
            viewportHeight: nextViewportHeight,
          },
          previousRange
        );
        return rangesEqual(previousRange, nextRange)
          ? previousRange
          : nextRange;
      });
    };

    const unsubscribe = controller.subscribe(() => {
      update();
    });
    const onScroll = (): void => {
      update();
    };

    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            update();
          })
        : null;
    resizeObserver?.observe(scrollElement);
    update();

    return () => {
      unsubscribe();
      scrollElement.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
    };
  }, [controller, itemHeight, overscan, viewportHeight]);

  const stickyLayout = useMemo(
    () =>
      computeStickyWindowLayout({
        itemCount,
        itemHeight,
        range,
        viewportHeight: resolvedViewportHeight,
      }),
    [itemCount, itemHeight, range, resolvedViewportHeight]
  );

  return (
    <div
      data-file-tree-virtualized-root="true"
      role="tree"
      style={{ height: `${viewportHeight}px` }}
    >
      <div ref={scrollRef} data-file-tree-virtualized-scroll="true">
        <div
          data-file-tree-virtualized-list="true"
          style={{ height: `${stickyLayout.totalHeight}px` }}
        >
          <div
            data-file-tree-virtualized-sticky-offset="true"
            aria-hidden="true"
            style={{ height: `${stickyLayout.offsetHeight}px` }}
          />
          <div
            data-file-tree-virtualized-sticky="true"
            style={{
              height: `${stickyLayout.windowHeight}px`,
              top: `${stickyLayout.stickyInset}px`,
              bottom: `${stickyLayout.stickyInset}px`,
            }}
          >
            {renderRangeChildren(controller, range, itemHeight)}
          </div>
        </div>
      </div>
    </div>
  );
}
