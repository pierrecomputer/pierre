import { getCurrentScope, markRaw, onScopeDispose } from 'vue';

import type { FileTreeOptions } from '../model/publicTypes';
import { FileTree } from '../render/FileTree';

export interface UseFileTreeResult {
  model: FileTree;
}

export function useFileTree(options: FileTreeOptions): UseFileTreeResult {
  const model = markRaw(new FileTree(options));

  if (getCurrentScope() != null) {
    onScopeDispose(() => {
      model.cleanUp();
    });
  }

  return { model };
}
