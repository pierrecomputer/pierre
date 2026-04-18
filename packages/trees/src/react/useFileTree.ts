'use client';

import { useEffect, useRef } from 'react';

import type { FileTreeOptions } from '../model/types';
import { FileTree } from '../render/FileTree';

export interface UseFileTreeResult {
  model: FileTree;
}

// Creates the model exactly once so React callers have a stable imperative
// runtime. Later option changes are intentionally ignored; callers must use
// explicit model methods like resetPaths and setComposition.
export function useFileTree(options: FileTreeOptions): UseFileTreeResult {
  const modelRef = useRef<FileTree | null>(null);

  modelRef.current ??= new FileTree(options);

  useEffect(() => {
    const model = modelRef.current;
    return () => {
      model?.cleanUp();
      modelRef.current = null;
    };
  }, []);

  return { model: modelRef.current };
}
