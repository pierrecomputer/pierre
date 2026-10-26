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
  type FileEditChangeHandler,
  type FileEditCompleteEvent,
  type FileEditCompleteHandler,
  type FileOptions,
  type FileRenderInput,
} from '../../components/File';
import { VirtualizedFile } from '../../components/VirtualizedFile';
import { EMPTY_LINE_ANNOTATIONS } from '../../constants';
import type { Editor, EditorChangeEvent, EditorOptions } from '../../edit';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
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
import { useForceUpdate } from './useForceUpdate';
import { useNextRenderData } from './useNextRenderData';
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

interface UseFileInstanceProps<LAnnotation, Caret> {
  file: FileContents;
  options: FileOptions<LAnnotation, Caret> | undefined;
  editorOptions: EditorOptions<'file', LAnnotation, Caret> | undefined;
  editStateKey: string | undefined;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?: FileEditChangeHandler<LAnnotation, Caret>;
  onEditComplete?: FileEditCompleteHandler<LAnnotation, Caret>;
}

interface UseFileInstanceReturn<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[];
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
  getAnnotationSlotName(annotation: LineAnnotation<LAnnotation>): string;
}

export function useFileInstance<LAnnotation, Caret>({
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
}: UseFileInstanceProps<
  LAnnotation,
  Caret
>): UseFileInstanceReturn<LAnnotation> {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation, Caret>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<'file', LAnnotation, Caret>) =>
      _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  // When an edit is accepted, the instance switches to the edited file right
  // away, but the file and lineAnnotations props keep their pre-edit values
  // until the parent passes new ones. This keeps the accepted values so the
  // renders in between don't show the pre-edit file again.
  const acceptedCache = useRef<AcceptedCompletion<LAnnotation> | null>(null);
  const handleOnEditComplete = useStableCallback(
    (event: FileEditCompleteEvent<LAnnotation, Caret>) => {
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
    File<LAnnotation, Caret> | VirtualizedFile<LAnnotation, Caret> | null
  >(null);
  const forceUpdate = useForceUpdate();
  const accepted = useAcceptedValues(acceptedCache, file, lineAnnotations);
  const renderData = useNextRenderData(instanceRef, accepted) ?? {
    file,
    lineAnnotations: lineAnnotations ?? EMPTY_LINE_ANNOTATIONS,
  };
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
          forceUpdate
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
          forceUpdate
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
    const forceRender = !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    // Detach the editor before rendering when editing turns off
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
    // Attach the editor after rendering when editing turns on. The editor can
    // show content that is still highlighting, so render the children again
    // from the edit session.
    if (edit && disposeEditorRef.current == null) {
      disposeEditorRef.current = applyEdit(instance, getEditor);
      forceUpdate();
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
  return { ...renderData, ref, getHoveredLine, getAnnotationSlotName };
}

// Read the accepted values on every render. Entries are only removed in the
// effect, by resolveAcceptedValues. The cache changes without new props, so
// this must not be memoized.
function useAcceptedValues<LAnnotation>(
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>,
  file: FileContents,
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined
): FileRenderInput<LAnnotation> {
  'use no memo';
  // oxlint-disable-next-line react/refs -- the cache changes without new props
  return getAcceptedValues(file, lineAnnotations, acceptedCache.current);
}

// Use the accepted values for props that still hold their pre-edit values.
function getAcceptedValues<LAnnotation>(
  file: FileContents,
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined,
  accepted: AcceptedCompletion<LAnnotation> | null
): FileRenderInput<LAnnotation> {
  return {
    file:
      accepted?.file != null && areFileTargetsEqual(file, accepted.file.stale)
        ? accepted.file.installed
        : file,
    lineAnnotations:
      accepted?.annotations != null &&
      lineAnnotations === accepted.annotations.stale
        ? accepted.annotations.installed
        : lineAnnotations,
  };
}

// Return the accepted values, and drop each one once its prop no longer holds
// the pre-edit value. The cache is cleared once both are dropped.
function resolveAcceptedValues<LAnnotation>(
  file: FileContents,
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined,
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>
): FileRenderInput<LAnnotation> {
  const { current: accepted } = acceptedCache;
  const resolved = getAcceptedValues(file, lineAnnotations, accepted);
  if (accepted == null) {
    return resolved;
  }
  if (
    accepted.file != null &&
    !areFileTargetsEqual(file, accepted.file.stale)
  ) {
    accepted.file = null;
  }
  if (lineAnnotations !== accepted.annotations?.stale) {
    accepted.annotations = null;
  }
  if (accepted.file == null && accepted.annotations == null) {
    acceptedCache.current = null;
  }
  return resolved;
}

interface MergeFileOptionsProps<LAnnotation, Caret> {
  options: FileOptions<LAnnotation, Caret> | undefined;
  controlledSelection: boolean;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  onEditChange: FileEditChangeHandler<LAnnotation, Caret> | undefined;
  onEditComplete: FileEditCompleteHandler<LAnnotation, Caret> | undefined;
}

function mergeFileOptions<LAnnotation, Caret>({
  options,
  controlledSelection,
  hasCustomHeader,
  hasGutterRenderUtility,
  onEditChange,
  onEditComplete,
}: MergeFileOptionsProps<LAnnotation, Caret>): FileOptions<LAnnotation, Caret> {
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

// Attach an editor to the instance, cleaning the editor up if attaching throws.
function applyEdit<LAnnotation, Caret>(
  instance: File<LAnnotation, Caret>,
  getEditor: () => Editor<'file', LAnnotation, Caret>
): () => void {
  const editor = getEditor();
  try {
    return editor.edit(instance);
  } catch (error) {
    editor.cleanUp();
    throw error;
  }
}
