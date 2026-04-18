'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

import type { FileTree } from '../render/FileTree';

export type FileTreeSelector<TSelected> = (model: FileTree) => TSelected;
export type FileTreeSelectorEquality<TSelected> = (
  previous: TSelected,
  next: TSelected
) => boolean;

interface SelectorCache<TSelected> {
  hasValue: boolean;
  model: FileTree | null;
  selector: FileTreeSelector<TSelected> | null;
  value: TSelected | undefined;
}

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

// Bridges the imperative tree model into React with a cached selected snapshot.
// We reset the cache when the model or selector identity changes so
// useSyncExternalStore can compare stable values across real store updates.

export function useFileTreeSelector<TSelected>(
  model: FileTree,
  selector: FileTreeSelector<TSelected>,
  isEqual?: FileTreeSelectorEquality<TSelected>
): TSelected {
  const cacheRef = useRef<SelectorCache<TSelected>>({
    hasValue: false,
    model: null,
    selector: null,
    value: undefined,
  });

  const subscribe = useCallback(
    (listener: () => void) => model.subscribe(listener),
    [model]
  );

  const getSnapshot = useCallback((): TSelected => {
    const cache = cacheRef.current;
    const nextValue = selector(model);
    const selectorChanged =
      cache.model !== model || cache.selector !== selector;

    if (selectorChanged || !cache.hasValue) {
      cache.hasValue = true;
      cache.model = model;
      cache.selector = selector;
      cache.value = nextValue;
      return nextValue;
    }

    const previousValue = cache.value as TSelected;
    if (areSelectedValuesEqual(previousValue, nextValue, isEqual)) {
      return previousValue;
    }

    cache.value = nextValue;
    return nextValue;
  }, [isEqual, model, selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
