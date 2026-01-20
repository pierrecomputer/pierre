import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { FileDiff, type FileDiffOptions } from '../../components/FileDiff';
import { SimpleVirtualizedFileDiff } from '../../components/SimpleVirtualizedFileDiff';
import type { SelectedLineRange } from '../../managers/LineSelectionManager';
import type { GetHoveredLineResult } from '../../managers/MouseEventManager';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { useSimpleVirtualizer } from '../SimpleVirtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileDiffInstanceProps<LAnnotation> {
  oldFile?: FileContents;
  newFile?: FileContents;
  fileDiff?: FileDiffMetadata;
  options: FileDiffOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
}

interface UseFileDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function useFileDiffInstance<LAnnotation>({
  oldFile,
  newFile,
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn {
  const simpleVirtualizer = useSimpleVirtualizer();
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<
    FileDiff<LAnnotation> | SimpleVirtualizedFileDiff<LAnnotation> | null
  >(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      if (simpleVirtualizer != null) {
        instanceRef.current = new SimpleVirtualizedFileDiff(
          options,
          simpleVirtualizer,
          poolManager,
          true
        );
      } else {
        instanceRef.current = new FileDiff(options, poolManager, true);
      }
      void instanceRef.current.hydrate({
        fileDiff,
        oldFile,
        newFile,
        fileContainer,
        lineAnnotations,
        prerenderedHTML,
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
    const forceRender = !areOptionsEqual(instance.options, options);
    instance.setOptions(options);
    void instance.render({
      forceRender,
      fileDiff,
      oldFile,
      newFile,
      lineAnnotations,
    });
    if (selectedLines !== undefined) {
      instance.setSelectedLines(selectedLines);
    }
  });

  const getHoveredLine = useCallback(():
    | GetHoveredLineResult<'diff'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);

  return { ref, getHoveredLine };
}
