import type { DragTarget } from '../../features/drag-and-drop/types';
import type { ItemInstance } from '../types/core';

export const insertItemsAtTarget = async <T>(
  itemIds: string[],
  target: DragTarget<T>,
  onChangeChildren: (
    item: ItemInstance<T>,
    newChildrenIds: string[]
  ) => Promise<void> | void
) => {
  await target.item.getTree().waitForItemChildrenLoaded(target.item.getId());
  const oldChildrenIds = target.item
    .getTree()
    .retrieveChildrenIds(target.item.getId());

  // add moved items to new common parent, if dropped onto parent
  if (!('childIndex' in target)) {
    const newChildren = [...oldChildrenIds, ...itemIds];
    await onChangeChildren(target.item, newChildren);
    if ('updateCachedChildrenIds' in target.item) {
      target.item.updateCachedChildrenIds(newChildren);
    }
    target.item.getTree().rebuildTree();
    return;
  }

  // add moved items to new common parent, if dropped between siblings
  const newChildren = [
    ...oldChildrenIds.slice(0, target.insertionIndex),
    ...itemIds,
    ...oldChildrenIds.slice(target.insertionIndex),
  ];

  await onChangeChildren(target.item, newChildren);

  if ('updateCachedChildrenIds' in target.item) {
    target.item.updateCachedChildrenIds(newChildren);
  }
  target.item.getTree().rebuildTree();
};
