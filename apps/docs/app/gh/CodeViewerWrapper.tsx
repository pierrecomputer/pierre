import {
  type CodeViewerDiffItem,
  type CodeViewerItem,
  type CodeViewerOptions,
  DEFAULT_THEMES,
  DEFAULT_VIRTUAL_FILE_METRICS,
  type DiffLineAnnotation,
  type LineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs';
import {
  CodeViewer,
  type CodeViewerHandle,
  useStableCallback,
} from '@pierre/diffs/react';
import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useMemo,
  useRef,
} from 'react';

import { DraftAnnotation } from './DraftAnnotation';
import { ExampleAnnotation } from './ExampleAnnotation';
import type { CommentMetadata } from './types';
import {
  incrementItemVersion,
  isDiffItem,
  isDraftAnnotation,
  isDraftMetadata,
  isSavedAnnotation,
} from './utils';
import { cn } from '@/lib/utils';

const unsafeCSS = `[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--diffs-bg);
}
@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}`;

const VIEWER_METRICS = { gap: 12, paddingBottom: 20, paddingTop: 20 };

interface CodeViewerWrapperProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  overflow: 'wrap' | 'scroll';
  scrollRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<CodeViewerHandle<CommentMetadata> | null>;
  items: CodeViewerItem<CommentMetadata>[];
  setItems: Dispatch<SetStateAction<CodeViewerItem<CommentMetadata>[]>>;
}

export const CodeViewerWrapper = memo(function CodeViewerWrapper({
  className,
  diffStyle,
  overflow,
  scrollRef,
  viewerRef,
  items,
  setItems,
}: CodeViewerWrapperProps) {
  const nextCommentKeyRef = useRef(0);

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
          (candidate): candidate is CodeViewerDiffItem<CommentMetadata> =>
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
      setItems((prev) => {
        const next = [...prev];
        const item = next.find(
          (candidate): candidate is CodeViewerDiffItem<CommentMetadata> =>
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
    }
  );

  const handleSaveDraftComment = useStableCallback(
    (itemId: string, key: string, message: string) => {
      const trimmedMessage = message.trim();
      if (trimmedMessage.length === 0) {
        return;
      }

      setItems((prev) => {
        const next = [...prev];
        const item = next.find(
          (candidate): candidate is CodeViewerDiffItem<CommentMetadata> =>
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
    }
  );

  const renderCommentAnnotation = useStableCallback(
    (
      annotation:
        | DiffLineAnnotation<CommentMetadata>
        | LineAnnotation<CommentMetadata>,
      item: CodeViewerItem<CommentMetadata>
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
        />
      );
    }
  );

  // NOTE(amadeus): For some insane reason, the react compiler did not know how
  // to properly memoize this, so we pulled it into a `useMemo` for safety...
  const options: CodeViewerOptions<CommentMetadata> = useMemo(
    () =>
      ({
        theme: DEFAULT_THEMES,
        diffStyle,
        overflow,
        lineHoverHighlight: 'number',
        // hunkSeparators: 'line-info-basic',
        // FIXME(amadeus): We need to optimize this...
        enableLineSelection: true,
        enableGutterUtility: true,
        unsafeCSS,
        onGutterUtilityClick(range, context) {
          if (context.item.type !== 'diff') {
            return;
          }
          handleCreateDraftComment(range, context.item.id);
        },
      }) satisfies CodeViewerOptions<CommentMetadata>,
    [diffStyle, handleCreateDraftComment, overflow]
  );
  return (
    <CodeViewer<CommentMetadata>
      ref={viewerRef}
      containerRef={scrollRef}
      items={items}
      className={cn(
        'border-border relative h-full min-h-0 min-w-0 flex-1 overflow-auto border-l px-5 w-full [contain:strict] [overflow-anchor:none] [overscroll-behavior-x:none] [will-change:scroll-position] [&_diffs-container]:overflow-clip [&_diffs-container]:rounded-lg [&_diffs-container]:shadow-[0_0_0_1px_var(--color-border)] [&_diffs-container]:[contain:layout_paint_style]',
        className
      )}
      viewerMetrics={VIEWER_METRICS}
      options={options}
      // To test annotations and headers and stuff...
      renderAnnotation={renderCommentAnnotation}
      // metrics={CUSTOM_HEADER_METRICS}
      // renderCustomHeader={renderHeader}
    />
  );
});

export const CUSTOM_HEADER_METRICS = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  diffHeaderHeight: 20,
};

export function renderHeader(item: CodeViewerItem<CommentMetadata>) {
  if (item.type === 'diff') {
    return <div>{item.fileDiff.name}</div>;
  }
  return null;
}
