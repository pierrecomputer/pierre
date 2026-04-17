'use client';

import { useEffect, useRef } from 'react';

import { PathStoreFileTree } from '../file-tree';
import type { PathStoreFileTreeOptions } from '../types';

export interface UseFileTreeResult {
  model: PathStoreFileTree;
}

// Creates the model exactly once so React callers have a stable imperative
// runtime. Later option changes are intentionally ignored; callers must use
// explicit model methods like resetPaths and setComposition.
export function useFileTree(
  options: PathStoreFileTreeOptions
): UseFileTreeResult {
  const modelRef = useRef<PathStoreFileTree | null>(null);

  modelRef.current ??= new PathStoreFileTree(options);

  useEffect(() => {
    const model = modelRef.current;
    return () => {
      model?.cleanUp();
      modelRef.current = null;
    };
  }, []);

  return { model: modelRef.current };
}
