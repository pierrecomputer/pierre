import deepEqual from 'fast-deep-equal';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { FileDiff, type FileDiffOptions } from '../../FileDiff';
import type { SelectedLineRange } from '../../LineSelectionManager';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
} from '../../types';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileDiffInstanceProps<LAnnotation> {
  oldFile?: FileContents;
  newFile?: FileContents;
  fileDiff?: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation>;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
}

export function useFileDiffInstance<LAnnotation>({
  oldFile,
  newFile,
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
}: UseFileDiffInstanceProps<LAnnotation>): (
  fileContainer: HTMLElement | null
) => void {
  const instanceRef = useRef<FileDiff<LAnnotation> | null>(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      // FIXME: Ideally we don't use FileDiffUI here, and instead amalgamate
      // the renderers manually
      instanceRef.current = new FileDiff(options, true);
      void instanceRef.current.hydrate({
        fileDiff,
        oldFile,
        newFile,
        fileContainer,
        lineAnnotations,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useFileDiffInstance: A FileDiff instance should exist when unmounting'
        );
      }
      instanceRef.current.cleanUp();
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null) return;
    const instance = instanceRef.current;
    const forceRender = !deepEqual(instance.options, options);
    const hasControlledSelection = selectedLines !== undefined;
    const currentSelection = selectedLines ?? null;
    instance.setOptions(options);
    void instance
      .render({
        forceRender,
        fileDiff,
        oldFile,
        newFile,
        lineAnnotations: lineAnnotations,
      })
      .then(() => {
        if (instanceRef.current !== instance) return;
        if (hasControlledSelection) {
          instance.setSelectedLines(currentSelection);
        }
      });
  });

  useIsometricEffect(() => {
    if (instanceRef.current == null || selectedLines === undefined) return;
    instanceRef.current.setSelectedLines(selectedLines);
  }, [selectedLines]);

  return ref;
}
