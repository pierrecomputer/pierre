'use client';

import {
  type AnnotationSide,
  type CodeViewItem,
  type CodeViewLineSelection,
  type DiffLineAnnotation,
  type FileContents,
  type LineAnnotation,
  parseDiffFromFile,
  type SelectedLineRange,
} from '@pierre/diffs';
import {
  CodeView,
  type CodeViewReactOptions,
  useStableCallback,
} from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';

import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CommentForm,
  CommentThread,
  ExampleThread,
} from './PlaygroundComments';

const CODE_VIEW_STYLES = { height: '70vh', overflow: 'auto' } as const;

type PlaygroundItem = CodeViewItem<PlaygroundAnnotationMetadata>;

interface PlaygroundCodeViewProps {
  items: PlaygroundItem[];
  options: CodeViewReactOptions<PlaygroundAnnotationMetadata>;
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
// edit mode at once). CodeView creates one Editor per edited item through the
// app-level EditProvider and keeps it attached across virtualization
// scroll-out, so unsaved edits and undo history survive scrolling. When a session ends
// (checkbox off), `onItemEditComplete` hands us the final contents and we
// persist them back into the item — file items swap contents directly, diff
// items re-diff the edited new side against the original old side.
//
// Annotations ride on item data: a gutter utility gesture appends a comment
// form at its final line, submitting persists it as a comment thread, and
// cancelling removes it again.
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

  // Edits remap annotation line numbers (an Enter above a comment shifts it
  // down); this writes the remapped set back to the owning item, with the
  // version bump every item-data change requires — CodeView drops
  // same-version pushes, and its render loop re-applies `item.annotations`
  // to the instance on every pass, so a stale item would snap the comment
  // back to its pre-edit line. flushSync commits in the same task as the
  // editor's shadow-slot rename (the items push is a layout effect), so the
  // comment is never projected nowhere between frames. The identity bail
  // keeps ordinary typing free: the editor passes the same array reference
  // when nothing remapped.
  const handleEditChange = useCallback(
    (
      item: PlaygroundItem,
      _file: FileContents,
      lineAnnotations?: DiffLineAnnotation<PlaygroundAnnotationMetadata>[]
    ) => {
      if (lineAnnotations == null) {
        return;
      }
      flushSync(() => {
        setItems((current) => {
          const target = current.find((existing) => existing.id === item.id);
          if (target == null || target.annotations === lineAnnotations) {
            return current;
          }
          return current.map((existing) =>
            existing.id === item.id
              ? {
                  ...existing,
                  annotations: lineAnnotations,
                  version: (existing.version ?? 0) + 1,
                }
              : existing
          );
        });
      });
    },
    []
  );

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

  // Submitting persists the form in place: the annotation keeps its position
  // and gains the typed body, which flips its rendering to a comment thread.
  const submitCommentAtLine = useCallback(
    (
      itemId: string,
      side: AnnotationSide | undefined,
      lineNumber: number,
      body: string
    ) => {
      setItems((current) =>
        current.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          const version = (item.version ?? 0) + 1;
          if (item.type === 'file') {
            return {
              ...item,
              annotations: (item.annotations ?? []).map((a) =>
                a.lineNumber === lineNumber
                  ? { ...a, metadata: { ...a.metadata, body } }
                  : a
              ),
              version,
            };
          }
          return {
            ...item,
            annotations: (item.annotations ?? []).map((a) =>
              a.side === side && a.lineNumber === lineNumber
                ? { ...a, metadata: { ...a.metadata, body } }
                : a
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

  // Match the Normal view's precedence: an open comment form (neither a
  // thread nor a submitted comment) pauses the gutter utility so forms can't
  // stack.
  const hasOpenCommentForm = items.some(
    (item) =>
      item.annotations?.some(
        (annotation) =>
          annotation.metadata.isThread !== true &&
          annotation.metadata.body == null
      ) === true
  );
  const canSelectLines =
    enableLineSelection && !enableGutterComments && !hasOpenCommentForm;
  const canUseGutterComments =
    enableGutterComments && showAnnotations && !hasOpenCommentForm;

  const codeViewOptions = useMemo<
    CodeViewReactOptions<PlaygroundAnnotationMetadata>
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
      const side = 'side' in annotation ? annotation.side : undefined;
      if (annotation.metadata.isThread === true) {
        return (
          <ExampleThread
            onDelete={() =>
              removeCommentAtLine(item.id, side, annotation.lineNumber)
            }
          />
        );
      }
      if (annotation.metadata.body != null) {
        return (
          <CommentThread
            body={annotation.metadata.body}
            onDelete={() =>
              removeCommentAtLine(item.id, side, annotation.lineNumber)
            }
          />
        );
      }
      return (
        <CommentForm
          side={side}
          lineNumber={annotation.lineNumber}
          onCancel={(side, lineNumber) =>
            removeCommentAtLine(item.id, side, lineNumber)
          }
          onSubmit={(side, lineNumber, body) =>
            submitCommentAtLine(item.id, side, lineNumber, body)
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
      onItemEditChange={handleEditChange}
      onItemEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}
