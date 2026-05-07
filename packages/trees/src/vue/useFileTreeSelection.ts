import type { ShallowRef } from 'vue';

import type { FileTree } from '../render/FileTree';
import { areArraysEqual, useFileTreeSelector } from './useFileTreeSelector';

export function useFileTreeSelection(
  model: FileTree
): ShallowRef<readonly string[]> {
  return useFileTreeSelector(
    model,
    (currentModel) => currentModel.getSelectedPaths(),
    areArraysEqual
  );
}
