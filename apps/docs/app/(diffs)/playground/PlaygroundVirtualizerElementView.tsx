'use client';

import {
  type AnnotationSide,
  type DiffLineAnnotation,
  type FileDiffEditCompleteEvent,
  type FileDiffMetadata,
  type FileDiffOptions,
  type FileEditCompleteEvent,
  type FileOptions,
  type LineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { EditorOptions, EditorType } from '@pierre/diffs/edit';
import {
  File,
  FileDiff,
  useStableCallback,
  Virtualizer,
} from '@pierre/diffs/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { PlaygroundAnnotationMetadata } from './constants';
import { ITEM_UNSAFE_CSS, LONG_README_FILE } from './constants';
import type { SharedRenderOptions } from './PlaygroundClient';
import { CommentForm, CommentThread } from './PlaygroundComments';
import { EditSessionButtons } from './PlaygroundEditButtons';

const SCROLL_REGION_STYLES = { height: '70vh', overflow: 'auto' } as const;

interface PlaygroundVirtualizerElementViewProps {
  diffs: FileDiffMetadata[];
  options: SharedRenderOptions;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
  editPrediction: NonNullable<
    EditorOptions<
      EditorType,
      PlaygroundAnnotationMetadata,
      undefined
    >['editPrediction']
  >;
}

// Renders the diff list through the React <Virtualizer> wrapper, which always
// scrolls inside its own element — so this view mimics the CodeView mode's
// fixed-height scroll region, in contrast to the window-scroll variant that
// drives the vanilla Virtualizer against `document`. Any React <FileDiff>
// nested under <Virtualizer> auto-virtualizes through context; no imperative
// wiring is needed. The long README plain file leads the list (as in
// CodeView), rendered through <File>, which virtualizes the same way.
export function PlaygroundVirtualizerElementView({
  diffs,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
  editPrediction,
}: PlaygroundVirtualizerElementViewProps) {
  return (
    <Virtualizer
      className="border-border rounded-lg border"
      style={SCROLL_REGION_STYLES}
    >
      <ElementVirtualizerFile
        options={options}
        enableLineSelection={enableLineSelection}
        enableGutterComments={enableGutterComments}
        showAnnotations={showAnnotations}
        editPrediction={editPrediction}
      />
      {diffs.map((fileDiff) => (
        <ElementVirtualizerDiff
          key={fileDiff.name}
          fileDiff={fileDiff}
          options={options}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterComments}
          showAnnotations={showAnnotations}
          editPrediction={editPrediction}
        />
      ))}
    </Virtualizer>
  );
}

interface ElementVirtualizerFileProps {
  options: SharedRenderOptions;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
  editPrediction: NonNullable<
    EditorOptions<
      'file',
      PlaygroundAnnotationMetadata,
      undefined
    >['editPrediction']
  >;
}

const EMPTY_FILE_ANNOTATIONS: LineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];

// The long README plain-file component leading the list. It owns the same edit,
// line-selection, and gutter-comment behavior as each diff below it.
function ElementVirtualizerFile({
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
  editPrediction,
}: ElementVirtualizerFileProps) {
  const [file, setFile] = useState(LONG_README_FILE);
  const [editing, setEditing] = useState(false);
  // Cancel marks the session before turning edit off; the completion handler
  // consumes the mark to revert instead of accept.
  const cancelled = useRef(false);
  const savedVersion = useRef(0);
  const [annotations, setAnnotations] = useState<
    LineAnnotation<PlaygroundAnnotationMetadata>[]
  >([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(
    null
  );
  // Starts `true` so mounting with annotations hidden clears the selection
  // the same way toggling them off later does.
  const [previousShowAnnotations, setPreviousShowAnnotations] = useState(true);

  const editorOptions = useMemo<
    EditorOptions<'file', PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      editPrediction,
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }),
    [editPrediction]
  );

  // Save accepts the completed file under a fresh cacheKey and stores it as
  // the component's file; Cancel reverts to the current one.
  const handleEditComplete = useCallback(
    (event: FileEditCompleteEvent<PlaygroundAnnotationMetadata, undefined>) => {
      if (cancelled.current) {
        cancelled.current = false;
        return 'reject';
      }
      savedVersion.current += 1;
      event.file.cacheKey = `${event.file.name}:v${savedVersion.current}`;
      setFile(event.file);
      // Adopt the session's final annotation positions so the comment
      // portals render into the accepted (moved) slots.
      if (event.lineAnnotations != null) {
        setAnnotations(event.lineAnnotations);
      }
      return 'accept';
    },
    []
  );

  const addCommentAtRange = useCallback((range: SelectedLineRange) => {
    const lineNumber = range.end;
    setAnnotations((current) =>
      current.some((annotation) => annotation.lineNumber === lineNumber)
        ? current
        : [
            ...current,
            {
              lineNumber,
              metadata: { key: `line-${lineNumber}`, isThread: false },
            },
          ]
    );
  }, []);

  const removeCommentAtLine = useCallback(
    (_side: AnnotationSide | undefined, lineNumber: number) => {
      setAnnotations((current) =>
        current.filter((annotation) => annotation.lineNumber !== lineNumber)
      );
      setSelectedLines(null);
    },
    []
  );

  const submitCommentAtLine = useCallback(
    (_side: AnnotationSide | undefined, lineNumber: number, body: string) => {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.lineNumber === lineNumber
            ? { ...annotation, metadata: { ...annotation.metadata, body } }
            : annotation
        )
      );
      setSelectedLines(null);
    },
    []
  );

  if (previousShowAnnotations !== showAnnotations) {
    setPreviousShowAnnotations(showAnnotations);
    if (!showAnnotations) {
      setSelectedLines(null);
    }
  }

  const hasOpenCommentForm = annotations.some(
    (annotation) => annotation.metadata.body == null
  );
  const canSelectLines =
    enableLineSelection && !enableGutterComments && !hasOpenCommentForm;
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const fileOptions = useMemo<
    FileOptions<PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      ...options,
      stickyHeader: true,
      unsafeCSS: ITEM_UNSAFE_CSS,
      enableLineSelection: canSelectLines,
      enableGutterUtility: canUseGutterComments,
      onLineSelectionStart: setSelectedLines,
      onLineSelectionChange: setSelectedLines,
      onLineSelectionEnd: setSelectedLines,
      onGutterUtilityClick: canUseGutterComments
        ? addCommentAtRange
        : undefined,
    }),
    [options, canSelectLines, canUseGutterComments, addCommentAtRange]
  );

  const renderAnnotation = useStableCallback(
    (annotation: LineAnnotation<PlaygroundAnnotationMetadata>) => {
      return annotation.metadata.body != null ? (
        <CommentThread
          body={annotation.metadata.body}
          onDelete={() => removeCommentAtLine(undefined, annotation.lineNumber)}
        />
      ) : (
        <CommentForm
          side={undefined}
          lineNumber={annotation.lineNumber}
          onCancel={removeCommentAtLine}
          onSubmit={submitCommentAtLine}
        />
      );
    }
  );

  // Must NOT be a stable callback — see ElementVirtualizerDiff's
  // renderHeaderMetadata for why a per-`editing` useCallback is required.
  const renderHeaderMetadata = useCallback(
    () => (
      <EditSessionButtons
        editing={editing}
        onEdit={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        onCancel={() => {
          cancelled.current = true;
          setEditing(false);
        }}
        onSave={() => {
          cancelled.current = false;
          setEditing(false);
        }}
      />
    ),
    [editing]
  );

  return (
    <File
      file={file}
      edit={editing}
      selectedLines={selectedLines}
      lineAnnotations={showAnnotations ? annotations : EMPTY_FILE_ANNOTATIONS}
      options={fileOptions}
      editorOptions={editorOptions}
      onEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}

interface ElementVirtualizerDiffProps {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<PlaygroundAnnotationMetadata, undefined>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
  editPrediction: NonNullable<
    EditorOptions<
      'file-diff',
      PlaygroundAnnotationMetadata,
      undefined
    >['editPrediction']
  >;
}

const EMPTY_ANNOTATIONS: DiffLineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];

// One diff in the element-scroll list. Each component is its own state island
// with an edit toggle, editor options, and annotations. The app-level
// EditProvider creates an independent editor when that component enters edit
// mode.
function ElementVirtualizerDiff({
  fileDiff,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
  editPrediction,
}: ElementVirtualizerDiffProps) {
  const [currentDiff, setCurrentDiff] = useState(fileDiff);
  const [editing, setEditing] = useState(false);
  // Cancel marks the session before turning edit off; the completion handler
  // consumes the mark to revert instead of accept.
  const cancelled = useRef(false);
  const savedVersion = useRef(0);
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<PlaygroundAnnotationMetadata>[]
  >([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(
    null
  );
  // Starts `true` so mounting with annotations hidden clears the selection
  // the same way toggling them off later does.
  const [previousShowAnnotations, setPreviousShowAnnotations] = useState(true);

  const editorOptions = useMemo<
    EditorOptions<'file-diff', PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      editPrediction,
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }),
    [editPrediction]
  );

  // Save accepts the completed diff under a fresh cacheKey and stores it as
  // the component's diff; Cancel reverts to the current one.
  const handleEditComplete = useCallback(
    (
      event: FileDiffEditCompleteEvent<PlaygroundAnnotationMetadata, undefined>
    ) => {
      if (cancelled.current) {
        cancelled.current = false;
        return 'reject';
      }
      savedVersion.current += 1;
      event.fileDiff.cacheKey = `${event.fileDiff.name}:v${savedVersion.current}`;
      setCurrentDiff(event.fileDiff);
      if (event.lineAnnotations != null) {
        setAnnotations(event.lineAnnotations);
      }
      return 'accept';
    },
    []
  );

  const addCommentAtRange = useCallback((range: SelectedLineRange) => {
    const side = range.endSide ?? range.side;
    if (side == null) {
      return;
    }
    const lineNumber = range.end;
    setAnnotations((current) =>
      current.some(
        (annotation) =>
          annotation.side === side && annotation.lineNumber === lineNumber
      )
        ? current
        : [
            ...current,
            {
              side,
              lineNumber,
              metadata: { key: `${side}-${lineNumber}`, isThread: false },
            },
          ]
    );
  }, []);

  const removeCommentAtLine = useCallback(
    (side: AnnotationSide | undefined, lineNumber: number) => {
      setAnnotations((current) =>
        current.filter(
          (annotation) =>
            !(annotation.side === side && annotation.lineNumber === lineNumber)
        )
      );
      setSelectedLines(null);
    },
    []
  );

  // Submitting persists the form in place: the annotation keeps its position
  // and gains the typed body, which flips its rendering to a comment thread.
  const submitCommentAtLine = useCallback(
    (side: AnnotationSide | undefined, lineNumber: number, body: string) => {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.side === side && annotation.lineNumber === lineNumber
            ? { ...annotation, metadata: { ...annotation.metadata, body } }
            : annotation
        )
      );
      setSelectedLines(null);
    },
    []
  );

  if (previousShowAnnotations !== showAnnotations) {
    setPreviousShowAnnotations(showAnnotations);
    if (!showAnnotations) {
      setSelectedLines(null);
    }
  }

  // Match the other views' precedence: an open comment form (no submitted
  // body yet) pauses the gutter utility so another form cannot be opened
  // beneath it.
  const hasOpenCommentForm = annotations.some(
    (annotation) => annotation.metadata.body == null
  );
  const canSelectLines =
    enableLineSelection && !enableGutterComments && !hasOpenCommentForm;
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const fileDiffOptions = useMemo<
    FileDiffOptions<PlaygroundAnnotationMetadata, undefined>
  >(
    () => ({
      ...options,
      stickyHeader: true,
      unsafeCSS: ITEM_UNSAFE_CSS,
      enableLineSelection: canSelectLines,
      enableGutterUtility: canUseGutterComments,
      onLineSelectionStart: setSelectedLines,
      onLineSelectionChange: setSelectedLines,
      onLineSelectionEnd: setSelectedLines,
      onGutterUtilityClick: canUseGutterComments
        ? addCommentAtRange
        : undefined,
    }),
    [options, canSelectLines, canUseGutterComments, addCommentAtRange]
  );

  const renderAnnotation = useStableCallback(
    (annotation: DiffLineAnnotation<PlaygroundAnnotationMetadata>) => {
      return annotation.metadata.body != null ? (
        <CommentThread
          body={annotation.metadata.body}
          onDelete={() =>
            removeCommentAtLine(annotation.side, annotation.lineNumber)
          }
        />
      ) : (
        <CommentForm
          side={annotation.side}
          lineNumber={annotation.lineNumber}
          onCancel={removeCommentAtLine}
          onSubmit={submitCommentAtLine}
        />
      );
    }
  );

  // Must NOT be a stable callback: FileDiff invokes renderHeaderMetadata
  // synchronously during render, but useStableCallback only refreshes its inner
  // ref in a commit-phase insertion effect. Reading `editing` (render-phase
  // state) through a stable wrapper would render the button one toggle behind —
  // the header would reflect the previous `editing` value. A per-`editing`
  // useCallback hands renderDiffChildren the current closure each toggle.
  const renderHeaderMetadata = useCallback(
    () => (
      <EditSessionButtons
        editing={editing}
        onEdit={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        onCancel={() => {
          cancelled.current = true;
          setEditing(false);
        }}
        onSave={() => {
          cancelled.current = false;
          setEditing(false);
        }}
      />
    ),
    [editing]
  );

  return (
    <FileDiff
      fileDiff={currentDiff}
      edit={editing}
      selectedLines={selectedLines}
      lineAnnotations={showAnnotations ? annotations : EMPTY_ANNOTATIONS}
      options={fileDiffOptions}
      editorOptions={editorOptions}
      onEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}
