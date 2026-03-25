/* oxlint-disable typescript-eslint/no-unsafe-return, typescript-eslint/strict-boolean-expressions */
import type { ItemInstance, TreeInstance } from '../../types/core';
import type { DragTarget } from './types';

export enum ItemDropCategory {
  Item,
  ExpandedFolder,
  LastInGroup,
}

export enum PlacementType {
  ReorderAbove,
  ReorderBelow,
  MakeChild,
  Reparent,
}

export type TargetPlacement =
  | {
      type:
        | PlacementType.ReorderAbove
        | PlacementType.ReorderBelow
        | PlacementType.MakeChild;
    }
  | {
      type: PlacementType.Reparent;
      reparentLevel: number;
    };

export const isOrderedDragTarget = <T>(dragTarget: DragTarget<T>) =>
  'childIndex' in dragTarget;

export const canDrop = (
  dataTransfer: DataTransfer | null,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  target: DragTarget<any>,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  tree: TreeInstance<any>
) => {
  const draggedItems = tree.getState().dnd?.draggedItems;
  const config = tree.getConfig();

  if (
    draggedItems != null &&
    !(config.canDrop?.(draggedItems, target) ?? true)
  ) {
    return false;
  }

  if (
    draggedItems != null &&
    draggedItems.some(
      (draggedItem) =>
        target.item.getId() === draggedItem.getId() ||
        target.item.isDescendentOf(draggedItem.getId())
    )
  ) {
    return false;
  }

  if (
    draggedItems == null &&
    dataTransfer != null &&
    config.canDropForeignDragObject != null &&
    !config.canDropForeignDragObject(dataTransfer, target)
  ) {
    return false;
  }

  return true;
};

// oxlint-disable-next-line typescript-eslint/no-explicit-any
export const getItemDropCategory = (item: ItemInstance<any>) => {
  if (item.isExpanded()) {
    return ItemDropCategory.ExpandedFolder;
  }

  const parent = item.getParent();
  if (
    parent != null &&
    item.getIndexInParent() === item.getItemMeta().setSize - 1
  ) {
    return ItemDropCategory.LastInGroup;
  }

  return ItemDropCategory.Item;
};

export const getInsertionIndex = <T>(
  children: ItemInstance<T>[],
  childIndex: number,
  draggedItems: ItemInstance<T>[] | undefined
) => {
  const numberOfDragItemsBeforeTarget =
    children
      .slice(0, childIndex)
      .reduce(
        (counter, child) =>
          draggedItems?.some((i) => i.getId() === child.getId()) === true
            ? ++counter
            : counter,
        0
      ) ?? 0;
  return childIndex - numberOfDragItemsBeforeTarget;
};

export const getTargetPlacement = (
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  e: any,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  item: ItemInstance<any>,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  tree: TreeInstance<any>,
  canMakeChild: boolean
): TargetPlacement => {
  const config = tree.getConfig();

  if (config.canReorder !== true) {
    return canMakeChild
      ? { type: PlacementType.MakeChild }
      : { type: PlacementType.ReorderBelow };
  }

  const bb = item.getElement()?.getBoundingClientRect();
  const topPercent = bb ? (e.clientY - bb.top) / bb.height : 0.5;
  const leftPixels = bb ? e.clientX - bb.left : 0;
  const targetDropCategory = getItemDropCategory(item);
  const reorderAreaPercentage = !canMakeChild
    ? 0.5
    : (config.reorderAreaPercentage ?? 0.3);
  const indent = config.indent ?? 20;
  const makeChildType = canMakeChild
    ? PlacementType.MakeChild
    : PlacementType.ReorderBelow;

  if (targetDropCategory === ItemDropCategory.ExpandedFolder) {
    if (topPercent < reorderAreaPercentage) {
      return { type: PlacementType.ReorderAbove };
    }
    return { type: makeChildType };
  }

  if (targetDropCategory === ItemDropCategory.LastInGroup) {
    if (leftPixels < item.getItemMeta().level * indent) {
      if (topPercent < 0.5) {
        return { type: PlacementType.ReorderAbove };
      }
      const minLevel = item.getItemBelow()?.getItemMeta().level ?? 0;
      return {
        type: PlacementType.Reparent,
        reparentLevel: Math.max(minLevel, Math.floor(leftPixels / indent)),
      };
    }
    // if not at left of item area, treat as if it was a normal item
  }

  // targetDropCategory === ItemDropCategory.Item
  if (topPercent < reorderAreaPercentage) {
    return { type: PlacementType.ReorderAbove };
  }
  if (topPercent > 1 - reorderAreaPercentage) {
    return { type: PlacementType.ReorderBelow };
  }
  return { type: makeChildType };
};

export const getDragCode = (
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  item: ItemInstance<any>,
  placement: TargetPlacement
) => {
  return [
    item.getId(),
    placement.type,
    placement.type === PlacementType.Reparent ? placement.reparentLevel : 0,
  ].join('__');
};

const getNthParent = (
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  item: ItemInstance<any>,
  n: number
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
): ItemInstance<any> => {
  if (n === item.getItemMeta().level) {
    return item;
  }
  return getNthParent(item.getParent()!, n);
};

/** @param item refers to the bottom-most item of the container, at which bottom is being reparented on (e.g. root-1-2-6)  */
export const getReparentTarget = <T>(
  item: ItemInstance<T>,
  reparentLevel: number,
  draggedItems: ItemInstance<T>[] | undefined
) => {
  const itemMeta = item.getItemMeta();
  const reparentedTarget = getNthParent(item, reparentLevel - 1);
  const targetItemAbove = getNthParent(item, reparentLevel); // .getItemBelow()!;
  const targetIndex = targetItemAbove.getIndexInParent() + 1;

  return {
    item: reparentedTarget,
    childIndex: targetIndex,
    insertionIndex: getInsertionIndex(
      reparentedTarget.getChildren(),
      targetIndex,
      draggedItems
    ),
    dragLineIndex: itemMeta.index + 1,
    dragLineLevel: reparentLevel,
  };
};

export const getDragTarget = (
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  e: any,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  item: ItemInstance<any>,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  tree: TreeInstance<any>,
  canReorder = tree.getConfig().canReorder
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
): DragTarget<any> => {
  const draggedItems = tree.getState().dnd?.draggedItems;
  const itemMeta = item.getItemMeta();
  const parent = item.getParent();
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const itemTarget: DragTarget<any> = { item };
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const parentTarget: DragTarget<any> | null =
    parent != null ? { item: parent } : null;
  const canBecomeSibling =
    parentTarget != null && canDrop(e.dataTransfer, parentTarget, tree);

  const canMakeChild = canDrop(e.dataTransfer, itemTarget, tree);
  const placement = getTargetPlacement(e, item, tree, canMakeChild);

  if (
    canReorder !== true &&
    parent != null &&
    canBecomeSibling &&
    placement.type !== PlacementType.MakeChild
  ) {
    if (
      draggedItems?.some((item) => item.isDescendentOf(parent.getId())) === true
    ) {
      // dropping on itself should be illegal, return item, canDrop will then return false
      return itemTarget;
    }
    return parentTarget;
  }

  if (canReorder !== true && parent != null && !canBecomeSibling) {
    // TODO! this breaks in story DND/Can Drop. Maybe move this logic into a composable DragTargetStrategy[] ?
    return getDragTarget(e, parent, tree, false);
  }

  if (parent == null) {
    // Shouldn't happen, but if dropped "next" to root item, just drop it inside
    return itemTarget;
  }

  if (placement.type === PlacementType.MakeChild) {
    return itemTarget;
  }

  if (!canBecomeSibling) {
    return getDragTarget(e, parent, tree, false);
  }

  if (placement.type === PlacementType.Reparent) {
    return getReparentTarget(item, placement.reparentLevel, draggedItems);
  }

  const maybeAddOneForBelow =
    placement.type === PlacementType.ReorderAbove ? 0 : 1;
  const childIndex = item.getIndexInParent() + maybeAddOneForBelow;

  return {
    item: parent,
    dragLineIndex: itemMeta.index + maybeAddOneForBelow,
    dragLineLevel: itemMeta.level,
    childIndex,
    // TODO performance could be improved by computing this only when dragcode changed
    insertionIndex: getInsertionIndex(
      parent.getChildren(),
      childIndex,
      draggedItems
    ),
  };
};
