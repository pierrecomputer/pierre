import type { TreeInstance } from '../../core/types/core';
import type { ItemMeta } from './types';

interface VisibleItemTraversalNode {
  itemId: string;
  parentId: string;
  level: number;
  posInSet: number;
  setSize: number;
}

export interface PackedVisibleItemMeta {
  indexById: Record<string, number | undefined>;
  levels: number[];
  parentIds: string[];
  posInSet: number[];
  setSizes: number[];
  visibleItemIds: string[];
}

// Builds the visible tree order and item metadata in one iterative traversal so
// the core rebuild path can fill its packed lookup store without a second pass.
export function buildPackedVisibleItemMeta<T>(
  tree: Pick<TreeInstance<T>, 'getConfig' | 'getState' | 'retrieveChildrenIds'>
): PackedVisibleItemMeta {
  const { rootItemId } = tree.getConfig();
  const { expandedItems } = tree.getState();
  const expandedLookup = Object.create(null) as Record<
    string,
    true | undefined
  >;
  for (let index = 0; index < expandedItems.length; index++) {
    expandedLookup[expandedItems[index]] = true;
  }

  const rootChildren = tree.retrieveChildrenIds(rootItemId) ?? [];
  const stack: VisibleItemTraversalNode[] = [];
  const visibleItemIds: string[] = [];
  const parentIds: string[] = [];
  const levels: number[] = [];
  const setSizes: number[] = [];
  const posInSet: number[] = [];
  const indexById = Object.create(null) as Record<string, number | undefined>;
  let visibleIndex = 0;

  for (
    let childIndex = rootChildren.length - 1;
    childIndex >= 0;
    childIndex--
  ) {
    stack.push({
      itemId: rootChildren[childIndex],
      parentId: rootItemId,
      level: 0,
      setSize: rootChildren.length,
      posInSet: childIndex,
    });
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    visibleItemIds[visibleIndex] = current.itemId;
    parentIds[visibleIndex] = current.parentId;
    levels[visibleIndex] = current.level;
    setSizes[visibleIndex] = current.setSize;
    posInSet[visibleIndex] = current.posInSet;
    indexById[current.itemId] = visibleIndex;
    visibleIndex += 1;

    if (expandedLookup[current.itemId] !== true) {
      continue;
    }

    const children = tree.retrieveChildrenIds(current.itemId) ?? [];
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex--) {
      stack.push({
        itemId: children[childIndex],
        parentId: current.itemId,
        level: current.level + 1,
        setSize: children.length,
        posInSet: childIndex,
      });
    }
  }

  return {
    indexById,
    levels,
    parentIds,
    posInSet,
    setSizes,
    visibleItemIds,
  };
}

export function collectVisibleItemMeta<T>(
  tree: Pick<TreeInstance<T>, 'getConfig' | 'getState' | 'retrieveChildrenIds'>
): ItemMeta[] {
  const packed = buildPackedVisibleItemMeta(tree);
  const flatItems = new Array<ItemMeta>(packed.visibleItemIds.length);

  for (let index = 0; index < packed.visibleItemIds.length; index++) {
    flatItems[index] = {
      itemId: packed.visibleItemIds[index],
      parentId: packed.parentIds[index],
      level: packed.levels[index] ?? -1,
      index,
      setSize: packed.setSizes[index] ?? 1,
      posInSet: packed.posInSet[index] ?? 0,
    };
  }

  return flatItems;
}
