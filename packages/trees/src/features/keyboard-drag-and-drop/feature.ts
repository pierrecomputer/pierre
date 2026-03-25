/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import {
  type FeatureImplementation,
  type ItemInstance,
  type TreeInstance,
} from '../../core/types/core';
import { makeStateUpdater } from '../../core/utils';
import type { DndDataRef, DragTarget } from '../drag-and-drop/types';
import {
  canDrop,
  getInsertionIndex,
  getItemDropCategory,
  getReparentTarget,
  isOrderedDragTarget,
  ItemDropCategory,
} from '../drag-and-drop/utils';
import { AssistiveDndState, type KDndDataRef } from './types';

const getNextDragTarget = <T>(
  tree: TreeInstance<T>,
  isUp: boolean,
  dragTarget: DragTarget<T>
): DragTarget<T> | undefined => {
  const direction = isUp ? 0 : 1;
  const draggedItems = tree.getState().dnd?.draggedItems;

  // currently hovering between items
  if (isOrderedDragTarget(dragTarget)) {
    const parent = dragTarget.item.getParent();
    const targetedItem = tree.getItems()[dragTarget.dragLineIndex - 1]; // item above dragline

    const targetCategory =
      targetedItem != null
        ? getItemDropCategory(targetedItem as ItemInstance<unknown>)
        : ItemDropCategory.Item;
    const maxLevel = targetedItem?.getItemMeta().level ?? 0;
    const minLevel = targetedItem?.getItemBelow()?.getItemMeta().level ?? 0;

    // reparenting
    if (targetCategory === ItemDropCategory.LastInGroup) {
      if (isUp && dragTarget.dragLineLevel < maxLevel) {
        return getReparentTarget(
          targetedItem,
          dragTarget.dragLineLevel + 1,
          draggedItems
        );
      }
      if (!isUp && dragTarget.dragLineLevel > minLevel && parent != null) {
        return getReparentTarget(
          targetedItem,
          dragTarget.dragLineLevel - 1,
          draggedItems
        );
      }
    }

    const newIndex = dragTarget.dragLineIndex - 1 + direction;
    const item = tree.getItems()[newIndex];
    return item != null ? { item } : undefined;
  }

  // moving upwards outside of an open folder
  const targetingExpandedFolder =
    getItemDropCategory(dragTarget.item as ItemInstance<unknown>) ===
    ItemDropCategory.ExpandedFolder;
  if (targetingExpandedFolder && !isUp) {
    return {
      item: dragTarget.item,
      childIndex: 0,
      insertionIndex: getInsertionIndex(
        dragTarget.item.getChildren(),
        0,
        draggedItems
      ),
      dragLineIndex: dragTarget.item.getItemMeta().index + direction,
      dragLineLevel: dragTarget.item.getItemMeta().level + 1,
    };
  }

  // currently hovering over item
  const childIndex = dragTarget.item.getIndexInParent() + direction;
  return {
    item: dragTarget.item.getParent()!,
    childIndex,
    insertionIndex: getInsertionIndex(
      dragTarget.item.getParent()!.getChildren(),
      childIndex,
      draggedItems
    ),
    dragLineIndex: dragTarget.item.getItemMeta().index + direction,
    dragLineLevel: dragTarget.item.getItemMeta().level,
  };
};

const getNextValidDragTarget = <T>(
  tree: TreeInstance<T>,
  isUp: boolean,
  previousTarget = tree.getState().dnd?.dragTarget
): DragTarget<T> | undefined => {
  if (previousTarget == null) return undefined;
  const nextTarget = getNextDragTarget(tree, isUp, previousTarget);
  const dataTransfer =
    tree.getDataRef<KDndDataRef>().current.kDndDataTransfer ?? null;
  if (nextTarget == null) return undefined;
  if (
    canDrop(
      dataTransfer,
      nextTarget as DragTarget<unknown>,
      tree as TreeInstance<unknown>
    )
  ) {
    return nextTarget;
  }
  return getNextValidDragTarget(tree, isUp, nextTarget);
};

const updateScroll = <T>(tree: TreeInstance<T>) => {
  const state = tree.getState().dnd;
  if (state?.dragTarget == null || isOrderedDragTarget(state.dragTarget))
    return;
  void state.dragTarget.item.scrollTo({ block: 'nearest', inline: 'nearest' });
};

const initiateDrag = <T>(
  tree: TreeInstance<T>,
  draggedItems?: ItemInstance<T>[],
  dataTransfer?: DataTransfer
) => {
  const focusedItem = tree.getFocusedItem();
  const { canDrag } = tree.getConfig();

  if (draggedItems != null && canDrag != null && !canDrag(draggedItems)) {
    return;
  }

  if (draggedItems != null) {
    tree.applySubStateUpdate('dnd', { draggedItems });
    // getNextValidDragTarget->canDrop needs the draggedItems in state
    tree.getConfig().onStartKeyboardDrag?.(draggedItems);
  } else if (dataTransfer != null) {
    tree.getDataRef<KDndDataRef>().current.kDndDataTransfer = dataTransfer;
  }

  const dragTarget = getNextValidDragTarget(tree, false, {
    item: focusedItem,
  });
  if (dragTarget == null) return;

  tree.applySubStateUpdate('dnd', {
    draggedItems,
    dragTarget,
  });
  tree.applySubStateUpdate('assistiveDndState', AssistiveDndState.Started);
  updateScroll(tree);
};

const moveDragPosition = <T>(tree: TreeInstance<T>, isUp: boolean) => {
  const dragTarget = getNextValidDragTarget(tree, isUp);
  if (dragTarget == null) return;
  tree.applySubStateUpdate('dnd', {
    draggedItems: tree.getState().dnd?.draggedItems,
    dragTarget,
  });
  tree.applySubStateUpdate('assistiveDndState', AssistiveDndState.Dragging);
  if (!isOrderedDragTarget(dragTarget)) {
    dragTarget.item.setFocused();
  }
  updateScroll(tree);
};

export const keyboardDragAndDropFeature: FeatureImplementation = {
  key: 'keyboard-drag-and-drop',
  deps: ['drag-and-drop'],

  getDefaultConfig: (defaultConfig, tree) => ({
    setAssistiveDndState: makeStateUpdater('assistiveDndState', tree),
    ...defaultConfig,
  }),

  stateHandlerNames: {
    assistiveDndState: 'setAssistiveDndState',
  },

  treeInstance: {
    startKeyboardDrag: ({ tree }, draggedItems) => {
      initiateDrag(tree, draggedItems, undefined);
    },
    startKeyboardDragOnForeignObject: ({ tree }, dataTransfer) => {
      initiateDrag(tree, undefined, dataTransfer);
    },
    stopKeyboardDrag: ({ tree }) => {
      tree.getDataRef<KDndDataRef>().current.kDndDataTransfer = undefined;
      tree.applySubStateUpdate('dnd', null);
      tree.applySubStateUpdate('assistiveDndState', AssistiveDndState.None);
    },
  },

  hotkeys: {
    startDrag: {
      hotkey: 'Control+Shift+KeyD',
      preventDefault: true,
      isEnabled: (tree) => tree.getState().dnd == null,
      handler: (_, tree) => {
        const selectedItems = tree.getSelectedItems?.() ?? [
          tree.getFocusedItem(),
        ];
        const focusedItem = tree.getFocusedItem();

        tree.startKeyboardDrag(
          selectedItems.includes(focusedItem)
            ? selectedItems
            : selectedItems.concat(focusedItem)
        );
      },
    },
    dragUp: {
      hotkey: 'ArrowUp',
      preventDefault: true,
      isEnabled: (tree) => tree.getState().dnd != null,
      handler: (_, tree) => {
        moveDragPosition(tree, true);
      },
    },
    dragDown: {
      hotkey: 'ArrowDown',
      preventDefault: true,
      isEnabled: (tree) => tree.getState().dnd != null,
      handler: (_, tree) => {
        moveDragPosition(tree, false);
      },
    },
    cancelDrag: {
      hotkey: 'Escape',
      isEnabled: (tree) => tree.getState().dnd != null,
      handler: (_, tree) => {
        tree.stopKeyboardDrag();
      },
    },
    completeDrag: {
      hotkey: 'Enter',
      preventDefault: true,
      isEnabled: (tree) => tree.getState().dnd != null,
      // oxlint-disable-next-line typescript-eslint/no-misused-promises
      handler: async (e, tree) => {
        e.stopPropagation();
        // TODO copied from keyboard onDrop, unify them
        const dataRef = tree.getDataRef<DndDataRef & KDndDataRef>();
        const target = tree.getDragTarget();
        const dataTransfer = dataRef.current.kDndDataTransfer ?? null;

        if (target == null || !canDrop(dataTransfer, target, tree)) {
          return;
        }

        const config = tree.getConfig();
        const draggedItems = tree.getState().dnd?.draggedItems;

        dataRef.current.lastDragCode = undefined;
        tree.applySubStateUpdate('dnd', null);

        if (draggedItems != null) {
          await config.onDrop?.(draggedItems, target);
          tree.getItemInstance(draggedItems[0].getId()).setFocused();
        } else if (dataTransfer != null) {
          await config.onDropForeignDragObject?.(dataTransfer, target);
        }

        tree.applySubStateUpdate(
          'assistiveDndState',
          AssistiveDndState.Completed
        );
      },
    },
  },
};
