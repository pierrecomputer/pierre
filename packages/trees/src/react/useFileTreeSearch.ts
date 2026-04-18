'use client';

import { useMemo } from 'react';

import type { FileTree } from '../render/FileTree';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

interface FileTreeSearchSnapshot {
  isOpen: boolean;
  matchingPaths: readonly string[];
  value: string;
}

export interface FileTreeSearchState extends FileTreeSearchSnapshot {
  close: () => void;
  focusNextMatch: () => void;
  focusPreviousMatch: () => void;
  open: (initialValue?: string) => void;
  setValue: (value: string | null) => void;
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
  const snapshot = useFileTreeSelector(
    model,
    (currentModel): FileTreeSearchSnapshot => ({
      isOpen: currentModel.isSearchOpen(),
      matchingPaths: currentModel.getSearchMatchingPaths(),
      value: currentModel.getSearchValue(),
    }),
    areSearchSnapshotsEqual
  );

  return useMemo(
    () => ({
      ...snapshot,
      close: () => {
        model.closeSearch();
      },
      focusNextMatch: () => {
        model.focusNextSearchMatch();
      },
      focusPreviousMatch: () => {
        model.focusPreviousSearchMatch();
      },
      open: (initialValue?: string) => {
        model.openSearch(initialValue);
      },
      setValue: (value: string | null) => {
        model.setSearch(value);
      },
    }),
    [model, snapshot]
  );
}
