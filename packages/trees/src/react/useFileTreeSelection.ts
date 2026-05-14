'use client';

import type { FileTreeModel } from '../model/publicTypes';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

export function useFileTreeSelection(model: FileTreeModel): readonly string[] {
  return useFileTreeSelector(
    model,
    (currentModel) => currentModel.getSelectedPaths(),
    areArraysEqual
  );
}
