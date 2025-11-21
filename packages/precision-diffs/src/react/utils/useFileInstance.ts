import deepEqual from 'fast-deep-equal';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { File, type FileOptions } from '../../File';
import type { SelectedLineRange } from '../../LineSelectionManager';
import type { GetHoveredLineResult } from '../../MouseEventManager';
import type { FileContents, LineAnnotation } from '../../types';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation> | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
}

interface UseFileInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}

export function useFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn {
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
      void instanceRef.current.hydrate({
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
    void instanceRef.current.render({ file, lineAnnotations, forceRender });
    if (selectedLines !== undefined) {
      instanceRef.current.setSelectedLines(selectedLines);
    }
  });

  const getHoveredLine = useCallback(():
    | GetHoveredLineResult<'file'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);
  return { ref, getHoveredLine };
}
