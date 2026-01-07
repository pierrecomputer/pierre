import { useEffect, useLayoutEffect, useRef } from 'react';

import { FileTree, type FileTreeOptions } from '../../components/FileTree';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileTreeInstanceProps<T> {
  options: FileTreeOptions<T>;
  prerenderedHTML: string | undefined;
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void;
}

export function useFileTreeInstance<T>({
  options,
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
      // FIXME: Ideally we don't use FileDiffUI here, and instead amalgamate
      // the renderers manually
      instanceRef.current = new FileTree(options);
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
    void instance.render({});
  });

  return { ref };
}
