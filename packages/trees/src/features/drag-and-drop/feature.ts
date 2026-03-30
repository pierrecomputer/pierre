/* oxlint-disable typescript-oxlint/strict-boolean-expressions -- Ported from @headless-tree/core internals */
import type {
  FeatureImplementation,
  ItemInstance,
  TreeInstance,
} from '../../core/types/core';
import { makeStateUpdater } from '../../core/utils';
import type {
  DndDataRef,
  DragLineData,
  DragTarget,
  TouchDndDataRef,
} from './types';
import {
  canDrop,
  getDragCode,
  getDragTarget,
  getTargetPlacement,
  isOrderedDragTarget,
  PlacementType,
  type TargetPlacement,
} from './utils';

const LONG_PRESS_DELAY = 400;
const LONG_PRESS_MOVE_THRESHOLD = 10;

const handleAutoOpenFolder = (
  dataRef: { current: DndDataRef },
  tree: TreeInstance<unknown>,
  item: ItemInstance<unknown>,
  placement: TargetPlacement
) => {
  const { openOnDropDelay } = tree.getConfig();
  const dragCode = dataRef.current.lastDragCode;

  if (
    !openOnDropDelay ||
    !item.isFolder() ||
    item.isExpanded() ||
    placement.type !== PlacementType.MakeChild
  ) {
    return;
  }
  clearTimeout(dataRef.current.autoExpandTimeout);
  dataRef.current.autoExpandTimeout = setTimeout(() => {
    if (
      dragCode !== dataRef.current.lastDragCode ||
      !dataRef.current.lastAllowDrop
    )
      return;
    item.expand();
  }, openOnDropDelay);
};

const findItemUnderPoint = (
  tree: TreeInstance<unknown>,
  clientX: number,
  clientY: number
): ItemInstance<unknown> | null => {
  const treeEl = tree.getElement();
  const root = treeEl?.getRootNode() as Document | ShadowRoot | undefined;
  const el = (root ?? document).elementFromPoint(clientX, clientY);
  const itemEl = el?.closest?.('[data-item-id]');
  const itemId = itemEl?.getAttribute('data-item-id');
  if (!itemId) return null;
  try {
    return tree.getItemInstance(itemId);
  } catch {
    return null;
  }
};

const createTouchProxy = (touch: Touch) => ({
  clientX: touch.clientX,
  clientY: touch.clientY,
  dataTransfer: null as DataTransfer | null,
});

const cleanupTouchListeners = (dataRef: { current: TouchDndDataRef }) => {
  clearTimeout(dataRef.current.touchLongPressTimer);
  dataRef.current.touchLongPressTimer = undefined;

  if (dataRef.current.touchMoveHandler) {
    document.removeEventListener('touchmove', dataRef.current.touchMoveHandler);
    dataRef.current.touchMoveHandler = undefined;
  }
  if (dataRef.current.touchEndHandler) {
    document.removeEventListener('touchend', dataRef.current.touchEndHandler);
    dataRef.current.touchEndHandler = undefined;
  }
  if (dataRef.current.touchCancelHandler) {
    document.removeEventListener(
      'touchcancel',
      dataRef.current.touchCancelHandler
    );
    dataRef.current.touchCancelHandler = undefined;
  }
  if (dataRef.current.selectStartHandler) {
    document.removeEventListener(
      'selectstart',
      dataRef.current.selectStartHandler
    );
    dataRef.current.selectStartHandler = undefined;
  }
  if (dataRef.current.touchDragElement) {
    dataRef.current.touchDragElement.setAttribute('draggable', 'true');
    dataRef.current.touchDragElement.style.removeProperty('touch-action');
    dataRef.current.touchDragElement = undefined;
  }
  if (dataRef.current.touchGhostElement) {
    dataRef.current.touchGhostElement.remove();
    dataRef.current.touchGhostElement = undefined;
    dataRef.current.touchGhostOffsetX = undefined;
    dataRef.current.touchGhostOffsetY = undefined;
  }
};

interface TouchDragConfig {
  _onTouchDragMove?: (clientX: number, clientY: number) => void;
  _onTouchDragEnd?: () => void;
}

const startTouchDrag = (
  tree: TreeInstance<unknown>,
  item: ItemInstance<unknown>,
  dataRef: { current: TouchDndDataRef }
) => {
  const config = tree.getConfig() as ReturnType<
    TreeInstance<unknown>['getConfig']
  > &
    TouchDragConfig;
  const selectedItems = tree.getSelectedItems
    ? tree.getSelectedItems()
    : [tree.getFocusedItem()];
  const items = selectedItems.includes(item) ? selectedItems : [item];

  if (!selectedItems.includes(item)) {
    tree.setSelectedItems?.([item.getItemMeta().itemId]);
  }

  if (!(config.canDrag?.(items) ?? true)) {
    dataRef.current.touchDragActive = false;
    // Restore draggable — drag was rejected
    if (dataRef.current.touchDragElement) {
      dataRef.current.touchDragElement.setAttribute('draggable', 'true');
      dataRef.current.touchDragElement = undefined;
    }
    return;
  }

  dataRef.current.touchDragActive = true;

  // Lock touch-action on the dragged element to prevent any remaining
  // browser gesture interference during the active drag.
  if (dataRef.current.touchDragElement) {
    dataRef.current.touchDragElement.style.setProperty('touch-action', 'none');
  }

  // Prevent iOS Safari from entering text selection mode during drag
  const onSelectStart = (e: Event) => e.preventDefault();
  dataRef.current.selectStartHandler = onSelectStart;
  document.addEventListener('selectstart', onSelectStart);

  tree.applySubStateUpdate('dnd', {
    draggedItems: items,
    draggingOverItem: tree.getFocusedItem(),
  });

  // Create ghost element that follows the user's finger
  const itemEl = item.getElement();
  if (itemEl) {
    const rect = itemEl.getBoundingClientRect();
    const ghost = itemEl.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-item-id');
    ghost.removeAttribute('id');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
      pointerEvents: 'none',
      opacity: '0.85',
      zIndex: '10000',
      margin: '0',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      willChange: 'transform',
    });

    const treeEl = tree.getElement();
    const root = treeEl?.getRootNode();
    if (root instanceof ShadowRoot) {
      root.appendChild(ghost);
    } else {
      document.body.appendChild(ghost);
    }

    dataRef.current.touchGhostElement = ghost;
    dataRef.current.touchGhostOffsetX =
      (dataRef.current.touchStartX ?? 0) - rect.left;
    dataRef.current.touchGhostOffsetY =
      (dataRef.current.touchStartY ?? 0) - rect.top;
  }

  const onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();

    if (dataRef.current.touchGhostElement) {
      const x = touch.clientX - (dataRef.current.touchGhostOffsetX ?? 0);
      const y = touch.clientY - (dataRef.current.touchGhostOffsetY ?? 0);
      dataRef.current.touchGhostElement.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    const proxy = createTouchProxy(touch);
    const targetItem = findItemUnderPoint(tree, touch.clientX, touch.clientY);

    config._onTouchDragMove?.(touch.clientX, touch.clientY);

    if (!targetItem) {
      tree.applySubStateUpdate('dnd', (state) => ({
        ...state,
        draggingOverItem: undefined,
        dragTarget: undefined,
      }));
      dataRef.current.lastDragCode = 'no-drag';
      dataRef.current.lastAllowDrop = false;
      return;
    }

    const placement = getTargetPlacement(proxy, targetItem, tree, true);
    const nextDragCode = getDragCode(targetItem, placement);

    if (nextDragCode === dataRef.current.lastDragCode) {
      return;
    }
    dataRef.current.lastDragCode = nextDragCode;

    handleAutoOpenFolder(dataRef, tree, targetItem, placement);

    const target = getDragTarget(proxy, targetItem, tree);

    if (!canDrop(null, target, tree)) {
      dataRef.current.lastAllowDrop = false;
      tree.applySubStateUpdate('dnd', (state) => ({
        ...state,
        draggingOverItem: targetItem,
        dragTarget: undefined,
      }));
      return;
    }

    tree.applySubStateUpdate('dnd', (state) => ({
      ...state,
      dragTarget: target,
      draggingOverItem: targetItem,
    }));
    dataRef.current.lastAllowDrop = true;
  };

  const finishDrag = async (dropped: boolean, e?: TouchEvent) => {
    cleanupTouchListeners(dataRef);
    dataRef.current.touchDragActive = false;
    dataRef.current.lastDragCode = undefined;
    clearTimeout(dataRef.current.autoExpandTimeout);

    let dropTarget: DragTarget<unknown> | undefined;
    let draggedItems: ItemInstance<unknown>[] | undefined;

    if (dropped && e) {
      const touch = e.changedTouches[0];
      if (touch) {
        const targetItem = findItemUnderPoint(
          tree,
          touch.clientX,
          touch.clientY
        );
        if (targetItem) {
          const proxy = createTouchProxy(touch);
          const target = getDragTarget(proxy, targetItem, tree);
          if (canDrop(null, target, tree)) {
            draggedItems = tree.getState().dnd?.draggedItems;
            dropTarget = target;
          }
        }
      }
    }

    tree.applySubStateUpdate('dnd', {
      draggedItems: undefined,
      draggingOverItem: undefined,
      dragTarget: undefined,
    });

    try {
      if (draggedItems && dropTarget) {
        await config.onDrop?.(draggedItems, dropTarget);
      }
    } catch (error) {
      console.error('Touch drag-and-drop onDrop failed', error);
    } finally {
      try {
        config._onTouchDragEnd?.();
      } catch (error) {
        console.error('Touch drag-and-drop cleanup callback failed', error);
      }
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    void finishDrag(true, e);
  };

  const onTouchCancel = () => {
    void finishDrag(false);
  };

  dataRef.current.touchMoveHandler = onTouchMove;
  dataRef.current.touchEndHandler = onTouchEnd;
  dataRef.current.touchCancelHandler = onTouchCancel;

  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchCancel);
};

const defaultCanDropForeignDragObject = () => false;

export const dragAndDropFeature: FeatureImplementation = {
  key: 'drag-and-drop',

  getDefaultConfig: (defaultConfig, tree) => ({
    canDrop: (_: unknown, target: { item: ItemInstance<unknown> }) =>
      target.item.isFolder(),
    canDropForeignDragObject: defaultCanDropForeignDragObject,
    canDragForeignDragObjectOver:
      defaultConfig.canDropForeignDragObject !== defaultCanDropForeignDragObject
        ? (dataTransfer: DataTransfer) => dataTransfer.effectAllowed !== 'none'
        : () => false,
    setDndState: makeStateUpdater('dnd', tree),
    canReorder: true,
    openOnDropDelay: 800,
    ...defaultConfig,
  }),

  stateHandlerNames: {
    dnd: 'setDndState',
  },

  onTreeMount: (tree) => {
    const listener = () => {
      tree.applySubStateUpdate('dnd', null);
    };
    tree.getDataRef<DndDataRef>().current.windowDragEndListener = listener;
    window.addEventListener('dragend', listener);
  },

  onTreeUnmount: (tree) => {
    const dataRef = tree.getDataRef<TouchDndDataRef>();
    const { windowDragEndListener } = dataRef.current;
    if (windowDragEndListener) {
      window.removeEventListener('dragend', windowDragEndListener);
    }
    // Clean up any active touch drag state
    cleanupTouchListeners(dataRef);
    dataRef.current.touchDragActive = false;
  },

  treeInstance: {
    getDragTarget: ({ tree }) => {
      return tree.getState().dnd?.dragTarget ?? null;
    },

    getDragLineData: ({ tree }): DragLineData | null => {
      const target = tree.getDragTarget();

      const treeBb = tree.getElement()?.getBoundingClientRect();

      if (!target || !treeBb || !isOrderedDragTarget(target)) return null;

      const leftOffset = target.dragLineLevel * (tree.getConfig().indent ?? 1);
      const targetItem = tree.getItems()[target.dragLineIndex];

      if (!targetItem) {
        const bb = tree
          .getItems()
          [target.dragLineIndex - 1]?.getElement()
          ?.getBoundingClientRect();

        if (bb) {
          return {
            indent: (target.item.getItemMeta().level ?? 0) + 1,
            top: bb.bottom - treeBb.top,
            left: bb.left + leftOffset - treeBb.left,
            width: bb.width - leftOffset,
          };
        }
      }

      const bb = targetItem?.getElement()?.getBoundingClientRect();

      if (bb) {
        return {
          indent: (target.item.getItemMeta().level ?? 0) + 1,
          top: bb.top - treeBb.top,
          left: bb.left + leftOffset - treeBb.left,
          width: bb.width - leftOffset,
        };
      }

      return null;
    },

    getDragLineStyle: ({ tree }, topOffset = -1, leftOffset = -8) => {
      const dragLine = tree.getDragLineData();
      return dragLine
        ? {
            position: 'absolute',
            top: `${dragLine.top + topOffset}px`,
            left: `${dragLine.left + leftOffset}px`,
            width: `${dragLine.width - leftOffset}px`,
            pointerEvents: 'none',
          }
        : { display: 'none' };
    },

    getContainerProps: ({ prev, tree }, treeLabel) => {
      const prevProps = prev?.(treeLabel);
      return {
        ...prevProps,

        onDragOver: (e: DragEvent) => {
          e.preventDefault();
        },

        onDrop: async (e: DragEvent) => {
          const dataRef = tree.getDataRef<DndDataRef>();
          const target: DragTarget<unknown> = { item: tree.getRootItem() };

          if (!canDrop(e.dataTransfer, target, tree)) {
            return;
          }

          e.preventDefault();
          const config = tree.getConfig();
          const draggedItems = tree.getState().dnd?.draggedItems;

          dataRef.current.lastDragCode = undefined;

          if (draggedItems) {
            await config.onDrop?.(draggedItems, target);
          } else if (e.dataTransfer) {
            await config.onDropForeignDragObject?.(e.dataTransfer, target);
          }
        },

        style: {
          ...prevProps?.style,
          position: 'relative',
        },
      };
    },
  },

  itemInstance: {
    getProps: ({ tree, item, prev }) => {
      const baseProps = prev?.() ?? {};

      return {
        ...baseProps,

        draggable: true,

        onDragEnter: (e: DragEvent) => e.preventDefault(),

        onDragStart: (e: DragEvent) => {
          const selectedItems = tree.getSelectedItems
            ? tree.getSelectedItems()
            : [tree.getFocusedItem()];
          const items = selectedItems.includes(item) ? selectedItems : [item];
          const config = tree.getConfig();

          if (!selectedItems.includes(item)) {
            tree.setSelectedItems?.([item.getItemMeta().itemId]);
          }

          if (!(config.canDrag?.(items) ?? true)) {
            e.preventDefault();
            return;
          }

          if (config.setDragImage) {
            const { imgElement, xOffset, yOffset } = config.setDragImage(items);
            e.dataTransfer?.setDragImage(
              imgElement,
              xOffset ?? 0,
              yOffset ?? 0
            );
          }

          if (config.createForeignDragObject && e.dataTransfer) {
            const { format, data, dropEffect, effectAllowed } =
              config.createForeignDragObject(items);
            e.dataTransfer.setData(format, data as string);

            if (dropEffect) e.dataTransfer.dropEffect = dropEffect;
            if (effectAllowed) e.dataTransfer.effectAllowed = effectAllowed;
          }

          tree.applySubStateUpdate('dnd', {
            draggedItems: items,
            draggingOverItem: tree.getFocusedItem(),
          });
        },

        onDragOver: (e: DragEvent) => {
          e.stopPropagation();
          const dataRef = tree.getDataRef<DndDataRef>();
          const placement = getTargetPlacement(e, item, tree, true);
          const nextDragCode = getDragCode(item, placement);

          if (nextDragCode === dataRef.current.lastDragCode) {
            if (dataRef.current.lastAllowDrop) {
              e.preventDefault();
            }
            return;
          }
          dataRef.current.lastDragCode = nextDragCode;
          dataRef.current.lastDragEnter = Date.now();

          handleAutoOpenFolder(dataRef, tree, item, placement);

          const target = getDragTarget(e, item, tree);

          if (
            !tree.getState().dnd?.draggedItems &&
            (!e.dataTransfer ||
              !tree
                .getConfig()
                .canDragForeignDragObjectOver?.(e.dataTransfer, target))
          ) {
            dataRef.current.lastAllowDrop = false;
            return;
          }

          if (!canDrop(e.dataTransfer, target, tree)) {
            dataRef.current.lastAllowDrop = false;
            return;
          }

          tree.applySubStateUpdate('dnd', (state) => ({
            ...state,
            dragTarget: target,
            draggingOverItem: item,
          }));
          dataRef.current.lastAllowDrop = true;
          e.preventDefault();
        },

        onDragLeave: () => {
          setTimeout(() => {
            const dataRef = tree.getDataRef<DndDataRef>();
            if ((dataRef.current.lastDragEnter ?? 0) + 100 >= Date.now())
              return;
            dataRef.current.lastDragCode = 'no-drag';
            tree.applySubStateUpdate('dnd', (state) => ({
              ...state,
              draggingOverItem: undefined,
              dragTarget: undefined,
            }));
          }, 100);
        },

        onDragEnd: (e: DragEvent) => {
          const { onCompleteForeignDrop, canDragForeignDragObjectOver } =
            tree.getConfig();
          const draggedItems = tree.getState().dnd?.draggedItems;

          if (e.dataTransfer?.dropEffect === 'none' || !draggedItems) {
            return;
          }

          const target = getDragTarget(e, item, tree);
          if (
            canDragForeignDragObjectOver &&
            e.dataTransfer &&
            !canDragForeignDragObjectOver(e.dataTransfer, target)
          ) {
            return;
          }

          onCompleteForeignDrop?.(draggedItems);
        },

        onDrop: async (e: DragEvent) => {
          e.stopPropagation();
          const dataRef = tree.getDataRef<DndDataRef>();
          const target = getDragTarget(e, item, tree);
          const draggedItems = tree.getState().dnd?.draggedItems;
          const isValidDrop = canDrop(e.dataTransfer, target, tree);

          tree.applySubStateUpdate('dnd', {
            draggedItems: undefined,
            draggingOverItem: undefined,
            dragTarget: undefined,
          });

          if (!isValidDrop) {
            return;
          }

          e.preventDefault();
          const config = tree.getConfig();

          dataRef.current.lastDragCode = undefined;

          if (draggedItems) {
            await config.onDrop?.(draggedItems, target);
          } else if (e.dataTransfer) {
            await config.onDropForeignDragObject?.(e.dataTransfer, target);
          }
        },

        onTouchStart: (e: TouchEvent) => {
          const dataRef = tree.getDataRef<TouchDndDataRef>();
          if (dataRef.current.touchDragActive) return;

          const touch = e.touches[0];
          if (!touch) return;

          const el = e.currentTarget as HTMLElement;

          dataRef.current.touchStartX = touch.clientX;
          dataRef.current.touchStartY = touch.clientY;

          // Disable native draggable immediately so iOS Safari's built-in
          // long-press drag gesture doesn't fire touchcancel and steal
          // our custom touch drag sequence.
          el.setAttribute('draggable', 'false');
          dataRef.current.touchDragElement = el;

          // Early touchmove listener to cancel long-press if finger moves too far
          const earlyMoveHandler = (moveE: TouchEvent) => {
            const moveTouch = moveE.touches[0];
            if (!moveTouch) return;
            const dx = moveTouch.clientX - (dataRef.current.touchStartX ?? 0);
            const dy = moveTouch.clientY - (dataRef.current.touchStartY ?? 0);
            if (
              dx * dx + dy * dy >
              LONG_PRESS_MOVE_THRESHOLD * LONG_PRESS_MOVE_THRESHOLD
            ) {
              clearTimeout(dataRef.current.touchLongPressTimer);
              dataRef.current.touchLongPressTimer = undefined;
              // Restore draggable — user is scrolling, not dragging
              el.setAttribute('draggable', 'true');
              dataRef.current.touchDragElement = undefined;
              document.removeEventListener('touchmove', earlyMoveHandler);
              document.removeEventListener('touchend', earlyEndHandler);
              document.removeEventListener('touchcancel', earlyEndHandler);
            }
          };

          const earlyEndHandler = () => {
            clearTimeout(dataRef.current.touchLongPressTimer);
            dataRef.current.touchLongPressTimer = undefined;
            // Restore draggable — touch ended without drag
            el.setAttribute('draggable', 'true');
            dataRef.current.touchDragElement = undefined;
            document.removeEventListener('touchmove', earlyMoveHandler);
            document.removeEventListener('touchend', earlyEndHandler);
            document.removeEventListener('touchcancel', earlyEndHandler);
          };

          document.addEventListener('touchmove', earlyMoveHandler, {
            passive: true,
          });
          document.addEventListener('touchend', earlyEndHandler);
          document.addEventListener('touchcancel', earlyEndHandler);

          dataRef.current.touchLongPressTimer = setTimeout(() => {
            dataRef.current.touchLongPressTimer = undefined;
            document.removeEventListener('touchmove', earlyMoveHandler);
            document.removeEventListener('touchend', earlyEndHandler);
            document.removeEventListener('touchcancel', earlyEndHandler);
            startTouchDrag(tree, item, dataRef);
          }, LONG_PRESS_DELAY);
        },

        onContextMenu: (e: Event) => {
          const dataRef = tree.getDataRef<TouchDndDataRef>();
          if (
            dataRef.current.touchLongPressTimer != null ||
            dataRef.current.touchDragActive
          ) {
            e.preventDefault();
          }
        },
      };
    },

    isDragTarget: ({ tree, item }) => {
      const target = tree.getDragTarget();
      return target ? target.item.getId() === item.getId() : false;
    },

    isUnorderedDragTarget: ({ tree, item }) => {
      const target = tree.getDragTarget();
      return target
        ? !isOrderedDragTarget(target) && target.item.getId() === item.getId()
        : false;
    },

    isDragTargetAbove: ({ tree, item }) => {
      const target = tree.getDragTarget();

      if (
        !target ||
        !isOrderedDragTarget(target) ||
        target.item !== item.getParent()
      )
        return false;
      return target.childIndex === item.getItemMeta().posInSet;
    },

    isDragTargetBelow: ({ tree, item }) => {
      const target = tree.getDragTarget();

      if (
        !target ||
        !isOrderedDragTarget(target) ||
        target.item !== item.getParent()
      )
        return false;
      return target.childIndex - 1 === item.getItemMeta().posInSet;
    },

    isDraggingOver: ({ tree, item }) => {
      return tree.getState().dnd?.draggingOverItem?.getId() === item.getId();
    },
  },
};
