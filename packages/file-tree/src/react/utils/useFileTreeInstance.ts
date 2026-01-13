import { useEffect, useLayoutEffect, useRef } from 'react';

import { FileTree, type FileTreeOptions } from '../../components/FileTree';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileTreeInstanceProps<T> {
  options: FileTreeOptions<T>;
  forceClientRender?: boolean;
  prerenderedHTML: string | undefined;
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void;
}

export function useFileTreeInstance<T>({
  options,
  forceClientRender,
  prerenderedHTML,
}: UseFileTreeInstanceProps<T>): UseFileTreeInstanceReturn {
  const instanceRef = useRef<FileTree<T> | null>(null);
  const ref = useStableCallback((fileTreeContainer: HTMLElement | null) => {
    if (fileTreeContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      // TODO: switch to a more robust way of quickly grabbing this specific element
      const existingFileTreeId = (
        fileTreeContainer.shadowRoot?.children[1] as HTMLElement | undefined
      )?.dataset?.fileTreeId;
      if (!existingFileTreeId) {
        throw new Error(
          'useFileTreeInstance: No file tree id found in the container'
        );
      }
      instanceRef.current = new FileTree({
        ...options,
        id: existingFileTreeId ?? undefined,
      });
      void instanceRef.current.hydrate({
        fileTreeContainer,
        prerenderedHTML,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useFileTreeInstance: A FileTree instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const instance = instanceRef.current;
    instance.setOptions(options);
    if (forceClientRender === true) {
      void instance.render({});
    }
  });

  return { ref };
}
