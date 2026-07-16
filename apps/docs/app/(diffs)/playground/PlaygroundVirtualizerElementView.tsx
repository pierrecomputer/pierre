'use client';

import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditProvider, FileDiff, Virtualizer } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ITEM_UNSAFE_CSS } from './constants';
import { CommentForm } from './PlaygroundComments';

const SCROLL_REGION_STYLES = { height: '70vh', overflow: 'auto' } as const;

interface PlaygroundVirtualizerElementViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<undefined>;
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
  options: FileDiffOptions<undefined>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
}

// One diff in the element-scroll list. Each file is its own state island: a
// dedicated Editor (one editor binds to one instance, so per-file editing
// needs per-file editors/providers), its own edit toggle, and its own
// annotation list — all through the first-class React FileDiff props, the
// same way the Normal view is wired.
function ElementVirtualizerDiff({
  fileDiff,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
}: ElementVirtualizerDiffProps) {
  const editor = useMemo(() => new Editor<undefined>({}), []);
  const [editing, setEditing] = useState(false);
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<undefined>[]
  >([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(
    null
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
        : [...current, { side, lineNumber }]
    );
  }, []);

  const removeCommentAtLine = useCallback(
    (
      side: DiffLineAnnotation<undefined>['side'] | undefined,
      lineNumber: number
    ) => {
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

  useEffect(() => {
    if (!showAnnotations) {
      setSelectedLines(null);
    }
  }, [showAnnotations]);

  // Match the other views' precedence: an open comment form pauses the gutter
  // utility so another form cannot be opened beneath it.
  const hasOpenCommentForm = annotations.length > 0;
  const canSelectLines =
    enableLineSelection && !enableGutterComments && !hasOpenCommentForm;
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const fileDiffOptions = useMemo<FileDiffOptions<undefined>>(
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

  return (
    <EditProvider editor={editor}>
      <FileDiff
        fileDiff={fileDiff}
        contentEditable={editing}
        selectedLines={selectedLines}
        lineAnnotations={showAnnotations ? annotations : []}
        options={fileDiffOptions}
        renderHeaderMetadata={() => (
          <label className="flex cursor-pointer items-center gap-[4px] text-xs select-none">
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={editing}
              onChange={(event) => setEditing(event.target.checked)}
            />
            Edit
          </label>
        )}
        renderAnnotation={(annotation) => (
          <CommentForm
            side={annotation.side}
            lineNumber={annotation.lineNumber}
            onCancel={removeCommentAtLine}
          />
        )}
      />
    </EditProvider>
  );
}
