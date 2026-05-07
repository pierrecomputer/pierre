'use client';

import { type CodeViewItem, processFile } from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  appendFileDiffToCodeViewData,
  buildCodeViewData,
  createCodeViewDataAccumulator,
  snapshotCodeViewTreeSource,
  takePendingCodeViewItems,
} from './codeViewDataAccumulator';
import type { ViewerLoadState } from './constants';
import { getPatchTreePathPrefix } from './gitPatchMetadata';
import {
  getStreamedPatchMetadata,
  streamGitPatchFiles,
} from './streamGitPatchFiles';
import type {
  CodeViewCommentFileByItemId,
  CodeViewDiffStats,
  CodeViewFileTreeSource,
  CodeViewSavedCommentItem,
  CommentMetadata,
} from './types';

const STREAM_PUBLISH_FILE_BATCH_SIZE = 25;
const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;

interface UsePatchLoaderOptions {
  domain?: string;
  onLoadStart?(): void;
  path: string;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

interface UsePatchLoaderResult {
  commentFileByItemId: CodeViewCommentFileByItemId | null;
  commentSections: CodeViewSavedCommentItem[];
  diffStats: CodeViewDiffStats | null;
  errorMessage: string | null;
  initialItems: CodeViewItem<CommentMetadata>[];
  loadState: ViewerLoadState;
  retryLoad(): void;
  setCommentSections: Dispatch<SetStateAction<CodeViewSavedCommentItem[]>>;
  treeSource: CodeViewFileTreeSource | null;
  viewerKey: number;
}

export function usePatchLoader({
  domain,
  onLoadStart,
  path,
  viewerRef,
}: UsePatchLoaderOptions): UsePatchLoaderResult {
  const [initialItems, setInitialItems] = useState<
    CodeViewItem<CommentMetadata>[]
  >([]);
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
  const [viewerKey, setViewerKey] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const patchRequestKey =
      domain == null || domain === '' ? path : `${domain}${path}`;
    const patchSearchParams = new URLSearchParams({ path });
    if (domain != null && domain !== '') {
      patchSearchParams.set('domain', domain);
    }

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () =>
      requestIdRef.current === requestId && !controller.signal.aborted;

    setViewerKey(requestId);
    setInitialItems([]);
    setTreeSource(null);
    setDiffStats(null);
    setCommentFileByItemId(null);
    setCommentSections([]);
    onLoadStart?.();
    setErrorMessage(null);
    setLoadState('fetching');

    async function loadPatch() {
      try {
        const cacheKeyPrefix = encodeURIComponent(patchRequestKey);
        async function commitFullPatch(patchContent: string) {
          if (!isCurrentRequest()) {
            return;
          }
          setLoadState('parsing');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

          if (!isCurrentRequest()) {
            return;
          }
          const loadedData = buildCodeViewData(patchContent, patchRequestKey);
          if (!isCurrentRequest()) {
            return;
          }

          setTreeSource(loadedData.treeSource);
          setCommentFileByItemId(loadedData.itemIdToFile);
          setCommentSections([]);
          setDiffStats(loadedData.diffStats);
          setInitialItems(loadedData.items);
          setLoadState('ready');
        }

        console.time('--     request time');
        const response = await fetch(`/api/diff?${patchSearchParams}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        console.timeEnd('--     request time');

        // This only catches route setup errors. GitHub fetch failures are
        // delivered while consuming the stream so the UI can enter the
        // streaming state as soon as the local transport opens.
        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error(
            detail.length > 0 ? detail : `Request failed (${response.status}).`
          );
        }

        if (response.body == null) {
          console.time('--     reading patch');
          const patchContent = await response.text();
          console.timeEnd('--     reading patch');
          await commitFullPatch(patchContent);
          return;
        }

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
        let hasPublishedTree = false;
        let hasPublishedInitialItems = false;
        let hasReceivedFirstStreamedFile = false;
        let lastPublishTime = performance.now();
        let lastWorkYieldTime = lastPublishTime;
        let lastTreePublishTime = lastPublishTime;

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

        const publishPendingData = async () => {
          if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingPublishFileCount = 0;
          lastPublishTime = performance.now();
          const pendingItems = takePendingCodeViewItems(accumulator);
          if (!hasPublishedInitialItems) {
            hasPublishedInitialItems = true;
            publishTreeSource();
            setInitialItems(pendingItems);
          } else {
            const viewer = viewerRef.current;
            if (viewer != null) {
              viewer.addItems(pendingItems);
            } else {
              setInitialItems((prev) => [...prev, ...pendingItems]);
            }
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
            pendingPublishFileCount < STREAM_PUBLISH_FILE_BATCH_SIZE &&
            elapsed < STREAM_PUBLISH_INTERVAL_MS
          ) {
            return;
          }

          await publishPendingData();
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
  }, [domain, loadAttempt, onLoadStart, path, viewerRef]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  return {
    commentFileByItemId,
    commentSections,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    retryLoad,
    setCommentSections,
    treeSource,
    viewerKey,
  };
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
