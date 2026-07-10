import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import { File, type FileOptions } from '../../components/File';
import { VirtualizedFile } from '../../components/VirtualizedFile';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
  FileContents,
  LineAnnotation,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../../types';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { noopRender } from '../constants';
import { useEditor } from '../EditContext';
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
  contentEditable: boolean;
  onChange?: (
    file: FileContents,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ) => void;
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
  contentEditable,
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const editor = useEditor<LAnnotation>();
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
            contentEditable,
            hasCustomHeader,
            hasEditor: editor !== undefined,
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
            controlledSelection,
            contentEditable,
            hasCustomHeader,
            hasEditor: editor !== undefined,
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
      controlledSelection,
      contentEditable,
      hasCustomHeader,
      hasEditor: editor !== undefined,
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

  useIsometricEffect(() => {
    if (contentEditable && instanceRef.current != null) {
      if (editor === undefined) {
        throw new Error('File: Editor is not attached');
      }
      return editor.edit(instanceRef.current);
    }
    return undefined;
  }, [contentEditable, editor]);

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
  contentEditable: boolean;
  hasEditor: boolean;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
}

function mergeFileOptions<LAnnotation>({
  options,
  controlledSelection,
  contentEditable,
  hasCustomHeader,
  hasEditor,
  hasGutterRenderUtility,
}: MergeFileOptionsProps<LAnnotation>): FileOptions<LAnnotation> | undefined {
  const needsEditorOptions = contentEditable && hasEditor;
  const needsReactOverrides =
    controlledSelection || hasGutterRenderUtility || hasCustomHeader;

  if (!needsReactOverrides && !needsEditorOptions) {
    return options;
  }

  let merged: FileOptions<LAnnotation> = { ...options };

  if (needsReactOverrides) {
    merged = {
      ...merged,
      controlledSelection,
      renderCustomHeader: hasCustomHeader
        ? noopRender
        : options?.renderCustomHeader,
      renderGutterUtility: hasGutterRenderUtility
        ? noopRender
        : options?.renderGutterUtility,
    };
  }

  if (needsEditorOptions) {
    merged = {
      ...merged,
      useTokenTransformer: true,
      enableGutterUtility: false,
      enableLineSelection: false,
      lineHoverHighlight: 'disabled',
    };
  }

  return merged;
}
