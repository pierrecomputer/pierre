'use client';

import { FileTree } from '@pierre/file-tree';
import { useEffect, useRef } from 'react';

export function ClientPage() {
  const isRendered = useRef(false);
  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;
    const fileTree = new FileTree();
    fileTree.render({
      containerWrapper:
        document.getElementById('test-file-tree-elem') ?? undefined,
    });
  }, []);

  return null;
}
