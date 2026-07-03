'use client';

import {
  type AnnotationSide,
  type CodeViewCreateEditorOptions,
  type CodeViewItem,
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
// Annotations ride on item data: a gutter click appends a comment-form
// annotation to the clicked item (with a version bump), and cancelling the
// form removes it again.
export function PlaygroundCodeView({
  items: initialItems,
  options,
  enableGutterComments,
  showAnnotations,
}: PlaygroundCodeViewProps) {
  const [items, setItems] = useState(initialItems);

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

  // Mirrors the Normal view's addCommentAtLine, but per item: the annotation
  // is appended to the clicked item's data with a version bump.
  const addCommentAtLine = useCallback(
    (itemId: string, range: SelectedLineRange) => {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          const version = (item.version ?? 0) + 1;
          const metadata: PlaygroundAnnotationMetadata = {
            key: `${range.side ?? 'line'}-${range.start}`,
            isThread: false,
          };
          if (item.type === 'file') {
            const annotations = item.annotations ?? [];
            if (annotations.some((a) => a.lineNumber === range.start)) {
              return item;
            }
            return {
              ...item,
              annotations: [
                ...annotations,
                { lineNumber: range.start, metadata },
              ],
              version,
            };
          }
          if (range.side == null) {
            return item;
          }
          const annotations = item.annotations ?? [];
          if (
            annotations.some(
              (a) => a.side === range.side && a.lineNumber === range.start
            )
          ) {
            return item;
          }
          return {
            ...item,
            annotations: [
              ...annotations,
              { side: range.side, lineNumber: range.start, metadata },
            ],
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
    },
    []
  );

  // Annotations live on item data, so hiding them is a data change: turning
  // the toggle off clears any comments that were added.
  useEffect(() => {
    if (showAnnotations) {
      return;
    }
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
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const codeViewOptions = useMemo<
    CodeViewOptions<PlaygroundAnnotationMetadata>
  >(
    () => ({
      ...options,
      enableGutterUtility: canUseGutterComments,
      onGutterUtilityClick: canUseGutterComments
        ? (range, context) => addCommentAtLine(context.item.id, range)
        : undefined,
    }),
    [options, canUseGutterComments, addCommentAtLine]
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
