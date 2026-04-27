'use client';

import { type CodeViewerItem } from '@pierre/diffs';
import { type CodeViewerHandle } from '@pierre/diffs/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CodeViewerHeader } from './CodeViewerHeader';
import { CodeViewerSidebar } from './CodeViewerSidebar';
import { CodeViewerWrapper } from './CodeViewerWrapper';
import type {
  CodeViewerCommentFileByItemId,
  CodeViewerDeletedCommentEvent,
  CodeViewerFileTreeSource,
  CodeViewerSavedCommentEntry,
  CodeViewerSavedCommentEvent,
  CodeViewerSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  removeSavedCommentSidebarEntry,
  upsertSavedCommentSidebarEntry,
} from './utils';
import { WorkerPoolStatus } from './WorkerPoolStatus';

export function GHViewer() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [key, setKey] = useState(0);
  const [items, setItems] = useState<CodeViewerItem<CommentMetadata>[]>([]);
  // Tree data is intentionally stored separately from items so annotation
  // updates do not cascade into the file tree and trigger needless rebuilds.
  // It is rebuilt once per fetch inside CodeViewerHeader.
  const [treeSource, setTreeSource] = useState<CodeViewerFileTreeSource | null>(
    null
  );
  const [commentFileByItemId, setCommentFileByItemId] =
    useState<CodeViewerCommentFileByItemId | null>(null);
  const [commentSections, setCommentSections] = useState<
    CodeViewerSavedCommentItem[]
  >([]);
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewerHandle<CommentMetadata> | null>(null);
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
      offset: 20,
      behavior: 'smooth',
    });
  }, []);
  const handleCommentSaved = useCallback(
    (comment: CodeViewerSavedCommentEvent) => {
      setCommentSections((prev) =>
        upsertSavedCommentSidebarEntry(prev, commentFileByItemId, comment)
      );
    },
    [commentFileByItemId]
  );
  const handleCommentDeleted = useCallback(
    (comment: CodeViewerDeletedCommentEvent) => {
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
    (comment: CodeViewerSavedCommentEntry) => {
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
      <CodeViewerHeader
        className="contain-layout contain-paint [grid-area:header]"
        diffStyle={diffStyle}
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
      />
      <CodeViewerSidebar
        commentSections={commentSections}
        mobileOverlayOpen={fileTreeOverlayOpen}
        onMobileClose={handleCloseFileTreeOverlay}
        onSelectComment={handleSelectComment}
        source={treeSource}
        onSelectItem={handleSelectTreeItem}
      />
      <CodeViewerWrapper
        className="contain-strict [grid-area:viewer]"
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
      <WorkerPoolStatus scrollRef={scrollRef} />
    </div>
  );
}
