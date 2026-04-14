/** @jsxImportSource preact */
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';

import { Icon } from '../components/Icon';
import { MiddleTruncate, Truncate } from '../components/OverflowText';
import {
  CONTEXT_MENU_SLOT_NAME,
  CONTEXT_MENU_TRIGGER_TYPE,
  HEADER_SLOT_NAME,
} from '../constants';
import { PathStoreTreesController } from './controller';
import { createPathStoreIconResolver } from './iconResolver';
import type {
  PathStoreTreesContextMenuItem,
  PathStoreTreesContextMenuOpenContext,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesItemHandle,
  PathStoreTreesRowDecoration,
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

function isSpaceSelectionKey(event: KeyboardEvent): boolean {
  return (
    event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
  );
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

function isContextMenuOpenKey(event: KeyboardEvent): boolean {
  return (event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu';
}

const BLOCKED_CONTEXT_MENU_NAV_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

const CONTEXT_MENU_ROW_ANCHOR_NAME = '--path-store-context-row';
let cachedAnchorSupportCss: typeof CSS | null | undefined;
let cachedAnchorSupportValue: boolean | null = null;

function isEventInContextMenu(event: Event): boolean {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) {
      continue;
    }

    if (entry.dataset.type === 'context-menu-anchor') {
      return true;
    }

    if (entry.getAttribute('slot') === CONTEXT_MENU_SLOT_NAME) {
      return true;
    }
  }

  return false;
}

function serializeAnchorRect(
  rect: DOMRect
): PathStoreTreesContextMenuOpenContext['anchorRect'] {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

// The floating trigger lives outside the virtual rows, so we convert a row's
// viewport rect back into scroll-content coordinates before positioning it.
function getContextMenuAnchorTop(
  scrollElement: HTMLElement | null,
  itemElement: HTMLElement
): number {
  if (scrollElement == null) {
    return itemElement.offsetTop;
  }

  const itemRect = itemElement.getBoundingClientRect();
  const scrollRect = scrollElement.getBoundingClientRect();
  return itemRect.top - scrollRect.top + scrollElement.scrollTop;
}

function supportsContextMenuAnchorPositioning(): boolean {
  const currentCss = typeof CSS === 'undefined' ? null : CSS;
  if (
    cachedAnchorSupportCss === currentCss &&
    cachedAnchorSupportValue != null
  ) {
    return cachedAnchorSupportValue;
  }

  cachedAnchorSupportCss = currentCss;
  cachedAnchorSupportValue =
    currentCss != null &&
    currentCss.supports('anchor-name', CONTEXT_MENU_ROW_ANCHOR_NAME) &&
    currentCss.supports('position-anchor', CONTEXT_MENU_ROW_ANCHOR_NAME) &&
    currentCss.supports('top', 'anchor(top)');

  return cachedAnchorSupportValue;
}

function createContextMenuItem(
  row: PathStoreTreesVisibleRow,
  path: string
): PathStoreTreesContextMenuItem {
  return {
    kind: row.kind,
    name: getPathStoreTreesRowAriaLabel(row),
    path,
  };
}

function renderRowDecoration(
  decoration: PathStoreTreesRowDecoration | null
): JSX.Element | null {
  if (decoration == null) {
    return null;
  }

  if ('text' in decoration) {
    return <span title={decoration.title}>{decoration.text}</span>;
  }

  const icon =
    typeof decoration.icon === 'string'
      ? { name: decoration.icon }
      : decoration.icon;
  return (
    <span title={decoration.title}>
      <Icon {...icon} />
    </span>
  );
}

function focusFirstMenuElement(menuElement: HTMLElement | null): void {
  if (menuElement == null) {
    return;
  }

  const focusable = menuElement.querySelector<HTMLElement>(
    [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ')
  );

  focusElement(focusable ?? menuElement);
}

function renderStyledRow(
  controller: PathStoreTreesController,
  row: PathStoreTreesVisibleRow,
  visualFocusPath: string | null,
  contextAnchorName: string | null,
  contextAnchorPath: string | null,
  contextHoverPath: string | null,
  itemHeight: number,
  contextMenuEnabled: boolean,
  registerButton: (path: string, element: HTMLButtonElement | null) => void,
  resolveIcon: ReturnType<typeof createPathStoreIconResolver>['resolveIcon'],
  renderDecorationForRow: (
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => PathStoreTreesRowDecoration | null,
  openContextMenuForRow: (
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  onKeyDown: (event: KeyboardEvent) => void,
  key: string | number,
  options: {
    isParked?: boolean;
    style?: Record<string, string | undefined>;
  } = {}
): JSX.Element {
  const targetPath = getPathStoreTreesRowPath(row);
  const item = controller.getItem(targetPath);
  const directoryItem = isPathStoreTreesDirectoryHandle(item) ? item : null;
  const { isParked = false, style } = options;
  const decoration = renderDecorationForRow(row, targetPath);
  const focusedProps =
    row.isFocused && visualFocusPath === targetPath
      ? { 'data-item-focused': true }
      : {};
  const selectedProps = row.isSelected ? { 'data-item-selected': true } : {};
  const contextAnchorProps =
    contextAnchorPath === targetPath
      ? { 'data-item-context-anchor': 'true' }
      : {};
  const contextAnchorStyle =
    contextAnchorPath === targetPath && contextAnchorName != null
      ? { anchorName: contextAnchorName }
      : undefined;
  const contextHoverProps =
    contextHoverPath === targetPath
      ? { 'data-item-context-hover': 'true' }
      : {};

  return (
    <button
      key={key}
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
      aria-haspopup={contextMenuEnabled ? 'menu' : undefined}
      aria-posinset={row.posInSet + 1}
      aria-selected={row.isSelected ? 'true' : 'false'}
      aria-setsize={row.setSize}
      onClick={(event) => {
        if (event.shiftKey) {
          controller.selectPathRange(
            targetPath,
            event.ctrlKey || event.metaKey
          );
        } else if (event.ctrlKey || event.metaKey) {
          controller.togglePathSelectionFromInput(targetPath);
        } else {
          controller.selectOnlyPath(targetPath);
        }

        item?.focus();
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          directoryItem?.toggle();
        }
      }}
      onFocus={() => {
        item?.focus();
      }}
      onContextMenu={
        contextMenuEnabled
          ? (event) => {
              event.preventDefault();
              item?.focus();
              openContextMenuForRow(row, targetPath);
            }
          : undefined
      }
      onKeyDown={onKeyDown}
      role="treeitem"
      tabIndex={row.isFocused ? 0 : -1}
      style={{
        minHeight: `${itemHeight}px`,
        ...contextAnchorStyle,
        ...style,
      }}
      {...focusedProps}
      {...selectedProps}
      {...contextAnchorProps}
      {...contextHoverProps}
    >
      {/*
        Reuse the outer row shell by viewport slot, but remount the row's inner
        layout when the slot is reassigned to a different path. This avoids the
        remaining CLS source from the trace where indent/icon/content DIVs slide
        horizontally when one slot is recycled across rows with different tree
        depths.
      */}
      <Fragment key={row.path}>
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
            <Icon {...resolveIcon('file-tree-icon-chevron')} />
          ) : (
            <Icon {...resolveIcon('file-tree-icon-file', targetPath)} />
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
        {decoration != null ? (
          <div data-item-section="status">
            {renderRowDecoration(decoration)}
          </div>
        ) : null}
      </Fragment>
    </button>
  );
}

function renderRangeChildren(
  controller: PathStoreTreesController,
  range: { start: number; end: number },
  activeItemPath: string | null,
  contextAnchorName: string | null,
  contextAnchorPath: string | null,
  contextHoverPath: string | null,
  itemHeight: number,
  contextMenuEnabled: boolean,
  registerButton: (path: string, element: HTMLButtonElement | null) => void,
  resolveIcon: ReturnType<typeof createPathStoreIconResolver>['resolveIcon'],
  renderDecorationForRow: (
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => PathStoreTreesRowDecoration | null,
  openContextMenuForRow: (
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  onKeyDown: (event: KeyboardEvent) => void
): JSX.Element[] {
  if (range.end < range.start) {
    return [];
  }

  // Reuse DOM nodes by viewport slot instead of item identity so rebasing the
  // overscanned window does not make still-visible rows jump to a new slot.
  // That keeps sticky virtualization Safari-friendly while avoiding large
  // layout shifts during scroll in browsers that track CLS inside scrollers.
  return controller
    .getVisibleRows(range.start, range.end)
    .map((row, slotIndex) =>
      renderStyledRow(
        controller,
        row,
        activeItemPath,
        contextAnchorName,
        contextAnchorPath,
        contextHoverPath,
        itemHeight,
        contextMenuEnabled,
        registerButton,
        resolveIcon,
        renderDecorationForRow,
        openContextMenuForRow,
        onKeyDown,
        slotIndex
      )
    );
}

/**
 * New path-store-specific always-virtualized renderer. It borrows the sticky
 * window idea from the legacy virtualizer without reusing its code.
 */
export function PathStoreTreesView({
  composition,
  controller,
  icons,
  itemHeight = PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  overscan = PATH_STORE_TREES_DEFAULT_OVERSCAN,
  renderRowDecoration,
  slotHost,
  viewportHeight = PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
}: PathStoreTreesViewProps): JSX.Element {
  'use no memo';
  const contextMenuAnchorRef = useRef<HTMLDivElement>(null);
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const isScrollingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const updateViewportRef = useRef<() => void>(() => {});
  const domFocusOwnerRef = useRef(false);
  const previousFocusedPathRef = useRef<string | null>(null);
  const [, setControllerRevision] = useState(0);
  const [activeItemPath, setActiveItemPath] = useState<string | null>(null);
  const [contextHoverPath, setContextHoverPath] = useState<string | null>(null);
  const [contextMenuAnchorTop, setContextMenuAnchorTop] = useState<
    number | null
  >(null);
  const [lastContextMenuInteraction, setLastContextMenuInteraction] = useState<
    'focus' | 'pointer' | null
  >(null);
  const [contextMenuState, setContextMenuState] = useState<{
    item: PathStoreTreesContextMenuItem;
    path: string;
  } | null>(null);
  const contextMenuStateRef = useRef(contextMenuState);
  contextMenuStateRef.current = contextMenuState;
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
  const contextMenuEnabled =
    composition?.contextMenu?.enabled === true ||
    composition?.contextMenu?.render != null ||
    composition?.contextMenu?.onOpen != null ||
    composition?.contextMenu?.onClose != null;
  const contextMenuUsesAnchorPositioning =
    supportsContextMenuAnchorPositioning();
  const { resolveIcon } = useMemo(
    () => createPathStoreIconResolver(icons),
    [icons]
  );
  const focusedPath = controller.getFocusedPath();
  const focusedIndex = controller.getFocusedIndex();
  const focusedRowIsMounted =
    focusedIndex >= range.start && focusedIndex <= range.end;
  const renderDecorationForRow = useCallback(
    (
      row: PathStoreTreesVisibleRow,
      targetPath: string
    ): PathStoreTreesRowDecoration | null =>
      renderRowDecoration?.({
        item: createContextMenuItem(row, targetPath),
        row,
      }) ?? null,
    [renderRowDecoration]
  );
  const restoreContextMenuFocus = useCallback(
    (restorePath: string | null): boolean => {
      const focusedButton =
        restorePath == null
          ? null
          : (rowButtonRefs.current.get(restorePath) ?? null);
      if (focusElement(focusedButton)) {
        return true;
      }

      return focusElement(rootRef.current);
    },
    []
  );
  const restoreFocusToTree = useCallback(
    (path: string | null): void => {
      const nextFocusedPath = controller.focusNearestPath(path);
      restoreContextMenuFocus(nextFocusedPath);
    },
    [controller, restoreContextMenuFocus]
  );
  const restoreFocusToTreeRef = useRef(restoreFocusToTree);
  restoreFocusToTreeRef.current = restoreFocusToTree;
  const closeContextMenuRef = useRef<() => void>(() => {});
  const closeContextMenu = useCallback((): void => {
    const currentContextMenuState = contextMenuStateRef.current;
    if (currentContextMenuState == null) {
      return;
    }

    setContextMenuState(null);
    composition?.contextMenu?.onClose?.();
    restoreFocusToTree(currentContextMenuState.path);
  }, [composition?.contextMenu, restoreFocusToTree]);
  closeContextMenuRef.current = closeContextMenu;
  const updateTriggerPosition = useCallback(
    (itemButton: HTMLButtonElement | null): void => {
      if (contextMenuUsesAnchorPositioning) {
        setContextMenuAnchorTop(null);
        return;
      }

      const nextTop =
        itemButton == null
          ? null
          : getContextMenuAnchorTop(scrollRef.current, itemButton);
      setContextMenuAnchorTop((previousTop) =>
        previousTop === nextTop ? previousTop : nextTop
      );
    },
    [contextMenuUsesAnchorPositioning]
  );
  const openContextMenuForRow = useCallback(
    (row: PathStoreTreesVisibleRow, targetPath: string): void => {
      const item = controller.getItem(targetPath);
      if (item == null) {
        return;
      }

      item.focus();
      updateTriggerPosition(rowButtonRefs.current.get(targetPath) ?? null);
      setContextMenuState({
        item: createContextMenuItem(row, targetPath),
        path: targetPath,
      });
    },
    [controller, updateTriggerPosition]
  );

  const handleTreeKeyDown = (event: KeyboardEvent): void => {
    if (contextMenuState != null) {
      if (event.key === 'Escape') {
        closeContextMenu();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (BLOCKED_CONTEXT_MENU_NAV_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const focusedItem = controller.getFocusedItem();
    if (focusedItem == null) {
      return;
    }

    const focusedDirectoryItem = isPathStoreTreesDirectoryHandle(focusedItem)
      ? focusedItem
      : null;
    let handled = true;
    if (event.shiftKey && event.key === 'ArrowDown') {
      controller.extendSelectionFromFocused(1);
    } else if (event.shiftKey && event.key === 'ArrowUp') {
      controller.extendSelectionFromFocused(-1);
    } else if (
      contextMenuEnabled &&
      isContextMenuOpenKey(event) &&
      focusedPath != null &&
      focusedIndex >= 0
    ) {
      const focusedRow =
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ?? null;
      const focusedButton = rowButtonRefs.current.get(focusedPath) ?? null;
      if (focusedRow == null || focusedButton == null) {
        handled = false;
      } else {
        openContextMenuForRow(focusedRow, focusedPath);
      }
    } else if ((event.ctrlKey || event.metaKey) && isSpaceSelectionKey(event)) {
      controller.toggleFocusedSelection();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'a'
    ) {
      controller.selectAllVisiblePaths();
    } else {
      switch (event.key) {
        case 'ArrowDown':
          controller.focusNextItem();
          break;
        case 'ArrowUp':
          controller.focusPreviousItem();
          break;
        case 'ArrowRight':
          if (
            focusedDirectoryItem == null ||
            focusedDirectoryItem.isExpanded()
          ) {
            controller.focusNextItem();
          } else {
            focusedDirectoryItem.expand();
          }
          break;
        case 'ArrowLeft':
          if (
            focusedDirectoryItem != null &&
            focusedDirectoryItem.isExpanded()
          ) {
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
    }

    if (!handled) {
      return;
    }

    setLastContextMenuInteraction('focus');

    // Focus-only and selection-only controller updates do not change
    // range/itemCount, so force a render tick before the DOM-focus sync effect
    // runs.
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
      if (contextMenuStateRef.current != null) {
        closeContextMenuRef.current();
      }
      isScrollingRef.current = true;
      setContextHoverPath((previousPath) =>
        previousPath == null ? previousPath : null
      );

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
        isScrollingRef.current = false;
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
      isScrollingRef.current = false;
      resizeObserver?.disconnect();
    };
  }, [controller, itemHeight, overscan, viewportHeight]);

  useLayoutEffect(() => {
    if (contextMenuState == null) {
      slotHost?.clearSlotContent(CONTEXT_MENU_SLOT_NAME);
      return;
    }

    const anchorElement =
      contextMenuTriggerRef.current ?? contextMenuAnchorRef.current;
    if (anchorElement == null) {
      return;
    }

    const context: PathStoreTreesContextMenuOpenContext = {
      anchorElement,
      anchorRect: serializeAnchorRect(anchorElement.getBoundingClientRect()),
      close: () => {
        closeContextMenuRef.current();
      },
      restoreFocus: () => {
        restoreFocusToTreeRef.current(
          contextMenuStateRef.current?.path ?? null
        );
      },
    };
    const menuContent =
      composition?.contextMenu?.render?.(contextMenuState.item, context) ??
      null;

    slotHost?.setSlotContent(CONTEXT_MENU_SLOT_NAME, menuContent);
    composition?.contextMenu?.onOpen?.(contextMenuState.item, context);
    focusFirstMenuElement(menuContent);
    queueMicrotask(() => {
      if (menuContent == null || !menuContent.isConnected) {
        return;
      }

      if (document.activeElement !== menuContent) {
        return;
      }

      focusFirstMenuElement(menuContent);
    });

    return () => {
      slotHost?.clearSlotContent(CONTEXT_MENU_SLOT_NAME);
    };
  }, [composition?.contextMenu, contextMenuState, slotHost]);

  useLayoutEffect(() => {
    if (
      contextMenuState != null &&
      controller.getItem(contextMenuState.path) == null
    ) {
      closeContextMenu();
    }
  }, [closeContextMenu, contextMenuState, controller]);

  useLayoutEffect(() => {
    if (contextMenuState == null) {
      return;
    }

    const rootNode = rootRef.current?.getRootNode();
    const host =
      rootNode instanceof ShadowRoot ? rootNode.host : rootRef.current;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (contextMenuAnchorRef.current?.contains(target) === true) {
        return;
      }

      if (host?.contains(target) === true) {
        return;
      }

      closeContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [closeContextMenu, contextMenuState]);

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

  const focusTriggerPath =
    domFocusOwnerRef.current === true ? (activeItemPath ?? focusedPath) : null;
  const triggerPath =
    contextMenuState?.path ??
    (lastContextMenuInteraction === 'pointer'
      ? contextHoverPath
      : lastContextMenuInteraction === 'focus'
        ? focusTriggerPath
        : null);

  useLayoutEffect(() => {
    const triggerButton =
      triggerPath == null
        ? null
        : (rowButtonRefs.current.get(triggerPath) ?? null);
    updateTriggerPosition(triggerButton);
  }, [
    itemCount,
    range,
    resolvedViewportHeight,
    triggerPath,
    updateTriggerPosition,
  ]);

  const handleTreePointerOver = useCallback((event: Event): void => {
    if (isScrollingRef.current) {
      return;
    }

    if (isEventInContextMenu(event)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (
      target.closest?.(`[data-type="${CONTEXT_MENU_TRIGGER_TYPE}"]`) != null
    ) {
      return;
    }

    const rowButton = target.closest?.('[data-type="item"]');
    const nextPath =
      rowButton instanceof HTMLButtonElement
        ? (rowButton.dataset.itemPath ?? null)
        : null;

    if (nextPath != null) {
      setLastContextMenuInteraction((previousMode) =>
        previousMode === 'pointer' ? previousMode : 'pointer'
      );
    }
    setContextHoverPath((previousPath) =>
      previousPath === nextPath ? previousPath : nextPath
    );
  }, []);

  const handleTreePointerLeave = useCallback((): void => {
    setContextHoverPath(null);
  }, []);

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
  const contextAnchorName =
    contextMenuUsesAnchorPositioning && triggerPath != null
      ? CONTEXT_MENU_ROW_ANCHOR_NAME
      : null;
  const visualFocusPath = contextMenuState?.path ?? activeItemPath;
  const contextAnchorPath = triggerPath;
  const visualContextHoverPath = contextMenuState?.path ?? contextHoverPath;
  const triggerButton =
    triggerPath == null
      ? null
      : (rowButtonRefs.current.get(triggerPath) ?? null);
  const triggerButtonVisible =
    contextMenuEnabled &&
    triggerButton != null &&
    triggerPath != null &&
    (contextMenuUsesAnchorPositioning || contextMenuAnchorTop != null);
  const contextMenuAnchorStyle =
    contextMenuUsesAnchorPositioning && contextAnchorName != null
      ? {
          positionAnchor: contextAnchorName,
          top: 'anchor(top)',
        }
      : !contextMenuUsesAnchorPositioning &&
          triggerButtonVisible &&
          contextMenuAnchorTop != null
        ? {
            top: `${contextMenuAnchorTop}px`,
          }
        : undefined;
  const openMenuFromTrigger = (): void => {
    if (triggerPath == null || triggerButton == null) {
      return;
    }

    const triggerItem = controller.getItem(triggerPath);
    if (triggerItem == null) {
      return;
    }

    updateTriggerPosition(triggerButton);
    setContextMenuState({
      item: {
        kind: triggerItem.isDirectory() ? 'directory' : 'file',
        name: triggerButton.getAttribute('aria-label') ?? triggerPath,
        path: triggerItem.getPath(),
      },
      path: triggerItem.getPath(),
    });
  };

  return (
    <div
      ref={rootRef}
      data-file-tree-virtualized-root="true"
      onKeyDown={handleTreeKeyDown}
      onPointerLeave={contextMenuEnabled ? handleTreePointerLeave : undefined}
      onPointerOver={contextMenuEnabled ? handleTreePointerOver : undefined}
      role="tree"
      tabIndex={-1}
      style={{
        height: `${viewportHeight}px`,
        outline: 'none',
        position: 'relative',
      }}
    >
      <style
        data-path-store-guide-style="true"
        dangerouslySetInnerHTML={{ __html: guideStyleText }}
      />
      <slot name={HEADER_SLOT_NAME} data-type="header-slot" />
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
              visualFocusPath,
              contextAnchorName,
              contextAnchorPath,
              visualContextHoverPath,
              itemHeight,
              contextMenuEnabled,
              (path, element) => {
                if (element == null) {
                  rowButtonRefs.current.delete(path);
                  return;
                }

                rowButtonRefs.current.set(path, element);
              },
              resolveIcon,
              renderDecorationForRow,
              openContextMenuForRow,
              handleTreeKeyDown
            )}
            {parkedFocusedRow != null && parkedFocusedRowOffset != null
              ? renderStyledRow(
                  controller,
                  parkedFocusedRow,
                  visualFocusPath,
                  contextAnchorName,
                  contextAnchorPath,
                  visualContextHoverPath,
                  itemHeight,
                  contextMenuEnabled,
                  (path, element) => {
                    if (element == null) {
                      rowButtonRefs.current.delete(path);
                      return;
                    }

                    rowButtonRefs.current.set(path, element);
                  },
                  resolveIcon,
                  renderDecorationForRow,
                  openContextMenuForRow,
                  handleTreeKeyDown,
                  `parked:${parkedFocusedRow.path}`,
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
        {contextMenuEnabled ? (
          <div
            ref={contextMenuAnchorRef}
            data-type="context-menu-anchor"
            data-anchor-positioning={
              contextMenuUsesAnchorPositioning ? 'true' : undefined
            }
            data-visible={triggerButtonVisible ? 'true' : 'false'}
            style={contextMenuAnchorStyle}
          >
            <button
              ref={contextMenuTriggerRef}
              type="button"
              data-type={CONTEXT_MENU_TRIGGER_TYPE}
              aria-label="Options"
              aria-haspopup="menu"
              data-visible={triggerButtonVisible ? 'true' : 'false'}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (contextMenuState != null) {
                  closeContextMenu();
                  return;
                }

                openMenuFromTrigger();
              }}
              tabIndex={-1}
            >
              <Icon {...resolveIcon('file-tree-icon-ellipsis')} />
            </button>
            {contextMenuState != null ? (
              <slot name={CONTEXT_MENU_SLOT_NAME} />
            ) : null}
          </div>
        ) : null}
      </div>
      {contextMenuState != null ? (
        <div
          data-type="context-menu-wash"
          aria-hidden="true"
          onMouseDownCapture={(event) => {
            event.preventDefault();
            closeContextMenu();
          }}
          onTouchStartCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
          }}
          onTouchMoveCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onWheelCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ) : null}
    </div>
  );
}
