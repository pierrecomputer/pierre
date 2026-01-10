import { useEffect, useLayoutEffect, useRef } from 'react';

import { ImageDiff } from '../../components/ImageDiff';
import type {
  FileContents,
  FileDiffMetadata,
  ImageDiffOptions,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseImageDiffInstanceProps {
  oldFile?: FileContents;
  newFile?: FileContents;
  fileDiff?: FileDiffMetadata;
  options: ImageDiffOptions | undefined;
  prerenderedHTML: string | undefined;
}

interface UseImageDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
}

export function useImageDiffInstance({
  oldFile,
  newFile,
  fileDiff,
  options,
  prerenderedHTML,
}: UseImageDiffInstanceProps): UseImageDiffInstanceReturn {
  const instanceRef = useRef<ImageDiff | null>(null);

  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useImageDiffInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = new ImageDiff(options, true);
      void instanceRef.current.hydrate({
        fileDiff,
        oldFile,
        newFile,
        fileContainer,
        prerenderedHTML,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useImageDiffInstance: An ImageDiff instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const instance = instanceRef.current;
    const forceRender = !areOptionsEqual(instance.options, options);
    instance.setOptions(options);
    void instance.render({
      forceRender,
      fileDiff,
      oldFile,
      newFile,
    });
  });

  return { ref };
}
