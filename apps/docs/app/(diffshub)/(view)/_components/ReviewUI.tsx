'use client';

import {
  type CodeViewItem,
  type DiffIndicators,
  parsePatchFiles,
} from '@pierre/diffs';
import { type CodeViewHandle } from '@pierre/diffs/react';
import type { GitStatusEntry } from '@pierre/trees';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { CodeViewHeader } from './CodeViewHeader';
import { CodeViewSidebar } from './CodeViewSidebar';
import { CodeViewStatusPanel } from './CodeViewStatusPanel';
import { CodeViewWrapper } from './CodeViewWrapper';
import {
  CODE_VIEW_MARGIN_OFFSET,
  CODE_VIEW_PADDING_BLOCK,
  type ViewerLoadState,
} from './constants';
import type {
  CodeViewCommentFileByItemId,
  CodeViewCommentSidebarFile,
  CodeViewDeletedCommentEvent,
  CodeViewDiffStats,
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentEvent,
  CodeViewSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  createCodeViewFileTreeSource,
  getGitHubPath,
  mapChangeTypeToGitStatus,
  removeSavedCommentSidebarEntry,
  upsertSavedCommentSidebarEntry,
} from './utils';

const COMMIT_HASH_METADATA_PATTERN = /^From\s+([a-f0-9]+)\s/im;

interface LoadedCodeViewData {
  itemIdToFile: CodeViewCommentFileByItemId;
  diffStats: CodeViewDiffStats;
  items: CodeViewItem<CommentMetadata>[];
  treeSource: CodeViewFileTreeSource;
}

interface ReviewUIProps {
  initialUrl: string;
}

export function ReviewUI({ initialUrl }: ReviewUIProps) {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [items, setItems] = useState<CodeViewItem<CommentMetadata>[]>([]);
  // Tree data is intentionally stored separately from items so annotation
  // updates do not cascade into the file tree and trigger needless rebuilds.
  // It is rebuilt once per fetch in this viewer route.
  const [treeSource, setTreeSource] = useState<CodeViewFileTreeSource | null>(
    null
  );
  const [diffStats, setDiffStats] = useState<CodeViewDiffStats | null>(null);
  const [commentFileByItemId, setCommentFileByItemId] =
    useState<CodeViewCommentFileByItemId | null>(null);
  const [commentSections, setCommentSections] = useState<
    CodeViewSavedCommentItem[]
  >([]);
  const [loadState, setLoadState] = useState<ViewerLoadState>('fetching');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [diffIndicators, setDiffIndicators] = useState<DiffIndicators>('bars');
  const [lineNumbers, setLineNumbers] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const githubPath = getGitHubPath(initialUrl);
    if (githubPath == null) {
      setItems([]);
      setTreeSource(null);
      setDiffStats(null);
      setCommentFileByItemId(null);
      setCommentSections([]);
      setErrorMessage('Enter a valid GitHub URL.');
      setLoadState('error');
      return;
    }
    const resolvedGitHubPath = githubPath;

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () =>
      requestIdRef.current === requestId && !controller.signal.aborted;

    setItems([]);
    setTreeSource(null);
    setDiffStats(null);
    setCommentFileByItemId(null);
    setCommentSections([]);
    setFileTreeOverlayOpen(false);
    setErrorMessage(null);
    setLoadState('fetching');

    async function loadPatch() {
      try {
        console.time('--     request time');
        const response = await fetch(
          `/api/fetch-pr-patch?path=${encodeURIComponent(resolvedGitHubPath)}`,
          { signal: controller.signal }
        );
        console.timeEnd('--     request time');

        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error(
            detail.length > 0 ? detail : `Request failed (${response.status}).`
          );
        }

        console.time('--     reading patch');
        const patchContent = await response.text();
        console.timeEnd('--     reading patch');
        if (!isCurrentRequest()) {
          return;
        }
        setLoadState('parsing');
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

        if (!isCurrentRequest()) {
          return;
        }
        const loadedData = buildCodeViewData(patchContent, resolvedGitHubPath);
        if (!isCurrentRequest()) {
          return;
        }

        setTreeSource(loadedData.treeSource);
        setCommentFileByItemId(loadedData.itemIdToFile);
        setCommentSections([]);
        setDiffStats(loadedData.diffStats);
        setItems(loadedData.items);
        setLoadState('ready');
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to fetch the diff.'
        );
        setLoadState('error');
      }
    }

    void loadPatch();

    return () => {
      controller.abort();
    };
  }, [initialUrl, loadAttempt]);

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
  const handleRetryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
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
    <ReviewGrid>
      <CodeViewHeader
        className="[grid-area:header]"
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        loading={loadState === 'fetching' || loadState === 'parsing'}
        fileTreeOverlayOpen={fileTreeOverlayOpen}
        fileTreeAvailable={treeSource != null}
        overflow={overflow}
        onToggleFileTreeOverlay={handleToggleFileTreeOverlay}
        setOverflow={setOverflow}
        showBackgrounds={showBackgrounds}
        setShowBackgrounds={setShowBackgrounds}
        diffIndicators={diffIndicators}
        setDiffIndicators={setDiffIndicators}
        lineNumbers={lineNumbers}
        setLineNumbers={setLineNumbers}
        setDiffStyle={setDiffStyle}
      />
      {loadState === 'ready' ? (
        <>
          <CodeViewSidebar
            className="[grid-area:viewer] md:[grid-area:tree]"
            commentSections={commentSections}
            diffStats={diffStats}
            mobileOverlayOpen={fileTreeOverlayOpen}
            onMobileClose={handleCloseFileTreeOverlay}
            onSelectComment={handleSelectComment}
            scrollRef={scrollRef}
            source={treeSource}
            onSelectItem={handleSelectTreeItem}
          />
          <CodeViewWrapper
            className="[grid-area:viewer]"
            diffStyle={diffStyle}
            overflow={overflow}
            showBackgrounds={showBackgrounds}
            diffIndicators={diffIndicators}
            lineNumbers={lineNumbers}
            scrollRef={scrollRef}
            viewerRef={viewerRef}
            items={items}
            onCommentDeleted={handleCommentDeleted}
            onCommentSaved={handleCommentSaved}
            setItems={setItems}
          />
        </>
      ) : (
        <CodeViewStatusPanel
          state={loadState}
          errorMessage={errorMessage}
          onRetry={handleRetryLoad}
        />
      )}
    </ReviewGrid>
  );
}

interface ReviewGridProps {
  children: ReactNode;
}

function ReviewGrid({ children }: ReviewGridProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] contain-strict [grid-template-areas:'header''viewer'] md:grid-cols-[320px_minmax(0,1fr)] md:[grid-template-areas:'header_header''tree_viewer']">
      {children}
    </div>
  );
}

function getPatchTreePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_METADATA_PATTERN)?.[1];
  return commitHash != null
    ? commitHash.slice(0, 5)
    : `Commit ${patchIndex + 1}`;
}

// Converts raw patch text into the exact state slices consumed by the diff
// viewer, sidebar tree, stats panel, and comment index in one linear pass.
function buildCodeViewData(
  patchContent: string,
  githubPath: string
): LoadedCodeViewData {
  console.time('--  parsing patches');
  const parsedPatches = parsePatchFiles(
    patchContent,
    // Use the url as a cache key
    encodeURIComponent(githubPath)
  );
  console.timeEnd('--  parsing patches');

  console.time('-- computing layout');
  let fileIndex = 0;
  const items: CodeViewItem<CommentMetadata>[] = [];
  // Build the tree's path list, id map, and git-status entries in the same
  // pass that constructs items so large patches do not pay for a second walk.
  const paths: string[] = [];
  const pathToItemId = new Map<string, string>();
  const itemIdToFile = new Map<string, CodeViewCommentSidebarFile>();
  const gitStatus: GitStatusEntry[] = [];
  const diffStats: CodeViewDiffStats = {
    addedLines: 0,
    deletedLines: 0,
    fileCount: 0,
    totalLinesOfCode: 0,
  };
  const shouldPrefixTreePaths = parsedPatches.length > 1;
  for (const [patchIndex, patch] of parsedPatches.entries()) {
    const treePathPrefix = shouldPrefixTreePaths
      ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;
    for (const fileDiff of patch.files) {
      diffStats.fileCount++;
      diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
      for (const hunk of fileDiff.hunks) {
        diffStats.addedLines += hunk.additionLines;
        diffStats.deletedLines += hunk.deletionLines;
      }

      const id = `${fileIndex++}:${fileDiff.name}`;
      const fileOrder = items.length;

      items.push({
        id,
        type: 'diff',
        fileDiff,
        version: 0,
      });

      const path = fileDiff.name;
      itemIdToFile.set(id, { fileOrder, path });
      const treePath =
        treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
      if (path.length === 0 || pathToItemId.has(treePath)) {
        continue;
      }
      paths.push(treePath);
      pathToItemId.set(treePath, id);
      // Modified files are excluded so they render as the visual default.
      // Only added, deleted, and renamed files retain status indicators.
      const gitStatusEntry = mapChangeTypeToGitStatus(fileDiff.type);
      if (gitStatusEntry !== 'modified') {
        gitStatus.push({ path: treePath, status: gitStatusEntry });
      }
    }
  }
  console.timeEnd('-- computing layout');

  return {
    itemIdToFile,
    diffStats,
    items,
    treeSource: createCodeViewFileTreeSource(paths, pathToItemId, gitStatus),
  };
}
