import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  FileDiff,
  type FileDiffEditChangeHandler,
  type FileDiffEditCompleteEvent,
  type FileDiffEditCompleteHandler,
  type FileDiffOptions,
  type FileDiffRenderInput,
} from '../../components/FileDiff';
import { VirtualizedFileDiff } from '../../components/VirtualizedFileDiff';
import { EMPTY_LINE_ANNOTATIONS } from '../../constants';
import type { Editor, EditorChangeEvent, EditorOptions } from '../../edit';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type {
  DiffLineAnnotation,
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
import { useForceUpdate } from './useForceUpdate';
import { useNextRenderData } from './useNextRenderData';
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

interface UseFileDiffInstanceProps<LAnnotation, Caret> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents | null;
  newFile?: FileContents | null;
  options: FileDiffOptions<LAnnotation, Caret> | undefined;
  editorOptions: EditorOptions<'file-diff', LAnnotation, Caret> | undefined;
  editStateKey: string | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  selectedLines: SelectedLineRange | null | undefined;
  prerenderedHTML: string | undefined;
  metrics?: VirtualFileMetrics;
  hasGutterRenderUtility: boolean;
  hasCustomHeader: boolean;
  disableWorkerPool: boolean;
  edit: boolean;
  onEditChange?: FileDiffEditChangeHandler<LAnnotation, Caret>;
  onEditComplete?: FileDiffEditCompleteHandler<LAnnotation, Caret>;
}

interface UseFileDiffInstanceReturn<LAnnotation> {
  lineAnnotations: DiffLineAnnotation<LAnnotation>[];
  fileDiff: FileDiffMetadata;
  ref(node: HTMLElement | null): void;
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getAnnotationSlotName(annotation: DiffLineAnnotation<LAnnotation>): string;
}

export function useFileDiffInstance<LAnnotation, Caret>({
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
}: UseFileDiffInstanceProps<
  LAnnotation,
  Caret
>): UseFileDiffInstanceReturn<LAnnotation> {
  const simpleVirtualizer = useVirtualizer();
  const controlledSelection = selectedLines !== undefined;
  const poolManager = useContext(WorkerPoolContext);
  const createEditor = useCreateEditor<LAnnotation, Caret>();
  const [asyncAttachError, setAsyncAttachError] = useState<unknown>();
  const handleOnEditChange = useStableCallback(
    (event: EditorChangeEvent<'file-diff', LAnnotation, Caret>) =>
      _onEditChange?.(event)
  );
  const onEditChange = _onEditChange != null ? handleOnEditChange : undefined;
  // An accepted completion installs its diff on the instance immediately,
  // but the fileDiff/lineAnnotations props stay pre-edit until the owner's
  // state update lands. This holds the accepted values so the renders in
  // between do not repaint pre-edit state.
  const acceptedCache = useRef<AcceptedCompletion<LAnnotation> | null>(null);
  const handleOnEditComplete = useStableCallback(
    (event: FileDiffEditCompleteEvent<LAnnotation, Caret>) => {
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
  const effectiveFileDiff = useEffectiveFileDiff({
    acceptedCache,
    fileDiff,
    newFile,
    oldFile,
    parseDiffOptions: options?.parseDiffOptions,
  });
  const instanceRef = useRef<
    | FileDiff<LAnnotation, Caret>
    | VirtualizedFileDiff<LAnnotation, Caret>
    | null
  >(null);
  const forceUpdate = useForceUpdate();
  const accepted = useAcceptedValues(
    acceptedCache,
    effectiveFileDiff,
    lineAnnotations
  );
  const renderData = useNextRenderData(instanceRef, accepted) ?? {
    fileDiff: effectiveFileDiff,
    lineAnnotations: lineAnnotations ?? EMPTY_LINE_ANNOTATIONS,
  };
  const disposeEditorRef = useRef<() => void>(null);
  const pendingAttachRef = useRef<{ promise: Promise<void> } | null>(null);
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
          forceUpdate
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
          forceUpdate
        );
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
      pendingAttachRef.current = null;
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
    const forceRender = !areOptionsEqual(instance.options, newOptions);
    instance.setOptions(newOptions);
    // Detach editor before rendering if required
    if (!edit) {
      pendingAttachRef.current = null;
      if (disposeEditorRef.current != null) {
        const { current: disposeEditor } = disposeEditorRef;
        disposeEditorRef.current = null;
        disposeEditor();
      }
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
    if (!edit || disposeEditorRef.current != null) {
      return;
    }
    if (createEditor == null) {
      throw new Error('FileDiff: EditContext is not attached');
    }

    const attach = (): void => {
      if (
        instanceRef.current !== instance ||
        disposeEditorRef.current != null ||
        !instance.__canAttachEditor()
      ) {
        return;
      }
      disposeEditorRef.current = applyEdit(instance, getEditor);
      // The editor can show content that is still highlighting, so render the
      // children again from the edit session.
      forceUpdate();
    };
    // If we're all ready to attach the editor, lets go ahead
    // and do that synchronously
    if (instance.__canAttachEditor()) {
      pendingAttachRef.current = null;
      attach();
      return;
    }
    const promise = instance.__prepareForEditing();
    // If we can't hydrate the files... this will come back undefined,
    // which means there's nothing we can do
    if (promise == null) {
      pendingAttachRef.current = null;
      return;
    }
    // If we are already waiting on a hydration to finish, then there's nothing
    // we need to do
    if (pendingAttachRef.current?.promise === promise) {
      return;
    }
    const pending = { promise };
    pendingAttachRef.current = pending;
    void promise
      .then(() => {
        if (pendingAttachRef.current !== pending) {
          return;
        }
        attach();
        pendingAttachRef.current = null;
      })
      .catch((error: unknown) => {
        if (pendingAttachRef.current === pending) {
          pendingAttachRef.current = null;
          setAsyncAttachError(error);
        }
      });
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

  if (asyncAttachError != null) {
    throw asyncAttachError;
  }

  return {
    ...renderData,
    ref,
    getHoveredLine,
    getAnnotationSlotName,
  };
}

interface UseEffectiveFileDiffProps<LAnnotation, Caret> {
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>;
  fileDiff: FileDiffMetadata | undefined;
  newFile: FileContents | null | undefined;
  oldFile: FileContents | null | undefined;
  parseDiffOptions: FileDiffOptions<LAnnotation, Caret>['parseDiffOptions'];
}

// Return the diff to render: the fileDiff prop, or a parse of the file props.
// While the file props still match the accepted edit's original or completed
// files, return the accepted diff instead. Other files remove the filePair
// entry. The ref is read and written during render on purpose, so that stays
// in this hook instead of the caller.
function useEffectiveFileDiff<LAnnotation, Caret>({
  acceptedCache,
  fileDiff,
  newFile,
  oldFile,
  parseDiffOptions,
}: UseEffectiveFileDiffProps<LAnnotation, Caret>): FileDiffMetadata {
  /* oxlint-disable react/immutability react/refs -- accepted edit output must
   * replace stale file-pair props during render */
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
      parseDiffOptions
    );
  }, [acceptedCache, fileDiff, oldFile, newFile, parseDiffOptions]);
  /* oxlint-enable react/immutability react/refs */

  return effectiveFileDiff;
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

// Read the accepted values on every render. Entries are only removed in the
// effect, by resolveAcceptedValues. The cache changes without new props, so
// this must not be memoized.
function useAcceptedValues<LAnnotation>(
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>,
  fileDiff: FileDiffMetadata,
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined
): FileDiffRenderInput<LAnnotation> {
  'use no memo';
  // oxlint-disable-next-line react/refs -- the cache changes without new props
  return getAcceptedValues(fileDiff, lineAnnotations, acceptedCache.current);
}

// Use the accepted values for props that still hold their pre-edit values.
function getAcceptedValues<LAnnotation>(
  fileDiff: FileDiffMetadata,
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
  accepted: AcceptedCompletion<LAnnotation> | null
): FileDiffRenderInput<LAnnotation> {
  return {
    fileDiff:
      accepted?.fileDiff != null &&
      areDiffTargetsEqual(fileDiff, accepted.fileDiff.stale)
        ? accepted.fileDiff.installed
        : fileDiff,
    lineAnnotations:
      accepted?.annotations != null &&
      lineAnnotations === accepted.annotations.stale
        ? accepted.annotations.installed
        : lineAnnotations,
  };
}

// Return the accepted values, and drop each one once its prop no longer holds
// the pre-edit value. useEffectiveFileDiff drops the filePair entry. The cache
// is cleared once every entry is dropped.
function resolveAcceptedValues<LAnnotation>(
  fileDiff: FileDiffMetadata,
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
  acceptedCache: RefObject<AcceptedCompletion<LAnnotation> | null>
): FileDiffRenderInput<LAnnotation> {
  const { current: accepted } = acceptedCache;
  const resolved = getAcceptedValues(fileDiff, lineAnnotations, accepted);
  if (accepted == null) {
    return resolved;
  }
  if (
    accepted.fileDiff != null &&
    !areDiffTargetsEqual(fileDiff, accepted.fileDiff.stale)
  ) {
    accepted.fileDiff = null;
  }
  if (lineAnnotations !== accepted.annotations?.stale) {
    accepted.annotations = null;
  }
  if (
    accepted.fileDiff == null &&
    accepted.annotations == null &&
    accepted.filePair == null
  ) {
    acceptedCache.current = null;
  }
  return resolved;
}

interface MergeFileDiffOptionsProps<LAnnotation, Caret> {
  controlledSelection: boolean;
  hasCustomHeader: boolean;
  hasGutterRenderUtility: boolean;
  onEditChange?: FileDiffEditChangeHandler<LAnnotation, Caret>;
  onEditComplete?: FileDiffEditCompleteHandler<LAnnotation, Caret>;
  options: FileDiffOptions<LAnnotation, Caret> | undefined;
}

function mergeFileDiffOptions<LAnnotation, Caret>({
  options,
  controlledSelection,
  hasCustomHeader,
  hasGutterRenderUtility,
  onEditChange,
  onEditComplete,
}: MergeFileDiffOptionsProps<LAnnotation, Caret>): FileDiffOptions<
  LAnnotation,
  Caret
> {
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

function applyEdit<LAnnotation, Caret>(
  instance: FileDiff<LAnnotation, Caret>,
  getEditor: () => Editor<'file-diff', LAnnotation, Caret>
): () => void {
  const editor = getEditor();
  try {
    return editor.edit(instance);
  } catch (error) {
    editor.cleanUp();
    throw error;
  }
}
