import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  UnresolvedFile as UnresolvedFileClass,
  type UnresolvedFileOptions,
} from '../../components/UnresolvedFile';
import type {
  GetHoveredLineResult,
  SelectedLineRange,
} from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  FileContents,
  MergeConflictResolution,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
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
}

interface UseUnresolvedFileInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  resolveMergeConflictAction(
    conflictIndex: number,
    resolution: MergeConflictResolution
  ): void;
}

export function useUnresolvedFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
}: UseUnresolvedFileInstanceProps<LAnnotation>): UseUnresolvedFileInstanceReturn {
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<UnresolvedFileClass<LAnnotation> | null>(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useUnresolvedFileInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = new UnresolvedFileClass(options, poolManager, true);
      void instanceRef.current.hydrate({
        file,
        fileContainer,
        lineAnnotations,
        prerenderedHTML,
      });
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useUnresolvedFileInstance: A UnresolvedFile instance should exist when unmounting'
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
      file,
      lineAnnotations,
      forceRender,
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

  const resolveMergeConflictAction = useCallback(
    (conflictIndex: number, resolution: MergeConflictResolution): void => {
      instanceRef.current?.resolveConflictAndRender(conflictIndex, resolution);
    },
    []
  );

  return { ref, getHoveredLine, resolveMergeConflictAction };
}
