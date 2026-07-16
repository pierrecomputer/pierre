'use client';

import {
  type AnnotationSide,
  type CodeViewCreateEditorOptions,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileContents,
  type LineAnnotation,
  parseDiffFromFile,
  type SelectedLineRange,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { CodeView, useStableCallback } from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PlaygroundAnnotationMetadata } from './constants';
import { CommentForm, ExampleThread } from './PlaygroundComments';

const CODE_VIEW_STYLES = { height: '70vh', overflow: 'auto' } as const;

type PlaygroundItem = CodeViewItem<PlaygroundAnnotationMetadata>;

interface PlaygroundCodeViewProps {
  items: PlaygroundItem[];
  options: CodeViewOptions<PlaygroundAnnotationMetadata>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
}

// Renders a mix of diff and file items in a CodeView. Unlike the Virtualizer
// mode, CodeView manages its own scroll container, so we give it a fixed height
// and `overflow: auto`.
//
// This view also demos first-class item editing: each header carries an Edit
// checkbox that flips the item's `edit` flag (any number of items can be in
// edit mode at once). CodeView creates one Editor per edited item through
// `createEditor` and keeps it attached across virtualization scroll-out, so
// unsaved edits and undo history survive scrolling. When a session ends
// (checkbox off), `onItemEditComplete` hands us the final contents and we
// persist them back into the item — file items swap contents directly, diff
// items re-diff the edited new side against the original old side.
//
// Annotations ride on item data: a gutter utility gesture appends a comment
// form at its final line, and cancelling the form removes it again.
export function PlaygroundCodeView({
  items: initialItems,
  options,
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
}: PlaygroundCodeViewProps) {
  const [items, setItems] = useState(initialItems);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);

  const toggleEdit = useCallback((id: string, edit: boolean) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, edit, version: (item.version ?? 0) + 1 }
          : item
      )
    );
  }, []);

  // Committing a finished edit session is user-space: CodeView only ends the
  // session and reports the final contents through this lifecycle. The app
  // commits with one combined item write — the new file/fileDiff (fresh
  // cacheKey, since the contents changed) along with `edit: false`.
  const handleEditComplete = useCallback(
    (item: PlaygroundItem, file: FileContents) => {
      setItems((current) =>
        current.map((existing) => {
          if (existing.id !== item.id) {
            return existing;
          }
          const version = (existing.version ?? 0) + 1;
          const cacheKey = `${existing.id}:v${version}`;
          if (existing.type === 'file') {
            return {
              ...existing,
              file: { ...existing.file, contents: file.contents, cacheKey },
              edit: false,
              version,
            };
          }
          // Rebuild the diff against the edited new side. Generated diffs
          // carry the full old file in `deletionLines` (lines keep their
          // endings), so the original old side is recoverable from the item.
          const { fileDiff } = existing;
          return {
            ...existing,
            fileDiff: {
              ...parseDiffFromFile(
                {
                  name: fileDiff.prevName ?? fileDiff.name,
                  contents: fileDiff.deletionLines.join(''),
                },
                { name: fileDiff.name, contents: file.contents }
              ),
              cacheKey,
            },
            edit: false,
            version,
          };
        })
      );
    },
    []
  );

  // Mirrors the Normal view's addCommentAtRange, but stores the annotation on
  // the CodeView item that owns the selected range.
  const addCommentAtRange = useCallback(
    (itemId: string, range: SelectedLineRange) => {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          const side = range.endSide ?? range.side;
          const lineNumber = range.end;
          const version = (item.version ?? 0) + 1;
          const metadata: PlaygroundAnnotationMetadata = {
            key: `${side ?? 'line'}-${lineNumber}`,
            isThread: false,
          };
          if (item.type === 'file') {
            const annotations = item.annotations ?? [];
            if (annotations.some((a) => a.lineNumber === lineNumber)) {
              return item;
            }
            return {
              ...item,
              annotations: [...annotations, { lineNumber, metadata }],
              version,
            };
          }
          if (side == null) {
            return item;
          }
          const annotations = item.annotations ?? [];
          if (
            annotations.some(
              (a) => a.side === side && a.lineNumber === lineNumber
            )
          ) {
            return item;
          }
          return {
            ...item,
            annotations: [...annotations, { side, lineNumber, metadata }],
            version,
          };
        })
      );
    },
    []
  );

  const removeCommentAtLine = useCallback(
    (itemId: string, side: AnnotationSide | undefined, lineNumber: number) => {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          const version = (item.version ?? 0) + 1;
          if (item.type === 'file') {
            return {
              ...item,
              annotations: (item.annotations ?? []).filter(
                (a) => a.lineNumber !== lineNumber
              ),
              version,
            };
          }
          return {
            ...item,
            annotations: (item.annotations ?? []).filter(
              (a) => !(a.side === side && a.lineNumber === lineNumber)
            ),
            version,
          };
        })
      );
      setSelectedLines(null);
    },
    []
  );

  // Annotations live on item data, so hiding them is a data change: turning
  // the toggle off clears any comments that were added.
  useEffect(() => {
    if (showAnnotations) {
      return;
    }
    setSelectedLines(null);
    setItems((current) =>
      current.map((item) =>
        (item.annotations?.length ?? 0) > 0
          ? { ...item, annotations: [], version: (item.version ?? 0) + 1 }
          : item
      )
    );
  }, [showAnnotations]);

  // Match the Normal view's precedence: an open comment form pauses the
  // gutter utility so the form can't stack.
  const hasOpenCommentForm = items.some(
    (item) =>
      item.annotations?.some(
        (annotation) => annotation.metadata.isThread !== true
      ) === true
  );
  const canSelectLines =
    enableLineSelection && !enableGutterComments && !hasOpenCommentForm;
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const codeViewOptions = useMemo<
    CodeViewOptions<PlaygroundAnnotationMetadata>
  >(
    () => ({
      ...options,
      enableLineSelection: canSelectLines,
      enableGutterUtility: canUseGutterComments,
      onGutterUtilityClick: canUseGutterComments
        ? (range, context) => addCommentAtRange(context.item.id, range)
        : undefined,
    }),
    [options, canSelectLines, canUseGutterComments, addCommentAtRange]
  );

  const renderAnnotation = useStableCallback(
    (
      annotation:
        | LineAnnotation<PlaygroundAnnotationMetadata>
        | DiffLineAnnotation<PlaygroundAnnotationMetadata>,
      item: PlaygroundItem
    ) => {
      if (annotation.metadata.isThread === true) {
        return <ExampleThread />;
      }
      return (
        <CommentForm
          side={'side' in annotation ? annotation.side : undefined}
          lineNumber={annotation.lineNumber}
          onCancel={(side, lineNumber) =>
            removeCommentAtLine(item.id, side, lineNumber)
          }
        />
      );
    }
  );

  const renderHeaderMetadata = useStableCallback((item: PlaygroundItem) => {
    return (
      <label className="flex cursor-pointer items-center gap-[4px] text-xs select-none">
        <input
          type="checkbox"
          className="cursor-pointer"
          checked={item.edit === true}
          onChange={(event) => toggleEdit(item.id, event.target.checked)}
        />
        Edit
      </label>
    );
  });

  return (
    <CodeView
      items={items}
      className="border-border rounded-lg border"
      style={CODE_VIEW_STYLES}
      options={codeViewOptions}
      selectedLines={selectedLines}
      onSelectedLinesChange={setSelectedLines}
      createEditor={createEditor}
      onItemEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}

function createEditor(
  editorOptions: CodeViewCreateEditorOptions<PlaygroundAnnotationMetadata>
) {
  return new Editor(editorOptions);
}
