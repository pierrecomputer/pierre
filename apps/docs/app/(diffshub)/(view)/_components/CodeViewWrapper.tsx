import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  DEFAULT_THEMES,
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
import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  incrementItemVersion,
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

interface CodeViewWrapperProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  onCommentDeleted?(comment: CodeViewDeletedCommentEvent): void;
  onCommentSaved?(comment: CodeViewSavedCommentEvent): void;
  overflow: 'wrap' | 'scroll';
  showBackgrounds: boolean;
  lineNumbers: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
  items: CodeViewItem<CommentMetadata>[];
  setItems: Dispatch<SetStateAction<CodeViewItem<CommentMetadata>[]>>;
}

export const CodeViewWrapper = memo(function CodeViewWrapper({
  className,
  diffStyle,
  onCommentDeleted,
  onCommentSaved,
  overflow,
  showBackgrounds,
  lineNumbers,
  scrollRef,
  viewerRef,
  items,
  setItems,
}: CodeViewWrapperProps) {
  const nextCommentKeyRef = useRef(0);
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
      setItems((prev) => {
        const next = [...prev];
        let changed = false;

        for (const item of next) {
          if (item.type !== 'diff' || item.annotations == null) {
            continue;
          }

          const nextAnnotations = item.annotations.filter(
            (annotation) => !isDraftMetadata(annotation.metadata)
          );

          if (nextAnnotations.length === item.annotations.length) {
            continue;
          }

          item.annotations = nextAnnotations;
          incrementItemVersion(item);
          changed = true;
        }

        const item = next.find(
          (candidate): candidate is CodeViewDiffItem<CommentMetadata> =>
            candidate.id === itemId && isDiffItem(candidate)
        );

        if (item == null) {
          return changed ? next : prev;
        }

        const nextAnnotations = [...(item.annotations ?? [])];
        nextAnnotations.push({
          side,
          lineNumber,
          metadata: {
            kind: 'draft',
            key: commentKey,
            message: '',
            range,
          },
        });
        item.annotations = nextAnnotations;
        incrementItemVersion(item);
        return next;
      });
    }
  );

  const handleRemoveComment = useStableCallback(
    (itemId: string, key: string) => {
      const item = items.find(
        (candidate): candidate is CodeViewDiffItem<CommentMetadata> =>
          candidate.id === itemId && isDiffItem(candidate)
      );
      const removedAnnotation = item?.annotations?.find(
        (annotation) => annotation.metadata.key === key
      );

      setItems((prev) => {
        const next = [...prev];
        const item = next.find(
          (candidate): candidate is CodeViewDiffItem<CommentMetadata> =>
            candidate.id === itemId && isDiffItem(candidate)
        );

        if (item == null || item.annotations == null) {
          return prev;
        }

        const nextAnnotations = item.annotations.filter(
          (annotation) => annotation.metadata.key !== key
        );

        if (nextAnnotations.length === item.annotations.length) {
          return prev;
        }

        item.annotations = nextAnnotations;
        incrementItemVersion(item);
        return next;
      });

      setSelectedLines(null);
      if (removedAnnotation != null && isSavedAnnotation(removedAnnotation)) {
        onCommentDeleted?.({ itemId, key });
      }
    }
  );

  const handleSaveDraftComment = useStableCallback(
    (itemId: string, key: string, message: string) => {
      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        return;
      }

      const item = items.find(
        (candidate): candidate is CodeViewDiffItem<CommentMetadata> =>
          candidate.id === itemId && isDiffItem(candidate)
      );
      const draftAnnotation = item?.annotations?.find(
        (annotation) => annotation.metadata.key === key
      );
      if (draftAnnotation == null || !isDraftAnnotation(draftAnnotation)) {
        return;
      }

      setItems((prev) => {
        const next = [...prev];
        const item = next.find(
          (candidate): candidate is CodeViewDiffItem<CommentMetadata> =>
            candidate.id === itemId && isDiffItem(candidate)
        );

        if (item == null || item.annotations == null) {
          return prev;
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
          return prev;
        }

        item.annotations = nextAnnotations;
        incrementItemVersion(item);
        return next;
      });

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
    setItems((prev) => {
      const viewer = viewerRef.current?.getInstance();
      const itemIndex = prev.findIndex(
        (candidate) => candidate.id === itemId && isDiffItem(candidate)
      );
      const item = prev[itemIndex];
      if (item == null || viewer == null) {
        return prev;
      }

      const next = [...prev];
      next[itemIndex] = {
        ...item,
        collapsed: item.collapsed !== true,
        version: typeof item.version === 'number' ? item.version + 1 : 1,
      };
      // NOTE(amadeus): If the top of the item is before the scrollTop, then
      // we'll want to apply a scroll fix on the next render to ensure we
      // keep the collapsed file in view and anchored
      const itemTop = viewer.getTopForItem(itemId);
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
      return next;
    });
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
      lineNumbers,
      overflow,
      showBackgrounds,
    ]
  );
  return (
    <CodeView<CommentMetadata>
      ref={viewerRef}
      containerRef={scrollRef}
      items={items}
      className={cn(
        'gh-code-view-scrollbar-y mt-[-12px] h-[calc(100%_+_12px)] pr-[1px] relative min-h-0 min-w-0 flex-1 px-[1px] overflow-auto overscroll-contain w-full [contain:strict] [overflow-anchor:none] [will-change:scroll-position] [&_diffs-container]:overflow-clip [&_diffs-container]:rounded-lg [&_diffs-container]:shadow-[0_0_0_1px_var(--color-border)] [&_diffs-container]:[contain:layout_paint_style]',
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
