'use client';

import {
  areSelectionsEqual,
  type CodeViewItem,
  type CodeViewLineSelection,
  processFile,
} from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { CODE_VIEW_BATCH_COUNT, getInitialBatchSize } from '@/lib/constants';
import {
  appendFileDiffToDiffsHubData,
  buildDiffsHubData,
  createDiffsHubDataAccumulator,
  type DiffsHubItemIdRename,
  snapshotDiffsHubTreeSource,
  takePendingDiffsHubItems,
} from '@/lib/diffsHubDataAccumulator';
import { getPatchTreePathPrefix } from '@/lib/gitPatchMetadata';
import {
  type DiffsHubLineHashTarget,
  formatDiffsHubLineHash,
  parseDiffsHubLineHash,
} from '@/lib/lineHash';
import {
  getStreamedPatchMetadata,
  streamGitPatchFiles,
} from '@/lib/streamGitPatchFiles';
import type {
  CommentMetadata,
  DiffsHubCommentFileByItemId,
  DiffsHubDiffStats,
  DiffsHubFileTreeSource,
  DiffsHubSavedCommentItem,
  ViewerLoadState,
} from '@/lib/types';

const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_INITIAL_PUBLISH_INTERVAL_MS = 500;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;
const GENERIC_PATCH_LOAD_ERROR_MESSAGE =
  'We couldn’t load that diff. Check the URL and try again.';

interface UsePatchLoaderOptions {
  collapseMode: 'expanded' | 'collapsed';
  domain?: string;
  onLoadStart(): void;
  path: string;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

interface UsePatchLoaderResult {
  applyCollapseModeToLoaded(mode: 'expanded' | 'collapsed'): void;
  commentFileByItemId: DiffsHubCommentFileByItemId | null;
  commentSections: DiffsHubSavedCommentItem[];
  diffStats: DiffsHubDiffStats | null;
  errorMessage: string | null;
  initialItems: CodeViewItem<CommentMetadata>[];
  loadState: ViewerLoadState;
  onLineLinkChange(selection: CodeViewLineSelection | null): void;
  onViewerReady(): void;
  retryLoad(): void;
  setCommentSections: Dispatch<SetStateAction<DiffsHubSavedCommentItem[]>>;
  treeSource: DiffsHubFileTreeSource | null;
  viewerKey: number;
}

export function usePatchLoader({
  collapseMode,
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
  const [treeSource, setTreeSource] = useState<DiffsHubFileTreeSource | null>(
    null
  );
  const [diffStats, setDiffStats] = useState<DiffsHubDiffStats | null>(null);
  const [commentFileByItemId, setCommentFileByItemId] =
    useState<DiffsHubCommentFileByItemId | null>(null);
  const [commentSections, setCommentSections] = useState<
    DiffsHubSavedCommentItem[]
  >([]);
  const [loadState, setLoadState] = useState<ViewerLoadState>('fetching');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [viewerKey, setViewerKey] = useState(0);
  const requestIdRef = useRef(0);
  const appliedLineHashKeyRef = useRef<string | null>(null);
  const viewerKeyRef = useRef(0);
  // Tracks the ids of every item that has been handed to the viewer so we can
  // walk the full set when the user toggles collapse mode. The viewer handle
  // does not expose an enumeration API, so we maintain our own index.
  const loadedItemIdsRef = useRef<Set<string>>(new Set());
  // Mirrors the latest collapse mode so the streaming code path (which lives
  // inside a long-lived effect/closure) can read the live value without us
  // having to re-bind it on every change.
  const collapseModeRef = useRef(collapseMode);
  collapseModeRef.current = collapseMode;

  // Pre-mutates fresh items so they arrive in the viewer matching the current
  // collapse mode, then records their ids for later bulk updates. Diff items
  // are normalized in both directions because the accumulator initializes
  // deleted-file diffs as collapsed by default — without an unconditional
  // overwrite, those would stay collapsed even when the user is in expanded
  // mode.
  const prepareItemsForViewer = (
    items: readonly CodeViewItem<CommentMetadata>[]
  ): void => {
    const targetCollapsed = collapseModeRef.current === 'collapsed';
    for (const item of items) {
      loadedItemIdsRef.current.add(item.id);
      if (item.type === 'diff') {
        item.collapsed = targetCollapsed;
      }
    }
  };

  const applyCollapseModeToLoaded = useStableCallback(
    (mode: 'expanded' | 'collapsed') => {
      const targetCollapsed = mode === 'collapsed';
      const viewer = viewerRef.current;
      if (viewer == null) {
        // The viewer hasn't mounted yet (e.g. the worker pool is still warming
        // up while the header is already interactive). Rewrite any items
        // already buffered in initialItems so they arrive in the right state
        // once the viewer mounts. New items still streaming in pick up the
        // live collapse mode through prepareItemsForViewer.
        setInitialItems((prev) => {
          let changed = false;
          const next = prev.map((item) => {
            if (
              item.type !== 'diff' ||
              (item.collapsed === true) === targetCollapsed
            ) {
              return item;
            }
            changed = true;
            return { ...item, collapsed: targetCollapsed };
          });
          return changed ? next : prev;
        });
        return;
      }

      for (const itemId of loadedItemIdsRef.current) {
        const item = viewer.getItem(itemId);
        if (item == null || item.type !== 'diff') {
          continue;
        }
        const current = item.collapsed === true;
        if (current === targetCollapsed) {
          continue;
        }
        item.collapsed = targetCollapsed;
        item.version = getNextItemVersion(item);
        viewer.updateItem(item);
      }
    }
  );

  const tryApplyLineHashTarget = useStableCallback(() => {
    const { hash } = window.location;
    const target = parseDiffsHubLineHash(hash);
    if (target == null) {
      return;
    }

    const applyKey = getLineHashApplyKey(viewerKeyRef.current, hash);
    if (appliedLineHashKeyRef.current === applyKey) {
      return;
    }

    const viewer = viewerRef.current;
    if (viewer == null) {
      return;
    }

    if (applyDiffsHubLineHashTarget(viewer, target)) {
      appliedLineHashKeyRef.current = applyKey;
    }
  });

  const handleLineLinkChange = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      const nextHash =
        selection == null ? null : formatDiffsHubLineHash(selection);
      appliedLineHashKeyRef.current =
        nextHash == null
          ? null
          : getLineHashApplyKey(viewerKeyRef.current, nextHash);
      replaceLocationHash(nextHash);
    }
  );

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

    viewerKeyRef.current = requestId;
    appliedLineHashKeyRef.current = null;
    loadedItemIdsRef.current = new Set();
    setViewerKey(requestId);
    setInitialItems([]);
    setTreeSource(null);
    setDiffStats(null);
    setCommentFileByItemId(null);
    setCommentSections([]);
    onLoadStart();
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
          const loadedData = buildDiffsHubData(patchContent, patchRequestKey);
          if (!isCurrentRequest()) {
            return;
          }

          setTreeSource(loadedData.treeSource);
          setCommentFileByItemId(loadedData.itemIdToFile);
          setCommentSections([]);
          setDiffStats(loadedData.diffStats);
          prepareItemsForViewer(loadedData.items);
          setInitialItems(loadedData.items);
          setLoadState('ready');
          await yieldToBrowser();
          if (isCurrentRequest()) {
            tryApplyLineHashTarget();
          }
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

        const accumulator = createDiffsHubDataAccumulator();
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
        const initialPublishFileBatchSize = getInitialBatchSize();

        const publishTreeSource = () => {
          if (pendingTreePublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingTreePublishFileCount = 0;
          hasPublishedTree = true;
          lastTreePublishTime = performance.now();
          setCommentFileByItemId(accumulator.itemIdToFile);
          setDiffStats({ ...accumulator.diffStats });
          setTreeSource(snapshotDiffsHubTreeSource(accumulator));
        };

        const publishPendingData = async () => {
          if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingPublishFileCount = 0;
          lastPublishTime = performance.now();
          const pendingItems = takePendingDiffsHubItems(accumulator);
          prepareItemsForViewer(pendingItems);
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
          if (isCurrentRequest()) {
            tryApplyLineHashTarget();
          }
          lastWorkYieldTime = performance.now();
        };

        const publishPendingDataIfNeeded = async () => {
          if (pendingPublishFileCount === 0) {
            return;
          }

          const elapsed = performance.now() - lastPublishTime;
          const publishFileBatchSize = hasPublishedInitialItems
            ? CODE_VIEW_BATCH_COUNT
            : initialPublishFileBatchSize;
          const publishInterval = hasPublishedInitialItems
            ? STREAM_PUBLISH_INTERVAL_MS
            : STREAM_INITIAL_PUBLISH_INTERVAL_MS;
          if (
            pendingPublishFileCount < publishFileBatchSize &&
            elapsed < publishInterval
          ) {
            return;
          }

          await publishPendingData();
        };
        const shouldDeferInitialPublishForBatchTarget = () => {
          if (hasPublishedInitialItems) {
            return false;
          }

          const elapsed = performance.now() - lastPublishTime;
          return (
            pendingPublishFileCount < initialPublishFileBatchSize &&
            elapsed < STREAM_INITIAL_PUBLISH_INTERVAL_MS
          );
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

          const itemIdRename = appendFileDiffToDiffsHubData(
            accumulator,
            fileDiff,
            streamTreePathPrefix
          );
          if (itemIdRename != null) {
            applyDiffsHubItemIdRename(viewerRef.current, itemIdRename);
            if (loadedItemIdsRef.current.delete(itemIdRename.oldId)) {
              loadedItemIdsRef.current.add(itemIdRename.newId);
            }
          }
          pendingPublishFileCount++;
          pendingTreePublishFileCount++;
          const elapsedWork = performance.now() - lastWorkYieldTime;
          if (elapsedWork >= STREAM_WORK_BUDGET_MS) {
            if (shouldDeferInitialPublishForBatchTarget()) {
              await yieldToBrowser();
              lastWorkYieldTime = performance.now();
            } else {
              await publishPendingData();
            }
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
        console.warn('Failed to load diff', error);
        setErrorMessage(GENERIC_PATCH_LOAD_ERROR_MESSAGE);
        setLoadState('error');
      }
    }

    void loadPatch();

    return () => {
      controller.abort();
    };
  }, [
    domain,
    loadAttempt,
    onLoadStart,
    path,
    tryApplyLineHashTarget,
    viewerRef,
  ]);

  useEffect(() => {
    window.addEventListener('hashchange', tryApplyLineHashTarget);
    tryApplyLineHashTarget();
    return () => {
      window.removeEventListener('hashchange', tryApplyLineHashTarget);
    };
  }, [tryApplyLineHashTarget]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  return {
    applyCollapseModeToLoaded,
    commentFileByItemId,
    commentSections,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    onLineLinkChange: handleLineLinkChange,
    onViewerReady: tryApplyLineHashTarget,
    retryLoad,
    setCommentSections,
    treeSource,
    viewerKey,
  };
}

function getLineHashApplyKey(viewerKey: number, hash: string): string {
  return `${viewerKey}:${hash}`;
}

function applyDiffsHubLineHashTarget(
  viewer: CodeViewHandle<CommentMetadata>,
  target: DiffsHubLineHashTarget
): boolean {
  const item = viewer.getItem(target.itemId);
  if (item == null) {
    return false;
  }

  const selectedLines = viewer.getSelectedLines();
  if (
    selectedLines?.id === target.itemId &&
    areSelectionsEqual(selectedLines.range, target.range)
  ) {
    return true;
  }

  if (item.collapsed === true) {
    item.collapsed = false;
    item.version = getNextItemVersion(item);
    if (!viewer.updateItem(item)) {
      return false;
    }
    viewer.getInstance()?.render(true);
  }

  viewer.setSelectedLines({ id: target.itemId, range: target.range });
  viewer.scrollTo({
    type: 'range',
    id: target.itemId,
    range: target.range,
    align: 'center',
    behavior: 'instant',
  });
  return true;
}

function applyDiffsHubItemIdRename(
  viewer: CodeViewHandle<CommentMetadata> | null,
  rename: DiffsHubItemIdRename
): void {
  viewer?.updateItemId(rename.oldId, rename.newId);
}

function getNextItemVersion(item: { version?: string | number }): number {
  return typeof item.version === 'number' ? item.version + 1 : 1;
}

function replaceLocationHash(hash: string | null): void {
  const { pathname, search } = window.location;
  const nextHash = hash ?? '';
  if (window.location.hash === nextHash) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    '',
    `${pathname}${search}${nextHash}`
  );
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
