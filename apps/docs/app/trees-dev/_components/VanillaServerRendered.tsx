'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import '@pierre/trees/web-components';
import { useCallback, useRef } from 'react';

/**
 * Vanilla FileTree - Server-Side Rendered
 * Uses declarative shadow DOM to prerender HTML, then hydrates with FileTree instance.
 * The preloadFileTree() `html` output is injected into a wrapper div — the consumer
 * doesn't need to know about <file-tree-container> or <template shadowrootmode>.
 */
export function VanillaServerRendered({
  options,
  stateConfig,
  containerHtml,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        // Clear the shadow root content for re-render
        const shadowRoot = fileTreeContainer.shadowRoot;
        if (shadowRoot !== null) {
          const treeElement = Array.from(shadowRoot.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.dataset?.fileTreeId != null
          );
          treeElement?.replaceChildren();
        }
      }

      const fileTree = new FileTree(options, stateConfig);

      if (!hasHydratedRef.current) {
        // Initial mount - hydrate the prerendered HTML
        fileTree.hydrate({
          fileTreeContainer,
        });
        hasHydratedRef.current = true;
      } else {
        // Options changed - re-render
        fileTree.render({ fileTreeContainer });
      }

      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig]
  );

  return (
    <div
      ref={ref}
      dangerouslySetInnerHTML={{ __html: containerHtml }}
      suppressHydrationWarning
    />
  );
}
