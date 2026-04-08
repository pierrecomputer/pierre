/** @jsxImportSource preact */
import { Fragment } from 'preact';
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

function focusElement(element: HTMLElement | null): boolean {
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

// Shadow-root focus lives on shadowRoot.activeElement, so this helper
// resolves the actual focused tree element regardless of host indirection.
// Reads the actual focused element from the tree's shadow root so focus
// sync logic can work even when document.activeElement points at the host.
function getActiveTreeElement(rootElement: HTMLElement): HTMLElement | null {
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
        <Fragment key={segment.path}>
          <span data-item-flattened-subitem={segment.path}>
            <Truncate>{segment.name}</Truncate>
          </span>
          {index < segments.length - 1 ? ' / ' : ''}
        </Fragment>
      ))}
    </span>
  );
}

function getPathStoreTreesRowPath(row: PathStoreTreesVisibleRow): string {
  return row.isFlattened
    ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
        row.path)
    : row.path;
}

function getPathStoreTreesRowAriaLabel(row: PathStoreTreesVisibleRow): string {
  const flattenedSegments = row.flattenedSegments;
  if (flattenedSegments == null || flattenedSegments.length === 0) {
    return row.name;
  }

  return flattenedSegments.map((segment) => segment.name).join(' / ');
}

function isPathStoreTreesDirectoryHandle(
  item: PathStoreTreesItemHandle | null
): item is PathStoreTreesDirectoryHandle {
  return item != null && 'toggle' in item;
}

// Focus changes should keep the logical focused row visible without relying on
// browser scrollIntoView heuristics inside the virtualized shadow root.
// Keeps a newly focused row inside the viewport without relying on
// element.scrollIntoView(), which does not understand our virtual rows.
function scrollFocusedRowIntoView(
  scrollElement: HTMLElement,
  focusedIndex: number,
  itemHeight: number,
  fallbackViewportHeight: number
): boolean {
  if (focusedIndex < 0) {
    return false;
  }

  const viewportHeight =
    scrollElement.clientHeight > 0
      ? scrollElement.clientHeight
      : fallbackViewportHeight;
  const itemTop = focusedIndex * itemHeight;
  const itemBottom = itemTop + itemHeight;
  const currentScrollTop = scrollElement.scrollTop;
  let nextScrollTop = currentScrollTop;

  if (itemTop < currentScrollTop) {
    nextScrollTop = itemTop;
  } else if (itemBottom > currentScrollTop + viewportHeight) {
    nextScrollTop = itemBottom - viewportHeight;
  }

  if (nextScrollTop === currentScrollTop) {
    return false;
  }

  scrollElement.scrollTop = nextScrollTop;
  return true;
}

function getParkedFocusedRowOffset(
  focusedIndex: number,
  itemHeight: number,
  range: { start: number; end: number },
  windowHeight: number
): number | null {
  if (focusedIndex < range.start) {
    return -itemHeight;
  }

  if (focusedIndex > range.end) {
    return windowHeight;
  }

  return null;
}

function getPathStoreGuideStyleText(focusedParentPath: string | null): string {
  if (focusedParentPath == null) {
    return '';
  }

  const escapedPath = focusedParentPath
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
  return `[data-item-section="spacing-item"][data-ancestor-path="${escapedPath}"] { opacity: 1; }`;
}

function renderStyledRow(
  controller: PathStoreTreesController,
  row: PathStoreTreesVisibleRow,
  activeItemPath: string | null,
  itemHeight: number,
  registerButton: (path: string, element: HTMLButtonElement | null) => void,
  onKeyDown: (event: KeyboardEvent) => void,
  options: {
    isParked?: boolean;
    style?: Record<string, string | undefined>;
  } = {}
): JSX.Element {
  const targetPath = getPathStoreTreesRowPath(row);
  const item = controller.getItem(targetPath);
  const directoryItem = isPathStoreTreesDirectoryHandle(item) ? item : null;
  const { isParked = false, style } = options;
  const focusedProps =
    row.isFocused && activeItemPath === targetPath
      ? { 'data-item-focused': true }
      : {};

  return (
    <button
      key={row.path}
      ref={(element) => {
        registerButton(targetPath, element);
      }}
      type="button"
      data-type="item"
      data-item-path={targetPath}
      data-item-parked={isParked ? 'true' : undefined}
      data-item-type={row.hasChildren ? 'folder' : 'file'}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-label={getPathStoreTreesRowAriaLabel(row)}
      aria-level={row.level + 1}
      aria-posinset={row.posInSet + 1}
      aria-selected="false"
      aria-setsize={row.setSize}
      onClick={(event) => {
        item?.focus();
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }

        directoryItem?.toggle();
      }}
      onFocus={() => {
        item?.focus();
      }}
      onKeyDown={onKeyDown}
      role="treeitem"
      tabIndex={row.isFocused ? 0 : -1}
      style={{ minHeight: `${itemHeight}px`, ...style }}
      {...focusedProps}
    >
      {row.depth > 0 ? (
        <div data-item-section="spacing">
          {Array.from({ length: row.depth }).map((_, index) => (
            <div
              key={index}
              data-item-section="spacing-item"
              data-ancestor-path={row.ancestorPaths[index]}
            />
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
  activeItemPath: string | null,
  itemHeight: number,
  registerButton: (path: string, element: HTMLButtonElement | null) => void,
  onKeyDown: (event: KeyboardEvent) => void
): JSX.Element[] {
  if (range.end < range.start) {
    return [];
  }

  return controller
    .getVisibleRows(range.start, range.end)
    .map((row) =>
      renderStyledRow(
        controller,
        row,
        activeItemPath,
        itemHeight,
        registerButton,
        onKeyDown
      )
    );
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
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const updateViewportRef = useRef<() => void>(() => {});
  const domFocusOwnerRef = useRef(false);
  const previousFocusedPathRef = useRef<string | null>(null);
  const [, setControllerRevision] = useState(0);
  const [activeItemPath, setActiveItemPath] = useState<string | null>(null);
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
  const focusedPath = controller.getFocusedPath();
  const focusedIndex = controller.getFocusedIndex();
  const focusedRowIsMounted =
    focusedIndex >= range.start && focusedIndex <= range.end;

  const handleTreeKeyDown = (event: KeyboardEvent): void => {
    const focusedItem = controller.getFocusedItem();
    if (focusedItem == null) {
      return;
    }

    const focusedDirectoryItem = isPathStoreTreesDirectoryHandle(focusedItem)
      ? focusedItem
      : null;
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        controller.focusNextItem();
        break;
      case 'ArrowUp':
        controller.focusPreviousItem();
        break;
      case 'ArrowRight':
        if (focusedDirectoryItem == null || focusedDirectoryItem.isExpanded()) {
          controller.focusNextItem();
        } else {
          focusedDirectoryItem.expand();
        }
        break;
      case 'ArrowLeft':
        if (focusedDirectoryItem != null && focusedDirectoryItem.isExpanded()) {
          focusedDirectoryItem.collapse();
        } else {
          controller.focusParentItem();
        }
        break;
      case 'Home':
        controller.focusFirstItem();
        break;
      case 'End':
        controller.focusLastItem();
        break;
      default:
        handled = false;
    }

    if (!handled) {
      return;
    }

    // Focus-only controller updates do not change range/itemCount, so force a
    // render tick before the DOM-focus sync effect runs.
    setControllerRevision((revision) => revision + 1);
    event.preventDefault();
    event.stopPropagation();
  };

  useLayoutEffect(() => {
    const rootElement = rootRef.current;
    if (rootElement == null) {
      return;
    }

    const updateActiveItemPath = (): void => {
      const activeTreeElement = getActiveTreeElement(rootElement);
      const nextActiveItemPath = activeTreeElement?.dataset.itemPath ?? null;
      setActiveItemPath((previousPath) =>
        previousPath === nextActiveItemPath ? previousPath : nextActiveItemPath
      );
    };

    const onFocusIn = (): void => {
      domFocusOwnerRef.current = true;
      updateActiveItemPath();
    };
    const onFocusOut = (event: FocusEvent): void => {
      const nextTarget = event.relatedTarget;
      if (nextTarget == null) {
        // Virtualization can swap the focused row between rendered and parked
        // states before the replacement element receives focus.
        return;
      }

      if (!(nextTarget instanceof Node) || !rootElement.contains(nextTarget)) {
        domFocusOwnerRef.current = false;
        setActiveItemPath(null);
        return;
      }

      updateActiveItemPath();
    };

    rootElement.addEventListener('focusin', onFocusIn);
    rootElement.addEventListener('focusout', onFocusOut);
    return () => {
      rootElement.removeEventListener('focusin', onFocusIn);
      rootElement.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useLayoutEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollElement = scrollRef.current;
    const listElement = listRef.current;
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

    updateViewportRef.current = update;
    const unsubscribe = controller.subscribe(() => {
      setControllerRevision((revision) => revision + 1);
      update();
    });
    const onScroll = (): void => {
      update();

      // Mark the list as scrolling to suppress hover styles on items.
      // Applied to the list (inside the scroll container) so the container
      // itself still receives scroll events.
      if (listElement != null) {
        listElement.dataset.isScrolling ??= '';
      }
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      scrollTimer = setTimeout(() => {
        if (listElement != null) {
          delete listElement.dataset.isScrolling;
        }
        scrollTimer = null;
      }, 50);
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
      updateViewportRef.current = () => {};
      unsubscribe();
      scrollElement.removeEventListener('scroll', onScroll);
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      if (listElement != null) {
        delete listElement.dataset.isScrolling;
      }
      resizeObserver?.disconnect();
    };
  }, [controller, itemHeight, overscan, viewportHeight]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    const rootElement = rootRef.current;
    if (scrollElement == null || rootElement == null) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    const focusedButton =
      focusedPath == null
        ? null
        : (rowButtonRefs.current.get(focusedPath) ?? null);
    const activeTreeElement = getActiveTreeElement(rootElement);
    const activeTreeElementPath = activeTreeElement?.dataset.itemPath ?? null;
    const focusWithinTree = activeTreeElement != null;
    const shouldOwnDomFocus = domFocusOwnerRef.current || focusWithinTree;
    const focusedPathChanged = previousFocusedPathRef.current !== focusedPath;

    if (
      shouldOwnDomFocus &&
      focusedPathChanged &&
      scrollFocusedRowIntoView(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight
      )
    ) {
      updateViewportRef.current();
    }

    if (!shouldOwnDomFocus) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (focusedButton == null) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (
      focusedPathChanged ||
      activeTreeElementPath == null ||
      activeTreeElementPath !== focusedPath
    ) {
      focusElement(focusedButton);
    }
    previousFocusedPathRef.current = focusedPath;
  }, [
    controller,
    focusedIndex,
    focusedPath,
    focusedRowIsMounted,
    itemHeight,
    range,
    resolvedViewportHeight,
  ]);

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
  const parkedFocusedRow =
    focusedPath != null &&
    activeItemPath === focusedPath &&
    !focusedRowIsMounted &&
    focusedIndex >= 0
      ? (controller.getVisibleRows(focusedIndex, focusedIndex)[0] ?? null)
      : null;
  const parkedFocusedRowOffset =
    parkedFocusedRow == null
      ? null
      : getParkedFocusedRowOffset(
          focusedIndex,
          itemHeight,
          range,
          stickyLayout.windowHeight
        );
  const focusedVisibleRow =
    focusedIndex >= 0
      ? (controller.getVisibleRows(focusedIndex, focusedIndex)[0] ?? null)
      : null;
  const guideStyleText = getPathStoreGuideStyleText(
    focusedVisibleRow?.ancestorPaths.at(-1) ?? null
  );

  return (
    <div
      ref={rootRef}
      data-file-tree-virtualized-root="true"
      onKeyDown={handleTreeKeyDown}
      role="tree"
      tabIndex={-1}
      style={{ height: `${viewportHeight}px`, outline: 'none' }}
    >
      <style
        data-path-store-guide-style="true"
        dangerouslySetInnerHTML={{ __html: guideStyleText }}
      />
      <div ref={scrollRef} data-file-tree-virtualized-scroll="true">
        <div
          ref={listRef}
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
            {renderRangeChildren(
              controller,
              range,
              activeItemPath,
              itemHeight,
              (path, element) => {
                if (element == null) {
                  rowButtonRefs.current.delete(path);
                  return;
                }

                rowButtonRefs.current.set(path, element);
              },
              handleTreeKeyDown
            )}
            {parkedFocusedRow != null && parkedFocusedRowOffset != null
              ? renderStyledRow(
                  controller,
                  parkedFocusedRow,
                  activeItemPath,
                  itemHeight,
                  (path, element) => {
                    if (element == null) {
                      rowButtonRefs.current.delete(path);
                      return;
                    }

                    rowButtonRefs.current.set(path, element);
                  },
                  handleTreeKeyDown,
                  {
                    isParked: true,
                    style: {
                      left: '0',
                      position: 'absolute',
                      right: '0',
                      top: `${parkedFocusedRowOffset}px`,
                    },
                  }
                )
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}
