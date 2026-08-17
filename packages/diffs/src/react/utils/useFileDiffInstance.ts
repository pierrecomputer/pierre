import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  FileDiff,
  type FileDiffEditCompleteEvent,
  type FileDiffEditCompleteHandler,
  type FileDiffOptions,
} from '../../components/FileDiff';
import { VirtualizedFileDiff } from '../../components/VirtualizedFileDiff';
import type { EditorChangeEvent, EditorOptions } from '../../edit';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { noopRender } from '../constants';
import { useCreateEditor } from '../EditContext';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface UseFileDiffInstanceProps<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<LAnnotation> | undefined;
  editorOptions: EditorOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation>): void;
  onEditComplete: FileDiffEditCompleteHandler<LAnnotation> | undefined;
}

interface UseFileDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function useFileDiffInstance<LAnnotation>({
  fileDiff,
  options,
  editorOptions,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool,
  edit,
  onEditChange: _onEditChange,
  onEditComplete: _onEditComplete,
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<LAnnotation>) => _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  const handleOnEditComplete = useStableCallback(
    (event: FileDiffEditCompleteEvent<LAnnotation>) =>
      _onEditComplete?.(event) ?? null
  );
  const onEditComplete =
    _onEditComplete != null ? handleOnEditComplete : undefined;
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
            controlledSelection,
            hasCustomHeader,
            hasGutterRenderUtility,
            onEditChange,
            onEditComplete,
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
            controlledSelection,
            hasCustomHeader,
            hasGutterRenderUtility,
            onEditChange,
            onEditComplete,
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

  useIsomorphicLayoutEffect(() => {
    const { current: instance } = instanceRef;
    if (instance == null) return;
    const newOptions = mergeFileDiffOptions({
      controlledSelection,
      hasCustomHeader,
      hasGutterRenderUtility,
      onEditChange,
      onEditComplete,
      options,
    });
    // setOptions(undefined) is a no-op, so an undefined merge result never
    // requires a forced render — comparing it against the instance's
    // constructor-default options would force a full render on every commit.
    const forceRender =
      newOptions !== undefined &&
      !areOptionsEqual(instance.options, newOptions);
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

  useIsomorphicLayoutEffect(() => {
    if (edit && instanceRef.current != null) {
      if (createEditor === undefined) {
        throw new Error('FileDiff: EditContext is not attached');
      }
      const editor = createEditor(editorOptions ?? {});
      if (editor == null) {
        throw new Error(
          'FileDiff: EditProvider.createEditor must return an editor instance'
        );
      }
      try {
        return editor.edit(instanceRef.current);
      } catch (error) {
        editor.cleanUp();
        throw error;
      }
    }
    return undefined;
  }, [edit]);

  const getHoveredLine = useCallback(():
    | GetHoveredLineResult<'diff'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);

  return {
    ref,
    getHoveredLine,
  };
}

interface MergeFileDiffOptionsProps<LAnnotation> {
  controlledSelection: boolean;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation>): void;
  onEditComplete: FileDiffEditCompleteHandler<LAnnotation> | undefined;
  options: FileDiffOptions<LAnnotation> | undefined;
}

function mergeFileDiffOptions<LAnnotation>({
  options,
  controlledSelection,
  hasCustomHeader,
  hasGutterRenderUtility,
  onEditChange,
  onEditComplete,
}: MergeFileDiffOptionsProps<LAnnotation>):
  | FileDiffOptions<LAnnotation>
  | undefined {
  const needsReactOverrides =
    controlledSelection ||
    hasGutterRenderUtility ||
    hasCustomHeader ||
    onEditChange != null ||
    onEditComplete != null;

  if (!needsReactOverrides) {
    return options;
  }

  return {
    ...options,
    controlledSelection,
    renderCustomHeader: hasCustomHeader
      ? noopRender
      : options?.renderCustomHeader,
    renderGutterUtility: hasGutterRenderUtility
      ? noopRender
      : options?.renderGutterUtility,
    onEditChange,
    onEditComplete,
  };
}
