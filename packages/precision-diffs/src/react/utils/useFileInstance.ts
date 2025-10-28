import deepEqual from 'fast-deep-equal';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { File, type FileOptions } from '../../File';
import type { FileContents, LineAnnotation } from '../../types';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
}
export function useFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
}: UseFileInstanceProps<LAnnotation>): (node: HTMLElement | null) => void {
  const instanceRef = useRef<File<LAnnotation> | null>(null);
  const ref = useStableCallback((node: HTMLElement | null) => {
    if (node != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'File: An instance should not already exist when a node is created'
        );
      }
      // FIXME: Ideally we don't use FileUI here, and instead amalgamate
      // the renderers manually
      instanceRef.current = new File(options, true);
      instanceRef.current.hydrate({
        file,
        fileContainer: node,
        lineAnnotations,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error('File: A File instance should exist when unmounting');
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const forceRender = !deepEqual(instanceRef.current.options, options);
    instanceRef.current.setOptions(options);
    void instanceRef.current.render({
      file,
      lineAnnotations,
      forceRender,
    });
  });
  return ref;
}
