'use client';

import type { PathStoreFileTree } from '../file-tree';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

export function useFileTreeSelection(
  model: PathStoreFileTree
): readonly string[] {
  return useFileTreeSelector(
    model,
    (currentModel) => currentModel.getSelectedPaths(),
    areArraysEqual
  );
}
