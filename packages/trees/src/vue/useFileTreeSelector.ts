import { getCurrentScope, onScopeDispose, shallowRef, toRaw } from 'vue';
import type { ShallowRef } from 'vue';

import type { FileTree } from '../render/FileTree';

export type FileTreeSelector<TSelected> = (model: FileTree) => TSelected;
export type FileTreeSelectorEquality<TSelected> = (
  previous: TSelected,
  next: TSelected
) => boolean;

export function areArraysEqual<TValue>(
  previous: readonly TValue[],
  next: readonly TValue[]
): boolean {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (!Object.is(previous[index], next[index])) {
      return false;
    }
  }

  return true;
}

function areSelectedValuesEqual<TSelected>(
  previous: TSelected,
  next: TSelected,
  isEqual?: FileTreeSelectorEquality<TSelected>
): boolean {
  return Object.is(previous, next) || isEqual?.(previous, next) === true;
}

export function useFileTreeSelector<TSelected>(
  model: FileTree,
  selector: FileTreeSelector<TSelected>,
  isEqual?: FileTreeSelectorEquality<TSelected>
): ShallowRef<TSelected> {
  const rawModel = toRaw(model);
  const selected = shallowRef(selector(rawModel)) as ShallowRef<TSelected>;
  const unsubscribe = rawModel.subscribe(() => {
    const nextValue = selector(rawModel);
    if (areSelectedValuesEqual(selected.value, nextValue, isEqual)) {
      return;
    }

    selected.value = nextValue;
  });

  if (getCurrentScope() != null) {
    onScopeDispose(unsubscribe);
  }

  return selected;
}
