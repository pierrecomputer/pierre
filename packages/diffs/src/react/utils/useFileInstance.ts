import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { File, type FileOptions } from '../../components/File';
import { VirtualizedFile } from '../../components/VirtualizedFile';
import type {
  GetHoveredLineResult,
  SelectedLineRange,
} from '../../managers/InteractionManager';
import type {
  FileContents,
  LineAnnotation,
  VirtualFileMetrics,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { noopRender } from '../constants';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation> | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
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
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool,
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<
    File<LAnnotation> | VirtualizedFile<LAnnotation> | null
  >(null);
  const ref = useStableCallback((node: HTMLElement | null) => {
    if (node != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'File: An instance should not already exist when a node is created'
        );
      }
      if (simpleVirtualizer != null) {
        instanceRef.current = new VirtualizedFile(
          mergeFileOptions({
            hasCustomHeader,
            hasGutterRenderUtility,
            options,
          }),
          simpleVirtualizer,
          metrics,
          !disableWorkerPool ? poolManager : undefined,
          true
        );
      } else {
        instanceRef.current = new File(
          mergeFileOptions({
            hasCustomHeader,
            hasGutterRenderUtility,
            options,
          }),
          !disableWorkerPool ? poolManager : undefined,
          true
        );
      }
      void instanceRef.current.hydrate({
        file,
        fileContainer: node,
        lineAnnotations,
        prerenderedHTML,
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
    const newOptions = mergeFileOptions({
      hasCustomHeader,
      hasGutterRenderUtility,
      options,
    });
    const forceRender = !areOptionsEqual(
      instanceRef.current.options,
      newOptions
    );
    instanceRef.current.setOptions(newOptions);
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

interface MergeFileOptionsProps<LAnnotation> {
  options: FileOptions<LAnnotation> | undefined;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
}

function mergeFileOptions<LAnnotation>({
  options,
  hasCustomHeader,
  hasGutterRenderUtility,
}: MergeFileOptionsProps<LAnnotation>): FileOptions<LAnnotation> | undefined {
  if (hasGutterRenderUtility || hasCustomHeader) {
    return {
      ...options,
      renderCustomHeader: hasCustomHeader ? noopRender : undefined,
      renderGutterUtility: hasGutterRenderUtility ? noopRender : undefined,
    };
  }
  return options;
}
