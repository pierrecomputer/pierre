'use client';

import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffMetadata,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs';
import type { EditorOptions } from '@pierre/diffs/editor';
import { FileDiff, useStableCallback, Virtualizer } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

import type { PlaygroundAnnotationMetadata } from './constants';
import { ITEM_UNSAFE_CSS } from './constants';
import { CommentForm, CommentThread } from './PlaygroundComments';

const SCROLL_REGION_STYLES = { height: '70vh', overflow: 'auto' } as const;

interface PlaygroundVirtualizerElementViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<PlaygroundAnnotationMetadata>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
}

// Renders the diff list through the React <Virtualizer> wrapper, which always
// scrolls inside its own element — so this view mimics the CodeView mode's
// fixed-height scroll region, in contrast to the window-scroll variant that
// drives the vanilla Virtualizer against `document`. Any React <FileDiff>
// nested under <Virtualizer> auto-virtualizes through context; no imperative
// wiring is needed.
export function PlaygroundVirtualizerElementView({
  diffs,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
}: PlaygroundVirtualizerElementViewProps) {
  return (
    <Virtualizer
      className="border-border rounded-lg border"
      style={SCROLL_REGION_STYLES}
    >
      {diffs.map((fileDiff) => (
        <ElementVirtualizerDiff
          key={fileDiff.name}
          fileDiff={fileDiff}
          options={options}
          enableLineSelection={enableLineSelection}
          enableGutterComments={enableGutterComments}
          showAnnotations={showAnnotations}
        />
      ))}
    </Virtualizer>
  );
}

interface ElementVirtualizerDiffProps {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<PlaygroundAnnotationMetadata>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
}

const EMPTY_ANNOTATIONS: DiffLineAnnotation<PlaygroundAnnotationMetadata>[] =
  [];

// One diff in the element-scroll list. Each surface is its own state island
// with an edit toggle, edit options, and annotations. The app-level
// EditProvider creates an independent editor when that surface enters edit
// mode.
function ElementVirtualizerDiff({
  fileDiff,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
}: ElementVirtualizerDiffProps) {
  const [editing, setEditing] = useState(false);
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<PlaygroundAnnotationMetadata>[]
  >([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(
    null
  );

  // Edits remap annotation line numbers; onChange hands the remapped set back
  // so the `lineAnnotations` prop — and the React-slotted comment content
  // keyed by line number — follows the edit. The flushSync matters: the
  // editor renamed the shadow-DOM annotation slots during this same
  // keystroke, and a scheduled commit would leave the comments projected
  // nowhere for the frames in between.
  const editOptions = useMemo<EditorOptions<PlaygroundAnnotationMetadata>>(
    () => ({
      onChange(_file, lineAnnotations) {
        if (lineAnnotations != null) {
          flushSync(() => {
            setAnnotations(lineAnnotations);
          });
        }
      },
    }),
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

  useEffect(() => {
    if (!showAnnotations) {
      setSelectedLines(null);
    }
  }, [showAnnotations]);

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
    FileDiffOptions<PlaygroundAnnotationMetadata>
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

  const renderHeaderMetadata = useStableCallback(() => {
    return (
      <label className="flex cursor-pointer items-center gap-[4px] text-xs select-none">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={editing}
          onChange={(event) => setEditing(event.target.checked)}
        />
        Edit
      </label>
    );
  });

  return (
    <FileDiff
      fileDiff={fileDiff}
      edit={editing}
      selectedLines={selectedLines}
      lineAnnotations={showAnnotations ? annotations : EMPTY_ANNOTATIONS}
      options={fileDiffOptions}
      editOptions={editOptions}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}
