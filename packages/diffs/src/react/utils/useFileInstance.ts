import {
  type RefObject,
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
  DiffsEditor,
  FileContents,
  LineAnnotation,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../../types';
import { areFileTargetsEqual } from '../../utils/areFileTargetsEqual';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { noopRender } from '../constants';
import { useCreateEditor } from '../EditContext';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface AcceptedCompletion<LAnnotation> {
  file: {
    installed: FileContents;
    stale: FileContents;
  } | null;
  annotations: {
    installed: LineAnnotation<LAnnotation>[] | undefined;
    stale: LineAnnotation<LAnnotation>[];
  } | null;
}

interface UseFileInstanceProps<LAnnotation> {
  file: FileContents;
  options: FileOptions<LAnnotation> | undefined;
  editorOptions: EditorOptions<LAnnotation> | undefined;
  editStateKey: string | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'file'>): void;
  onEditComplete: FileEditCompleteHandler<LAnnotation> | undefined;
}

interface UseFileInstanceReturn<LAnnotation> {
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
  getAnnotationSlotName(annotation: LineAnnotation<LAnnotation>): string;
}

export function useFileInstance<LAnnotation>({
  file,
  options,
  editorOptions,
  editStateKey,
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
}: UseFileInstanceProps<LAnnotation>): UseFileInstanceReturn<LAnnotation> {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<LAnnotation, 'file'>) => _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  // An accepted completion installs its file on the instance immediately,
  // but the file/lineAnnotations props stay pre-edit until the owner's state
  // update lands. This holds the accepted values so the renders in between do
  // not repaint pre-edit state.
  const acceptedCache = useRef<AcceptedCompletion<LAnnotation> | null>(null);
  const handleOnEditComplete = useStableCallback(
    (event: FileEditCompleteEvent<LAnnotation>) => {
      const decision = _onEditComplete?.(event) ?? 'reject';
      if (decision === 'accept') {
        acceptedCache.current = {
          file: { installed: event.file, stale: event.originalFile },
          annotations: {
            installed: event.lineAnnotations,
            stale: event.originalLineAnnotations,
          },
        };
      }
      return decision;
    }
  );
  const onEditComplete =
    _onEditComplete != null ? handleOnEditComplete : undefined;
  const instanceRef = useRef<
    File<LAnnotation> | VirtualizedFile<LAnnotation> | null
  >(null);
  const disposeEditorRef = useRef<() => void>(null);
  const getEditor = useStableCallback(() => {
    if (createEditor == null) {
      throw new Error('File: EditContext is not attached');
    }
    return createEditor('file', editorOptions ?? {}, editStateKey);
  });
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
      if (edit && disposeEditorRef.current == null) {
        disposeEditorRef.current = applyEdit(instanceRef.current, getEditor);
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
      disposeEditorRef.current = null;
    }
  });

  useIsomorphicLayoutEffect(() => {
    const { current: instance } = instanceRef;
    if (instance == null) return;
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
      !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    // Detach editor before rendering if required
    if (!edit && disposeEditorRef.current != null) {
      const { current: disposeEditor } = disposeEditorRef;
      disposeEditorRef.current = null;
      disposeEditor();
    }
    const resolved = resolveAcceptedValues(
      file,
      lineAnnotations,
      acceptedCache
    );
    void instance.render({
      file: resolved.file,
      lineAnnotations: resolved.lineAnnotations,
      forceRender,
    });
    if (selectedLines !== undefined) {
      instance.setSelectedLines(selectedLines);
    }
    // Attach editor after rendering if required
    if (edit && disposeEditorRef.current == null) {
      disposeEditorRef.current = applyEdit(instance, getEditor);
    }
  });

  const getHoveredLine = useCallback(():
    | GetHoveredLineResult<'file'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);
  const getAnnotationSlotName = useCallback(
    (annotation: LineAnnotation<LAnnotation>): string =>
      instanceRef.current?.getAnnotationSlotName(annotation) ??
      getLineAnnotationName(annotation),
    []
  );
  return { ref, getHoveredLine, getAnnotationSlotName };
}

// Return the installed values in place of props that still match their stale
// counterparts. Any other prop value clears its half, and the ref clears once
// both halves have.
function resolveAcceptedValues<LAnnotation>(
  file: FileContents,
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined,
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>
): {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
} {
  const { current: accepted } = acceptedCache;
  if (accepted == null) {
    return { file, lineAnnotations };
  }
  const { file: acceptedFiles, annotations: acceptedAnnotations } = accepted;
  let resolvedFile = file;
  if (acceptedFiles != null) {
    if (areFileTargetsEqual(file, acceptedFiles.stale)) {
      resolvedFile = acceptedFiles.installed;
    } else {
      accepted.file = null;
    }
  }
  let resolvedAnnotations = lineAnnotations;
  if (acceptedAnnotations != null) {
    if (lineAnnotations === acceptedAnnotations.stale) {
      resolvedAnnotations = acceptedAnnotations.installed;
    } else {
      accepted.annotations = null;
    }
  }
  if (accepted.file == null && accepted.annotations == null) {
    acceptedCache.current = null;
  }
  return { file: resolvedFile, lineAnnotations: resolvedAnnotations };
}

interface MergeFileOptionsProps<LAnnotation> {
  options: FileOptions<LAnnotation> | undefined;
  controlledSelection: boolean;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'file'>): void;
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

function applyEdit<LAnnotation>(
  instance: File<LAnnotation>,
  getEditor: () => DiffsEditor<LAnnotation>
): () => void {
  const editor = getEditor();
  try {
    return editor.edit(instance);
  } catch (error) {
    editor.cleanUp();
    throw error;
  }
}
