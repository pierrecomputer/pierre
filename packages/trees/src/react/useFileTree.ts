'use client';

import { useEffect, useRef, useState } from 'react';

import type { FileTreeOptions } from '../model/publicTypes';
import { FileTree } from '../render/FileTree';

interface CleanUpRef {
  timeout: ReturnType<typeof setTimeout> | null;
  model: FileTree;
}

export interface UseFileTreeResult {
  model: FileTree;
}

// Creates the model exactly once so React callers have a stable imperative
// runtime. Later option changes are intentionally ignored; callers must use
// explicit model methods like resetPaths and setComposition.
export function useFileTree(options: FileTreeOptions): UseFileTreeResult {
  const [model] = useState(() => new FileTree(options));
  const cleanUpRef = useRef<CleanUpRef>({ timeout: null, model });
  useEffect(() => {
    const { current } = cleanUpRef;
    // NOTE(amadeus): This is designed to ensure strict mode doesn't blow away
    // our instance -- we wait a cycle to clean up
    if (current.timeout != null) {
      clearTimeout(current.timeout);
      current.timeout = null;
    }
    return () => {
      current.timeout = setTimeout(() => current.model.cleanUp(), 1);
    };
  }, []);
  return { model };
}
