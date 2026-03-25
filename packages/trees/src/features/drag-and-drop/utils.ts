/* oxlint-disable typescript-oxlint/strict-boolean-expressions -- Ported from @headless-tree/core internals */
import type { ItemInstance, TreeInstance } from '../../core/types/core';
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

export const isOrderedDragTarget = <T>(
  dragTarget: DragTarget<T>
): dragTarget is DragTarget<T> & {
  childIndex: number;
  insertionIndex: number;
  dragLineIndex: number;
  dragLineLevel: number;
} => 'childIndex' in dragTarget;

export const canDrop = (
  dataTransfer: DataTransfer | null,
  target: DragTarget<unknown>,
  tree: TreeInstance<unknown>
): boolean => {
  const draggedItems = tree.getState().dnd?.draggedItems;
  const config = tree.getConfig();

  if (draggedItems && !(config.canDrop?.(draggedItems, target) ?? true)) {
    return false;
  }

  if (
    draggedItems &&
    draggedItems.some(
      (draggedItem) =>
        target.item.getId() === draggedItem.getId() ||
        target.item.isDescendentOf(draggedItem.getId())
    )
  ) {
    return false;
  }

  if (
    !draggedItems &&
    dataTransfer &&
    config.canDropForeignDragObject &&
    !config.canDropForeignDragObject(dataTransfer, target)
  ) {
    return false;
  }

  return true;
};

export const getItemDropCategory = (
  item: ItemInstance<unknown>
): ItemDropCategory => {
  if (item.isExpanded()) {
    return ItemDropCategory.ExpandedFolder;
  }

  const parent = item.getParent();
  if (parent && item.getIndexInParent() === item.getItemMeta().setSize - 1) {
    return ItemDropCategory.LastInGroup;
  }

  return ItemDropCategory.Item;
};

export const getInsertionIndex = <T>(
  children: ItemInstance<T>[],
  childIndex: number,
  draggedItems: ItemInstance<T>[] | undefined
): number => {
  if (!draggedItems || draggedItems.length === 0) {
    return childIndex;
  }

  const draggedIds = new Set<string>();
  for (const draggedItem of draggedItems) {
    draggedIds.add(draggedItem.getId());
  }

  const endIndex = Math.min(childIndex, children.length);
  let numberOfDragItemsBeforeTarget = 0;
  for (let i = 0; i < endIndex; i++) {
    if (draggedIds.has(children[i].getId())) {
      numberOfDragItemsBeforeTarget++;
    }
  }

  return childIndex - numberOfDragItemsBeforeTarget;
};

// oxlint-disable-next-line @typescript-oxlint/no-explicit-any
export const getTargetPlacement = (
  e: { clientX: number; clientY: number },
  item: ItemInstance<unknown>,
  tree: TreeInstance<unknown>,
  canMakeChild: boolean
): TargetPlacement => {
  const config = tree.getConfig();

  if (!config.canReorder) {
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
  item: ItemInstance<unknown>,
  placement: TargetPlacement
): string => {
  return [
    item.getId(),
    placement.type,
    placement.type === PlacementType.Reparent ? placement.reparentLevel : 0,
  ].join('__');
};

const getNthParent = <T>(item: ItemInstance<T>, n: number): ItemInstance<T> => {
  if (n === item.getItemMeta().level) {
    return item;
  }
  return getNthParent(item.getParent()!, n);
};

export const getReparentTarget = <T>(
  item: ItemInstance<T>,
  reparentLevel: number,
  draggedItems: ItemInstance<T>[] | undefined
): DragTarget<T> => {
  const itemMeta = item.getItemMeta();
  const reparentedTarget = getNthParent(item, reparentLevel - 1);
  const targetItemAbove = getNthParent(item, reparentLevel);
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
  e: { clientX: number; clientY: number; dataTransfer?: DataTransfer | null },
  item: ItemInstance<unknown>,
  tree: TreeInstance<unknown>,
  canReorder = tree.getConfig().canReorder
): DragTarget<unknown> => {
  const draggedItems = tree.getState().dnd?.draggedItems;
  const parent = item.getParent();
  const itemTarget: DragTarget<unknown> = { item };
  const parentTarget: DragTarget<unknown> | null = parent
    ? { item: parent }
    : null;
  const canBecomeSibling =
    parentTarget && canDrop(e.dataTransfer ?? null, parentTarget, tree);

  const canMakeChild = canDrop(e.dataTransfer ?? null, itemTarget, tree);
  const placement = getTargetPlacement(e, item, tree, canMakeChild);

  if (
    !canReorder &&
    parent &&
    canBecomeSibling &&
    placement.type !== PlacementType.MakeChild
  ) {
    if (
      draggedItems?.some(
        (draggedItem) =>
          item.getId() === draggedItem.getId() ||
          item.isDescendentOf(draggedItem.getId())
      )
    ) {
      return itemTarget;
    }
    return parentTarget as DragTarget<unknown>;
  }

  if (!canReorder && parent && !canBecomeSibling) {
    return getDragTarget(e, parent, tree, false);
  }

  if (!parent) {
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
  const itemMeta = item.getItemMeta();

  return {
    item: parent,
    dragLineIndex: itemMeta.index + maybeAddOneForBelow,
    dragLineLevel: itemMeta.level,
    childIndex,
    insertionIndex: getInsertionIndex(
      parent.getChildren(),
      childIndex,
      draggedItems
    ),
  };
};
