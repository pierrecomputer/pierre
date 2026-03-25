/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import {
  type FeatureImplementation,
  type ItemInstance,
  type TreeInstance,
} from '../../types/core';
import { makeStateUpdater } from '../../utils';
import type { DndDataRef, DragLineData, DragTarget } from './types';
import {
  canDrop,
  getDragCode,
  getDragTarget,
  getTargetPlacement,
  isOrderedDragTarget,
  PlacementType,
  type TargetPlacement,
} from './utils';

const handleAutoOpenFolder = (
  dataRef: { current: DndDataRef },
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  tree: TreeInstance<any>,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  item: ItemInstance<any>,
  placement: TargetPlacement
) => {
  const { openOnDropDelay } = tree.getConfig();
  const dragCode = dataRef.current.lastDragCode;

  if (
    openOnDropDelay == null ||
    openOnDropDelay === 0 ||
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
      dataRef.current.lastAllowDrop !== true
    )
      return;
    item.expand();
  }, openOnDropDelay);
};

const defaultCanDropForeignDragObject = () => false;
export const dragAndDropFeature: FeatureImplementation = {
  key: 'drag-and-drop',

  getDefaultConfig: (defaultConfig, tree) => ({
    canDrop: (_, target) => target.item.isFolder(),
    canDropForeignDragObject: defaultCanDropForeignDragObject,
    canDragForeignDragObjectOver:
      defaultConfig.canDropForeignDragObject !== defaultCanDropForeignDragObject
        ? (dataTransfer) => dataTransfer.effectAllowed !== 'none'
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
    const { windowDragEndListener } = tree.getDataRef<DndDataRef>().current;
    if (windowDragEndListener == null) return;
    window.removeEventListener('dragend', windowDragEndListener);
  },

  treeInstance: {
    getDragTarget: ({ tree }) => {
      return tree.getState().dnd?.dragTarget ?? null;
    },

    getDragLineData: ({ tree }): DragLineData | null => {
      const target = tree.getDragTarget();
      const indent = (target?.item.getItemMeta().level ?? 0) + 1;

      const treeBb = tree.getElement()?.getBoundingClientRect();

      if (target == null || treeBb == null || !isOrderedDragTarget(target))
        return null;

      const leftOffset = target.dragLineLevel * (tree.getConfig().indent ?? 1);
      const targetItem = tree.getItems()[target.dragLineIndex];

      if (targetItem == null) {
        const bb = tree
          .getItems()
          [target.dragLineIndex - 1]?.getElement()
          ?.getBoundingClientRect();

        if (bb != null) {
          return {
            indent,
            top: bb.bottom - treeBb.top,
            left: bb.left + leftOffset - treeBb.left,
            width: bb.width - leftOffset,
          };
        }
      }

      const bb = targetItem?.getElement()?.getBoundingClientRect();

      if (bb != null) {
        return {
          indent,
          top: bb.top - treeBb.top,
          left: bb.left + leftOffset - treeBb.left,
          width: bb.width - leftOffset,
        };
      }

      return null;
    },

    getDragLineStyle: ({ tree }, topOffset = -1, leftOffset = -8) => {
      const dragLine = tree.getDragLineData();
      return dragLine != null
        ? {
            position: 'absolute',
            top: `${dragLine.top + topOffset}px`,
            left: `${dragLine.left + leftOffset}px`,
            width: `${dragLine.width - leftOffset}px`,
            pointerEvents: 'none', // important to prevent capturing drag events
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
          // TODO merge implementation with itemInstance.onDrop
          const dataRef = tree.getDataRef<DndDataRef>();
          // oxlint-disable-next-line typescript-eslint/no-explicit-any
          const target: DragTarget<any> = { item: tree.getRootItem() };

          if (!canDrop(e.dataTransfer, target, tree)) {
            return;
          }

          e.preventDefault();
          const config = tree.getConfig();
          const draggedItems = tree.getState().dnd?.draggedItems;

          dataRef.current.lastDragCode = undefined;

          if (draggedItems != null) {
            await config.onDrop?.(draggedItems, target);
          } else if (e.dataTransfer != null) {
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
    getProps: ({ tree, item, prev }) => ({
      ...prev?.(),

      draggable: true,

      onDragEnter: (e: DragEvent) => e.preventDefault(),

      onDragStart: (e: DragEvent) => {
        const selectedItems =
          tree.getSelectedItems != null
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

        if (config.setDragImage != null) {
          const { imgElement, xOffset, yOffset } = config.setDragImage(items);
          e.dataTransfer?.setDragImage(imgElement, xOffset ?? 0, yOffset ?? 0);
        }

        if (config.createForeignDragObject != null && e.dataTransfer != null) {
          const { format, data, dropEffect, effectAllowed } =
            config.createForeignDragObject(items);
          e.dataTransfer.setData(format, data);

          if (dropEffect != null) e.dataTransfer.dropEffect = dropEffect;
          if (effectAllowed != null)
            e.dataTransfer.effectAllowed = effectAllowed;
        }

        tree.applySubStateUpdate('dnd', {
          draggedItems: items,
          draggingOverItem: tree.getFocusedItem(),
        });
      },

      onDragOver: (e: DragEvent) => {
        e.stopPropagation(); // don't bubble up to container dragover
        const dataRef = tree.getDataRef<DndDataRef>();
        const placement = getTargetPlacement(e, item, tree, true);
        const nextDragCode = getDragCode(item, placement);

        if (nextDragCode === dataRef.current.lastDragCode) {
          if (dataRef.current.lastAllowDrop === true) {
            e.preventDefault();
          }
          return;
        }
        dataRef.current.lastDragCode = nextDragCode;
        dataRef.current.lastDragEnter = Date.now();

        handleAutoOpenFolder(dataRef, tree, item, placement);

        const target = getDragTarget(e, item, tree);

        if (
          tree.getState().dnd?.draggedItems == null &&
          (e.dataTransfer == null ||
            tree
              .getConfig()
              .canDragForeignDragObjectOver?.(e.dataTransfer, target) !== true)
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
          if ((dataRef.current.lastDragEnter ?? 0) + 100 >= Date.now()) return;
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

        if (e.dataTransfer?.dropEffect === 'none' || draggedItems == null) {
          return;
        }

        const target = getDragTarget(e, item, tree);
        if (
          canDragForeignDragObjectOver != null &&
          e.dataTransfer != null &&
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

        if (draggedItems != null) {
          await config.onDrop?.(draggedItems, target);
        } else if (e.dataTransfer != null) {
          await config.onDropForeignDragObject?.(e.dataTransfer, target);
        }
      },
    }),

    isDragTarget: ({ tree, item }) => {
      const target = tree.getDragTarget();
      return target != null ? target.item.getId() === item.getId() : false;
    },

    isUnorderedDragTarget: ({ tree, item }) => {
      const target = tree.getDragTarget();
      return target != null
        ? !isOrderedDragTarget(target) && target.item.getId() === item.getId()
        : false;
    },

    isDragTargetAbove: ({ tree, item }) => {
      const target = tree.getDragTarget();

      if (
        target == null ||
        !isOrderedDragTarget(target) ||
        target.item !== item.getParent()
      )
        return false;
      return target.childIndex === item.getItemMeta().posInSet;
    },

    isDragTargetBelow: ({ tree, item }) => {
      const target = tree.getDragTarget();

      if (
        target == null ||
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
