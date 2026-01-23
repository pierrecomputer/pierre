import { useCallback, useRef } from 'react';

import { FileTree, type FileTreeOptions } from '../../FileTree';

interface UseFileTreeInstanceProps {
  options: FileTreeOptions;
  prerenderedHTML: string | undefined;
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void;
}

export function useFileTreeInstance({
  options,
  prerenderedHTML,
}: UseFileTreeInstanceProps): UseFileTreeInstanceReturn {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<FileTree | null>(null);

  // Ref callback that handles mount/unmount and re-runs when options change.
  // By including options in the dependency array, the callback identity changes
  // when options change, causing React to call cleanup then re-invoke with the
  // same DOM node - allowing us to detect and handle options changes.
  //
  // React 19: Return cleanup function, called when ref changes or element unmounts.
  const ref = useCallback(
    (fileTreeContainer: HTMLElement | null) => {
      if (fileTreeContainer == null) {
        return;
      }

      const getExistingFileTreeId = (): string | undefined => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        return fileTreeElement?.dataset?.fileTreeId;
      };

      const clearExistingFileTree = (): void => {
        const children = Array.from(
          fileTreeContainer.shadowRoot?.children ?? []
        );
        const fileTreeElement = children.find(
          (child: Element): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset?.fileTreeId != null &&
            child.dataset.fileTreeId.length > 0
        );
        if (fileTreeElement != null) {
          fileTreeElement.replaceChildren();
        }
      };

      const createInstance = (existingId?: string): FileTree => {
        return new FileTree({
          ...options,
          id: existingId,
        });
      };

      const existingFileTreeId = getExistingFileTreeId();

      // Check if this is a re-run due to options change (same container, but new callback identity)
      const isOptionsChange =
        containerRef.current === fileTreeContainer &&
        instanceRef.current != null;

      if (isOptionsChange) {
        // Options changed - clean up and re-create instance
        instanceRef.current?.cleanUp();
        clearExistingFileTree();
        instanceRef.current = createInstance(existingFileTreeId);
        void instanceRef.current.render({ fileTreeContainer });
      } else {
        // Initial mount
        containerRef.current = fileTreeContainer;

        // Check if we have prerendered HTML to hydrate
        const hasPrerenderedContent =
          prerenderedHTML != null && existingFileTreeId != null;

        instanceRef.current = createInstance(existingFileTreeId);

        if (hasPrerenderedContent) {
          // SSR: hydrate the prerendered HTML
          void instanceRef.current.hydrate({
            fileTreeContainer,
            prerenderedHTML,
          });
        } else {
          // CSR: render from scratch
          void instanceRef.current.render({ fileTreeContainer });
        }
      }

      return () => {
        instanceRef.current?.cleanUp();
        instanceRef.current = null;
        containerRef.current = null;
      };
    },
    [options, prerenderedHTML]
  );

  return { ref };
}
