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
import type { SVGSpriteNames } from '../sprite';
import type { GitStatus } from '../types';
import {
  PATH_STORE_TREES_RENAME_VIEW,
  PathStoreTreesController,
} from './controller';
import { createPathStoreIconResolver } from './iconResolver';
import type {
  PathStoreTreesContextMenuItem,
  PathStoreTreesContextMenuOpenContext,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesDropTarget,
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

function RenameInput({
  ariaLabel,
  isFlattened = false,
  ref,
  value,
  onBlur,
  onInput,
}: {
  ariaLabel: string;
  isFlattened?: boolean;
  onBlur: () => void;
  onInput: (event: Event) => void;
  ref: (element: HTMLInputElement | null) => void;
  value: string;
}): JSX.Element {
  return (
    <input
      ref={ref}
      data-item-rename-input
      {...(isFlattened ? { 'data-item-flattened-rename-input': true } : {})}
      aria-label={ariaLabel}
      value={value}
      onBlur={onBlur}
      onInput={onInput}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

function formatFlattenedSegments(
  row: PathStoreTreesVisibleRow,
  renameInput: JSX.Element | null = null,
  dragTargetFlattenedSegmentPath: string | null = null
): JSX.Element | string {
  'use no memo';
  const segments = row.flattenedSegments;
  if (segments == null || segments.length === 0) {
    return renameInput ?? row.name;
  }

  return (
    <span data-item-flattened-subitems>
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={segment.path}>
            <span
              data-item-flattened-subitem={segment.path}
              data-item-flattened-subitem-drag-target={
                dragTargetFlattenedSegmentPath === segment.path
                  ? 'true'
                  : undefined
              }
            >
              {isLast && renameInput != null ? (
                renameInput
              ) : (
                <Truncate>{segment.name}</Truncate>
              )}
            </span>
            {index < segments.length - 1 ? ' / ' : ''}
          </Fragment>
        );
      })}
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

const TOUCH_LONG_PRESS_DELAY = 400;
const TOUCH_LONG_PRESS_MOVE_THRESHOLD = 10;
const DRAG_EDGE_SCROLL_THRESHOLD = 40;
const DRAG_EDGE_SCROLL_MAX_SPEED = 18;

function getPointElement(
  rootNode: Document | ShadowRoot,
  clientX: number,
  clientY: number
): HTMLElement | null {
  const pointRoot = rootNode as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
  };
  const documentElementFromPoint =
    document.elementFromPoint?.bind(document) ?? null;
  const element =
    pointRoot.elementFromPoint?.(clientX, clientY) ??
    documentElementFromPoint?.(clientX, clientY) ??
    null;
  return element instanceof HTMLElement ? element : null;
}

function resolveDropTargetFromElement(
  target: HTMLElement | null
): PathStoreTreesDropTarget | null {
  const rowButton = target?.closest?.('[data-type="item"]');
  if (!(rowButton instanceof HTMLElement)) {
    return null;
  }

  const hoveredPath = rowButton.dataset.itemPath ?? null;
  if (hoveredPath == null) {
    return null;
  }

  const flattenedSegment = target?.closest?.('[data-item-flattened-subitem]');
  const flattenedSegmentPath =
    flattenedSegment instanceof HTMLElement
      ? (flattenedSegment.getAttribute('data-item-flattened-subitem') ?? null)
      : null;
  if (flattenedSegmentPath != null && flattenedSegmentPath.endsWith('/')) {
    return {
      directoryPath: flattenedSegmentPath,
      flattenedSegmentPath,
      hoveredPath,
      kind: 'directory',
    };
  }

  if (rowButton.dataset.itemType === 'folder') {
    return {
      directoryPath: hoveredPath,
      flattenedSegmentPath: null,
      hoveredPath,
      kind: 'directory',
    };
  }

  const parentPath = rowButton.dataset.itemParentPath ?? null;
  if (parentPath == null || parentPath.length === 0) {
    return {
      directoryPath: null,
      flattenedSegmentPath: null,
      hoveredPath,
      kind: 'root',
    };
  }

  return {
    directoryPath: parentPath,
    flattenedSegmentPath: null,
    hoveredPath,
    kind: 'directory',
  };
}

function createDragPreviewElement(sourceElement: HTMLElement): HTMLElement {
  const preview = sourceElement.cloneNode(true) as HTMLElement;
  preview.removeAttribute('id');
  preview.dataset.pathStoreDragPreview = 'true';
  preview.setAttribute('aria-hidden', 'true');
  preview.tabIndex = -1;
  Object.assign(preview.style, {
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    left: '0px',
    margin: '0',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0px',
    willChange: 'transform',
    zIndex: '10000',
  });
  return preview;
}

// Safari mis-renders detached custom drag images, so keep its pointer drags on
// the native preview path that the legacy tree already used successfully.
function shouldUseCustomPointerDragImage(): boolean {
  return navigator.vendor !== 'Apple Computer, Inc.';
}

function getDragEdgeScrollDelta(clientY: number, scrollRect: DOMRect): number {
  const topDistance = clientY - scrollRect.top;
  if (topDistance < DRAG_EDGE_SCROLL_THRESHOLD) {
    const clampedDistance = Math.max(0, topDistance);
    return -Math.ceil(
      ((DRAG_EDGE_SCROLL_THRESHOLD - clampedDistance) /
        DRAG_EDGE_SCROLL_THRESHOLD) *
        DRAG_EDGE_SCROLL_MAX_SPEED
    );
  }

  const bottomDistance = scrollRect.bottom - clientY;
  if (bottomDistance < DRAG_EDGE_SCROLL_THRESHOLD) {
    const clampedDistance = Math.max(0, bottomDistance);
    return Math.ceil(
      ((DRAG_EDGE_SCROLL_THRESHOLD - clampedDistance) /
        DRAG_EDGE_SCROLL_THRESHOLD) *
        DRAG_EDGE_SCROLL_MAX_SPEED
    );
  }

  return 0;
}

const PATH_STORE_GIT_STATUS_TEXT: Record<GitStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
};

const PATH_STORE_GIT_STATUS_TITLE: Record<GitStatus, string> = {
  added: 'Git status: added',
  deleted: 'Git status: deleted',
  modified: 'Git status: modified',
};

// Built-in git decorations reuse the existing status slot so path-store rows can
// inherit the shared git-status CSS contract without a second decoration API.
function getBuiltInGitStatusDecoration(
  gitStatus: GitStatus | null,
  containsGitChange: boolean
): PathStoreTreesRowDecoration | null {
  if (gitStatus != null) {
    return {
      text: PATH_STORE_GIT_STATUS_TEXT[gitStatus],
      title: PATH_STORE_GIT_STATUS_TITLE[gitStatus],
    };
  }

  if (containsGitChange) {
    return {
      icon: { name: 'file-tree-icon-dot', width: 6, height: 6 },
      title: 'Contains git changes',
    };
  }

  return null;
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

function isSearchOpenSeedKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    /^[\p{L}\p{N}]$/u.test(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
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

// Closing search can reintroduce many rows above the focused item, so this
// helper preserves the row's previous viewport offset when search closes and
// the unfiltered list pushes the selected row outside the viewport.
function scrollFocusedRowToViewportOffset(
  scrollElement: HTMLElement,
  focusedIndex: number,
  itemHeight: number,
  fallbackViewportHeight: number,
  totalHeight: number,
  targetViewportOffset: number
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
  const currentViewportBottom = currentScrollTop + viewportHeight;
  if (itemTop >= currentScrollTop && itemBottom <= currentViewportBottom) {
    return false;
  }

  const preservedScrollTop = Math.max(
    0,
    Math.min(
      itemTop - Math.max(0, targetViewportOffset),
      Math.max(0, totalHeight - viewportHeight)
    )
  );
  if (preservedScrollTop === currentScrollTop) {
    return false;
  }

  scrollElement.scrollTop = preservedScrollTop;
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

function isEventInContextMenu(event: Event): boolean {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) {
      continue;
    }

    if (entry.dataset.pathStoreContextMenuRoot === 'true') {
      return true;
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

function getPathStoreTreesRootDomId(
  instanceId: string | undefined
): string | undefined {
  return instanceId == null ? undefined : `${instanceId}__tree`;
}

// Search keeps DOM focus on the built-in input, so the focused row still needs
// a stable DOM id for aria-activedescendant and visual-focus parity.
function getPathStoreTreesFocusedRowDomId(
  instanceId: string | undefined,
  path: string,
  parked: boolean
): string | undefined {
  if (instanceId == null) {
    return undefined;
  }

  return `${instanceId}__focused-item-${encodeURIComponent(path)}${parked ? '__parked' : ''}`;
}

function isBuiltInDecorationIconName(name: string): name is SVGSpriteNames {
  return (
    name === 'file-tree-icon-chevron' ||
    name === 'file-tree-icon-dot' ||
    name === 'file-tree-icon-file' ||
    name === 'file-tree-icon-lock'
  );
}

function renderRowDecoration(
  decoration: PathStoreTreesRowDecoration | null,
  resolveIcon: ReturnType<typeof createPathStoreIconResolver>['resolveIcon']
): JSX.Element | null {
  if (decoration == null) {
    return null;
  }

  if ('text' in decoration) {
    return <span title={decoration.title}>{decoration.text}</span>;
  }

  const icon =
    typeof decoration.icon === 'string'
      ? isBuiltInDecorationIconName(decoration.icon)
        ? resolveIcon(decoration.icon)
        : { name: decoration.icon }
      : isBuiltInDecorationIconName(decoration.icon.name)
        ? (() => {
            const resolvedIcon = resolveIcon(decoration.icon.name);
            const { name: _ignoredName, ...iconOverrides } = decoration.icon;
            return { ...resolvedIcon, ...iconOverrides };
          })()
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
  renameView: ReturnType<
    PathStoreTreesController[typeof PATH_STORE_TREES_RENAME_VIEW]
  >,
  row: PathStoreTreesVisibleRow,
  visualFocusPath: string | null,
  contextHoverPath: string | null,
  draggedPathSet: ReadonlySet<string> | null,
  dragTarget: PathStoreTreesDropTarget | null,
  dragAndDropEnabled: boolean,
  shouldSuppressContextMenu: () => boolean,
  handleRowDragStart: (
    event: DragEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  handleRowDragEnd: () => void,
  handleRowTouchStart: (
    event: TouchEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  instanceId: string | undefined,
  itemHeight: number,
  directoriesWithGitChanges: ReadonlySet<string> | undefined,
  gitStatusByPath: ReadonlyMap<string, GitStatus> | undefined,
  contextMenuEnabled: boolean,
  registerRenameInput: (element: HTMLInputElement | null) => void,
  registerButton: (path: string, element: HTMLElement | null) => void,
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
  const ownGitStatus = gitStatusByPath?.get(targetPath) ?? null;
  const containsGitChange =
    row.kind === 'directory' &&
    (directoriesWithGitChanges?.has(targetPath) ?? false);
  const decoration =
    renderDecorationForRow(row, targetPath) ??
    getBuiltInGitStatusDecoration(ownGitStatus, containsGitChange);
  const renamingPath = renameView.getPath();
  const isRenamingRow = renamingPath === targetPath;
  const renamingValue = isRenamingRow ? renameView.getValue() : '';
  const renameInput = !isRenamingRow ? null : (
    <RenameInput
      ref={registerRenameInput}
      ariaLabel={`Rename ${getPathStoreTreesRowAriaLabel(row)}`}
      isFlattened={row.isFlattened}
      value={renamingValue}
      onBlur={() => {
        renameView.cancel();
      }}
      onInput={(event) => {
        renameView.setValue((event.currentTarget as HTMLInputElement).value);
      }}
    />
  );
  const focusedProps =
    row.isFocused && visualFocusPath === targetPath
      ? { 'data-item-focused': true }
      : {};
  const selectedProps = row.isSelected ? { 'data-item-selected': true } : {};
  const contextHoverProps =
    contextHoverPath === targetPath
      ? { 'data-item-context-hover': 'true' }
      : {};
  const dragTargetProps =
    dragTarget?.kind === 'directory' && dragTarget.directoryPath === targetPath
      ? { 'data-item-drag-target': true }
      : {};
  const draggingProps =
    draggedPathSet?.has(targetPath) === true
      ? { 'data-item-dragging': true }
      : {};
  const gitStatusProps = {
    ...(ownGitStatus != null && { 'data-item-git-status': ownGitStatus }),
    ...(containsGitChange ? { 'data-item-contains-git-change': 'true' } : {}),
  };
  const domId = row.isFocused
    ? getPathStoreTreesFocusedRowDomId(instanceId, targetPath, isParked)
    : undefined;
  const parentPath = row.ancestorPaths.at(-1) ?? '';

  const rowContent = (
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
        {row.kind === 'directory' ? (
          <Icon {...resolveIcon('file-tree-icon-chevron')} />
        ) : (
          <Icon {...resolveIcon('file-tree-icon-file', targetPath)} />
        )}
      </div>
      <div data-item-section="content">
        {row.isFlattened
          ? formatFlattenedSegments(
              row,
              renameInput,
              dragTarget?.flattenedSegmentPath ?? null
            )
          : (renameInput ?? (
              <MiddleTruncate minimumLength={5} split="extension">
                {row.name}
              </MiddleTruncate>
            ))}
      </div>
      {decoration != null ? (
        <div data-item-section="status">
          {renderRowDecoration(decoration, resolveIcon)}
        </div>
      ) : null}
    </Fragment>
  );
  const commonProps = {
    'aria-expanded': row.kind === 'directory' ? row.isExpanded : undefined,
    'aria-haspopup': contextMenuEnabled ? 'menu' : undefined,
    'aria-label': getPathStoreTreesRowAriaLabel(row),
    'aria-level': row.level + 1,
    'aria-posinset': row.posInSet + 1,
    'aria-selected': row.isSelected ? 'true' : 'false',
    'aria-setsize': row.setSize,
    'data-item-parent-path': parentPath.length > 0 ? parentPath : undefined,
    'data-item-parked': isParked ? 'true' : undefined,
    'data-item-path': targetPath,
    'data-item-type': row.kind === 'directory' ? 'folder' : 'file',
    'data-type': 'item',
    id: domId,
    key,
    onContextMenu:
      contextMenuEnabled || dragAndDropEnabled
        ? (event: MouseEvent) => {
            if (shouldSuppressContextMenu()) {
              event.preventDefault();
              return;
            }

            if (!contextMenuEnabled) {
              return;
            }

            event.preventDefault();
            item?.focus();
            openContextMenuForRow(row, targetPath);
          }
        : undefined,
    onFocus: () => {
      item?.focus();
    },
    onKeyDown,
    ref: (element: HTMLElement | null) => {
      registerButton(targetPath, element);
    },
    role: 'treeitem',
    style: { minHeight: `${itemHeight}px`, ...style },
    tabIndex: row.isFocused ? 0 : -1,
    ...focusedProps,
    ...selectedProps,
    ...contextHoverProps,
    ...dragTargetProps,
    ...draggingProps,
    ...gitStatusProps,
  } as const;

  if (isRenamingRow) {
    return <div {...commonProps}>{rowContent}</div>;
  }

  return (
    <button
      {...commonProps}
      type="button"
      draggable={dragAndDropEnabled && !isParked}
      onDragEnd={dragAndDropEnabled && !isParked ? handleRowDragEnd : undefined}
      onDragStart={
        dragAndDropEnabled && !isParked
          ? (event) => {
              handleRowDragStart(event, row, targetPath);
            }
          : undefined
      }
      onMouseDown={(event) => {
        if (controller.isSearchOpen()) {
          event.preventDefault();
        }
      }}
      onTouchStart={
        dragAndDropEnabled && !isParked
          ? (event) => {
              handleRowTouchStart(event, row, targetPath);
            }
          : undefined
      }
      onClick={(event) => {
        const shouldCloseSearch = controller.isSearchOpen();
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
        if (shouldCloseSearch) {
          controller.closeSearch();
        }
      }}
    >
      {rowContent}
    </button>
  );
}

function renderRangeChildren(
  controller: PathStoreTreesController,
  renameView: ReturnType<
    PathStoreTreesController[typeof PATH_STORE_TREES_RENAME_VIEW]
  >,
  range: { start: number; end: number },
  activeItemPath: string | null,
  contextHoverPath: string | null,
  draggedPathSet: ReadonlySet<string> | null,
  dragTarget: PathStoreTreesDropTarget | null,
  dragAndDropEnabled: boolean,
  shouldSuppressContextMenu: () => boolean,
  handleRowDragStart: (
    event: DragEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  handleRowDragEnd: () => void,
  handleRowTouchStart: (
    event: TouchEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ) => void,
  instanceId: string | undefined,
  itemHeight: number,
  directoriesWithGitChanges: ReadonlySet<string> | undefined,
  gitStatusByPath: ReadonlyMap<string, GitStatus> | undefined,
  contextMenuEnabled: boolean,
  registerRenameInput: (element: HTMLInputElement | null) => void,
  registerButton: (path: string, element: HTMLElement | null) => void,
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
        renameView,
        row,
        activeItemPath,
        contextHoverPath,
        draggedPathSet,
        dragTarget,
        dragAndDropEnabled,
        shouldSuppressContextMenu,
        handleRowDragStart,
        handleRowDragEnd,
        handleRowTouchStart,
        instanceId,
        itemHeight,
        directoriesWithGitChanges,
        gitStatusByPath,
        contextMenuEnabled,
        registerRenameInput,
        registerButton,
        resolveIcon,
        renderDecorationForRow,
        openContextMenuForRow,
        onKeyDown,
        range.start + slotIndex
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
  directoriesWithGitChanges,
  gitStatusByPath,
  icons,
  instanceId,
  itemHeight = PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  overscan = PATH_STORE_TREES_DEFAULT_OVERSCAN,
  renamingEnabled = false,
  renderRowDecoration,
  searchEnabled = false,
  slotHost,
  viewportHeight = PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
}: PathStoreTreesViewProps): JSX.Element {
  'use no memo';
  const contextMenuAnchorRef = useRef<HTMLDivElement>(null);
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const isScrollingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLElement>());
  const updateViewportRef = useRef<() => void>(() => {});
  const domFocusOwnerRef = useRef(false);
  const previousFocusedPathRef = useRef<string | null>(null);
  const previousRenamingPathRef = useRef<string | null>(null);
  const restoreTreeFocusAfterSearchCloseRef = useRef(false);
  const restoreTreeFocusViewportOffsetRef = useRef<number | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const dragHoverOpenKeyRef = useRef<string | null>(null);
  const dragHoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const dragPointRef = useRef<{ clientX: number; clientY: number } | null>(
    null
  );
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const dragRowSnapshotRef = useRef<PathStoreTreesVisibleRow | null>(null);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const touchDragActiveRef = useRef(false);
  const touchPreviewOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const touchSourceElementRef = useRef<HTMLElement | null>(null);
  const touchStartPointRef = useRef<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const touchLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
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
  const { resolveIcon } = useMemo(
    () => createPathStoreIconResolver(icons),
    [icons]
  );
  const renameView = controller[PATH_STORE_TREES_RENAME_VIEW]();
  const renamingPath = renameView.getPath();
  const isRenaming = renamingPath != null;
  const isSearchOpen = controller.isSearchOpen();
  const searchValue = controller.getSearchValue();
  const focusedPath = controller.getFocusedPath();
  const focusedIndex = controller.getFocusedIndex();
  const dragAndDropEnabled = controller.isDragAndDropEnabled();
  const dragSession = controller.getDragSession();
  const draggedPathSet = useMemo(
    () => (dragSession == null ? null : new Set(dragSession.draggedPaths)),
    [dragSession]
  );
  const dragTarget = dragSession?.target ?? null;
  const draggedPrimaryPath = dragSession?.primaryPath ?? null;
  const treeDomId = getPathStoreTreesRootDomId(instanceId);
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
  const shouldRestoreContextMenuFocusRef = useRef(true);
  const closeContextMenuRef = useRef<(restoreFocus?: boolean) => void>(
    () => {}
  );
  const closeContextMenu = useCallback(
    (restoreFocus: boolean = true): void => {
      const currentContextMenuState = contextMenuStateRef.current;
      if (currentContextMenuState == null) {
        return;
      }

      shouldRestoreContextMenuFocusRef.current =
        shouldRestoreContextMenuFocusRef.current && restoreFocus;
      setContextMenuState(null);
      composition?.contextMenu?.onClose?.();
      if (shouldRestoreContextMenuFocusRef.current) {
        restoreFocusToTree(currentContextMenuState.path);
      }
    },
    [composition?.contextMenu, restoreFocusToTree]
  );
  closeContextMenuRef.current = closeContextMenu;
  const updateTriggerPosition = useCallback(
    (itemButton: HTMLElement | null): void => {
      const nextTop =
        itemButton == null
          ? null
          : getContextMenuAnchorTop(scrollRef.current, itemButton);
      setContextMenuAnchorTop((previousTop) =>
        previousTop === nextTop ? previousTop : nextTop
      );
    },
    []
  );
  const openContextMenuForRow = useCallback(
    (row: PathStoreTreesVisibleRow, targetPath: string): void => {
      const item = controller.getItem(targetPath);
      if (item == null) {
        return;
      }

      item.focus();
      updateTriggerPosition(rowButtonRefs.current.get(targetPath) ?? null);
      shouldRestoreContextMenuFocusRef.current = true;
      setContextMenuState({
        item: createContextMenuItem(row, targetPath),
        path: targetPath,
      });
    },
    [controller, updateTriggerPosition]
  );
  const startRenameFromPath = useCallback(
    (path?: string): void => {
      if (!renamingEnabled) {
        return;
      }

      if (controller.isSearchOpen()) {
        const scrollElement = scrollRef.current;
        const viewportHeight =
          scrollElement?.clientHeight != null && scrollElement.clientHeight > 0
            ? scrollElement.clientHeight
            : resolvedViewportHeight;
        restoreTreeFocusViewportOffsetRef.current =
          focusedIndex < 0 || scrollElement == null
            ? null
            : Math.max(
                0,
                Math.min(
                  focusedIndex * itemHeight - scrollElement.scrollTop,
                  Math.max(0, viewportHeight - itemHeight)
                )
              );
        restoreTreeFocusAfterSearchCloseRef.current = true;
      }

      if (controller.startRenaming(path) === false) {
        return;
      }

      setLastContextMenuInteraction('focus');
      setControllerRevision((revision) => revision + 1);
    },
    [
      controller,
      focusedIndex,
      itemHeight,
      renamingEnabled,
      resolvedViewportHeight,
    ]
  );

  const shouldSuppressContextMenu = (): boolean => {
    return (
      touchLongPressTimerRef.current != null ||
      touchDragActiveRef.current === true
    );
  };

  const requestDragAnimationFrame = (callback: () => void): number => {
    return typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => {
          callback();
        })
      : window.setTimeout(callback, 16);
  };

  const cancelDragAnimationFrame = (handle: number | null): void => {
    if (handle == null) {
      return;
    }

    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle);
      return;
    }

    window.clearTimeout(handle);
  };

  const clearDragHoverOpen = (): void => {
    if (dragHoverOpenTimerRef.current != null) {
      clearTimeout(dragHoverOpenTimerRef.current);
      dragHoverOpenTimerRef.current = null;
    }
    dragHoverOpenKeyRef.current = null;
  };

  const clearDragPreview = (): void => {
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  };

  const stopDragAutoScroll = (): void => {
    cancelDragAnimationFrame(dragAutoScrollFrameRef.current);
    dragAutoScrollFrameRef.current = null;
    dragPointRef.current = null;
  };

  const mountDragPreview = (preview: HTMLElement): void => {
    const rootNode = rootRef.current?.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      rootNode.append(preview);
      return;
    }

    document.body.append(preview);
  };

  const clearTouchDragResources = (): void => {
    touchCleanupRef.current?.();
    touchCleanupRef.current = null;
    if (touchLongPressTimerRef.current != null) {
      clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }
    touchDragActiveRef.current = false;
    touchPreviewOffsetRef.current = null;
    touchStartPointRef.current = null;
    if (touchSourceElementRef.current != null) {
      touchSourceElementRef.current.setAttribute('draggable', 'true');
      touchSourceElementRef.current.style.removeProperty('touch-action');
      touchSourceElementRef.current = null;
    }
    clearDragPreview();
    clearDragHoverOpen();
    stopDragAutoScroll();
    dragRowSnapshotRef.current = null;
  };

  const syncDropTargetFromPoint = (
    clientX: number,
    clientY: number
  ): PathStoreTreesDropTarget | null => {
    const rootNode = rootRef.current?.getRootNode();
    const pointRoot = rootNode instanceof ShadowRoot ? rootNode : document;
    const pointElement = getPointElement(pointRoot, clientX, clientY);
    const nextTarget = resolveDropTargetFromElement(pointElement);
    controller.setDragTarget(nextTarget);
    return controller.getDragSession()?.target ?? null;
  };

  const scheduleDragHoverOpen = (
    nextTarget: PathStoreTreesDropTarget | null
  ): void => {
    const openDelay = controller.getDragAndDropConfig()?.openOnDropDelay ?? 800;
    if (
      nextTarget == null ||
      nextTarget.kind !== 'directory' ||
      nextTarget.directoryPath == null ||
      openDelay <= 0
    ) {
      clearDragHoverOpen();
      return;
    }

    const targetItem = controller.getItem(nextTarget.directoryPath);
    const directoryItem = isPathStoreTreesDirectoryHandle(targetItem)
      ? targetItem
      : null;
    if (directoryItem == null || directoryItem.isExpanded()) {
      clearDragHoverOpen();
      return;
    }

    const nextKey = `${nextTarget.directoryPath}::${nextTarget.flattenedSegmentPath ?? ''}`;
    if (dragHoverOpenKeyRef.current === nextKey) {
      return;
    }

    clearDragHoverOpen();
    dragHoverOpenKeyRef.current = nextKey;
    dragHoverOpenTimerRef.current = setTimeout(() => {
      const currentTarget = controller.getDragSession()?.target;
      if (
        currentTarget?.kind !== 'directory' ||
        currentTarget.directoryPath !== nextTarget.directoryPath ||
        currentTarget.flattenedSegmentPath !== nextTarget.flattenedSegmentPath
      ) {
        return;
      }

      directoryItem.expand();
    }, openDelay);
  };

  const runDragAutoScroll = (): void => {
    dragAutoScrollFrameRef.current = null;
    const dragPoint = dragPointRef.current;
    const scrollElement = scrollRef.current;
    if (
      dragPoint == null ||
      scrollElement == null ||
      controller.getDragSession() == null
    ) {
      return;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const scrollDelta = getDragEdgeScrollDelta(dragPoint.clientY, scrollRect);
    if (scrollDelta === 0) {
      return;
    }

    const maxScrollTop = Math.max(
      0,
      scrollElement.scrollHeight - scrollElement.clientHeight
    );
    const boundedScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollElement.scrollTop + scrollDelta)
    );
    if (boundedScrollTop !== scrollElement.scrollTop) {
      scrollElement.scrollTop = boundedScrollTop;
      updateViewportRef.current();
    }

    const nextTarget = syncDropTargetFromPoint(
      dragPoint.clientX,
      dragPoint.clientY
    );
    scheduleDragHoverOpen(nextTarget);
    dragAutoScrollFrameRef.current =
      requestDragAnimationFrame(runDragAutoScroll);
  };

  const updateDragPoint = (clientX: number, clientY: number): void => {
    dragPointRef.current = { clientX, clientY };
    dragAutoScrollFrameRef.current ??=
      requestDragAnimationFrame(runDragAutoScroll);
  };

  const handleRowDragStart = (
    event: DragEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ): void => {
    const dragSource = event.currentTarget as HTMLElement | null;
    if (dragSource == null) {
      return;
    }

    clearTouchDragResources();
    clearDragPreview();
    clearDragHoverOpen();
    stopDragAutoScroll();
    if (controller.startDrag(targetPath) === false) {
      event.preventDefault();
      return;
    }

    dragRowSnapshotRef.current = row;
    if (event.dataTransfer != null) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.dropEffect = 'move';
      event.dataTransfer.setData('text/plain', targetPath);

      if (shouldUseCustomPointerDragImage()) {
        const preview = createDragPreviewElement(dragSource);
        const rect = dragSource.getBoundingClientRect();
        Object.assign(preview.style, {
          height: `${rect.height}px`,
          opacity: '0.85',
          transform: 'translate3d(-9999px, 0px, 0)',
          width: `${rect.width}px`,
        });
        mountDragPreview(preview);
        dragPreviewRef.current = preview;
        event.dataTransfer.setDragImage(
          preview,
          Math.max(0, event.clientX - rect.left),
          Math.max(0, event.clientY - rect.top)
        );
      }
    }
  };

  const handleRowDragEnd = (): void => {
    clearDragPreview();
    clearDragHoverOpen();
    stopDragAutoScroll();
    dragRowSnapshotRef.current = null;
    controller.cancelDrag();
  };

  const handleRowTouchStart = (
    event: TouchEvent,
    row: PathStoreTreesVisibleRow,
    targetPath: string
  ): void => {
    if (touchLongPressTimerRef.current != null || touchDragActiveRef.current) {
      return;
    }

    const touch = event.touches[0];
    const dragSource = event.currentTarget as HTMLElement | null;
    if (touch == null || dragSource == null) {
      return;
    }

    touchStartPointRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
    touchSourceElementRef.current = dragSource;
    dragSource.setAttribute('draggable', 'false');

    const clearPendingTouchStart = (): void => {
      if (touchLongPressTimerRef.current != null) {
        clearTimeout(touchLongPressTimerRef.current);
        touchLongPressTimerRef.current = null;
      }
      document.removeEventListener('touchmove', handlePendingTouchMove);
      document.removeEventListener('touchend', handlePendingTouchEnd);
      document.removeEventListener('touchcancel', handlePendingTouchEnd);
      if (touchCleanupRef.current === clearPendingTouchStart) {
        touchCleanupRef.current = null;
      }
      if (!touchDragActiveRef.current) {
        dragSource.setAttribute('draggable', 'true');
        if (touchSourceElementRef.current === dragSource) {
          touchSourceElementRef.current = null;
        }
        touchStartPointRef.current = null;
      }
    };

    const handlePendingTouchMove = (moveEvent: globalThis.TouchEvent): void => {
      const moveTouch = moveEvent.touches[0];
      const startPoint = touchStartPointRef.current;
      if (moveTouch == null || startPoint == null) {
        return;
      }

      const deltaX = moveTouch.clientX - startPoint.clientX;
      const deltaY = moveTouch.clientY - startPoint.clientY;
      if (
        deltaX * deltaX + deltaY * deltaY <=
        TOUCH_LONG_PRESS_MOVE_THRESHOLD * TOUCH_LONG_PRESS_MOVE_THRESHOLD
      ) {
        return;
      }

      clearPendingTouchStart();
    };

    const handlePendingTouchEnd = (): void => {
      clearPendingTouchStart();
    };

    document.addEventListener('touchmove', handlePendingTouchMove, {
      passive: true,
    });
    document.addEventListener('touchend', handlePendingTouchEnd);
    document.addEventListener('touchcancel', handlePendingTouchEnd);
    touchCleanupRef.current = clearPendingTouchStart;
    touchLongPressTimerRef.current = setTimeout(() => {
      clearPendingTouchStart();
      if (controller.startDrag(targetPath) === false) {
        dragSource.setAttribute('draggable', 'true');
        if (touchSourceElementRef.current === dragSource) {
          touchSourceElementRef.current = null;
        }
        touchStartPointRef.current = null;
        return;
      }

      touchDragActiveRef.current = true;
      touchSourceElementRef.current = dragSource;
      dragSource.setAttribute('draggable', 'false');
      dragSource.style.setProperty('touch-action', 'none');
      dragRowSnapshotRef.current = row;
      const rect = dragSource.getBoundingClientRect();
      const preview = createDragPreviewElement(dragSource);
      Object.assign(preview.style, {
        height: `${rect.height}px`,
        opacity: '0.85',
        transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
        width: `${rect.width}px`,
      });
      mountDragPreview(preview);
      dragPreviewRef.current = preview;
      touchPreviewOffsetRef.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };

      const handleActiveTouchMove = (
        moveEvent: globalThis.TouchEvent
      ): void => {
        const moveTouch = moveEvent.touches[0];
        if (moveTouch == null) {
          return;
        }

        moveEvent.preventDefault();
        const previewOffset = touchPreviewOffsetRef.current;
        if (previewOffset != null && dragPreviewRef.current != null) {
          dragPreviewRef.current.style.transform = `translate3d(${moveTouch.clientX - previewOffset.x}px, ${moveTouch.clientY - previewOffset.y}px, 0)`;
        }

        const nextTarget = syncDropTargetFromPoint(
          moveTouch.clientX,
          moveTouch.clientY
        );
        scheduleDragHoverOpen(nextTarget);
        updateDragPoint(moveTouch.clientX, moveTouch.clientY);
      };

      const handleActiveTouchEnd = (endEvent: globalThis.TouchEvent): void => {
        const endTouch = endEvent.changedTouches[0];
        if (endTouch != null) {
          syncDropTargetFromPoint(endTouch.clientX, endTouch.clientY);
        }

        controller.completeDrag();
        clearTouchDragResources();
      };

      const handleActiveTouchCancel = (): void => {
        controller.cancelDrag();
        clearTouchDragResources();
      };

      touchCleanupRef.current = () => {
        document.removeEventListener('touchmove', handleActiveTouchMove);
        document.removeEventListener('touchend', handleActiveTouchEnd);
        document.removeEventListener('touchcancel', handleActiveTouchCancel);
      };
      document.addEventListener('touchmove', handleActiveTouchMove, {
        passive: false,
      });
      document.addEventListener('touchend', handleActiveTouchEnd);
      document.addEventListener('touchcancel', handleActiveTouchCancel);
    }, TOUCH_LONG_PRESS_DELAY);
  };

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

    if (renameView.isActive()) {
      if (event.key === 'Escape') {
        renameView.cancel();
      } else if (event.key === 'Enter') {
        renameView.commit();
      } else {
        return;
      }

      setLastContextMenuInteraction('focus');
      setControllerRevision((revision) => revision + 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (renamingEnabled && event.key === 'F2') {
      startRenameFromPath(focusedPath ?? undefined);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isSearchOpen) {
      if (event.key === 'Escape') {
        restoreTreeFocusAfterSearchCloseRef.current = false;
        restoreTreeFocusViewportOffsetRef.current = null;
        controller.closeSearch();
      } else if (event.key === 'Enter') {
        const currentFocusedPath = controller.getFocusedPath();
        if (currentFocusedPath != null) {
          controller.selectOnlyPath(currentFocusedPath);
        }
        const scrollElement = scrollRef.current;
        const viewportHeight =
          scrollElement?.clientHeight != null && scrollElement.clientHeight > 0
            ? scrollElement.clientHeight
            : resolvedViewportHeight;
        restoreTreeFocusViewportOffsetRef.current =
          focusedIndex < 0 || scrollElement == null
            ? null
            : Math.max(
                0,
                Math.min(
                  focusedIndex * itemHeight - scrollElement.scrollTop,
                  Math.max(0, viewportHeight - itemHeight)
                )
              );
        restoreTreeFocusAfterSearchCloseRef.current = true;
        controller.closeSearch();
      } else if (event.key === 'ArrowDown') {
        controller.focusNextSearchMatch();
      } else if (event.key === 'ArrowUp') {
        controller.focusPreviousSearchMatch();
      } else {
        return;
      }

      setLastContextMenuInteraction('focus');
      setControllerRevision((revision) => revision + 1);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (searchEnabled && isSearchOpenSeedKey(event)) {
      controller.openSearch(event.key);
      setControllerRevision((revision) => revision + 1);
      event.preventDefault();
      event.stopPropagation();
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
    if (!searchEnabled || !isSearchOpen) {
      return;
    }

    focusElement(searchInputRef.current);
  }, [isSearchOpen, searchEnabled]);

  useLayoutEffect(() => {
    if (renamingPath == null) {
      previousRenamingPathRef.current = null;
      return;
    }

    if (previousRenamingPathRef.current === renamingPath) {
      return;
    }

    previousRenamingPathRef.current = renamingPath;
    const input = renameInputRef.current;
    if (input == null) {
      return;
    }

    focusElement(input);
    input.select();
  }, [renamingPath]);

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
    if (contextMenuEnabled || contextMenuState == null) {
      return;
    }

    closeContextMenu(false);
  }, [closeContextMenu, contextMenuEnabled, contextMenuState]);

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
      close: (options) => {
        closeContextMenuRef.current(options?.restoreFocus ?? true);
      },
      restoreFocus: () => {
        if (!shouldRestoreContextMenuFocusRef.current) {
          return;
        }
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

      if (isEventInContextMenu(event)) {
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

  const totalScrollableHeight = itemCount * itemHeight;

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
    const renameInputOwnsFocus =
      isRenaming && renameInputRef.current === activeTreeElement;
    const searchInputOwnsFocus =
      searchEnabled && searchInputRef.current === activeTreeElement;
    const shouldRestoreTreeFocusAfterSearchClose =
      restoreTreeFocusAfterSearchCloseRef.current && !isSearchOpen;
    const preservedViewportOffset =
      restoreTreeFocusViewportOffsetRef.current ?? 0;
    const focusWithinTree = activeTreeElement != null;
    const shouldOwnDomFocus = domFocusOwnerRef.current || focusWithinTree;
    const focusedPathChanged = previousFocusedPathRef.current !== focusedPath;

    const shouldRestoreFocusedRowViewportOffset =
      shouldRestoreTreeFocusAfterSearchClose &&
      scrollFocusedRowToViewportOffset(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        preservedViewportOffset
      );

    if (
      shouldRestoreFocusedRowViewportOffset ||
      (shouldOwnDomFocus &&
        focusedPathChanged &&
        scrollFocusedRowIntoView(
          scrollElement,
          focusedIndex,
          itemHeight,
          resolvedViewportHeight
        ))
    ) {
      updateViewportRef.current();
    }

    if (!shouldOwnDomFocus) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (renameInputOwnsFocus) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (searchInputOwnsFocus && !shouldRestoreTreeFocusAfterSearchClose) {
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (focusedButton == null) {
      if (shouldRestoreTreeFocusAfterSearchClose && focusedIndex >= 0) {
        scrollFocusedRowToViewportOffset(
          scrollElement,
          focusedIndex,
          itemHeight,
          resolvedViewportHeight,
          totalScrollableHeight,
          preservedViewportOffset
        );
        updateViewportRef.current();
      }
      previousFocusedPathRef.current = focusedPath;
      return;
    }

    if (
      focusedPathChanged ||
      shouldRestoreTreeFocusAfterSearchClose ||
      activeTreeElementPath == null ||
      activeTreeElementPath !== focusedPath
    ) {
      focusElement(focusedButton);
      restoreTreeFocusAfterSearchCloseRef.current = false;
      restoreTreeFocusViewportOffsetRef.current = null;
    }
    previousFocusedPathRef.current = focusedPath;
  }, [
    controller,
    focusedIndex,
    focusedPath,
    focusedRowIsMounted,
    itemHeight,
    isRenaming,
    isSearchOpen,
    itemCount,
    range,
    resolvedViewportHeight,
    searchEnabled,
    totalScrollableHeight,
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
      rowButton instanceof HTMLElement
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

  useLayoutEffect(() => {
    if (!dragAndDropEnabled) {
      return;
    }

    const handleWindowDragEnd = (): void => {
      clearTouchDragResources();
      controller.cancelDrag();
    };

    window.addEventListener('dragend', handleWindowDragEnd);
    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd);
      clearTouchDragResources();
      controller.cancelDrag();
    };
  }, [controller, dragAndDropEnabled]);

  const handleTreeDragOver = (event: DragEvent): void => {
    if (
      !dragAndDropEnabled ||
      controller.getDragSession() == null ||
      touchDragActiveRef.current
    ) {
      return;
    }

    const nextTarget = resolveDropTargetFromElement(
      event.target instanceof HTMLElement ? event.target : null
    );
    controller.setDragTarget(nextTarget);
    const resolvedTarget = controller.getDragSession()?.target ?? null;
    scheduleDragHoverOpen(resolvedTarget);
    updateDragPoint(event.clientX, event.clientY);
    if (event.dataTransfer != null) {
      event.dataTransfer.dropEffect = 'move';
    }
    event.preventDefault();
  };

  const handleTreeDragLeave = (event: DragEvent): void => {
    if (
      !dragAndDropEnabled ||
      controller.getDragSession() == null ||
      touchDragActiveRef.current
    ) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      rootRef.current?.contains(nextTarget) === true
    ) {
      return;
    }

    clearDragHoverOpen();
    stopDragAutoScroll();
    controller.setDragTarget(null);
  };

  const handleTreeDrop = (event: DragEvent): void => {
    if (
      !dragAndDropEnabled ||
      controller.getDragSession() == null ||
      touchDragActiveRef.current
    ) {
      return;
    }
    event.preventDefault();
    syncDropTargetFromPoint(event.clientX, event.clientY);
    controller.completeDrag();
    clearDragPreview();
    clearDragHoverOpen();
    stopDragAutoScroll();
    dragRowSnapshotRef.current = null;
  };

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
  const shouldRenderParkedFocusedRow =
    activeItemPath === focusedPath ||
    restoreTreeFocusAfterSearchCloseRef.current;
  const parkedFocusedRow =
    focusedPath != null &&
    shouldRenderParkedFocusedRow &&
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
  const draggedRowSnapshot = dragRowSnapshotRef.current;
  const draggedRowIsMounted =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    draggedRowSnapshot.index >= range.start &&
    draggedRowSnapshot.index <= range.end;
  const parkedDraggedRow =
    draggedPrimaryPath != null &&
    draggedRowSnapshot != null &&
    draggedRowSnapshot.path === draggedPrimaryPath &&
    !draggedRowIsMounted &&
    draggedRowSnapshot.path !== parkedFocusedRow?.path
      ? draggedRowSnapshot
      : null;
  const parkedDraggedRowOffset =
    parkedDraggedRow == null
      ? null
      : getParkedFocusedRowOffset(
          parkedDraggedRow.index,
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
  const activeDescendantId =
    isSearchOpen && focusedPath != null
      ? getPathStoreTreesFocusedRowDomId(
          instanceId,
          focusedPath,
          !focusedRowIsMounted
        )
      : undefined;
  const visualFocusPath =
    contextMenuState?.path ?? (isSearchOpen ? focusedPath : activeItemPath);
  const visualContextHoverPath = contextMenuState?.path ?? contextHoverPath;
  const triggerButton =
    triggerPath == null
      ? null
      : (rowButtonRefs.current.get(triggerPath) ?? null);
  const triggerButtonVisible =
    contextMenuEnabled &&
    triggerButton != null &&
    contextMenuAnchorTop != null &&
    triggerPath != null;
  const contextMenuAnchorStyle =
    triggerButtonVisible && contextMenuAnchorTop != null
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
    shouldRestoreContextMenuFocusRef.current = true;
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
      id={treeDomId}
      data-file-tree-virtualized-root="true"
      onDragLeave={dragAndDropEnabled ? handleTreeDragLeave : undefined}
      onDragOver={dragAndDropEnabled ? handleTreeDragOver : undefined}
      onDrop={dragAndDropEnabled ? handleTreeDrop : undefined}
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
      {searchEnabled ? (
        <div data-file-tree-search-container>
          <input
            ref={searchInputRef}
            aria-activedescendant={activeDescendantId}
            aria-controls={treeDomId}
            placeholder="Search…"
            data-file-tree-search-input
            value={searchValue}
            onBlur={() => {
              controller.closeSearch();
            }}
            onInput={(event) => {
              const target = event.currentTarget;
              controller.setSearch(target.value);
            }}
          />
        </div>
      ) : null}
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
              renameView,
              range,
              visualFocusPath,
              visualContextHoverPath,
              draggedPathSet,
              dragTarget,
              dragAndDropEnabled,
              shouldSuppressContextMenu,
              handleRowDragStart,
              handleRowDragEnd,
              handleRowTouchStart,
              instanceId,
              itemHeight,
              directoriesWithGitChanges,
              gitStatusByPath,
              contextMenuEnabled,
              (element) => {
                renameInputRef.current = element;
              },
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
                  renameView,
                  parkedFocusedRow,
                  visualFocusPath,
                  visualContextHoverPath,
                  draggedPathSet,
                  dragTarget,
                  dragAndDropEnabled,
                  shouldSuppressContextMenu,
                  handleRowDragStart,
                  handleRowDragEnd,
                  handleRowTouchStart,
                  instanceId,
                  itemHeight,
                  directoriesWithGitChanges,
                  gitStatusByPath,
                  contextMenuEnabled,
                  (element) => {
                    renameInputRef.current = element;
                  },
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
                      opacity: '0',
                      pointerEvents:
                        draggedPrimaryPath === parkedFocusedRow.path
                          ? 'none'
                          : undefined,
                      position: 'absolute',
                      right: '0',
                      top: `${parkedFocusedRowOffset}px`,
                    },
                  }
                )
              : null}
            {parkedDraggedRow != null && parkedDraggedRowOffset != null
              ? renderStyledRow(
                  controller,
                  renameView,
                  parkedDraggedRow,
                  visualFocusPath,
                  visualContextHoverPath,
                  draggedPathSet,
                  dragTarget,
                  dragAndDropEnabled,
                  shouldSuppressContextMenu,
                  handleRowDragStart,
                  handleRowDragEnd,
                  handleRowTouchStart,
                  instanceId,
                  itemHeight,
                  directoriesWithGitChanges,
                  gitStatusByPath,
                  contextMenuEnabled,
                  (element) => {
                    renameInputRef.current = element;
                  },
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
                  `parked-drag:${parkedDraggedRow.path}`,
                  {
                    isParked: true,
                    style: {
                      left: '0',
                      opacity: '0',
                      pointerEvents: 'none',
                      position: 'absolute',
                      right: '0',
                      top: `${parkedDraggedRowOffset}px`,
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
