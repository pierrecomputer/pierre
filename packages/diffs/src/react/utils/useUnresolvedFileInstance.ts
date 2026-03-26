import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  UnresolvedFile,
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
  FileDiffMetadata,
  MergeConflictActionPayload,
  MergeConflictMarkerRow,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import {
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../../utils/parseMergeConflictDiffFromFile';
import { noopRender } from '../constants';
import type { UnresolvedFileReactOptions } from '../UnresolvedFile';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseUnresolvedFileInstanceProps<LAnnotation> {
  file: FileContents;
  options?: UnresolvedFileReactOptions<LAnnotation>;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  hasConflictUtility: boolean;
  hasGutterRenderUtility: boolean;
}

interface UseUnresolvedFileInstanceReturn<LAnnotation> {
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getInstance(): UnresolvedFile<LAnnotation> | undefined;
}

export function useUnresolvedFileInstance<LAnnotation>({
  file,
  options,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  hasConflictUtility,
  hasGutterRenderUtility,
}: UseUnresolvedFileInstanceProps<LAnnotation>): UseUnresolvedFileInstanceReturn<LAnnotation> {
  const [{ fileDiff, actions, markerRows }, setState] = useState(() => {
    const { fileDiff, actions, markerRows } = parseMergeConflictDiffFromFile(
      file,
      options?.maxContextLines
    );
    return { fileDiff, actions, markerRows };
  });
  // UnresolvedFile is intentionally uncontrolled in React. Keep an internal
  // source-of-truth file so sequential conflict actions apply to the latest
  // resolved contents rather than the initial prop value.
  const onMergeConflictAction = useStableCallback(
    (
      payload: MergeConflictActionPayload,
      instance: UnresolvedFile<LAnnotation>
    ) => {
      setState((prevState) => {
        const { fileDiff, actions, markerRows } =
          instance.resolveConflict(
            payload.conflict.conflictIndex,
            payload.resolution,
            prevState.fileDiff
          ) ?? {};
        if (fileDiff == null || actions == null || markerRows == null) {
          return prevState;
        } else {
          return { fileDiff, actions, markerRows };
        }
      });
    }
  );
  const poolManager = useContext(WorkerPoolContext);
  const instanceRef = useRef<UnresolvedFileClass<LAnnotation> | null>(null);
  const ref = useStableCallback((fileContainer: HTMLElement | null) => {
    if (fileContainer != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useUnresolvedFileInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = new UnresolvedFileClass(
        mergeUnresolvedOptions(
          options,
          onMergeConflictAction,
          hasConflictUtility,
          hasGutterRenderUtility
        ),
        poolManager,
        true
      );
      void instanceRef.current.hydrate({
        fileDiff,
        actions,
        markerRows,
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
    const newOptions = mergeUnresolvedOptions(
      options,
      onMergeConflictAction,
      hasConflictUtility,
      hasGutterRenderUtility
    );
    const forceRender = !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    void instance.render({
      fileDiff,
      actions,
      markerRows,
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

  const getInstance = useCallback(() => {
    return instanceRef.current ?? undefined;
  }, []);

  return { ref, getHoveredLine, fileDiff, actions, markerRows, getInstance };
}

function mergeUnresolvedOptions<LAnnotation>(
  options: UnresolvedFileReactOptions<LAnnotation> | undefined,
  onMergeConflictAction: UnresolvedFileOptions<LAnnotation>['onMergeConflictAction'],
  hasConflictUtility: boolean,
  hasGutterRenderUtility: boolean
): UnresolvedFileOptions<LAnnotation> {
  return {
    ...options,
    onMergeConflictAction,
    hunkSeparators:
      options?.hunkSeparators === 'custom'
        ? noopRender
        : options?.hunkSeparators,
    // Add a placeholder type for the custom render
    mergeConflictActionsType:
      hasConflictUtility || options?.mergeConflictActionsType === 'custom'
        ? noopRender
        : options?.mergeConflictActionsType,
    renderGutterUtility: hasGutterRenderUtility ? noopRender : undefined,
  };
}
