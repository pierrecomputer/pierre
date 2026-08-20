'use client';

import {
  type AnnotationSide,
  type CodeViewItem,
  type CodeViewLineSelection,
  type DiffLineAnnotation,
  type FileDiffEditCompleteEvent,
  type FileEditCompleteEvent,
  type LineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs';
import type { EditorOptions } from '@pierre/diffs/edit';
import {
  CodeView,
  type CodeViewReactOptions,
  useStableCallback,
} from '@pierre/diffs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaygroundAnnotationMetadata } from './constants';
import {
  CommentForm,
  CommentThread,
  ExampleThread,
} from './PlaygroundComments';
import { EditSessionButtons } from './PlaygroundEditButtons';

const CODE_VIEW_STYLES = { height: '70vh', overflow: 'auto' } as const;

type PlaygroundItem = CodeViewItem<PlaygroundAnnotationMetadata>;

const CODE_VIEW_EDITOR_OPTIONS: EditorOptions<PlaygroundAnnotationMetadata> = {
  onAttach(editor) {
    editor.focus({ lineNumber: 'first-visible', preventScroll: true });
  },
};

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
// button that starts a session, replaced by Cancel/Save while editing (any
// number of items can be in edit mode at once). CodeView creates one Editor per edited item through the
// app-level EditProvider and keeps it attached across virtualization
// scroll-out, so unsaved edits and undo history survive scrolling. Save and
// Cancel both end the session by turning edit off; `onItemEditComplete` then
// accepts by returning the built next item (Save) or reverts by returning
// null (Cancel, marked before the toggle).
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

  // Item ids whose next completion should revert: Cancel marks the id here
  // before turning edit off, and the completion handler consumes the mark.
  const cancelledEdits = useRef<Set<string>>(new Set());

  const toggleEdit = useCallback((id: string, edit: boolean) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, edit, version: (item.version ?? 0) + 1 }
          : item
      )
    );
  }, []);

  // Committing a finished edit session: stamp a fresh cacheKey on the
  // completed file/fileDiff and return the nextItem CodeView built from it.
  // CodeView installs the value and applies nextItem itself; mirroring the
  // same object into React state keeps the controlled collection matching
  // (equal versions make the props push a no-op).
  const handleEditComplete = useCallback(
    (
      event:
        | FileEditCompleteEvent<PlaygroundAnnotationMetadata>
        | FileDiffEditCompleteEvent<PlaygroundAnnotationMetadata>,
      item: PlaygroundItem,
      nextItem: PlaygroundItem
    ): PlaygroundItem | null => {
      if (cancelledEdits.current.delete(item.id)) {
        return null;
      }
      const cacheKey = `${item.id}:v${nextItem.version}`;
      if ('file' in event) {
        event.file.cacheKey = cacheKey;
      } else {
        event.fileDiff.cacheKey = cacheKey;
      }
      setItems((current) =>
        current.map((existing) =>
          existing.id === item.id ? nextItem : existing
        )
      );
      return nextItem;
    },
    []
  );

  // Mirrors the direct Diff view's addCommentAtRange, but stores the annotation on
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

  // Match the direct views' precedence: an open comment form (neither a
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

  const renderHeaderMetadata = useStableCallback((item: PlaygroundItem) => (
    <EditSessionButtons
      editing={item.edit === true}
      onEdit={() => toggleEdit(item.id, true)}
      onCancel={() => {
        cancelledEdits.current.add(item.id);
        toggleEdit(item.id, false);
      }}
      onSave={() => toggleEdit(item.id, false)}
    />
  ));

  return (
    <CodeView
      editorOptions={CODE_VIEW_EDITOR_OPTIONS}
      items={items}
      className="border-border rounded-lg border"
      style={CODE_VIEW_STYLES}
      options={codeViewOptions}
      selectedLines={selectedLines}
      onSelectedLinesChange={setSelectedLines}
      onItemEditComplete={handleEditComplete}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  );
}
