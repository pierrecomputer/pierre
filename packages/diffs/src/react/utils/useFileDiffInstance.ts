import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { FileDiff, type FileDiffOptions } from '../../components/FileDiff';
import { VirtualizedFileDiff } from '../../components/VirtualizedFileDiff';
import type { EditorOptions } from '../../editor';
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
  editOptions: EditorOptions<LAnnotation> | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
}

interface UseFileDiffInstanceReturn {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function useFileDiffInstance<LAnnotation>({
  fileDiff,
  options,
  editOptions,
  lineAnnotations,
  selectedLines,
  prerenderedHTML,
  metrics,
  hasGutterRenderUtility,
  hasCustomHeader,
  disableWorkerPool,
  edit,
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation>();
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
            edit,
            hasCustomHeader,
            hasEditor: createEditor !== undefined,
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
            controlledSelection,
            edit,
            hasCustomHeader,
            hasEditor: createEditor !== undefined,
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

  useIsomorphicLayoutEffect(() => {
    const { current: instance } = instanceRef;
    if (instance == null) return;
    const newOptions = mergeFileDiffOptions({
      controlledSelection,
      edit,
      hasCustomHeader,
      hasEditor: createEditor !== undefined,
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

  useIsomorphicLayoutEffect(() => {
    if (edit && instanceRef.current != null) {
      if (createEditor === undefined) {
        throw new Error('FileDiff: EditContext is not attached');
      }
      const editor = createEditor(editOptions ?? {});
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
  edit: boolean;
  hasEditor: boolean;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  options: FileDiffOptions<LAnnotation> | undefined;
}

function mergeFileDiffOptions<LAnnotation>({
  options,
  controlledSelection,
  edit,
  hasCustomHeader,
  hasEditor,
  hasGutterRenderUtility,
}: MergeFileDiffOptionsProps<LAnnotation>):
  | FileDiffOptions<LAnnotation>
  | undefined {
  const needsEditorOverrides = edit && hasEditor;
  const needsReactOverrides =
    controlledSelection || hasGutterRenderUtility || hasCustomHeader;

  if (!needsReactOverrides && !needsEditorOverrides) {
    return options;
  }

  return {
    ...options,
    ...(needsReactOverrides
      ? {
          controlledSelection,
          renderCustomHeader: hasCustomHeader
            ? noopRender
            : options?.renderCustomHeader,
          renderGutterUtility: hasGutterRenderUtility
            ? noopRender
            : options?.renderGutterUtility,
        }
      : null),
    ...(needsEditorOverrides ? { useTokenTransformer: true } : null),
  };
}
