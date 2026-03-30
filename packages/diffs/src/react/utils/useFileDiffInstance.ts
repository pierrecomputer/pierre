import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { FileDiff, type FileDiffOptions } from '../../components/FileDiff';
import { VirtualizedFileDiff } from '../../components/VirtualizedFileDiff';
import type {
  GetHoveredLineResult,
  SelectedLineRange,
} from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  VirtualFileMetrics,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { noopRender } from '../constants';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileDiffInstanceProps<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
}

interface UseFileDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function useFileDiffInstance<LAnnotation>({
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool,
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<
    FileDiff<LAnnotation> | VirtualizedFileDiff<LAnnotation> | null
  >(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useFileDiffInstance: An instance should not already exist when a node is created'
        );
      }
      if (simpleVirtualizer != null) {
        instanceRef.current = new VirtualizedFileDiff(
          mergeFileDiffOptions({
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
        instanceRef.current = new FileDiff(
          mergeFileDiffOptions({
            hasCustomHeader,
            hasGutterRenderUtility,
            options,
          }),
          !disableWorkerPool ? poolManager : undefined,
          true
        );
      }
      void instanceRef.current.hydrate({
        fileDiff,
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
    const { current: instance } = instanceRef;
    if (instance == null) return;
    const newOptions = mergeFileDiffOptions({
      hasCustomHeader,
      hasGutterRenderUtility,
      options,
    });
    const forceRender = !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    void instance.render({
      forceRender,
      fileDiff,
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

interface MergeFileDiffOptionsProps<LAnnotation> {
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  options: FileDiffOptions<LAnnotation> | undefined;
}

function mergeFileDiffOptions<LAnnotation>({
  options,
  hasCustomHeader,
  hasGutterRenderUtility,
}: MergeFileDiffOptionsProps<LAnnotation>):
  | FileDiffOptions<LAnnotation>
  | undefined {
  if (hasGutterRenderUtility || hasCustomHeader) {
    return {
      ...options,
      renderCustomHeader: hasCustomHeader ? noopRender : undefined,
      renderGutterUtility: hasGutterRenderUtility ? noopRender : undefined,
    };
  }
  return options;
}
