import type { ShallowRef } from 'vue';
import { computed, toRaw } from 'vue';
import type { ComputedRef } from 'vue';

import type { FileTree } from '../render/FileTree';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

interface FileTreeSearchSnapshot {
  isOpen: boolean;
  matchingPaths: readonly string[];
  value: string;
}

export interface FileTreeSearchState {
  close: () => void;
  focusNextMatch: () => void;
  focusPreviousMatch: () => void;
  isOpen: ComputedRef<boolean>;
  matchingPaths: ComputedRef<readonly string[]>;
  open: (initialValue?: string) => void;
  setValue: (value: string | null) => void;
  snapshot: ShallowRef<FileTreeSearchSnapshot>;
  value: ComputedRef<string>;
}

function areSearchSnapshotsEqual(
  previous: FileTreeSearchSnapshot,
  next: FileTreeSearchSnapshot
): boolean {
  return (
    previous.isOpen === next.isOpen &&
    previous.value === next.value &&
    areArraysEqual(previous.matchingPaths, next.matchingPaths)
  );
}

export function useFileTreeSearch(model: FileTree): FileTreeSearchState {
  const rawModel = toRaw(model);
  const snapshot = useFileTreeSelector(
    rawModel,
    (currentModel): FileTreeSearchSnapshot => ({
      isOpen: currentModel.isSearchOpen(),
      matchingPaths: currentModel.getSearchMatchingPaths(),
      value: currentModel.getSearchValue(),
    }),
    areSearchSnapshotsEqual
  );

  return {
    close: () => {
      rawModel.closeSearch();
    },
    focusNextMatch: () => {
      rawModel.focusNextSearchMatch();
    },
    focusPreviousMatch: () => {
      rawModel.focusPreviousSearchMatch();
    },
    isOpen: computed(() => snapshot.value.isOpen),
    matchingPaths: computed(() => snapshot.value.matchingPaths),
    open: (initialValue?: string) => {
      rawModel.openSearch(initialValue);
    },
    setValue: (value: string | null) => {
      rawModel.setSearch(value);
    },
    snapshot,
    value: computed(() => snapshot.value.value),
  };
}
