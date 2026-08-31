import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  DiffsEditor,
  FileContents,
  FileDiffMetadata,
  SelectedLineRange,
  VirtualFileMetrics,
} from '../../types';
import { areDiffTargetsEqual } from '../../utils/areDiffTargetsEqual';
import { areFileTargetsEqual } from '../../utils/areFileTargetsEqual';
import { areOptionsEqual } from '../../utils/areOptionsEqual';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { parseDiffFromFile } from '../../utils/parseDiffFromFile';
import { noopRender } from '../constants';
import { useCreateEditor } from '../EditContext';
import { useVirtualizer } from '../Virtualizer';
import { WorkerPoolContext } from '../WorkerPoolContext';
import { useStableCallback } from './useStableCallback';

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface AcceptedFilePair {
  oldFile: FileContents | null;
  newFile: FileContents | null;
}

interface AcceptedCompletion<LAnnotation> {
  fileDiff: {
    installed: FileDiffMetadata;
    stale: FileDiffMetadata;
  } | null;
  filePair: {
    fileDiff: FileDiffMetadata;
    installed: AcceptedFilePair;
    stale: AcceptedFilePair;
  } | null;
  annotations: {
    installed: DiffLineAnnotation<LAnnotation>[] | undefined;
    stale: DiffLineAnnotation<LAnnotation>[];
  } | null;
}

interface UseFileDiffInstanceProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents | null;
  newFile?: FileContents | null;
  options: FileDiffOptions<LAnnotation> | undefined;
  editorOptions: EditorOptions<LAnnotation> | undefined;
  editStateKey: string | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'diff'>): void;
  onEditComplete: FileDiffEditCompleteHandler<LAnnotation> | undefined;
}

interface UseFileDiffInstanceReturn<LAnnotation> {
  fileDiff: FileDiffMetadata;
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getAnnotationSlotName(annotation: DiffLineAnnotation<LAnnotation>): string;
}

export function useFileDiffInstance<LAnnotation>({
  fileDiff,
  oldFile,
  newFile,
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
}: UseFileDiffInstanceProps<LAnnotation>): UseFileDiffInstanceReturn<LAnnotation> {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<LAnnotation, 'diff'>) => _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  // An accepted completion installs its diff on the instance immediately,
  // but the fileDiff/lineAnnotations props stay pre-edit until the owner's
  // state update lands. This holds the accepted values so the renders in
  // between do not repaint pre-edit state.
  const acceptedCache = useRef<AcceptedCompletion<LAnnotation> | null>(null);
  const handleOnEditComplete = useStableCallback(
    (event: FileDiffEditCompleteEvent<LAnnotation>) => {
      const decision = _onEditComplete?.(event) ?? 'reject';
      if (decision === 'accept') {
        acceptedCache.current = {
          fileDiff: {
            installed: event.fileDiff,
            stale: event.originalFileDiff,
          },
          filePair:
            fileDiff == null
              ? {
                  fileDiff: event.fileDiff,
                  installed: { oldFile: event.oldFile, newFile: event.newFile },
                  stale: { oldFile: oldFile ?? null, newFile: newFile ?? null },
                }
              : null,
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
  // File-pair inputs parse here. While the file props still match the pair
  // from acceptance time (stale) or the completion event's files (installed),
  // the parse is the accepted diff itself; any other pair clears the record
  // and parses fresh.
  const effectiveFileDiff = useMemo(() => {
    if (fileDiff != null) {
      return fileDiff;
    }
    const { current: accepted } = acceptedCache;
    const filePair = accepted?.filePair;
    if (accepted != null && filePair != null) {
      if (
        isSameFilePair(oldFile, newFile, filePair.stale) ||
        isSameFilePair(oldFile, newFile, filePair.installed)
      ) {
        return filePair.fileDiff;
      }
      accepted.filePair = null;
    }
    return parseDiffFromFile(
      oldFile ?? null,
      newFile ?? null,
      options?.parseDiffOptions
    );
  }, [fileDiff, oldFile, newFile, options?.parseDiffOptions]);
  const instanceRef = useRef<
    FileDiff<LAnnotation> | VirtualizedFileDiff<LAnnotation> | null
  >(null);
  const disposeEditorRef = useRef<() => void>(null);
  const getEditor = useStableCallback(() => {
    if (createEditor == null) {
      throw new Error('FileDiff: EditContext is not attached');
    }
    return createEditor('file-diff', editorOptions ?? {}, editStateKey);
  });
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
      if (edit && disposeEditorRef.current == null) {
        disposeEditorRef.current = applyEdit(instanceRef.current, getEditor);
      }
      void instanceRef.current.hydrate({
        fileDiff: effectiveFileDiff,
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
      disposeEditorRef.current = null;
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
    // Detach editor before rendering if required
    if (!edit && disposeEditorRef.current != null) {
      const { current: disposeEditor } = disposeEditorRef;
      disposeEditorRef.current = null;
      disposeEditor();
    }
    const resolved = resolveAcceptedValues(
      effectiveFileDiff,
      lineAnnotations,
      acceptedCache
    );
    void instance.render({
      forceRender,
      fileDiff: resolved.fileDiff,
      lineAnnotations: resolved.lineAnnotations,
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
    | GetHoveredLineResult<'diff'>
    | undefined => {
    return instanceRef.current?.getHoveredLine();
  }, []);
  const getAnnotationSlotName = useCallback(
    (annotation: DiffLineAnnotation<LAnnotation>): string =>
      instanceRef.current?.getAnnotationSlotName(annotation) ??
      getLineAnnotationName(annotation),
    []
  );

  return {
    fileDiff: effectiveFileDiff,
    ref,
    getHoveredLine,
    getAnnotationSlotName,
  };
}

// Whether the file props name the same files as a recorded pair.
function isSameFilePair(
  oldFile: FileContents | null | undefined,
  newFile: FileContents | null | undefined,
  filePair: AcceptedFilePair
): boolean {
  return (
    areFileTargetsEqual(oldFile ?? undefined, filePair.oldFile ?? undefined) &&
    areFileTargetsEqual(newFile ?? undefined, filePair.newFile ?? undefined)
  );
}

// Render the installed values in place of props that still match their stale
// counterparts. Any other prop value clears its slot — filePair settles in
// the parse memo instead — and the ref clears once all three have.
function resolveAcceptedValues<LAnnotation>(
  fileDiff: FileDiffMetadata,
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>
): {
  fileDiff: FileDiffMetadata;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
} {
  const { current: accepted } = acceptedCache;
  if (accepted == null) {
    return { fileDiff, lineAnnotations };
  }
  const { fileDiff: acceptedDiff, annotations: acceptedAnnotations } = accepted;
  let resolvedFileDiff = fileDiff;
  if (acceptedDiff != null) {
    if (areDiffTargetsEqual(fileDiff, acceptedDiff.stale)) {
      resolvedFileDiff = acceptedDiff.installed;
    } else {
      accepted.fileDiff = null;
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
  if (
    accepted.fileDiff == null &&
    accepted.annotations == null &&
    accepted.filePair == null
  ) {
    acceptedCache.current = null;
  }
  return { fileDiff: resolvedFileDiff, lineAnnotations: resolvedAnnotations };
}

interface MergeFileDiffOptionsProps<LAnnotation> {
  controlledSelection: boolean;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  onEditChange?(event: EditorChangeEvent<LAnnotation, 'diff'>): void;
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

function applyEdit<LAnnotation>(
  instance: FileDiff<LAnnotation>,
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
