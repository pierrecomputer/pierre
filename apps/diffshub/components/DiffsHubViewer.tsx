import {
  areSelectionsEqual,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffIndicators,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type LineAnnotation,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import { IconChevronSm } from '@pierre/icons';
import { memo, type RefObject, useMemo, useRef, useState } from 'react';

import { CommentForm } from './CommentForm';
import { FileComments } from './FileComments';
import { GitHubAccount } from './GitHubAccount';
import { GitHubComment } from './GitHubComment';
import { ThemedCodeView } from './ThemedCodeView';
import { useChromeThemeProps } from './useChromeThemeProps';
import type { GitHubCommentControls } from './useGitHubComments';
import { buildAnnotationThemeStyle } from '@/lib/annotationThemeStyle';
import { cn } from '@/lib/cn';
import { CODE_VIEW_CUSTOM_CSS, CODE_VIEW_LAYOUT } from '@/lib/constants';
import type { GitHubUser } from '@/lib/githubTypes';
import { isDiffItem } from '@/lib/isDiffItem';
import { isDraftAnnotation } from '@/lib/isDraftAnnotation';
import { isDraftMetadata } from '@/lib/isDraftMetadata';
import { isSavedAnnotation } from '@/lib/isSavedAnnotation';
import { diffshubChromeMapping } from '@/lib/theme/diffshubChromeMapping';
import type { CommentMetadata } from '@/lib/types';

function getNextItemVersion(item: CodeViewItem<CommentMetadata>): number {
  return typeof item.version === 'number' ? item.version + 1 : 1;
}

function updateViewerDiffItem(
  viewer: CodeViewHandle<CommentMetadata, undefined>,
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

interface DiffsHubViewerProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  comments: GitHubCommentControls;
  commentKind: 'pull' | 'commit' | null;
  user: GitHubUser | null;
  overflow: 'wrap' | 'scroll';
  showBackgrounds: boolean;
  diffIndicators: DiffIndicators;
  lineNumbers: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  themeType: ThemeTypes;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata, undefined> | null>;
  initialItems: CodeViewItem<CommentMetadata>[];
  loadDiffFiles?: FileDiffContentsLoader;
  onLineLinkChange(selection: CodeViewLineSelection | null): void;
  onViewerReady(): void;
}

export const DiffsHubViewer = memo(function DiffsHubViewer({
  className,
  diffStyle,
  comments,
  commentKind,
  user,
  overflow,
  showBackgrounds,
  diffIndicators,
  lineNumbers,
  scrollRef,
  themeType,
  viewerRef,
  initialItems,
  loadDiffFiles,
  onLineLinkChange,
  onViewerReady,
}: DiffsHubViewerProps) {
  const canComment = user != null && comments.ready && commentKind != null;
  const nextCommentKeyRef = useRef(0);
  const activeDraftRef = useRef<ActiveDraftComment | null>(null);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  const { style: chromeStyle } = useChromeThemeProps(diffshubChromeMapping);
  // Preserve the previous `undefined`-means-not-resolved contract that
  // buildAnnotationThemeStyle and the className fallbacks depend on.
  const themeChromeStyle =
    Object.keys(chromeStyle).length > 0 ? chromeStyle : undefined;
  const annotationThemeStyle = useMemo(
    () => buildAnnotationThemeStyle(themeChromeStyle),
    [themeChromeStyle]
  );

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

  const handleLineSelectionEnd = useStableCallback(
    (range: SelectedLineRange | null, item: CodeViewItem<CommentMetadata>) => {
      if (range == null || item.type !== 'diff') {
        onLineLinkChange(null);
      } else {
        onLineLinkChange({ id: item.id, range });
      }
    }
  );

  const handleViewerRef = useStableCallback(
    (viewer: CodeViewHandle<CommentMetadata, undefined> | null) => {
      viewerRef.current = viewer;
      if (viewer != null) {
        onViewerReady();
      }
    }
  );

  const handleCreateDraftComment = useStableCallback(
    (range: SelectedLineRange, itemId: string) => {
      if (!canComment) return;
      if (
        activeDraftRef.current != null &&
        !window.confirm('Discard the open line comment?')
      )
        return;
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
      onLineLinkChange(null);
    }
  );

  const handleSaveDraftComment = useStableCallback(
    async (
      itemId: string,
      key: string,
      message: string
    ): Promise<string | undefined> => {
      const item = viewerRef.current?.getItem(itemId);
      if (item == null || !isDiffItem(item))
        return 'The file is no longer available. Reload the diff.';
      const draft = item.annotations?.find(
        (annotation) => annotation.metadata.key === key
      );
      if (draft == null || !isDraftAnnotation(draft))
        return 'The draft is no longer available.';
      return comments.create(
        item.fileDiff.name,
        { kind: 'line', range: draft.metadata.range },
        message
      );
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

    if (itemTop != null && itemTop < viewer.getScrollTop()) {
      viewer.scrollTo({
        type: 'item',
        id: item.id,
        align: 'start',
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
        return user == null ? (
          <GitHubAccount />
        ) : (
          <CommentForm
            key={annotation.metadata.key}
            user={user}
            disabled={!canComment}
            onCancel={() =>
              handleRemoveComment(item.id, annotation.metadata.key)
            }
            onSave={(message) =>
              handleSaveDraftComment(item.id, annotation.metadata.key, message)
            }
          />
        );
      }

      if (!isSavedAnnotation(annotation)) {
        return null;
      }

      return (
        <GitHubComment
          comment={annotation.metadata.comment}
          userId={user?.id}
          onDelete={comments.remove}
          onSelect={() =>
            handleToggleCommentSelection({
              id: item.id,
              range: annotation.metadata.range,
            })
          }
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
          disabled={
            item.fileDiff.splitLineCount === 0 &&
            item.fileDiff.unifiedLineCount === 0
          }
          collapsed={item.collapsed}
          onToggle={() => handleToggleItemCollapsed(item.id)}
        />
      );
    }
  );

  const renderHeaderFilenameSuffix = (item: CodeViewItem<CommentMetadata>) =>
    commentKind === 'pull' && item.type === 'diff' ? (
      <FileComments path={item.fileDiff.name} comments={comments} user={user} />
    ) : null;

  // NOTE(amadeus): For some insane reason, the react compiler did not know how
  // to properly memoize this, so we pulled it into a `useMemo` for safety...
  const options: CodeViewOptions<CommentMetadata, undefined> = useMemo(
    () =>
      ({
        // Use this to validate itemMetrics when changing layout with unsafeCSS.
        // __devOnlyValidateItemHeights: true,
        layout: CODE_VIEW_LAYOUT,
        themeType,
        diffStyle,
        diffIndicators,
        overflow,
        loadDiffFiles,
        disableBackground: !showBackgrounds,
        disableLineNumbers: !lineNumbers,
        lineHoverHighlight: 'number',
        // hunkSeparators: 'line-info-basic',
        enableLineSelection: true,
        enableGutterUtility: canComment,
        stickyHeaders: true,
        unsafeCSS: CODE_VIEW_CUSTOM_CSS,
        // FIXME(amadeus): Move all `onX` methods onto the react component maybe?
        onGutterUtilityClick(range, context) {
          if (context.item.type !== 'diff') {
            return;
          }
          handleCreateDraftComment(range, context.item.id);
        },
        onLineSelectionEnd(range, context) {
          handleLineSelectionEnd(range, context.item);
        },
      }) satisfies CodeViewOptions<CommentMetadata, undefined>,
    [
      canComment,
      diffIndicators,
      diffStyle,
      handleCreateDraftComment,
      handleLineSelectionEnd,
      lineNumbers,
      loadDiffFiles,
      overflow,
      showBackgrounds,
      themeType,
    ]
  );
  return (
    <div className={cn(className, 'flex min-h-0 min-w-0 flex-col')}>
      {commentKind != null && (!canComment || comments.error != null) && (
        <p
          role="status"
          className="border-border text-muted-foreground border-b px-4 py-2 text-sm"
        >
          {comments.error ??
            (user == null
              ? 'Sign in with GitHub to comment on code.'
              : 'Loading GitHub comments…')}
        </p>
      )}
      <ThemedCodeView<CommentMetadata>
        ref={handleViewerRef}
        containerRef={scrollRef}
        initialItems={initialItems}
        className={cn(
          'cv-scrollbar relative h-full min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain border-b border-border w-full [contain:strict] [overflow-anchor:none] [will-change:scroll-position] md:border-b-0 [&_diffs-container]:overflow-clip [&_diffs-container]:[contain:layout_paint_style] [&_diffs-container]:shadow-[0_-1px_0_var(--diffshub-diff-separator,var(--color-border-opaque)),0_1px_0_var(--diffshub-diff-separator,var(--color-border-opaque))]'
        )}
        options={options}
        style={annotationThemeStyle}
        selectedLines={selectedLines}
        onSelectedLinesChange={handleSetSelection}
        renderAnnotation={renderCommentAnnotation}
        renderHeaderPrefix={renderHeaderPrefix}
        renderHeaderFilenameSuffix={renderHeaderFilenameSuffix}
      />
    </div>
  );
});

interface CollapseDiffButtonProps {
  disabled?: boolean;
  collapsed?: boolean;
  onToggle(): void;
}

function CollapseDiffButton({
  disabled = false,
  collapsed = false,
  onToggle,
}: CollapseDiffButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={!disabled && !collapsed}
      aria-hidden={disabled}
      aria-label={
        disabled ? undefined : collapsed ? 'Expand diff' : 'Collapse diff'
      }
      className="text-muted-foreground hover:bg-muted hover:text-foreground ml-[-8px] inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-50"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <IconChevronSm
        aria-hidden="true"
        className={cn(
          'size-4 transition-transform',
          (disabled || collapsed) && '-rotate-90'
        )}
      />
    </button>
  );
}
