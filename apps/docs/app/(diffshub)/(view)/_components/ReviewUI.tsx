'use client';

import {
  type CodeViewItem,
  type DiffIndicators,
  type FileDiffMetadata,
  parsePatchFiles,
  processFile,
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
const GIT_FILE_BOUNDARY = 'diff --git ';
const GIT_FILE_BOUNDARY_WITH_NEWLINE = `\n${GIT_FILE_BOUNDARY}`;
const GIT_FILE_BOUNDARY_SCAN_OVERLAP =
  GIT_FILE_BOUNDARY_WITH_NEWLINE.length - 1;
const INITIAL_COLLAPSED_DIFF_LINE_THRESHOLD = 200_000;
const NON_WHITESPACE_PATTERN = /\S/;
const STREAM_PUBLISH_FILE_BATCH_SIZE = 25;
const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;

interface MutableCodeViewData {
  fileIndex: number;
  gitStatus: GitStatusEntry[];
  itemIdToFile: Map<string, CodeViewCommentSidebarFile>;
  items: CodeViewItem<CommentMetadata>[];
  pendingItems: CodeViewItem<CommentMetadata>[];
  pathToItemId: Map<string, string>;
  paths: string[];
  diffStats: CodeViewDiffStats;
}

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
  // It is updated by fetch/stream batches in this viewer route.
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
        const cacheKeyPrefix = encodeURIComponent(resolvedGitHubPath);
        async function commitFullPatch(patchContent: string) {
          if (!isCurrentRequest()) {
            return;
          }
          setLoadState('parsing');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

          if (!isCurrentRequest()) {
            return;
          }
          const loadedData = buildCodeViewData(
            patchContent,
            resolvedGitHubPath
          );
          if (!isCurrentRequest()) {
            return;
          }

          setTreeSource(loadedData.treeSource);
          setCommentFileByItemId(loadedData.itemIdToFile);
          setCommentSections([]);
          setDiffStats(loadedData.diffStats);
          setItems(loadedData.items);
          setLoadState('ready');
        }

        console.time('--     request time');
        const response = await fetch(
          `/api/fetch-pr-patch?path=${encodeURIComponent(resolvedGitHubPath)}`,
          { cache: 'no-store', signal: controller.signal }
        );
        console.timeEnd('--     request time');

        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error(
            detail.length > 0 ? detail : `Request failed (${response.status}).`
          );
        }

        // Non streaming code path
        if (response.body == null) {
          console.time('--     reading patch');
          const patchContent = await response.text();
          console.timeEnd('--     reading patch');
          await commitFullPatch(patchContent);
          return;
        }

        // Streaming code path
        setLoadState('streaming');
        await yieldToBrowser();
        if (!isCurrentRequest()) {
          return;
        }

        const accumulator = createCodeViewDataAccumulator();
        let streamPatchIndex = 0;
        let streamTreePathPrefix: string | undefined;
        let pendingPublishFileCount = 0;
        let pendingTreePublishFileCount = 0;
        let hasPublishedItems = false;
        let hasPublishedTree = false;
        let hasPublishedInitialItems = false;
        let hasReceivedFirstStreamedFile = false;
        let lastPublishTime = performance.now();
        let lastWorkYieldTime = lastPublishTime;
        let lastTreePublishTime = lastPublishTime;

        const publishPendingData = async () => {
          if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingPublishFileCount = 0;
          hasPublishedItems = true;
          lastPublishTime = performance.now();
          const pendingItems = takePendingCodeViewItems(accumulator);
          const viewer = viewerRef.current;
          if (viewer != null && hasPublishedInitialItems) {
            viewer.addItems(pendingItems);
          } else {
            hasPublishedInitialItems = true;
            setItems(pendingItems);
          }
          await yieldToBrowser();
          lastWorkYieldTime = performance.now();
        };

        const publishPendingDataIfNeeded = async () => {
          if (pendingPublishFileCount === 0) {
            return;
          }

          const elapsed = performance.now() - lastPublishTime;
          if (
            hasPublishedItems &&
            pendingPublishFileCount < STREAM_PUBLISH_FILE_BATCH_SIZE &&
            elapsed < STREAM_PUBLISH_INTERVAL_MS
          ) {
            return;
          }

          await publishPendingData();
        };

        const publishTreeSource = () => {
          if (pendingTreePublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingTreePublishFileCount = 0;
          hasPublishedTree = true;
          lastTreePublishTime = performance.now();
          setCommentFileByItemId(accumulator.itemIdToFile);
          setDiffStats({ ...accumulator.diffStats });
          setTreeSource(snapshotCodeViewTreeSource(accumulator));
        };

        const publishTreeSourceIfNeeded = () => {
          if (pendingTreePublishFileCount === 0) {
            return;
          }

          const elapsed = performance.now() - lastTreePublishTime;
          if (
            hasPublishedTree &&
            pendingTreePublishFileCount < STREAM_TREE_PUBLISH_FILE_BATCH_SIZE &&
            elapsed < STREAM_TREE_PUBLISH_INTERVAL_MS
          ) {
            return;
          }

          publishTreeSource();
        };

        const appendStreamedFile = async (fileText: string) => {
          if (!hasReceivedFirstStreamedFile) {
            hasReceivedFirstStreamedFile = true;
            console.timeEnd('--     first streamed file');
          }

          const patchMetadata = getStreamedPatchMetadata(fileText);
          if (patchMetadata != null) {
            streamTreePathPrefix = getPatchTreePathPrefix(
              patchMetadata,
              streamPatchIndex++
            );
          }

          const fileDiff = processFile(fileText, {
            cacheKey: `${cacheKeyPrefix}-0-${accumulator.fileIndex}`,
            isGitDiff: true,
          });
          if (fileDiff == null) {
            return;
          }

          appendFileDiffToCodeViewData(
            accumulator,
            fileDiff,
            streamTreePathPrefix
          );
          pendingPublishFileCount++;
          pendingTreePublishFileCount++;
          const elapsedWork = performance.now() - lastWorkYieldTime;
          if (elapsedWork >= STREAM_WORK_BUDGET_MS) {
            await publishPendingData();
          } else {
            await publishPendingDataIfNeeded();
          }
          publishTreeSourceIfNeeded();
        };

        console.time('--     first streamed file');
        console.time('--     reading patch stream');
        const fallbackPatchContent = await streamGitPatchFiles(
          response.body,
          appendStreamedFile
        );
        console.timeEnd('--     reading patch stream');
        if (!isCurrentRequest()) {
          return;
        }

        await publishPendingData();
        publishTreeSource();
        if (fallbackPatchContent != null) {
          await commitFullPatch(fallbackPatchContent);
          return;
        }

        setCommentFileByItemId(new Map(accumulator.itemIdToFile));
        setDiffStats({ ...accumulator.diffStats });
        setItems(accumulator.items.slice());
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
  const viewerAvailable =
    loadState === 'ready' || (loadState === 'streaming' && items.length > 0);

  return (
    <ReviewGrid>
      <CodeViewHeader
        className="[grid-area:header]"
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        loading={loadState !== 'ready' && loadState !== 'error'}
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
      {viewerAvailable ? (
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
            streaming={loadState === 'streaming'}
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

function createCodeViewDataAccumulator(): MutableCodeViewData {
  return {
    fileIndex: 0,
    gitStatus: [],
    itemIdToFile: new Map(),
    items: [],
    pendingItems: [],
    pathToItemId: new Map(),
    paths: [],
    diffStats: {
      addedLines: 0,
      deletedLines: 0,
      fileCount: 0,
      totalLinesOfCode: 0,
    },
  };
}

function appendFileDiffToCodeViewData(
  accumulator: MutableCodeViewData,
  fileDiff: FileDiffMetadata,
  treePathPrefix: string | undefined
): void {
  const { diffStats } = accumulator;
  diffStats.fileCount++;
  diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
  for (const hunk of fileDiff.hunks) {
    diffStats.addedLines += hunk.additionLines;
    diffStats.deletedLines += hunk.deletionLines;
  }

  const id = `${accumulator.fileIndex++}:${fileDiff.name}`;
  const fileOrder = accumulator.items.length;

  const item: CodeViewItem<CommentMetadata> = {
    id,
    type: 'diff',
    collapsed:
      fileDiff.type === 'deleted' ||
      Math.max(fileDiff.splitLineCount, fileDiff.unifiedLineCount) >
        INITIAL_COLLAPSED_DIFF_LINE_THRESHOLD,
    fileDiff,
    version: 0,
  };
  accumulator.items.push(item);
  accumulator.pendingItems.push(item);

  const path = fileDiff.name;
  accumulator.itemIdToFile.set(id, { fileOrder, path });
  const treePath = treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
  if (path.length === 0 || accumulator.pathToItemId.has(treePath)) {
    return;
  }

  accumulator.paths.push(treePath);
  accumulator.pathToItemId.set(treePath, id);
  // Modified files are excluded so they render as the visual default. Only
  // added, deleted, and renamed files retain status indicators.
  const gitStatusEntry = mapChangeTypeToGitStatus(fileDiff.type);
  if (gitStatusEntry !== 'modified') {
    accumulator.gitStatus.push({ path: treePath, status: gitStatusEntry });
  }
}

function takePendingCodeViewItems(
  accumulator: MutableCodeViewData
): CodeViewItem<CommentMetadata>[] {
  const { pendingItems } = accumulator;
  accumulator.pendingItems = [];
  return pendingItems;
}

function snapshotCodeViewTreeSource(
  accumulator: MutableCodeViewData
): CodeViewFileTreeSource {
  return createCodeViewFileTreeSource(
    accumulator.paths.slice(),
    new Map(accumulator.pathToItemId),
    accumulator.gitStatus.slice()
  );
}

function snapshotCodeViewData(
  accumulator: MutableCodeViewData
): LoadedCodeViewData {
  return {
    itemIdToFile: new Map(accumulator.itemIdToFile),
    diffStats: { ...accumulator.diffStats },
    items: accumulator.items.slice(),
    treeSource: snapshotCodeViewTreeSource(accumulator),
  };
}

async function streamGitPatchFiles(
  body: ReadableStream<Uint8Array>,
  onFileText: (fileText: string) => Promise<void>
): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createGitPatchFileStreamParser();

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (result.value.byteLength > 0) {
        parser.push(decoder.decode(result.value, { stream: true }));
        await consumeAvailableStreamedFiles(parser, onFileText);
      }
    }

    const finalText = decoder.decode();
    if (finalText.length > 0) {
      parser.push(finalText);
      await consumeAvailableStreamedFiles(parser, onFileText);
    }
    const result = parser.finish();
    if (result.fileText != null) {
      await onFileText(result.fileText);
    }
    let fileText: string | undefined;
    while ((fileText = parser.takeAvailableFile()) != null) {
      await onFileText(fileText);
    }
    return result.fallbackPatchContent;
  } finally {
    reader.releaseLock();
  }
}

interface GitPatchFileStreamFinishResult {
  fallbackPatchContent?: string;
  fileText?: string;
}

interface GitPatchFileStreamParser {
  finish(): GitPatchFileStreamFinishResult;
  push(chunk: string): void;
  takeAvailableFile(): string | undefined;
}

async function consumeAvailableStreamedFiles(
  parser: GitPatchFileStreamParser,
  onFileText: (fileText: string) => Promise<void>
): Promise<void> {
  let fileText: string | undefined;
  while ((fileText = parser.takeAvailableFile()) != null) {
    await onFileText(fileText);
  }
}

// Buffers the current file until the following `diff --git` header arrives so
// each parsed file is complete before it is appended to the viewer.
function createGitPatchFileStreamParser(): GitPatchFileStreamParser {
  let buffer = '';
  let currentFileBoundaryIndex: number | undefined;
  let nextBoundarySearchIndex = 0;
  let sawFileBoundary = false;

  function takeAvailableFile(): string | undefined {
    if (currentFileBoundaryIndex == null) {
      currentFileBoundaryIndex = findNextGitFileBoundary(
        buffer,
        nextBoundarySearchIndex
      );
      if (currentFileBoundaryIndex == null) {
        nextBoundarySearchIndex = getNextBoundarySearchIndex(buffer, 0);
        return undefined;
      }

      sawFileBoundary = true;
      nextBoundarySearchIndex = currentFileBoundaryIndex + 1;
    }

    for (;;) {
      const fileBoundaryIndex = currentFileBoundaryIndex;
      if (fileBoundaryIndex == null) {
        return undefined;
      }

      const nextBoundaryIndex = findNextGitFileBoundary(
        buffer,
        nextBoundarySearchIndex
      );
      if (nextBoundaryIndex == null) {
        nextBoundarySearchIndex = getNextBoundarySearchIndex(
          buffer,
          fileBoundaryIndex + 1
        );
        return undefined;
      }

      const splitIndex = getStreamedFileSplitIndex(
        buffer,
        fileBoundaryIndex,
        nextBoundaryIndex
      );
      const fileText = buffer.slice(0, splitIndex);

      buffer = buffer.slice(splitIndex);
      currentFileBoundaryIndex = findNextGitFileBoundary(buffer, 0);
      nextBoundarySearchIndex =
        currentFileBoundaryIndex == null ? 0 : currentFileBoundaryIndex + 1;
      if (NON_WHITESPACE_PATTERN.test(fileText)) {
        return fileText;
      }
    }
  }

  return {
    push(chunk: string) {
      if (chunk.length === 0) {
        return;
      }
      buffer += chunk;
    },
    takeAvailableFile,
    finish() {
      const fileText = takeAvailableFile();
      if (fileText != null) {
        return { fileText };
      }

      if (!NON_WHITESPACE_PATTERN.test(buffer)) {
        buffer = '';
        return {};
      }
      if (!sawFileBoundary) {
        const fullPatchText = buffer;
        buffer = '';
        return { fallbackPatchContent: fullPatchText };
      }

      const finalFileText = buffer;
      buffer = '';
      return { fileText: finalFileText };
    },
  };
}

function getNextBoundarySearchIndex(
  text: string,
  minimumIndex: number
): number {
  return Math.max(minimumIndex, text.length - GIT_FILE_BOUNDARY_SCAN_OVERLAP);
}

function findNextGitFileBoundary(
  text: string,
  fromIndex: number
): number | undefined {
  const startIndex = Math.max(fromIndex, 0);
  if (startIndex === 0 && text.startsWith(GIT_FILE_BOUNDARY)) {
    return 0;
  }

  const boundaryIndex = text.indexOf(
    GIT_FILE_BOUNDARY_WITH_NEWLINE,
    startIndex
  );
  return boundaryIndex === -1 ? undefined : boundaryIndex + 1;
}

function getStreamedFileSplitIndex(
  text: string,
  firstBoundaryIndex: number,
  nextBoundaryIndex: number
): number {
  return (
    findLastCommitMetadataBoundary(
      text,
      firstBoundaryIndex + 1,
      nextBoundaryIndex
    ) ?? nextBoundaryIndex
  );
}

function findLastCommitMetadataBoundary(
  text: string,
  startIndex: number,
  endIndex: number
): number | undefined {
  const minimumBoundaryIndex = Math.max(startIndex, 0);
  const maximumBoundaryIndex = Math.min(endIndex, text.length);
  if (minimumBoundaryIndex >= maximumBoundaryIndex) {
    return undefined;
  }

  let newlineIndex = text.lastIndexOf('\nFrom ', maximumBoundaryIndex - 1);
  for (;;) {
    if (newlineIndex === -1) {
      return undefined;
    }

    const boundaryIndex = newlineIndex + 1;
    if (boundaryIndex < minimumBoundaryIndex) {
      return undefined;
    }
    if (boundaryIndex >= maximumBoundaryIndex) {
      newlineIndex = text.lastIndexOf('\nFrom ', newlineIndex - 1);
      continue;
    }

    const lineEndIndex = text.indexOf('\n', boundaryIndex + 1);
    const line = text.slice(
      boundaryIndex,
      lineEndIndex === -1 || lineEndIndex > maximumBoundaryIndex
        ? maximumBoundaryIndex
        : lineEndIndex
    );
    if (COMMIT_HASH_METADATA_PATTERN.test(line)) {
      return boundaryIndex;
    }
    newlineIndex = text.lastIndexOf('\nFrom ', newlineIndex - 1);
  }
}

function getStreamedPatchMetadata(fileText: string): string | undefined {
  const diffBoundaryIndex = findNextGitFileBoundary(fileText, 0);
  if (diffBoundaryIndex == null || diffBoundaryIndex <= 0) {
    return undefined;
  }

  const metadata = fileText.slice(0, diffBoundaryIndex);
  return COMMIT_HASH_METADATA_PATTERN.test(metadata) ? metadata : undefined;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    let didResolve = false;
    const resolveOnce = () => {
      if (didResolve) {
        return;
      }

      didResolve = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(resolveOnce, 50);
    window.requestAnimationFrame(resolveOnce);
  });
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
  const accumulator = createCodeViewDataAccumulator();
  const shouldPrefixTreePaths = parsedPatches.length > 1;
  for (const [patchIndex, patch] of parsedPatches.entries()) {
    const treePathPrefix = shouldPrefixTreePaths
      ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;
    for (const fileDiff of patch.files) {
      appendFileDiffToCodeViewData(accumulator, fileDiff, treePathPrefix);
    }
  }
  console.timeEnd('-- computing layout');

  return snapshotCodeViewData(accumulator);
}
