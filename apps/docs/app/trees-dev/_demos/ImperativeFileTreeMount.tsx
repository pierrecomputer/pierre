'use client';

import { FileTree, type FileTreeOptions } from '@pierre/trees';
import { memo, useEffect, useRef } from 'react';

export const ImperativeFileTreeMount = memo(function ImperativeFileTreeMount({
  height,
  mountId,
  mountMode,
  onTreeReady,
  options,
  payloadHtml = '',
}: {
  height: number;
  mountId: string;
  mountMode: 'hydrate' | 'render';
  onTreeReady?: (tree: FileTree | null) => void;
  options: FileTreeOptions;
  payloadHtml?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!(mount instanceof HTMLDivElement)) {
      return;
    }

    const tree = new FileTree(options);
    if (mountMode === 'hydrate') {
      const existingContainer = mount.querySelector('file-tree-container');
      if (existingContainer instanceof HTMLElement) {
        tree.hydrate({ fileTreeContainer: existingContainer });
      } else {
        mount.innerHTML = '';
        tree.render({ containerWrapper: mount });
      }
    } else {
      mount.innerHTML = '';
      tree.render({ containerWrapper: mount });
    }
    onTreeReady?.(tree);

    return () => {
      tree.cleanUp();
      onTreeReady?.(null);
    };
  }, [mountMode, onTreeReady, options]);

  return (
    <div
      id={mountId}
      ref={mountRef}
      data-file-tree-imperative-mount={mountMode}
      style={{ height: `${String(height)}px` }}
      dangerouslySetInnerHTML={
        mountMode === 'hydrate' ? { __html: payloadHtml } : undefined
      }
      suppressHydrationWarning
    />
  );
});
