'use client';

import type { FileTree } from '../render/FileTree';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

export function useFileTreeSelection(model: FileTree): readonly string[] {
  return useFileTreeSelector(
    model,
    (currentModel) => currentModel.getSelectedPaths(),
    areArraysEqual
  );
}
