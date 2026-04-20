/** @jsxImportSource preact */
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import {
  useCallback,
  useEffect,
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
import {
  FILE_TREE_RENAME_VIEW,
  FileTreeController,
} from '../model/FileTreeController';
import {
  computeFileTreeLayout,
  computeStickyRows,
  type FileTreeLayoutSnapshot,
  type FileTreeLayoutStickyRow,
} from '../model/fileTreeLayout';
import type {
  FileTreeContextMenuButtonVisibility,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeContextMenuTriggerMode,
  FileTreeDirectoryHandle,
  FileTreeDropTarget,
  FileTreeItemHandle,
  FileTreeRowDecoration,
  FileTreeViewProps,
  FileTreeVisibleRow,
} from '../model/types';
import {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '../model/virtualization';
import type { SVGSpriteNames } from '../sprite';
import type { GitStatus } from '../types';
import {
  GIT_STATUS_DESCENDANT_TITLE,
  GIT_STATUS_LABEL,
  GIT_STATUS_TITLE,
} from '../utils/gitStatusPresentation';
import { createFileTreeIconResolver } from './iconResolver';

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
  row: FileTreeVisibleRow,
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

function getFileTreeRowPath(row: FileTreeVisibleRow): string {
  return row.isFlattened
    ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
        row.path)
    : row.path;
}

function getFileTreeRowAriaLabel(row: FileTreeVisibleRow): string {
  const flattenedSegments = row.flattenedSegments;
  if (flattenedSegments == null || flattenedSegments.length === 0) {
    return row.name;
  }

  return flattenedSegments.map((segment) => segment.name).join(' / ');
}

type FileTreeViewLayoutState = {
  snapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>;
  // Rows rendered inside the sticky overlay. Usually equal to
  // `snapshot.sticky.rows`, but at scrollTop=0 we keep this populated with
  // what the overlay would contain at scrollTop=1 so the DOM is ready before
  // the first scroll lands (CSS hides the overlay until the user scrolls, so
  // there's no visual impact at rest). Without this, the overlay has to be
  // created in the same frame that the first scroll happens, and the compositor
  // paints the scrolled rows one frame before React can mount it — showing up
  // as a brief upward jump of the first sticky folder.
  overlayRows: readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[];
  overlayHeight: number;
  visibleRows: readonly FileTreeVisibleRow[];
};

// Builds one visible-row snapshot so the layout engine and renderer consume the
// same projection, sticky chain, occlusion window, and mounted list slice.
//
// When sticky folders are disabled we skip materializing the full visible-row
// array — the layout engine only needs the total row count for geometry in
// that case, and the renderer can range-fetch the window slice directly from
// the controller. That keeps scroll work O(window) instead of O(total rows).
function computeFileTreeViewLayoutState({
  controller,
  itemHeight,
  overscan,
  scrollTop,
  stickyFolders,
  viewportHeight,
}: {
  controller: FileTreeController;
  itemHeight: number;
  overscan: number;
  scrollTop: number;
  stickyFolders: boolean;
  viewportHeight: number;
}): FileTreeViewLayoutState {
  const visibleCount = controller.getVisibleCount();
  const visibleRows =
    stickyFolders && visibleCount > 0
      ? controller.getVisibleRows(0, visibleCount - 1)
      : [];
  const snapshot = computeFileTreeLayout(visibleRows, {
    itemHeight,
    overscan,
    scrollTop,
    totalRowCount: visibleCount,
    viewportHeight,
  });

  const overlayRows =
    stickyFolders && scrollTop <= 0 && visibleRows.length > 0
      ? computeStickyRows(visibleRows, 1, itemHeight)
      : snapshot.sticky.rows;
  const overlayHeight = overlayRows.reduce(
    (maxBottom, entry) => Math.max(maxBottom, entry.top + itemHeight),
    0
  );

  return {
    overlayHeight,
    overlayRows,
    snapshot,
    visibleRows,
  };
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
): FileTreeDropTarget | null {
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
  preview.dataset.fileTreeDragPreview = 'true';
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

// Built-in git decorations now live in their own fixed lane so custom row
// decorations can coexist without borrowing git styling or precedence.
function getBuiltInGitStatusDecoration(
  gitStatus: GitStatus | null,
  containsGitChange: boolean
): FileTreeRowDecoration | null {
  if (gitStatus != null) {
    const label = GIT_STATUS_LABEL[gitStatus];
    if (label == null) {
      return null;
    }

    return {
      text: label,
      title: GIT_STATUS_TITLE[gitStatus],
    };
  }

  if (containsGitChange) {
    return {
      icon: { name: 'file-tree-icon-dot', width: 6, height: 6 },
      title: GIT_STATUS_DESCENDANT_TITLE,
    };
  }

  return null;
}

function getInheritedIgnoredGitStatus(
  ancestorPaths: readonly string[],
  ignoredDirectoryPaths: ReadonlySet<string> | undefined,
  ignoredInheritanceCache: Map<string, boolean>
): GitStatus | null {
  if (ignoredDirectoryPaths == null || ignoredDirectoryPaths.size === 0) {
    return null;
  }

  const visitedAncestors: string[] = [];
  for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
    const ancestorPath = ancestorPaths[index];
    const cached = ignoredInheritanceCache.get(ancestorPath);
    if (cached != null) {
      for (const visitedAncestor of visitedAncestors) {
        ignoredInheritanceCache.set(visitedAncestor, cached);
      }
      return cached ? 'ignored' : null;
    }

    if (ignoredDirectoryPaths.has(ancestorPath)) {
      ignoredInheritanceCache.set(ancestorPath, true);
      for (const visitedAncestor of visitedAncestors) {
        ignoredInheritanceCache.set(visitedAncestor, true);
      }
      return 'ignored';
    }

    visitedAncestors.push(ancestorPath);
  }

  for (const visitedAncestor of visitedAncestors) {
    ignoredInheritanceCache.set(visitedAncestor, false);
  }

  return null;
}

function isFileTreeDirectoryHandle(
  item: FileTreeItemHandle | null
): item is FileTreeDirectoryHandle {
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
  fallbackViewportHeight: number,
  topInset: number = 0
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
  const currentViewportTop = currentScrollTop + Math.max(0, topInset);
  let nextScrollTop = currentScrollTop;

  if (itemTop < currentViewportTop) {
    nextScrollTop = Math.max(0, itemTop - Math.max(0, topInset));
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
  const currentViewportTop =
    currentScrollTop + Math.max(0, targetViewportOffset);
  const currentViewportBottom = currentScrollTop + viewportHeight;
  if (itemTop >= currentViewportTop && itemBottom <= currentViewportBottom) {
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

function getFileTreeGuideStyleText(focusedParentPath: string | null): string {
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

    if (entry.dataset.fileTreeContextMenuRoot === 'true') {
      return true;
    }

    if (
      entry.dataset.type === 'context-menu-anchor' ||
      entry.dataset.type === CONTEXT_MENU_TRIGGER_TYPE
    ) {
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
): FileTreeContextMenuOpenContext['anchorRect'] {
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

function createAnchorRectFromPoint(
  x: number,
  y: number
): FileTreeContextMenuOpenContext['anchorRect'] {
  return {
    bottom: y,
    height: 0,
    left: x,
    right: x,
    top: y,
    width: 0,
    x,
    y,
  };
}

// The floating trigger is positioned against the root container, not the
// scrollbox. Using root-relative coordinates keeps sticky rows aligned even
// during the native scroll step before React processes the new layout.
function getContextMenuAnchorTop(
  rootElement: HTMLElement | null,
  itemElement: HTMLElement
): number {
  if (rootElement == null) {
    return itemElement.offsetTop;
  }

  const itemRect = itemElement.getBoundingClientRect();
  const rootRect = rootElement.getBoundingClientRect();
  return itemRect.top - rootRect.top;
}

function setButtonRef(
  buttonRefs: Map<string, HTMLElement>,
  path: string,
  element: HTMLElement | null
): void {
  if (element == null) {
    buttonRefs.delete(path);
    return;
  }

  buttonRefs.set(path, element);
}

// Sticky overlay rows are separate DOM mirrors of the real row. Prefer them
// when positioning the floating trigger so it follows the row the user can see.
function getContextMenuAnchorButton(
  path: string | null,
  stickyButtonRefs: ReadonlyMap<string, HTMLElement>,
  rowButtonRefs: ReadonlyMap<string, HTMLElement>
): HTMLElement | null {
  if (path == null) {
    return null;
  }

  return stickyButtonRefs.get(path) ?? rowButtonRefs.get(path) ?? null;
}

function createContextMenuItem(
  row: FileTreeVisibleRow,
  path: string
): FileTreeContextMenuItem {
  return {
    kind: row.kind,
    name: getFileTreeRowAriaLabel(row),
    path,
  };
}

function getFileTreeRootDomId(
  instanceId: string | undefined
): string | undefined {
  return instanceId == null ? undefined : `${instanceId}__tree`;
}

// Search keeps DOM focus on the built-in input, so the focused row still needs
// a stable DOM id for aria-activedescendant and visual-focus parity.
function getFileTreeFocusedRowDomId(
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
  decoration: FileTreeRowDecoration | null,
  resolveIcon: ReturnType<typeof createFileTreeIconResolver>['resolveIcon']
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

function renderFileTreeRowContent(
  row: FileTreeVisibleRow,
  resolveIcon: ReturnType<typeof createFileTreeIconResolver>['resolveIcon'],
  {
    actionLaneEnabled = false,
    customDecoration = null,
    decorationLaneEnabled = false,
    dragTargetFlattenedSegmentPath = null,
    gitDecoration = null,
    gitLaneActive = false,
    renameInput = null,
    showDecorativeActionAffordance = false,
  }: {
    actionLaneEnabled?: boolean;
    customDecoration?: FileTreeRowDecoration | null;
    decorationLaneEnabled?: boolean;
    dragTargetFlattenedSegmentPath?: string | null;
    gitDecoration?: FileTreeRowDecoration | null;
    gitLaneActive?: boolean;
    renameInput?: JSX.Element | null;
    showDecorativeActionAffordance?: boolean;
  } = {}
): JSX.Element {
  const targetPath = getFileTreeRowPath(row);

  return (
    <Fragment>
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
              dragTargetFlattenedSegmentPath
            )
          : (renameInput ?? (
              <MiddleTruncate minimumLength={5} split="extension">
                {row.name}
              </MiddleTruncate>
            ))}
      </div>
      {decorationLaneEnabled ? (
        <div data-item-section="decoration">
          {customDecoration != null
            ? renderRowDecoration(customDecoration, resolveIcon)
            : null}
        </div>
      ) : null}
      {gitLaneActive ? (
        <div data-item-section="git">
          {renderRowDecoration(gitDecoration, resolveIcon)}
        </div>
      ) : null}
      {actionLaneEnabled ? (
        <div data-item-section="action">
          {showDecorativeActionAffordance ? (
            <span aria-hidden="true" data-item-action-affordance="decorative">
              <Icon {...resolveIcon('file-tree-icon-ellipsis')} />
            </span>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  );
}

function renderStyledRow(
  controller: FileTreeController,
  renameView: ReturnType<FileTreeController[typeof FILE_TREE_RENAME_VIEW]>,
  row: FileTreeVisibleRow,
  visualFocusPath: string | null,
  contextHoverPath: string | null,
  draggedPathSet: ReadonlySet<string> | null,
  dragTarget: FileTreeDropTarget | null,
  dragAndDropEnabled: boolean,
  shouldSuppressContextMenu: () => boolean,
  handleRowDragStart: (
    event: DragEvent,
    row: FileTreeVisibleRow,
    targetPath: string
  ) => void,
  handleRowDragEnd: () => void,
  handleRowTouchStart: (
    event: TouchEvent,
    row: FileTreeVisibleRow,
    targetPath: string
  ) => void,
  instanceId: string | undefined,
  itemHeight: number,
  gitStatusByPath: ReadonlyMap<string, GitStatus> | undefined,
  ignoredGitDirectories: ReadonlySet<string> | undefined,
  ignoredInheritanceCache: Map<string, boolean>,
  directoriesWithGitChanges: ReadonlySet<string> | undefined,
  gitLaneActive: boolean,
  contextMenuEnabled: boolean,
  contextMenuTriggerMode: FileTreeContextMenuTriggerMode,
  contextMenuButtonTriggerEnabled: boolean,
  contextMenuButtonVisibility: FileTreeContextMenuButtonVisibility,
  contextMenuRightClickEnabled: boolean,
  registerRenameInput: (element: HTMLInputElement | null) => void,
  registerButton: (path: string, element: HTMLElement | null) => void,
  resolveIcon: ReturnType<typeof createFileTreeIconResolver>['resolveIcon'],
  renderDecorationForRow: (
    row: FileTreeVisibleRow,
    targetPath: string
  ) => FileTreeRowDecoration | null,
  openContextMenuForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
    options?: {
      anchorRect?: FileTreeContextMenuOpenContext['anchorRect'];
      source?: 'button' | 'keyboard' | 'right-click';
    }
  ) => void,
  onKeyDown: (event: KeyboardEvent) => void,
  key: string | number,
  options: {
    isParked?: boolean;
    style?: Record<string, string | undefined>;
  } = {}
): JSX.Element {
  const targetPath = getFileTreeRowPath(row);
  const item = controller.getItem(targetPath);
  const directoryItem = isFileTreeDirectoryHandle(item) ? item : null;
  const { isParked = false, style } = options;
  const ownGitStatus = gitStatusByPath?.get(targetPath) ?? null;
  const effectiveGitStatus =
    ownGitStatus ??
    getInheritedIgnoredGitStatus(
      row.ancestorPaths,
      ignoredGitDirectories,
      ignoredInheritanceCache
    );
  const containsGitChange =
    row.kind === 'directory' &&
    (directoriesWithGitChanges?.has(targetPath) ?? false);
  const customDecoration = renderDecorationForRow(row, targetPath);
  const gitDecoration = getBuiltInGitStatusDecoration(
    effectiveGitStatus,
    containsGitChange
  );
  const actionLaneEnabled =
    contextMenuEnabled && contextMenuButtonTriggerEnabled;
  const decorationLaneEnabled =
    customDecoration != null || gitLaneActive || actionLaneEnabled;
  const showDecorativeActionAffordance =
    actionLaneEnabled && contextMenuButtonVisibility === 'always';
  const renamingPath = renameView.getPath();
  const isRenamingRow = renamingPath === targetPath;
  const renamingValue = isRenamingRow ? renameView.getValue() : '';
  const renameInput = !isRenamingRow ? null : (
    <RenameInput
      ref={registerRenameInput}
      ariaLabel={`Rename ${getFileTreeRowAriaLabel(row)}`}
      isFlattened={row.isFlattened}
      value={renamingValue}
      onBlur={() => {
        renameView.commit();
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
    ...(effectiveGitStatus != null && {
      'data-item-git-status': effectiveGitStatus,
    }),
    ...(containsGitChange ? { 'data-item-contains-git-change': 'true' } : {}),
  };
  const domId = row.isFocused
    ? getFileTreeFocusedRowDomId(instanceId, targetPath, isParked)
    : undefined;
  const parentPath = row.ancestorPaths.at(-1) ?? '';

  const rowContent = renderFileTreeRowContent(row, resolveIcon, {
    actionLaneEnabled,
    customDecoration,
    decorationLaneEnabled,
    dragTargetFlattenedSegmentPath: dragTarget?.flattenedSegmentPath ?? null,
    gitDecoration,
    gitLaneActive,
    renameInput,
    showDecorativeActionAffordance,
  });
  const commonProps = {
    'aria-expanded': row.kind === 'directory' ? row.isExpanded : undefined,
    'aria-haspopup': contextMenuEnabled ? 'menu' : undefined,
    'aria-label': getFileTreeRowAriaLabel(row),
    'aria-level': row.level + 1,
    'aria-posinset': row.posInSet + 1,
    'aria-selected': row.isSelected ? 'true' : 'false',
    'aria-setsize': row.setSize,
    'data-item-context-menu-button-visibility': actionLaneEnabled
      ? contextMenuButtonVisibility
      : undefined,
    'data-item-context-menu-trigger-mode': contextMenuEnabled
      ? contextMenuTriggerMode
      : undefined,
    'data-item-has-context-menu-action-lane': actionLaneEnabled
      ? 'true'
      : undefined,
    'data-item-has-git-lane': gitLaneActive ? 'true' : undefined,
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
            if (!contextMenuRightClickEnabled) {
              return;
            }
            item?.focus();
            openContextMenuForRow(row, targetPath, {
              anchorRect: createAnchorRectFromPoint(
                event.clientX,
                event.clientY
              ),
              source: 'right-click',
            });
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

// Sticky overlay rows rely on the floating trigger for context menus, so they
// intentionally omit the inline action lane that normal rows reserve.

function renderStickyRow(
  row: FileTreeVisibleRow,
  resolveIcon: ReturnType<typeof createFileTreeIconResolver>['resolveIcon'],
  itemHeight: number,
  top: number,
  zIndex: number,
  {
    contextMenuEnabled,
    contextMenuRightClickEnabled,
    onClick,
    openContextMenuForRow,
    registerButton,
    shouldSuppressContextMenu,
  }: {
    contextMenuEnabled: boolean;
    contextMenuRightClickEnabled: boolean;
    onClick: (path: string) => void;
    openContextMenuForRow: (
      row: FileTreeVisibleRow,
      targetPath: string,
      options?: {
        anchorRect?: FileTreeContextMenuOpenContext['anchorRect'];
        source?: 'button' | 'keyboard' | 'right-click';
      }
    ) => void;
    registerButton: (path: string, element: HTMLElement | null) => void;
    shouldSuppressContextMenu: () => boolean;
  },
  key: string | number
): JSX.Element {
  const targetPath = getFileTreeRowPath(row);

  return (
    <button
      key={key}
      type="button"
      aria-expanded={row.kind === 'directory' ? row.isExpanded : undefined}
      aria-haspopup={contextMenuEnabled ? 'menu' : undefined}
      aria-label={getFileTreeRowAriaLabel(row)}
      data-file-tree-sticky-path={targetPath}
      data-file-tree-sticky-row="true"
      data-item-type={row.kind === 'directory' ? 'folder' : 'file'}
      onClick={() => {
        onClick(targetPath);
      }}
      onContextMenu={
        contextMenuEnabled
          ? (event: MouseEvent) => {
              if (shouldSuppressContextMenu()) {
                event.preventDefault();
                return;
              }

              event.preventDefault();
              if (!contextMenuRightClickEnabled) {
                return;
              }

              openContextMenuForRow(row, targetPath, {
                anchorRect: createAnchorRectFromPoint(
                  event.clientX,
                  event.clientY
                ),
                source: 'right-click',
              });
            }
          : undefined
      }
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      ref={(element) => {
        registerButton(targetPath, element);
      }}
      style={{
        left: '0',
        minHeight: `${itemHeight}px`,
        position: 'absolute',
        right: '0',
        top: `${top}px`,
        zIndex: `${zIndex}`,
      }}
      tabIndex={-1}
    >
      {renderFileTreeRowContent(row, resolveIcon)}
    </button>
  );
}

function renderRangeChildren(
  controller: FileTreeController,
  renameView: ReturnType<FileTreeController[typeof FILE_TREE_RENAME_VIEW]>,
  range: { start: number; end: number },
  hiddenRowPaths: ReadonlySet<string>,
  activeItemPath: string | null,
  contextHoverPath: string | null,
  draggedPathSet: ReadonlySet<string> | null,
  dragTarget: FileTreeDropTarget | null,
  dragAndDropEnabled: boolean,
  shouldSuppressContextMenu: () => boolean,
  handleRowDragStart: (
    event: DragEvent,
    row: FileTreeVisibleRow,
    targetPath: string
  ) => void,
  handleRowDragEnd: () => void,
  handleRowTouchStart: (
    event: TouchEvent,
    row: FileTreeVisibleRow,
    targetPath: string
  ) => void,
  instanceId: string | undefined,
  itemHeight: number,
  gitStatusByPath: ReadonlyMap<string, GitStatus> | undefined,
  ignoredGitDirectories: ReadonlySet<string> | undefined,
  ignoredInheritanceCache: Map<string, boolean>,
  directoriesWithGitChanges: ReadonlySet<string> | undefined,
  gitLaneActive: boolean,
  contextMenuEnabled: boolean,
  contextMenuTriggerMode: FileTreeContextMenuTriggerMode,
  contextMenuButtonTriggerEnabled: boolean,
  contextMenuButtonVisibility: FileTreeContextMenuButtonVisibility,
  contextMenuRightClickEnabled: boolean,
  registerRenameInput: (element: HTMLInputElement | null) => void,
  registerButton: (path: string, element: HTMLElement | null) => void,
  resolveIcon: ReturnType<typeof createFileTreeIconResolver>['resolveIcon'],
  renderDecorationForRow: (
    row: FileTreeVisibleRow,
    targetPath: string
  ) => FileTreeRowDecoration | null,
  openContextMenuForRow: (
    row: FileTreeVisibleRow,
    targetPath: string,
    options?: {
      anchorRect?: FileTreeContextMenuOpenContext['anchorRect'];
      source?: 'button' | 'keyboard' | 'right-click';
    }
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
  // Range-fetch the window slice directly so we stay O(window) per scroll
  // even when the layout state is not carrying the full visible-row array.
  return controller
    .getVisibleRows(range.start, range.end)
    .filter((row) => !hiddenRowPaths.has(getFileTreeRowPath(row)))
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
        gitStatusByPath,
        ignoredGitDirectories,
        ignoredInheritanceCache,
        directoriesWithGitChanges,
        gitLaneActive,
        contextMenuEnabled,
        contextMenuTriggerMode,
        contextMenuButtonTriggerEnabled,
        contextMenuButtonVisibility,
        contextMenuRightClickEnabled,
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

export function FileTreeView({
  composition,
  controller,
  gitStatusByPath,
  ignoredGitDirectories,
  directoriesWithGitChanges,
  icons,
  instanceId,
  itemHeight = FILE_TREE_DEFAULT_ITEM_HEIGHT,
  overscan = FILE_TREE_DEFAULT_OVERSCAN,
  renamingEnabled = false,
  renderRowDecoration,
  searchEnabled = false,
  slotHost,
  stickyFolders = false,
  viewportHeight = FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
}: FileTreeViewProps): JSX.Element {
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
  const stickyRowButtonRefs = useRef(new Map<string, HTMLElement>());
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
  const dragRowSnapshotRef = useRef<FileTreeVisibleRow | null>(null);
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
  const ignoredInheritanceCache = useMemo(() => new Map<string, boolean>(), []);
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
    anchorRect: FileTreeContextMenuOpenContext['anchorRect'] | null;
    item: FileTreeContextMenuItem;
    path: string;
    source: 'button' | 'keyboard' | 'right-click';
  } | null>(null);
  const contextMenuStateRef = useRef(contextMenuState);
  contextMenuStateRef.current = contextMenuState;

  const pendingStickyFocusPathRef = useRef<string | null>(null);
  const debugContextMenuTriggerPathRef = useRef<string | null>(null);
  const debugDisableScrollSuppressionRef = useRef(false);

  const [layoutState, setLayoutState] = useState<FileTreeViewLayoutState>(() =>
    computeFileTreeViewLayoutState({
      controller,
      itemHeight,
      overscan,
      scrollTop: 0,
      stickyFolders,
      viewportHeight,
    })
  );
  const [hasStickyUiMount, setHasStickyUiMount] = useState(false);
  useEffect(() => {
    setHasStickyUiMount(true);
  }, []);

  const contextMenuEnabled =
    composition?.contextMenu?.enabled === true ||
    composition?.contextMenu?.render != null ||
    composition?.contextMenu?.onOpen != null ||
    composition?.contextMenu?.onClose != null;
  const contextMenuTriggerMode =
    composition?.contextMenu?.triggerMode ??
    (contextMenuEnabled ? 'right-click' : 'both');
  const contextMenuButtonTriggerEnabled =
    contextMenuTriggerMode === 'both' || contextMenuTriggerMode === 'button';
  const contextMenuButtonVisibility =
    composition?.contextMenu?.buttonVisibility ?? 'when-needed';
  const contextMenuRightClickEnabled =
    contextMenuTriggerMode === 'both' ||
    contextMenuTriggerMode === 'right-click';
  useLayoutEffect(() => {
    const rootElement = rootRef.current;
    if (rootElement == null) {
      return;
    }

    const handleDebugSetContextMenuTrigger = (event: Event): void => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as { path?: string | null } | null;
      const nextPath = detail?.path ?? null;
      debugContextMenuTriggerPathRef.current = nextPath;
      setContextHoverPath(nextPath);
      setLastContextMenuInteraction(nextPath == null ? null : 'pointer');
    };

    const handleDebugSetScrollSuppression = (event: Event): void => {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as { disabled?: boolean } | null;
      debugDisableScrollSuppressionRef.current = detail?.disabled === true;
    };

    rootElement.addEventListener(
      'file-tree-debug-set-context-menu-trigger',
      handleDebugSetContextMenuTrigger as EventListener
    );
    rootElement.addEventListener(
      'file-tree-debug-set-scroll-suppression',
      handleDebugSetScrollSuppression as EventListener
    );

    return () => {
      rootElement.removeEventListener(
        'file-tree-debug-set-context-menu-trigger',
        handleDebugSetContextMenuTrigger as EventListener
      );
      rootElement.removeEventListener(
        'file-tree-debug-set-scroll-suppression',
        handleDebugSetScrollSuppression as EventListener
      );
    };
  }, []);

  const registerRowButton = useCallback(
    (path: string, element: HTMLElement | null): void => {
      setButtonRef(rowButtonRefs.current, path, element);
    },
    []
  );
  const registerStickyRowButton = useCallback(
    (path: string, element: HTMLElement | null): void => {
      setButtonRef(stickyRowButtonRefs.current, path, element);
    },
    []
  );
  const getTriggerAnchorButton = useCallback(
    (path: string | null): HTMLElement | null => {
      return getContextMenuAnchorButton(
        path,
        stickyRowButtonRefs.current,
        rowButtonRefs.current
      );
    },
    []
  );

  const gitLaneActive =
    gitStatusByPath != null ||
    ignoredGitDirectories != null ||
    directoriesWithGitChanges != null;
  const { resolveIcon } = useMemo(
    () => createFileTreeIconResolver(icons),
    [icons]
  );
  const renameView = controller[FILE_TREE_RENAME_VIEW]();
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
  const treeDomId = getFileTreeRootDomId(instanceId);
  const {
    overlayHeight: overlayRowsHeight,
    overlayRows,
    snapshot: layoutSnapshot,
    visibleRows,
  } = layoutState;
  const resolvedViewportHeight = layoutSnapshot.physical.viewportHeight;
  const range = useMemo(
    () => ({
      end: layoutSnapshot.window.endIndex,
      start: layoutSnapshot.window.startIndex,
    }),
    [layoutSnapshot.window.endIndex, layoutSnapshot.window.startIndex]
  );
  // The overlay DOM mirrors `overlayRows` (which includes the scrollTop=0
  // preview). The virtualized scroll content, on the other hand, must only
  // hide rows that the overlay is *actually* sticky-covering — at rest the
  // overlay is CSS-hidden, so filtering out preview rows would leave empty
  // slots where the real rows belong.
  const stickyRows = overlayRows;
  const occludedStickyRows = layoutSnapshot.sticky.rows;
  const focusedRowIsMounted =
    focusedIndex >= 0 &&
    focusedIndex >= range.start &&
    focusedIndex <= range.end;
  const renderDecorationForRow = useCallback(
    (
      row: FileTreeVisibleRow,
      targetPath: string
    ): FileTreeRowDecoration | null =>
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
          : getContextMenuAnchorTop(rootRef.current, itemButton);
      setContextMenuAnchorTop((previousTop) =>
        previousTop === nextTop ? previousTop : nextTop
      );
    },
    []
  );
  const openContextMenuForRow = useCallback(
    (
      row: FileTreeVisibleRow,
      targetPath: string,
      options?: {
        anchorRect?: FileTreeContextMenuOpenContext['anchorRect'];
        source?: 'button' | 'keyboard' | 'right-click';
      }
    ): void => {
      const item = controller.getItem(targetPath);
      if (item == null) {
        return;
      }

      item.focus();
      updateTriggerPosition(getTriggerAnchorButton(targetPath));
      shouldRestoreContextMenuFocusRef.current = true;
      setContextMenuState({
        anchorRect: options?.anchorRect ?? null,
        item: createContextMenuItem(row, targetPath),
        path: targetPath,
        source: options?.source ?? 'keyboard',
      });
    },
    [controller, getTriggerAnchorButton, updateTriggerPosition]
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
  ): FileTreeDropTarget | null => {
    const rootNode = rootRef.current?.getRootNode();
    const pointRoot = rootNode instanceof ShadowRoot ? rootNode : document;
    const pointElement = getPointElement(pointRoot, clientX, clientY);
    const nextTarget = resolveDropTargetFromElement(pointElement);
    controller.setDragTarget(nextTarget);
    return controller.getDragSession()?.target ?? null;
  };

  const scheduleDragHoverOpen = (
    nextTarget: FileTreeDropTarget | null
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
    const directoryItem = isFileTreeDirectoryHandle(targetItem)
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
    row: FileTreeVisibleRow,
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
    row: FileTreeVisibleRow,
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

    const focusedDirectoryItem = isFileTreeDirectoryHandle(focusedItem)
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

  // Mirror `scrollTop <= 0` onto the root element as a data attribute so CSS
  // can hide the pre-populated sticky overlay when the list is at rest at the
  // top. We drive this from the layout snapshot (synced on every scroll +
  // layout update) rather than only the scroll event, because programmatic
  // scrolling via keyboard navigation doesn't always fire a `scroll` event
  // across environments, and we want the attribute to track state reliably.
  useLayoutEffect(() => {
    const rootElement = rootRef.current;
    if (rootElement == null) {
      return;
    }
    if (layoutSnapshot.physical.scrollTop <= 0) {
      rootElement.dataset.scrollAtTop = 'true';
    } else {
      delete rootElement.dataset.scrollAtTop;
    }
  }, [layoutSnapshot.physical.scrollTop]);

  useLayoutEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollElement = scrollRef.current;
    const listElement = listRef.current;
    const rootElement = rootRef.current;
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
      // clamp scrollTop before recomputing the projected layout snapshot.
      if (scrollElement.scrollTop > maxScrollTop) {
        scrollElement.scrollTop = maxScrollTop;
      }

      setLayoutState(
        computeFileTreeViewLayoutState({
          controller,
          itemHeight,
          overscan,
          scrollTop: Math.min(scrollElement.scrollTop, maxScrollTop),
          stickyFolders,
          viewportHeight: nextViewportHeight,
        })
      );
    };

    updateViewportRef.current = update;
    const unsubscribe = controller.subscribe(() => {
      setControllerRevision((revision) => revision + 1);
      update();
    });
    // Flip a plain DOM attribute on the root (not React state) so the anchor
    // can be hidden via CSS before the compositor paints a scrolled frame.
    // Using state here would require a re-render to land, which is one frame
    // too late — the user would see the floating trigger sit at its old row
    // position for a frame while the rows themselves have already scrolled.
    const markScrolling = (): void => {
      if (debugDisableScrollSuppressionRef.current === true) {
        return;
      }
      if (listElement != null) {
        listElement.dataset.isScrolling ??= '';
      }
      if (rootElement != null) {
        rootElement.dataset.isScrolling ??= '';
      }
      isScrollingRef.current = true;
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      scrollTimer = setTimeout(() => {
        if (listElement != null) {
          delete listElement.dataset.isScrolling;
        }
        if (rootElement != null) {
          delete rootElement.dataset.isScrolling;
        }
        isScrollingRef.current = false;
        scrollTimer = null;
      }, 50);
    };

    // A distinct signal from `is-scrolling`: set *only* when the user initiates
    // a scroll while already at the top. It overrides the "hide overlay at
    // rest" CSS rule for long enough that the overlay is on screen by the time
    // the compositor paints the first scrolled frame. Unlike `is-scrolling`,
    // it is not set during a scroll *to* the top, so the overlay re-hides the
    // instant the user returns there.
    let overlayRevealTimer: ReturnType<typeof setTimeout> | null = null;
    const clearOverlayReveal = (): void => {
      if (rootElement != null) {
        delete rootElement.dataset.overlayReveal;
      }
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer);
        overlayRevealTimer = null;
      }
    };
    const markOverlayReveal = (): void => {
      if (
        rootElement == null ||
        debugDisableScrollSuppressionRef.current === true
      ) {
        return;
      }
      if (scrollElement.scrollTop > 0) {
        // Already past the top; overlay is already visible via scroll-at-top
        // being absent, and we don't want to arm the reveal for the next time
        // the scroll returns to 0.
        return;
      }
      rootElement.dataset.overlayReveal = 'true';
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer);
      }
      // Fallback cleanup if no scroll event follows (e.g. the user wheeled
      // while already pinned at the top). Long enough for the compositor to
      // commit a frame, short enough that a leftover reveal can't outlive an
      // intended "at rest" state.
      overlayRevealTimer = setTimeout(() => {
        clearOverlayReveal();
      }, 200);
    };

    const onScroll = (): void => {
      update();
      if (scrollElement.scrollTop > 0) {
        clearOverlayReveal();
      }
      if (contextMenuStateRef.current != null) {
        closeContextMenuRef.current();
      }
      if (debugDisableScrollSuppressionRef.current === true) {
        isScrollingRef.current = false;
        return;
      }
      setContextHoverPath((previousPath) =>
        previousPath == null ? previousPath : null
      );
      markScrolling();
    };

    // `wheel` / `touchmove` fire on the main thread before the compositor
    // commits the scroll, so setting the scrolling flag here hides the
    // context-menu anchor in the same frame the user sees the content move —
    // no one-frame drift of the floating trigger over the wrong row. When the
    // scroll starts from the very top we also arm the overlay-reveal flag so
    // the pre-mounted sticky overlay is visible through that first frame.
    const onPreScroll = (): void => {
      markScrolling();
      markOverlayReveal();
    };

    // Only the keys that actually move the scroll position should mark the
    // tree as scrolling — otherwise Shift+F10 / ContextMenu / Enter / letter
    // keys all trip the 50ms suppression and, for the ContextMenu case, hide
    // the keyboard-opened menu that was the whole point of the keypress.
    const SCROLL_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
      'Spacebar',
    ]);
    const onKeyDownPreScroll = (event: KeyboardEvent): void => {
      if (!SCROLL_KEYS.has(event.key)) {
        return;
      }
      onPreScroll();
    };

    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    scrollElement.addEventListener('wheel', onPreScroll, { passive: true });
    scrollElement.addEventListener('touchmove', onPreScroll, { passive: true });
    scrollElement.addEventListener('keydown', onKeyDownPreScroll);
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
      scrollElement.removeEventListener('wheel', onPreScroll);
      scrollElement.removeEventListener('touchmove', onPreScroll);
      scrollElement.removeEventListener('keydown', onKeyDownPreScroll);
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      if (overlayRevealTimer != null) {
        clearTimeout(overlayRevealTimer);
      }
      if (listElement != null) {
        delete listElement.dataset.isScrolling;
      }
      if (rootElement != null) {
        delete rootElement.dataset.isScrolling;
        delete rootElement.dataset.overlayReveal;
      }
      // `data-scroll-at-top` is owned by the separate sync layout effect —
      // deleting it here would strand the attribute off if this effect
      // rebinds (e.g. viewportHeight changes) while scrollTop is still 0,
      // because the sync effect only fires when scrollTop itself changes.
      isScrollingRef.current = false;
      resizeObserver?.disconnect();
    };
  }, [controller, itemHeight, overscan, stickyFolders, viewportHeight]);

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

    const context: FileTreeContextMenuOpenContext = {
      anchorElement,
      anchorRect:
        contextMenuState.anchorRect ??
        serializeAnchorRect(anchorElement.getBoundingClientRect()),
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

  const totalScrollableHeight = layoutSnapshot.physical.totalHeight;

  const stickyOverlayHeight = layoutSnapshot.sticky.height;
  const stickyRowPathSet = useMemo(
    () =>
      new Set(occludedStickyRows.map((entry) => getFileTreeRowPath(entry.row))),
    [occludedStickyRows]
  );

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
    const pendingStickyFocusPath = pendingStickyFocusPathRef.current;
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
    const shouldRestoreStickyFocusedRowViewportOffset =
      pendingStickyFocusPath != null &&
      pendingStickyFocusPath === focusedPath &&
      scrollFocusedRowToViewportOffset(
        scrollElement,
        focusedIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        stickyOverlayHeight
      );

    if (
      shouldRestoreStickyFocusedRowViewportOffset ||
      shouldRestoreFocusedRowViewportOffset ||
      (shouldOwnDomFocus &&
        focusedPathChanged &&
        pendingStickyFocusPath !== focusedPath &&
        scrollFocusedRowIntoView(
          scrollElement,
          focusedIndex,
          itemHeight,
          resolvedViewportHeight,
          stickyOverlayHeight
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
      pendingStickyFocusPath === focusedPath ||
      activeTreeElementPath == null ||
      activeTreeElementPath !== focusedPath
    ) {
      focusElement(focusedButton);
      if (pendingStickyFocusPath === focusedPath) {
        pendingStickyFocusPathRef.current = null;
      }
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
    range,
    resolvedViewportHeight,
    searchEnabled,
    stickyOverlayHeight,
    totalScrollableHeight,
    visibleRows,
  ]);

  const focusTriggerPath =
    domFocusOwnerRef.current === true ? (activeItemPath ?? focusedPath) : null;
  const triggerPath =
    contextMenuState?.path ??
    debugContextMenuTriggerPathRef.current ??
    (lastContextMenuInteraction === 'pointer'
      ? contextHoverPath
      : lastContextMenuInteraction === 'focus'
        ? focusTriggerPath
        : null);
  const isPointerContextMenuOpen = contextMenuState?.source === 'right-click';

  useLayoutEffect(() => {
    updateTriggerPosition(getTriggerAnchorButton(triggerPath));
  }, [
    getTriggerAnchorButton,
    range,
    resolvedViewportHeight,
    stickyRows,
    triggerPath,
    updateTriggerPosition,
    visibleRows,
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

    const stickyRowButton = target.closest?.(
      '[data-file-tree-sticky-row="true"]'
    );
    const rowButton = target.closest?.('[data-type="item"]');
    const nextPath =
      stickyRowButton instanceof HTMLElement
        ? (stickyRowButton.dataset.fileTreeStickyPath ?? null)
        : rowButton instanceof HTMLElement
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

  const windowHeight = layoutSnapshot.window.height;
  const windowOffsetTop = layoutSnapshot.window.offsetTop;
  // The virtualized window is usually taller than the viewport once overscan
  // is included, so a negative sticky inset lets the overscanned slice hang
  // above and below the scroll container without pinning the element during
  // normal scrolling. Both edges together catch the window when React falls
  // behind a fast scroll in either direction, which is what keeps the list
  // from blanking mid-flick.
  //
  // The `stickyOverlayHeight` subtraction matters when sticky folders are
  // enabled: the layout bumps `windowStart` past the rows that sit behind
  // the overlay, so `windowOffsetTop` can exceed `scrollTop` by up to the
  // overlay's height. Without accounting for that gap, the bottom constraint
  // would activate every frame and lock the element in place, stalling the
  // per-pixel scroll.
  const windowStickyInset = Math.min(
    0,
    resolvedViewportHeight - windowHeight - stickyOverlayHeight
  );
  const shouldRenderParkedFocusedRow =
    activeItemPath === focusedPath ||
    restoreTreeFocusAfterSearchCloseRef.current;
  const parkedFocusedRow =
    focusedPath != null &&
    shouldRenderParkedFocusedRow &&
    !focusedRowIsMounted &&
    focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null;
  const parkedFocusedRowOffset =
    parkedFocusedRow == null
      ? null
      : getParkedFocusedRowOffset(
          focusedIndex,
          itemHeight,
          range,
          windowHeight
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
          windowHeight
        );
  const focusedVisibleRow =
    focusedIndex >= 0
      ? (visibleRows[focusedIndex] ??
        controller.getVisibleRows(focusedIndex, focusedIndex)[0] ??
        null)
      : null;
  const guideStyleText = getFileTreeGuideStyleText(
    focusedVisibleRow?.ancestorPaths.at(-1) ?? null
  );
  const activeDescendantId =
    isSearchOpen && focusedPath != null
      ? getFileTreeFocusedRowDomId(
          instanceId,
          focusedPath,
          !focusedRowIsMounted
        )
      : undefined;
  const visualFocusPath =
    contextMenuState?.path ?? (isSearchOpen ? focusedPath : activeItemPath);
  const visualContextHoverPath = contextMenuState?.path ?? contextHoverPath;
  const triggerButton = getTriggerAnchorButton(triggerPath);
  const triggerButtonVisible =
    contextMenuEnabled &&
    contextMenuButtonTriggerEnabled &&
    !isPointerContextMenuOpen &&
    !isRenaming &&
    triggerButton != null &&
    contextMenuAnchorTop != null &&
    triggerPath != null;
  const contextMenuAnchorVisible =
    contextMenuEnabled && (triggerButtonVisible || contextMenuState != null);
  const pointerAnchorRect = contextMenuState?.anchorRect;
  const rowAnchorTop =
    pointerAnchorRect == null &&
    triggerButton != null &&
    contextMenuAnchorTop != null &&
    (contextMenuState != null || triggerButtonVisible)
      ? contextMenuAnchorTop
      : null;
  const contextMenuAnchorStyle =
    pointerAnchorRect != null
      ? {
          left: `${pointerAnchorRect.left}px`,
          position: 'fixed',
          right: 'auto',
          top: `${pointerAnchorRect.top}px`,
        }
      : rowAnchorTop != null
        ? {
            top: `${rowAnchorTop}px`,
          }
        : undefined;
  const contextMenuTriggerStyle = isPointerContextMenuOpen
    ? {
        opacity: '0',
      }
    : undefined;

  const handleStickyRowClick = useCallback(
    (path: string): void => {
      const scrollElement = scrollRef.current;
      if (scrollElement == null) {
        return;
      }

      // `controller.focusPath` relocates focus to `path` and returns the new
      // visible index, so we can look up the position without scanning the
      // visible-row array — sticky rows only render when `stickyFolders` is
      // on, but this stays O(1) regardless and avoids closing over the
      // visible-row snapshot in the callback dependency list.
      controller.focusPath(path);
      const visibleIndex = controller.getFocusedIndex();
      if (visibleIndex < 0) {
        return;
      }

      domFocusOwnerRef.current = true;
      scrollFocusedRowToViewportOffset(
        scrollElement,
        visibleIndex,
        itemHeight,
        resolvedViewportHeight,
        totalScrollableHeight,
        stickyOverlayHeight
      );
      updateViewportRef.current();
      pendingStickyFocusPathRef.current = path;
    },
    [
      controller,
      itemHeight,
      resolvedViewportHeight,
      stickyOverlayHeight,
      totalScrollableHeight,
    ]
  );

  const openMenuFromTrigger = (): void => {
    if (!contextMenuButtonTriggerEnabled) {
      return;
    }

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
      anchorRect: null,
      item: {
        kind: triggerItem.isDirectory() ? 'directory' : 'file',
        name: triggerButton.getAttribute('aria-label') ?? triggerPath,
        path: triggerItem.getPath(),
      },
      path: triggerItem.getPath(),
      source: 'button',
    });
  };

  return (
    <div
      ref={rootRef}
      id={treeDomId}
      data-file-tree-context-menu-button-visibility={
        contextMenuEnabled && contextMenuButtonTriggerEnabled
          ? contextMenuButtonVisibility
          : undefined
      }
      data-file-tree-context-menu-trigger-mode={
        contextMenuEnabled ? contextMenuTriggerMode : undefined
      }
      data-file-tree-has-context-menu-action-lane={
        contextMenuEnabled && contextMenuButtonTriggerEnabled
          ? 'true'
          : undefined
      }
      data-file-tree-has-git-lane={gitLaneActive ? 'true' : undefined}
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
        data-file-tree-guide-style="true"
        dangerouslySetInnerHTML={{ __html: guideStyleText }}
      />
      <slot name={HEADER_SLOT_NAME} data-type="header-slot" />
      {searchEnabled ? (
        <div
          data-file-tree-search-container
          data-open={isSearchOpen ? 'true' : 'false'}
        >
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
        {stickyFolders && hasStickyUiMount && stickyRows.length > 0 ? (
          <div aria-hidden="true" data-file-tree-sticky-overlay="true">
            <div
              data-file-tree-sticky-overlay-content="true"
              style={{ height: `${overlayRowsHeight}px` }}
            >
              {stickyRows.map((entry, index) =>
                renderStickyRow(
                  entry.row,
                  resolveIcon,
                  itemHeight,
                  entry.top,
                  stickyRows.length - index,
                  {
                    contextMenuEnabled,
                    contextMenuRightClickEnabled,
                    onClick: handleStickyRowClick,
                    openContextMenuForRow,
                    registerButton: registerStickyRowButton,
                    shouldSuppressContextMenu,
                  },
                  `sticky:${getFileTreeRowPath(entry.row)}`
                )
              )}
            </div>
          </div>
        ) : null}
        <div
          ref={listRef}
          data-file-tree-virtualized-list="true"
          style={{ height: `${totalScrollableHeight}px` }}
        >
          <div
            data-file-tree-virtualized-sticky-offset="true"
            aria-hidden="true"
            style={{ height: `${windowOffsetTop}px` }}
          />
          <div
            data-file-tree-virtualized-sticky="true"
            style={{
              height: `${windowHeight}px`,
              top: `${windowStickyInset}px`,
              bottom: `${windowStickyInset}px`,
            }}
          >
            {renderRangeChildren(
              controller,
              renameView,
              range,
              stickyRowPathSet,
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
              gitStatusByPath,
              ignoredGitDirectories,
              ignoredInheritanceCache,
              directoriesWithGitChanges,
              gitLaneActive,
              contextMenuEnabled,
              contextMenuTriggerMode,
              contextMenuButtonTriggerEnabled,
              contextMenuButtonVisibility,
              contextMenuRightClickEnabled,
              (element) => {
                renameInputRef.current = element;
              },
              registerRowButton,
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
                  gitStatusByPath,
                  ignoredGitDirectories,
                  ignoredInheritanceCache,
                  directoriesWithGitChanges,
                  gitLaneActive,
                  contextMenuEnabled,
                  contextMenuTriggerMode,
                  contextMenuButtonTriggerEnabled,
                  contextMenuButtonVisibility,
                  contextMenuRightClickEnabled,
                  (element) => {
                    renameInputRef.current = element;
                  },
                  registerRowButton,
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
                  gitStatusByPath,
                  ignoredGitDirectories,
                  ignoredInheritanceCache,
                  directoriesWithGitChanges,
                  gitLaneActive,
                  contextMenuEnabled,
                  contextMenuTriggerMode,
                  contextMenuButtonTriggerEnabled,
                  contextMenuButtonVisibility,
                  contextMenuRightClickEnabled,
                  (element) => {
                    renameInputRef.current = element;
                  },
                  registerRowButton,
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
      </div>
      {contextMenuEnabled ? (
        <div
          ref={contextMenuAnchorRef}
          data-type="context-menu-anchor"
          data-visible={contextMenuAnchorVisible ? 'true' : 'false'}
          style={contextMenuAnchorStyle}
        >
          <button
            ref={contextMenuTriggerRef}
            type="button"
            data-type={CONTEXT_MENU_TRIGGER_TYPE}
            aria-label="Options"
            aria-haspopup="menu"
            aria-expanded={contextMenuState != null ? 'true' : 'false'}
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
            style={contextMenuTriggerStyle}
          >
            <Icon {...resolveIcon('file-tree-icon-ellipsis')} />
          </button>
          {contextMenuState != null ? (
            <slot name={CONTEXT_MENU_SLOT_NAME} />
          ) : null}
        </div>
      ) : null}

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
