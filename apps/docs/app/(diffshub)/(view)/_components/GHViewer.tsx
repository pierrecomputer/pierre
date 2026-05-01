'use client';

import { type CodeViewItem } from '@pierre/diffs';
import { type CodeViewHandle } from '@pierre/diffs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CodeViewHeader } from './CodeViewHeader';
import { CodeViewSidebar } from './CodeViewSidebar';
import { CodeViewWrapper } from './CodeViewWrapper';
import { CODE_VIEW_MARGIN_OFFSET, CODE_VIEW_PADDING_BLOCK } from './constants';
import type {
  CodeViewCommentFileByItemId,
  CodeViewDeletedCommentEvent,
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentEvent,
  CodeViewSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  removeSavedCommentSidebarEntry,
  upsertSavedCommentSidebarEntry,
} from './utils';

interface GHViewerProps {
  initialUrl: string;
}

export function GHViewer({ initialUrl }: GHViewerProps) {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [key, setKey] = useState(0);
  const [items, setItems] = useState<CodeViewItem<CommentMetadata>[]>([]);
  // Tree data is intentionally stored separately from items so annotation
  // updates do not cascade into the file tree and trigger needless rebuilds.
  // It is rebuilt once per fetch inside CodeViewHeader.
  const [treeSource, setTreeSource] = useState<CodeViewFileTreeSource | null>(
    null
  );
  const [commentFileByItemId, setCommentFileByItemId] =
    useState<CodeViewCommentFileByItemId | null>(null);
  const [commentSections, setCommentSections] = useState<
    CodeViewSavedCommentItem[]
  >([]);
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateDiffStyle = (matches: boolean) => {
      setDiffStyle(matches ? 'unified' : 'split');
    };
    const handleChange = (event: MediaQueryListEvent) => {
      updateDiffStyle(event.matches);
    };

    updateDiffStyle(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  const handleSelectTreeItem = useCallback((itemId: string) => {
    setFileTreeOverlayOpen(false);
    viewerRef.current?.scrollTo({
      type: 'item',
      id: itemId,
      align: 'start',
      offset: CODE_VIEW_PADDING_BLOCK + CODE_VIEW_MARGIN_OFFSET,
      behavior: 'smooth',
    });
  }, []);
  const handleCommentSaved = useCallback(
    (comment: CodeViewSavedCommentEvent) => {
      setCommentSections((prev) =>
        upsertSavedCommentSidebarEntry(prev, commentFileByItemId, comment)
      );
    },
    [commentFileByItemId]
  );
  const handleCommentDeleted = useCallback(
    (comment: CodeViewDeletedCommentEvent) => {
      setCommentSections((prev) =>
        removeSavedCommentSidebarEntry(prev, comment)
      );
    },
    []
  );
  const handleToggleFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen((open) => !open);
  }, []);
  const handleCloseFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const handleSelectComment = useCallback(
    (comment: CodeViewSavedCommentEntry) => {
      setFileTreeOverlayOpen(false);
      viewerRef.current?.setSelectedLines({
        id: comment.itemId,
        range: comment.range,
      });
      viewerRef.current?.scrollTo({
        type: 'line',
        id: comment.itemId,
        lineNumber: comment.range.end,
        side: comment.range.endSide ?? comment.range.side,
        align: 'center',
        behavior: 'smooth-auto',
      });
    },
    []
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] contain-strict [grid-template-areas:'header''viewer'] md:grid-cols-[320px_minmax(0,1fr)] md:[grid-template-areas:'header_header''tree_viewer']">
      <CodeViewHeader
        className="z-10 m-2 mb-0 contain-layout contain-paint [grid-area:header]"
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        fileTreeOverlayOpen={fileTreeOverlayOpen}
        fileTreeAvailable={treeSource != null}
        overflow={overflow}
        onToggleFileTreeOverlay={handleToggleFileTreeOverlay}
        setCommentSections={setCommentSections}
        setCommentFileByItemId={setCommentFileByItemId}
        setItems={setItems}
        setOverflow={setOverflow}
        setDiffStyle={setDiffStyle}
        setKey={setKey}
        setTreeSource={setTreeSource}
        viewerRef={viewerRef}
      />
      <CodeViewSidebar
        commentSections={commentSections}
        mobileOverlayOpen={fileTreeOverlayOpen}
        onMobileClose={handleCloseFileTreeOverlay}
        onSelectComment={handleSelectComment}
        scrollRef={scrollRef}
        source={treeSource}
        onSelectItem={handleSelectTreeItem}
      />
      <CodeViewWrapper
        className="gh-code-view-scrollbar-y mt-[-12px] h-[calc(100%_+_12px)] pr-[3px] contain-strict [grid-area:viewer]"
        key={key}
        diffStyle={diffStyle}
        overflow={overflow}
        scrollRef={scrollRef}
        viewerRef={viewerRef}
        items={items}
        onCommentDeleted={handleCommentDeleted}
        onCommentSaved={handleCommentSaved}
        setItems={setItems}
      />
    </div>
  );
}
