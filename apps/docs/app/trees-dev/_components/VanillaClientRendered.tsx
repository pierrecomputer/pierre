'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { useCallback, useRef } from 'react';

/**
 * Vanilla FileTree - Client-Side Rendered
 * Uses ref callback to create and render FileTree instance on client mount
 */
export function VanillaClientRendered({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        node.innerHTML = '';
      }

      const fileTree = new FileTree(options, stateConfig);
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig]
  );

  return <div ref={ref} />;
}
