import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  UnresolvedFile,
  type UnresolvedFileOptions,
} from '../../components/UnresolvedFile';
import { VirtualizedUnresolvedFile } from '../../components/VirtualizedUnresolvedFile';
import type {
  GetHoveredLineResult,
  SelectedLineRange,
} from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  FileContents,
  VirtualFileMetrics,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseUnresolvedFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: UnresolvedFileOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
}

interface UseUnresolvedFileInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function useUnresolvedFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
}: UseUnresolvedFileInstanceProps<LAnnotation>): UseUnresolvedFileInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<
    UnresolvedFile<LAnnotation> | VirtualizedUnresolvedFile<LAnnotation> | null
  >(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useUnresolvedFileInstance: An instance should not already exist when a node is created'
        );
      }
      if (simpleVirtualizer != null) {
        instanceRef.current = new VirtualizedUnresolvedFile(
          options,
          simpleVirtualizer,
          metrics,
          poolManager,
          true
        );
      } else {
        instanceRef.current = new UnresolvedFile(options, poolManager, true);
      }
      void instanceRef.current.hydrate({
        file,
        fileContainer,
        lineAnnotations,
        prerenderedHTML,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useUnresolvedFileInstance: A FileDiff instance should exist when unmounting'
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
      file,
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
