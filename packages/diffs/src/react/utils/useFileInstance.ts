import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import {
  File,
  type FileEditCompleteEvent,
  type FileEditCompleteHandler,
  type FileOptions,
} from '../../components/File';
import { VirtualizedFile } from '../../components/VirtualizedFile';
import type { EditorChangeEvent, EditorOptions } from '../../edit';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
  FileContents,
  LineAnnotation,
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

interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation> | undefined;
  editorOptions: EditorOptions<LAnnotation> | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation>): void;
  onEditComplete: FileEditCompleteHandler<LAnnotation> | undefined;
}

interface UseFileInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}

export function useFileInstance<LAnnotation>({
  file,
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
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<LAnnotation>) => _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  const handleOnEditComplete = useStableCallback(
    (event: FileEditCompleteEvent<LAnnotation>) =>
      _onEditComplete?.(event) ?? null
  );
  const onEditComplete =
    _onEditComplete != null ? handleOnEditComplete : undefined;
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
        instanceRef.current = new File(
          mergeFileOptions({
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

  useIsomorphicLayoutEffect(() => {
    if (instanceRef.current == null) return;
    const newOptions = mergeFileOptions({
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
      !areOptionsEqual(instanceRef.current.options, newOptions);
    instanceRef.current.setOptions(newOptions);
    void instanceRef.current.render({ file, lineAnnotations, forceRender });
    if (selectedLines !== undefined) {
      instanceRef.current.setSelectedLines(selectedLines);
    }
  });

  useIsomorphicLayoutEffect(() => {
    if (edit && instanceRef.current != null) {
      if (createEditor === undefined) {
        throw new Error('File: EditContext is not attached');
      }
      const editor = createEditor(editorOptions ?? {});
      if (editor == null) {
        throw new Error(
          'File: EditProvider.createEditor must return an editor instance'
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
    | GetHoveredLineResult<'file'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);
  return { ref, getHoveredLine };
}

interface MergeFileOptionsProps<LAnnotation> {
  options: FileOptions<LAnnotation> | undefined;
  controlledSelection: boolean;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation>): void;
  onEditComplete: FileEditCompleteHandler<LAnnotation> | undefined;
}

function mergeFileOptions<LAnnotation>({
  options,
  controlledSelection,
  hasCustomHeader,
  hasGutterRenderUtility,
  onEditChange,
  onEditComplete,
}: MergeFileOptionsProps<LAnnotation>): FileOptions<LAnnotation> | undefined {
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
