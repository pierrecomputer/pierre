import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import {
  CONTEXT_MENU_SLOT_NAME,
  CONTEXT_MENU_TRIGGER_TYPE,
} from '../../constants';
import type { TreeInstance } from '../../core/types/core';
import type { FileTreeCallbacks } from '../../FileTree';
import type { FileTreeNode } from '../../types';
import { getSelectionPath } from '../../utils/getSelectionPath';

const BLOCKED_CONTEXT_MENU_NAV_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export interface UseContextMenuControllerArgs {
  tree: TreeInstance<FileTreeNode>;
  isContextMenuEnabled: boolean;
  callbacksRef?: { current: FileTreeCallbacks };
  files: string[];
  idToPath: Map<string, string>;
}

export interface UseContextMenuControllerResult {
  isContextMenuEnabled: boolean;
  isContextMenuOpen: boolean;
  contextMenuAnchorRef: { current: HTMLDivElement | null };
  triggerRef: { current: HTMLButtonElement | null };
  closeContextMenu: (notify?: boolean, restoreFocus?: boolean) => void;
  openContextMenuForItem: (
    itemId: string,
    anchorEl: HTMLElement | null,
    toggleIfAlreadyOpen?: boolean
  ) => void;
  handleTriggerClick: (e: MouseEvent) => void;
  handleContextMenuKeyDown: (e: KeyboardEvent) => void;
  handleTreeKeyDownCapture: (e: KeyboardEvent) => void;
  handleTreePointerOver: (e: PointerEvent) => void;
  handleTreePointerLeave: () => void;
  handleWashMouseDownCapture: (e: MouseEvent) => void;
  handleWashWheelCapture: (e: WheelEvent) => void;
  handleWashTouchMoveCapture: (e: TouchEvent) => void;
}

export function useContextMenuController({
  tree,
  isContextMenuEnabled,
  callbacksRef,
  files,
  idToPath,
}: UseContextMenuControllerArgs): UseContextMenuControllerResult {
  const [contextMenuItemId, setContextMenuItemId] = useState<string | null>(
    null
  );
  const contextMenuAnchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoveredContextMenuItemRef = useRef<string | null>(null);
  const contextHoverItemElRef = useRef<HTMLElement | null>(null);
  const contextHoverItemIdRef = useRef<string | null>(null);
  const contextMenuRestoreFocusRef = useRef<{
    element: HTMLElement | null;
    focusedItemId: string | null;
  }>({
    element: null,
    focusedItemId: null,
  });
  const contextMenuRestoreFocusTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const contextMenuRestoreFocusRetryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const contextMenuRestoreFocusLateTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const isScrollingRef = useRef(false);
  // Cached DOM references — stable across renders, updated when tree changes.
  const treeContainerRef = useRef<Element | null>(null);
  const scrollContainerRef = useRef<Element | null>(null);

  // Ref mirror of contextMenuItemId — lets callbacks read the current value
  // without including it as a dependency, keeping their identities stable.
  const contextMenuItemIdRef = useRef<string | null>(null);
  contextMenuItemIdRef.current = contextMenuItemId;
  const isContextMenuOpen = isContextMenuEnabled && contextMenuItemId != null;

  // Lazily resolve and cache the tree container and its virtualized scroll
  // child. The cache is invalidated when the container disconnects from DOM.
  const getTreeContainer = useCallback((): Element | null => {
    if (
      treeContainerRef.current != null &&
      treeContainerRef.current.isConnected
    ) {
      return treeContainerRef.current;
    }
    const container = tree.getElement()?.closest('[role="tree"]') ?? null;
    treeContainerRef.current = container;
    scrollContainerRef.current =
      container?.querySelector('[data-file-tree-virtualized-scroll]') ?? null;
    return container;
  }, [tree]);

  const setContextHoverItem = useCallback(
    (itemId: string | null) => {
      if (contextHoverItemIdRef.current === itemId) {
        return;
      }

      if (contextHoverItemElRef.current != null) {
        delete contextHoverItemElRef.current.dataset.itemContextHover;
        contextHoverItemElRef.current = null;
      }
      contextHoverItemIdRef.current = null;

      if (itemId == null) {
        return;
      }

      const container = getTreeContainer();
      if (container == null) {
        return;
      }
      const itemEl = container.querySelector<HTMLElement>(
        `[data-type="item"][data-item-id="${itemId}"]`
      );
      if (itemEl == null) {
        return;
      }

      itemEl.dataset.itemContextHover = 'true';
      contextHoverItemElRef.current = itemEl;
      contextHoverItemIdRef.current = itemId;
    },
    [getTreeContainer]
  );

  const isEventInContextMenu = useCallback((e: Event): boolean => {
    const path = e.composedPath();
    for (const entry of path) {
      if (!(entry instanceof HTMLElement)) continue;
      if (entry.dataset.type === 'context-menu-anchor') {
        return true;
      }
      if (entry.getAttribute('slot') === CONTEXT_MENU_SLOT_NAME) {
        return true;
      }
    }
    return false;
  }, []);

  const clearContextMenuRestoreTimers = useCallback(() => {
    if (contextMenuRestoreFocusTimerRef.current != null) {
      clearTimeout(contextMenuRestoreFocusTimerRef.current);
      contextMenuRestoreFocusTimerRef.current = null;
    }
    if (contextMenuRestoreFocusRetryTimerRef.current != null) {
      clearTimeout(contextMenuRestoreFocusRetryTimerRef.current);
      contextMenuRestoreFocusRetryTimerRef.current = null;
    }
    if (contextMenuRestoreFocusLateTimerRef.current != null) {
      clearTimeout(contextMenuRestoreFocusLateTimerRef.current);
      contextMenuRestoreFocusLateTimerRef.current = null;
    }
  }, []);

  const restoreContextMenuFocus = useCallback((): boolean => {
    const focusElement = (element: HTMLElement | null): boolean => {
      if (element == null || !element.isConnected) {
        return false;
      }
      if (element === document.body || element === document.documentElement) {
        return false;
      }
      element.focus();
      return document.activeElement === element;
    };

    if (focusElement(contextMenuRestoreFocusRef.current.element)) {
      return true;
    }

    const focusedItemId = contextMenuRestoreFocusRef.current.focusedItemId;
    if (focusedItemId != null) {
      const container = getTreeContainer();
      const focusedItemEl = container?.querySelector<HTMLElement>(
        `[data-type="item"][data-item-id="${focusedItemId}"]`
      );
      if (focusElement(focusedItemEl ?? null)) {
        return true;
      }
    }

    const treeElement = tree.getElement();
    if (treeElement instanceof HTMLElement) {
      treeElement.focus();
      return document.activeElement === treeElement;
    }

    return false;
  }, [getTreeContainer, tree]);

  const closeContextMenu = useCallback(
    (notify = true, restoreFocus = true) => {
      if (contextMenuItemIdRef.current == null) return;

      clearContextMenuRestoreTimers();

      setContextHoverItem(null);
      contextMenuItemIdRef.current = null;
      setContextMenuItemId(null);
      if (notify) {
        callbacksRef?.current.onContextMenuClose?.();
      }
      if (!restoreFocus) {
        contextMenuRestoreFocusRef.current = {
          element: null,
          focusedItemId: null,
        };
        return;
      }

      contextMenuRestoreFocusTimerRef.current = setTimeout(() => {
        contextMenuRestoreFocusTimerRef.current = null;
        restoreContextMenuFocus();
        contextMenuRestoreFocusRetryTimerRef.current = setTimeout(() => {
          contextMenuRestoreFocusRetryTimerRef.current = null;
          if (
            document.activeElement === document.body ||
            document.activeElement === document.documentElement
          ) {
            restoreContextMenuFocus();
          }
        }, 0);
        contextMenuRestoreFocusLateTimerRef.current = setTimeout(() => {
          contextMenuRestoreFocusLateTimerRef.current = null;
          if (
            document.activeElement === document.body ||
            document.activeElement === document.documentElement
          ) {
            restoreContextMenuFocus();
          }
          contextMenuRestoreFocusRef.current = {
            element: null,
            focusedItemId: null,
          };
        }, 32);
      }, 0);
    },
    [
      callbacksRef,
      clearContextMenuRestoreTimers,
      restoreContextMenuFocus,
      setContextHoverItem,
    ]
  );

  const updateTriggerPosition = useCallback(
    (itemEl: HTMLElement | null) => {
      const trigger = triggerRef.current;
      const anchor = contextMenuAnchorRef.current;
      if (trigger == null || anchor == null) return;
      if (itemEl == null) {
        const openItemId = contextMenuItemIdRef.current;
        if (openItemId == null) {
          trigger.dataset.visible = 'false';
          anchor.dataset.visible = 'false';
        }
        hoveredContextMenuItemRef.current = null;
        if (openItemId != null) {
          setContextHoverItem(openItemId);
        } else {
          setContextHoverItem(null);
        }
        return;
      }
      const container = getTreeContainer();
      if (container == null) return;
      const itemRect = itemEl.getBoundingClientRect();
      // For virtualized trees the trigger lives inside the scroll container,
      // so we compute a content-relative offset that scrolls with items.
      const scrollContainer = scrollContainerRef.current;
      let top: number;
      if (scrollContainer != null) {
        const scrollRect = scrollContainer.getBoundingClientRect();
        top = itemRect.top - scrollRect.top + scrollContainer.scrollTop;
      } else {
        const containerRect = container.getBoundingClientRect();
        top = itemRect.top - containerRect.top;
      }
      anchor.style.top = `${top}px`;
      trigger.dataset.visible = 'true';
      anchor.dataset.visible = 'true';
      const nextItemId = itemEl.dataset.itemId ?? null;
      trigger.dataset.itemId = nextItemId ?? '';
      hoveredContextMenuItemRef.current = nextItemId;
      setContextHoverItem(nextItemId);
    },
    [getTreeContainer, setContextHoverItem]
  );

  const openContextMenuForItem = useCallback(
    (
      itemId: string,
      anchorEl: HTMLElement | null,
      toggleIfAlreadyOpen = false
    ) => {
      const openContextMenu = callbacksRef?.current.onContextMenuOpen;
      if (openContextMenu == null) return;

      if (toggleIfAlreadyOpen && contextMenuItemIdRef.current === itemId) {
        closeContextMenu();
        return;
      }

      if (anchorEl == null) return;

      clearContextMenuRestoreTimers();
      const activeElement = document.activeElement;
      const focusTarget =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement
          ? activeElement
          : null;
      contextMenuRestoreFocusRef.current =
        focusTarget != null
          ? {
              element: focusTarget,
              focusedItemId: tree.getState().focusedItem ?? null,
            }
          : {
              element: null,
              focusedItemId: tree.getState().focusedItem ?? null,
            };

      if (anchorEl.dataset.type === 'item') {
        updateTriggerPosition(anchorEl);
      }

      const trigger = triggerRef.current;
      const menuAnchorEl =
        anchorEl.dataset.type === CONTEXT_MENU_TRIGGER_TYPE && trigger != null
          ? trigger
          : (trigger ?? anchorEl);
      contextMenuItemIdRef.current = itemId;
      setContextMenuItemId(itemId);
      const item = tree.getItemInstance(itemId);
      const data = item.getItemData();
      const canRename = item.canRename?.() ?? false;
      const anchorRect = menuAnchorEl.getBoundingClientRect();
      openContextMenu(
        {
          path: getSelectionPath(data.path),
          isFolder: data.children?.direct != null,
        },
        {
          anchorElement: menuAnchorEl,
          anchorRect: {
            top: anchorRect.top,
            right: anchorRect.right,
            bottom: anchorRect.bottom,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
            x: anchorRect.x,
            y: anchorRect.y,
          },
          close: () => closeContextMenu(),
          canRename,
          startRenaming: () => {
            if (!canRename) return;
            closeContextMenu(true, false);
            item.startRenaming?.();
          },
        }
      );
    },
    [
      callbacksRef,
      clearContextMenuRestoreTimers,
      closeContextMenu,
      tree,
      updateTriggerPosition,
    ]
  );

  const handleTriggerClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const trigger = triggerRef.current;
      const itemId = trigger?.dataset.itemId;
      if (itemId == null || trigger == null) return;
      openContextMenuForItem(itemId, trigger, true);
    },
    [openContextMenuForItem]
  );

  const handleContextMenuKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (contextMenuItemIdRef.current == null) {
        return;
      }
      if (!isEventInContextMenu(e)) {
        return;
      }
      if (!BLOCKED_CONTEXT_MENU_NAV_KEYS.has(e.key) && e.key !== 'Escape') {
        return;
      }
      // Let menu controls process keys first, then stop bubbling so tree-level
      // keyboard navigation does not run while menu content has focus.
      e.stopPropagation();
    },
    [isEventInContextMenu]
  );

  useEffect(() => {
    if (contextMenuItemId == null) {
      return;
    }
    const trigger = triggerRef.current;
    const anchor = contextMenuAnchorRef.current;
    if (trigger != null) {
      trigger.dataset.visible = 'true';
    }
    if (anchor != null) {
      anchor.dataset.visible = 'true';
    }
    setContextHoverItem(contextMenuItemId);
  }, [contextMenuItemId, setContextHoverItem]);

  const handleTreeKeyDownCapture = useCallback(
    (e: KeyboardEvent) => {
      // Read from the ref so this callback always sees the latest open state
      // even before Preact re-renders with the updated closure.
      if (contextMenuItemIdRef.current == null || e.defaultPrevented) {
        return;
      }
      if (isEventInContextMenu(e)) {
        // Let menu widgets handle key events, but prevent tree-level keyboard
        // navigation from reacting to these keys while the context menu is open.
        if (BLOCKED_CONTEXT_MENU_NAV_KEYS.has(e.key)) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        closeContextMenu();
        return;
      }
    },
    [closeContextMenu, isEventInContextMenu]
  );

  // Close context menu on scroll and hide the trigger while scrolling.
  // The trigger reappears on the next pointerover after scrolling stops,
  // matching the timing of the virtualizer's hover-style restoration.
  useEffect(() => {
    if (!isContextMenuEnabled) return;
    const container = getTreeContainer();
    const scrollParent = scrollContainerRef.current ?? container?.parentElement;
    const target = scrollParent ?? container?.parentElement;
    if (target == null) return;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      // Close context menu if open
      if (contextMenuItemIdRef.current != null) {
        closeContextMenu();
        return;
      }

      // Hide trigger during scroll
      isScrollingRef.current = true;
      const trigger = triggerRef.current;
      const anchor = contextMenuAnchorRef.current;
      if (trigger != null) {
        trigger.dataset.visible = 'false';
      }
      if (anchor != null) {
        anchor.dataset.visible = 'false';
      }
      hoveredContextMenuItemRef.current = null;
      setContextHoverItem(null);

      if (scrollTimer != null) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        isScrollingRef.current = false;
        scrollTimer = null;
      }, 50);
    };

    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', handleScroll);
      if (scrollTimer != null) clearTimeout(scrollTimer);
      isScrollingRef.current = false;
    };
  }, [
    closeContextMenu,
    getTreeContainer,
    isContextMenuEnabled,
    setContextHoverItem,
  ]);

  useEffect(
    () => () => {
      setContextHoverItem(null);
      clearContextMenuRestoreTimers();
      contextMenuRestoreFocusRef.current = {
        element: null,
        focusedItemId: null,
      };
    },
    [clearContextMenuRestoreTimers, setContextHoverItem]
  );

  useEffect(() => {
    if (isContextMenuEnabled || contextMenuItemId == null) return;
    closeContextMenu();
  }, [closeContextMenu, contextMenuItemId, isContextMenuEnabled]);

  const prevContextMenuStructureRef = useRef({ files, idToPath });
  useEffect(() => {
    const previous = prevContextMenuStructureRef.current;
    prevContextMenuStructureRef.current = { files, idToPath };
    const structureChanged =
      previous.files !== files || previous.idToPath !== idToPath;
    if (
      !isContextMenuEnabled ||
      contextMenuItemId == null ||
      !structureChanged
    ) {
      return;
    }
    closeContextMenu();
  }, [
    closeContextMenu,
    contextMenuItemId,
    files,
    idToPath,
    isContextMenuEnabled,
  ]);

  // Focus-based trigger positioning
  const focusedItemId = tree.getState().focusedItem ?? null;

  useEffect(() => {
    if (!isContextMenuEnabled || focusedItemId == null) return;
    const container = getTreeContainer();
    const itemEl = container?.querySelector(
      `[data-item-id="${focusedItemId}"]`
    ) as HTMLElement | null;
    updateTriggerPosition(itemEl);
  }, [
    focusedItemId,
    getTreeContainer,
    isContextMenuEnabled,
    updateTriggerPosition,
  ]);

  const handleTreePointerOver = useCallback(
    (e: PointerEvent) => {
      if (isScrollingRef.current) return;
      const target = e.target as HTMLElement;
      const contextHoverItemId =
        contextMenuItemIdRef.current ?? hoveredContextMenuItemRef.current;
      if (
        target.closest?.(`[data-type="${CONTEXT_MENU_TRIGGER_TYPE}"]`) != null
      ) {
        return;
      }
      if (target.closest?.('[data-type="context-menu-wash"]') != null) {
        setContextHoverItem(contextHoverItemId);
        return;
      }
      if (isEventInContextMenu(e)) {
        setContextHoverItem(contextHoverItemId);
        return;
      }
      const itemEl = target.closest?.('[data-type="item"]') ?? null;
      const itemId =
        itemEl instanceof HTMLElement ? (itemEl.dataset.itemId ?? null) : null;
      if (itemId != null && hoveredContextMenuItemRef.current === itemId) {
        return;
      }
      updateTriggerPosition(itemEl as HTMLElement | null);
    },
    [isEventInContextMenu, setContextHoverItem, updateTriggerPosition]
  );

  const handleTreePointerLeave = useCallback(() => {
    const anchor = contextMenuAnchorRef.current;
    if (contextMenuItemIdRef.current == null && triggerRef.current != null) {
      triggerRef.current.dataset.visible = 'false';
      if (anchor != null) {
        anchor.dataset.visible = 'false';
      }
    }
    hoveredContextMenuItemRef.current = null;
    if (contextMenuItemIdRef.current != null) {
      setContextHoverItem(contextMenuItemIdRef.current);
    } else {
      setContextHoverItem(null);
    }
  }, [setContextHoverItem]);

  const handleWashMouseDownCapture = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();
    },
    [closeContextMenu]
  );

  const handleWashWheelCapture = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleWashTouchMoveCapture = useCallback((e: TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    isContextMenuEnabled,
    isContextMenuOpen,
    contextMenuAnchorRef,
    triggerRef,
    closeContextMenu,
    openContextMenuForItem,
    handleTriggerClick,
    handleContextMenuKeyDown,
    handleTreeKeyDownCapture,
    handleTreePointerOver,
    handleTreePointerLeave,
    handleWashMouseDownCapture,
    handleWashWheelCapture,
    handleWashTouchMoveCapture,
  };
}
