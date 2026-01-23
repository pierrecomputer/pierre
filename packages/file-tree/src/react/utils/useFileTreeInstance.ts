import { useEffect, useLayoutEffect, useRef } from 'react';

import { FileTree, type FileTreeOptions } from '../../FileTree';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileTreeInstanceProps {
  options: FileTreeOptions;
  forceClientRender?: boolean;
  prerenderedHTML: string | undefined;
}

interface UseFileTreeInstanceReturn {
  ref(node: HTMLElement | null): void;
}

export function useFileTreeInstance({
  options,
  forceClientRender,
  prerenderedHTML,
}: UseFileTreeInstanceProps): UseFileTreeInstanceReturn {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<FileTree | null>(null);
  const previousOptionsRef = useRef<FileTreeOptions | null>(null);
  const hasRenderedRef = useRef(false);

  const getExistingFileTreeId = (fileTreeContainer: HTMLElement): string => {
    const children = Array.from(fileTreeContainer.shadowRoot?.children ?? []);
    const fileTreeElement = children.find(
      (child: Element): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.dataset?.fileTreeId != null &&
        child.dataset.fileTreeId.length > 0
    );
    if (fileTreeElement == null) {
      throw new Error(
        'useFileTreeInstance: No file tree element found in the container'
      );
    }
    // TODO: switch to a more robust way of quickly grabbing this specific element
    const existingFileTreeId = fileTreeElement?.dataset?.fileTreeId;
    if (!existingFileTreeId) {
      throw new Error(
        'useFileTreeInstance: No file tree id found in the container'
      );
    }
    return existingFileTreeId;
  };

  const clearExistingFileTree = (fileTreeContainer: HTMLElement): void => {
    const children = Array.from(fileTreeContainer.shadowRoot?.children ?? []);
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

  const createInstance = (fileTreeContainer: HTMLElement): FileTree => {
    const existingFileTreeId = getExistingFileTreeId(fileTreeContainer);
    const instance = new FileTree({
      ...options,
      id: existingFileTreeId ?? undefined,
    });
    return instance;
  };

  // TODO: pull this out and make it harder to forget to update
  const areOptionsEqual = (
    left: FileTreeOptions,
    right: FileTreeOptions
  ): boolean => {
    if (left === right) return true;
    if (left.flattenEmptyDirectories !== right.flattenEmptyDirectories)
      return false;
    if (left.id !== right.id) return false;
    if (left.onSelection !== right.onSelection) return false;
    if (left.config !== right.config) return false;
    if (left.files === right.files) return true;
    if (left.files.length !== right.files.length) return false;
    return left.files.every((file, index) => file === right.files[index]);
  };

  const ref = useStableCallback((fileTreeContainer: HTMLElement | null) => {
    if (fileTreeContainer != null) {
      containerRef.current = fileTreeContainer;
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = createInstance(fileTreeContainer);
      void instanceRef.current.hydrate({
        fileTreeContainer,
        prerenderedHTML,
      });
      hasRenderedRef.current = true;
    } else {
      containerRef.current = null;
      if (instanceRef.current == null) {
        throw new Error(
          'useFileTreeInstance: A FileTree instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
      hasRenderedRef.current = false;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const previousOptions = previousOptionsRef.current;
    previousOptionsRef.current = options;

    if (previousOptions == null) {
      if (forceClientRender === true) {
        void instanceRef.current.render({
          fileTreeContainer: containerRef.current ?? undefined,
        });
        hasRenderedRef.current = true;
      }
      return;
    }

    if (!areOptionsEqual(previousOptions, options)) {
      const fileTreeContainer = containerRef.current;
      if (fileTreeContainer != null) {
        instanceRef.current.cleanUp();
        clearExistingFileTree(fileTreeContainer);
        instanceRef.current = createInstance(fileTreeContainer);
        void instanceRef.current.render({ fileTreeContainer });
        hasRenderedRef.current = true;
      }
      return;
    }

    if (forceClientRender === true && !hasRenderedRef.current) {
      void instanceRef.current.render({
        fileTreeContainer: containerRef.current ?? undefined,
      });
      hasRenderedRef.current = true;
    }
  }, [forceClientRender, options]);

  return { ref };
}
