/* oxlint-disable typescript-eslint/no-unsafe-return */
import type { DragTarget } from '../../features/drag-and-drop/types';
import type { ItemInstance } from '../types/core';
import { insertItemsAtTarget } from './insert-items-at-target';
import { removeItemsFromParents } from './remove-items-from-parents';

export const createOnDropHandler =
  <T>(
    onChangeChildren: (item: ItemInstance<T>, newChildren: string[]) => void
  ) =>
  async (items: ItemInstance<T>[], target: DragTarget<T>) => {
    const itemIds = items.map((item) => item.getId());
    await removeItemsFromParents(items, onChangeChildren);
    await insertItemsAtTarget(itemIds, target, onChangeChildren);
  };
