import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  DEFAULT_THEMES,
  type DiffIndicators,
  type DiffLineAnnotation,
  type LineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs';
import {
  CodeView,
  type CodeViewHandle,
  useStableCallback,
} from '@pierre/diffs/react';
import { IconChevronSm } from '@pierre/icons';
import { memo, type RefObject, useMemo, useRef, useState } from 'react';

import {
  CODE_VIEW_CUSTOM_CSS,
  CODE_VIEW_MARGIN_OFFSET,
  CODE_VIEW_PADDING_BLOCK,
} from './constants';
import { DraftAnnotation } from './DraftAnnotation';
import { ExampleAnnotation } from './ExampleAnnotation';
import type {
  CodeViewDeletedCommentEvent,
  CodeViewSavedCommentEvent,
  CommentMetadata,
} from './types';
import {
  isDiffItem,
  isDraftAnnotation,
  isDraftMetadata,
  isSavedAnnotation,
} from './utils';
import { cn } from '@/lib/utils';

const VIEWER_METRICS = {
  gap: 12,
  paddingBottom: CODE_VIEW_PADDING_BLOCK,
  paddingTop: CODE_VIEW_PADDING_BLOCK + CODE_VIEW_MARGIN_OFFSET,
};

function getNextItemVersion(item: CodeViewItem<CommentMetadata>): number {
  return typeof item.version === 'number' ? item.version + 1 : 1;
}

function updateViewerDiffItem(
  viewer: CodeViewHandle<CommentMetadata>,
  itemId: string,
  updateItem: (item: CodeViewDiffItem<CommentMetadata>) => boolean
): CodeViewDiffItem<CommentMetadata> | undefined {
  const item = viewer.getItem(itemId);
  if (item == null || !isDiffItem(item)) {
    return undefined;
  }

  if (!updateItem(item)) {
    return undefined;
  }

  item.version = getNextItemVersion(item);
  return viewer.updateItem(item) ? item : undefined;
}

interface ActiveDraftComment {
  itemId: string;
  key: string;
}

interface CodeViewWrapperProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  onCommentDeleted?(comment: CodeViewDeletedCommentEvent): void;
  onCommentSaved?(comment: CodeViewSavedCommentEvent): void;
  overflow: 'wrap' | 'scroll';
  showBackgrounds: boolean;
  diffIndicators: DiffIndicators;
  lineNumbers: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
  initialItems: CodeViewItem<CommentMetadata>[];
}

export const CodeViewWrapper = memo(function CodeViewWrapper({
  className,
  diffStyle,
  onCommentDeleted,
  onCommentSaved,
  overflow,
  showBackgrounds,
  diffIndicators,
  lineNumbers,
  scrollRef,
  viewerRef,
  initialItems,
}: CodeViewWrapperProps) {
  const nextCommentKeyRef = useRef(0);
  const activeDraftRef = useRef<ActiveDraftComment | null>(null);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);

  const handleSetSelection = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      setSelectedLines(selection);
    }
  );

  const handleToggleCommentSelection = useStableCallback(
    (selection: CodeViewLineSelection) => {
      setSelectedLines((prev) =>
        prev?.id === selection.id &&
        areSelectionsEqual(prev.range, selection.range)
          ? null
          : selection
      );
    }
  );

  const handleCreateDraftComment = useStableCallback(
    (range: SelectedLineRange, itemId: string) => {
      const side = range.endSide ?? range.side;
      if (side == null) {
        return;
      }

      const lineNumber = range.end;
      const commentKey = `draft-${nextCommentKeyRef.current++}`;
      const { current: viewer } = viewerRef;
      if (viewer == null) {
        return;
      }

      const draftAnnotation: DiffLineAnnotation<CommentMetadata> = {
        side,
        lineNumber,
        metadata: {
          kind: 'draft',
          key: commentKey,
          message: '',
          range,
        },
      };

      const { current: activeDraft } = activeDraftRef;
      if (activeDraft != null && activeDraft.itemId !== itemId) {
        updateViewerDiffItem(viewer, activeDraft.itemId, (item) => {
          if (item.annotations == null) {
            return false;
          }

          const nextAnnotations = item.annotations.filter(
            (annotation) => annotation.metadata.key !== activeDraft.key
          );
          if (nextAnnotations.length === item.annotations.length) {
            return false;
          }

          item.annotations = nextAnnotations;
          return true;
        });
      }

      const updatedItem = updateViewerDiffItem(viewer, itemId, (item) => {
        const nonDraftAnnotations = (item.annotations ?? []).filter(
          (annotation) => !isDraftMetadata(annotation.metadata)
        );
        item.annotations = [...nonDraftAnnotations, draftAnnotation];
        return true;
      });

      if (updatedItem != null) {
        activeDraftRef.current = { itemId, key: commentKey };
      }
    }
  );

  const handleRemoveComment = useStableCallback(
    (itemId: string, key: string) => {
      const { current: viewer } = viewerRef;
      if (viewer == null) {
        return;
      }
      const item = viewer.getItem(itemId);
      const removedAnnotation =
        item != null && isDiffItem(item)
          ? item.annotations?.find(
              (annotation) => annotation.metadata.key === key
            )
          : undefined;

      updateViewerDiffItem(viewer, itemId, (item) => {
        if (item.annotations == null) {
          return false;
        }

        const nextAnnotations = item.annotations.filter(
          (annotation) => annotation.metadata.key !== key
        );

        if (nextAnnotations.length === item.annotations.length) {
          return false;
        }

        item.annotations = nextAnnotations;
        return true;
      });

      const { current: activeDraft } = activeDraftRef;
      if (activeDraft?.itemId === itemId && activeDraft.key === key) {
        activeDraftRef.current = null;
      }

      setSelectedLines(null);
      if (removedAnnotation != null && isSavedAnnotation(removedAnnotation)) {
        onCommentDeleted?.({ itemId, key });
      }
    }
  );

  const handleSaveDraftComment = useStableCallback(
    (itemId: string, key: string, message: string) => {
      const trimmedMessage = message.trim();
      const { current: viewer } = viewerRef;
      if (trimmedMessage.length === 0 || viewer == null) {
        return;
      }

      const item = viewer.getItem(itemId);
      if (item == null || !isDiffItem(item)) {
        return;
      }

      const draftAnnotation = item?.annotations?.find(
        (annotation) => annotation.metadata.key === key
      );
      if (draftAnnotation == null || !isDraftAnnotation(draftAnnotation)) {
        return;
      }

      const updatedItem = updateViewerDiffItem(viewer, itemId, (item) => {
        if (item.annotations == null) {
          return false;
        }

        const nextAnnotations: DiffLineAnnotation<CommentMetadata>[] =
          item.annotations.map((annotation) => {
            if (
              annotation.metadata.key !== key ||
              !isDraftAnnotation(annotation)
            ) {
              return annotation;
            }

            return {
              ...annotation,
              metadata: {
                kind: 'saved',
                key,
                author: 'you',
                message: trimmedMessage,
                range: annotation.metadata.range,
              },
            };
          });

        let didChange = false;
        for (let index = 0; index < nextAnnotations.length; index++) {
          if (nextAnnotations[index] !== item.annotations[index]) {
            didChange = true;
            break;
          }
        }

        if (!didChange) {
          return false;
        }

        item.annotations = nextAnnotations;
        return true;
      });

      if (updatedItem == null) {
        return;
      }

      const { current: activeDraft } = activeDraftRef;
      if (activeDraft?.itemId === itemId && activeDraft.key === key) {
        activeDraftRef.current = null;
      }

      setSelectedLines(null);
      onCommentSaved?.({
        author: 'you',
        itemId,
        key,
        lineNumber: draftAnnotation.lineNumber,
        message: trimmedMessage,
        range: draftAnnotation.metadata.range,
        side: draftAnnotation.side,
      });
    }
  );

  const handleToggleItemCollapsed = useStableCallback((itemId: string) => {
    const { current: viewerHandle } = viewerRef;
    const viewer = viewerHandle?.getInstance();
    const item = viewerHandle?.getItem(itemId);
    if (viewerHandle == null || viewer == null || item == null) {
      return;
    }

    // NOTE(amadeus): If the top of the item is before the scrollTop, then
    // we'll want to apply a scroll fix on the next render to ensure we
    // keep the collapsed file in view and anchored.
    const itemTop = viewer.getTopForItem(itemId);
    item.collapsed = item.collapsed !== true;
    item.version = getNextItemVersion(item);
    if (!viewerHandle.updateItem(item)) {
      return;
    }

    if (
      itemTop != null &&
      itemTop < viewer.getScrollTop() + CODE_VIEW_MARGIN_OFFSET
    ) {
      viewer.scrollTo({
        type: 'item',
        id: item.id,
        align: 'start',
        offset: CODE_VIEW_MARGIN_OFFSET,
      });
    }
  });

  const renderCommentAnnotation = useStableCallback(
    (
      annotation:
        | DiffLineAnnotation<CommentMetadata>
        | LineAnnotation<CommentMetadata>,
      item: CodeViewItem<CommentMetadata>
    ) => {
      if (!('side' in annotation) || item.type !== 'diff') {
        return null;
      }

      if (isDraftAnnotation(annotation)) {
        return (
          <DraftAnnotation
            annotation={annotation}
            itemId={item.id}
            onCancel={handleRemoveComment}
            onSave={handleSaveDraftComment}
          />
        );
      }

      if (!isSavedAnnotation(annotation)) {
        return null;
      }

      return (
        <ExampleAnnotation
          annotation={annotation}
          itemId={item.id}
          onDelete={handleRemoveComment}
          onToggleSelection={handleToggleCommentSelection}
        />
      );
    }
  );

  const renderHeaderPrefix = useStableCallback(
    (item: CodeViewItem<CommentMetadata>) => {
      if (item.type !== 'diff') {
        return null;
      }

      return (
        <CollapseDiffButton
          collapsed={item.collapsed === true}
          onToggle={() => handleToggleItemCollapsed(item.id)}
        />
      );
    }
  );

  // NOTE(amadeus): For some insane reason, the react compiler did not know how
  // to properly memoize this, so we pulled it into a `useMemo` for safety...
  const options: CodeViewOptions<CommentMetadata> = useMemo(
    () =>
      ({
        viewerMetrics: VIEWER_METRICS,
        theme: DEFAULT_THEMES,
        diffStyle,
        diffIndicators,
        overflow,
        disableBackground: !showBackgrounds,
        disableLineNumbers: !lineNumbers,
        lineHoverHighlight: 'number',
        // hunkSeparators: 'line-info-basic',
        // FIXME(amadeus): We need to optimize this...
        enableLineSelection: true,
        enableGutterUtility: true,
        stickyHeaders: true,
        unsafeCSS: CODE_VIEW_CUSTOM_CSS,
        onGutterUtilityClick(range, context) {
          if (context.item.type !== 'diff') {
            return;
          }
          handleCreateDraftComment(range, context.item.id);
        },
      }) satisfies CodeViewOptions<CommentMetadata>,
    [
      diffStyle,
      handleCreateDraftComment,
      diffIndicators,
      lineNumbers,
      overflow,
      showBackgrounds,
    ]
  );
  return (
    <CodeView<CommentMetadata>
      ref={viewerRef}
      containerRef={scrollRef}
      initialItems={initialItems}
      className={cn(
        'gh-code-view-scrollbar-y mt-[-12px] h-[calc(100%_+_12px)] relative min-h-0 min-w-0 flex-1 md:px-[1px] overflow-auto overscroll-contain w-full [contain:strict] [overflow-anchor:none] [will-change:scroll-position] [&_diffs-container]:overflow-clip md:[&_diffs-container]:rounded-lg [&_diffs-container]:shadow-[0_0_0_1px_var(--color-border)] [&_diffs-container]:[contain:layout_paint_style]',
        className
      )}
      options={options}
      selectedLines={selectedLines}
      onSelectedLinesChange={handleSetSelection}
      // To test annotations and headers and stuff...
      renderAnnotation={renderCommentAnnotation}
      renderHeaderPrefix={renderHeaderPrefix}
    />
  );
});

interface CollapseDiffButtonProps {
  collapsed: boolean;
  onToggle(): void;
}

function CollapseDiffButton({ collapsed, onToggle }: CollapseDiffButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand diff' : 'Collapse diff'}
      className="text-muted-foreground hover:bg-muted hover:text-foreground ml-[-8px] inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <IconChevronSm
        aria-hidden="true"
        className={cn('size-4 transition-transform', collapsed && '-rotate-90')}
      />
    </button>
  );
}
