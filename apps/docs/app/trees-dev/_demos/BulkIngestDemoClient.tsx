'use client';

import { PathStore } from '@pierre/path-store';
import type {
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjectionData,
} from '@pierre/path-store';
import {
  computeStickyWindowLayout,
  computeWindowRange,
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
  type FileTreeRange,
} from '@pierre/trees';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import {
  BULK_EXPERIMENT_EXPANSION_OPTIONS,
  BULK_EXPERIMENT_HEAD_CHUNK_SIZE_OPTIONS,
  BULK_EXPERIMENT_INGEST_OPTIONS,
  BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL_OPTIONS,
  BULK_EXPERIMENT_PUBLISH_PATH_BUDGET_OPTIONS,
  BULK_EXPERIMENT_PUBLISH_STRATEGY_OPTIONS,
  BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_OPTIONS,
  BULK_EXPERIMENT_READ_SLAB_MULTIPLIER_OPTIONS,
  BULK_EXPERIMENT_READ_STRATEGY_OPTIONS,
  BULK_EXPERIMENT_ROW_TRANSPORT_OPTIONS,
  BULK_EXPERIMENT_WORKLOAD_OPTIONS,
  type BulkExperimentExpansionMode,
  type BulkExperimentHeadChunkSize,
  type BulkExperimentIngestMode,
  type BulkExperimentPublishCheckpointInterval,
  type BulkExperimentPublishPathBudget,
  type BulkExperimentPublishStrategy,
  type BulkExperimentPublishTimeBudgetMs,
  type BulkExperimentReadSlabMultiplier,
  type BulkExperimentReadStrategy,
  type BulkExperimentRouteState,
  type BulkExperimentRowTransport,
  type BulkExperimentWorkloadName,
  DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE,
  DEFAULT_BULK_EXPERIMENT_FRONTIER_GATING,
  DEFAULT_BULK_EXPERIMENT_HEAD_CHUNK_SIZE,
  DEFAULT_BULK_EXPERIMENT_INGEST_MODE,
  DEFAULT_BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL,
  DEFAULT_BULK_EXPERIMENT_PUBLISH_PATH_BUDGET,
  DEFAULT_BULK_EXPERIMENT_PUBLISH_STRATEGY,
  DEFAULT_BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_MS,
  DEFAULT_BULK_EXPERIMENT_READ_SLAB_MULTIPLIER,
  DEFAULT_BULK_EXPERIMENT_READ_STRATEGY,
  DEFAULT_BULK_EXPERIMENT_ROW_TRANSPORT,
  DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME,
  getBulkExperimentAssetUrl,
  getBulkExperimentExpansionOptions,
  getBulkExperimentSeededExpandedPaths,
} from '../_lib/bulkExperimentMeta';
import { BulkExperimentModel } from '../_lib/bulkExperimentModel';
import { BULK_EXPERIMENT_PREVIEW_DATA } from '../_lib/bulkExperimentPreviewData';
import type {
  BulkExperimentInitOptions,
  BulkExperimentLatencyMetricSummary,
  BulkExperimentReadLatencyPhase,
  BulkExperimentReadLatencySummaryByKind,
  BulkExperimentReadRequestKind,
  BulkExperimentReadRequestLatencySample,
  BulkExperimentReadRequestLatencySummary,
  BulkExperimentReadRequestTiming,
  BulkExperimentSnapshot,
  BulkExperimentVisibleRow,
  BulkExperimentWorkerMessage,
  BulkExperimentWorkerRequest,
} from '../_lib/bulkExperimentProtocol';
import { decodeVisibleRowsTransferPayload } from '../_lib/bulkExperimentVisibleRowsTransfer';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';

function rangesEqual(left: FileTreeRange, right: FileTreeRange): boolean {
  return left.start === right.start && left.end === right.end;
}

interface BulkExperimentAdapter {
  cancelIngest(): Promise<void>;
  collapsePath(path: string): Promise<void>;
  dispose(): void;
  expandPath(path: string): Promise<void>;
  getSnapshot(): BulkExperimentSnapshot;
  getVisibleIndex(path: string): Promise<number | null>;
  getVisibleRows(
    start: number,
    end: number
  ): Promise<readonly BulkExperimentVisibleRow[]>;
  startIngest(): Promise<void>;
  subscribe(listener: (snapshot: BulkExperimentSnapshot) => void): () => void;
}

type BulkExperimentAckRequest =
  | { type: 'cancelIngest' }
  | { path: string; type: 'collapsePath' }
  | { path: string; type: 'expandPath' }
  | { options: BulkExperimentInitOptions; type: 'initialize' }
  | { type: 'startIngest' };

interface LongTaskStats {
  count: number | null;
  longestMs: number | null;
}

interface BulkExperimentSummary {
  applyMs: number;
  committedIngestedPathCount: number;
  committedPublishCount: number;
  expansionMode: BulkExperimentExpansionMode;
  fetchCompletedAt: number | null;
  fetchMs: number;
  frontierGating: boolean;
  headChunkCompletedAt: number | null;
  headChunkMaterializedVisibleCount: number | null;
  ingestMode: BulkExperimentIngestMode;
  longTaskCount: number | null;
  longestLongTaskMs: number | null;
  parseCompletedAt: number | null;
  parseMs: number;
  previewInteractivePaintedAt: number | null;
  publishP95Ms: number | null;
  publishSampleCount: number;
  publishStrategy: BulkExperimentPublishStrategy;
  readSlabMultiplier: BulkExperimentReadSlabMultiplier;
  readStrategy: BulkExperimentReadStrategy;
  rowTransport: BulkExperimentRowTransport;

  status: BulkExperimentSnapshot['bulkInfo']['status'];
  tailChunkCompletedAt: readonly number[];
  totalMs: number;
  unpublishedPathCount: number;
  viewportRowsCacheHitCount: number;
  viewportRowsCacheMissCount: number;
  viewportRowsRequestCompletedCount: number;
  viewportRowsRequestDroppedCount: number;
  viewportRowsRequestSentCount: number;
  workerMode: 'main' | 'worker';
  workingCheckpointCount: number;
  workingIngestedPathCount: number;
  workloadName: BulkExperimentWorkloadName;
}

type BulkExperimentReadLatencyBuckets = {
  visibleIndex: Record<
    BulkExperimentReadLatencyPhase,
    BulkExperimentReadRequestLatencySample[]
  >;
  visibleRows: Record<
    BulkExperimentReadLatencyPhase,
    BulkExperimentReadRequestLatencySample[]
  >;
};

type BulkExperimentReadLatencyListener = (
  sample: BulkExperimentReadRequestLatencySample
) => void;

function createEmptyLatencyMetricSummary(): BulkExperimentLatencyMetricSummary {
  return {
    averageMs: null,
    maxMs: null,
    p50Ms: null,
    p95Ms: null,
    sampleCount: 0,
  };
}

function createEmptyReadLatencySummary(): BulkExperimentReadRequestLatencySummary {
  return {
    compute: createEmptyLatencyMetricSummary(),
    queueWait: createEmptyLatencyMetricSummary(),
    total: createEmptyLatencyMetricSummary(),
    transport: createEmptyLatencyMetricSummary(),
  };
}

function createEmptyReadLatencySummaryByKind(): BulkExperimentReadLatencySummaryByKind {
  return {
    visibleIndex: {
      activeIngest: createEmptyReadLatencySummary(),
      postCompletion: createEmptyReadLatencySummary(),
    },
    visibleRows: {
      activeIngest: createEmptyReadLatencySummary(),
      postCompletion: createEmptyReadLatencySummary(),
    },
  };
}

function createEmptyReadLatencyBuckets(): BulkExperimentReadLatencyBuckets {
  return {
    visibleIndex: { activeIngest: [], postCompletion: [] },
    visibleRows: { activeIngest: [], postCompletion: [] },
  };
}

function classifyReadLatencyPhase(
  status: BulkExperimentSnapshot['bulkInfo']['status']
): BulkExperimentReadLatencyPhase {
  return status === 'ingesting' ? 'activeIngest' : 'postCompletion';
}

// Converts absolute request timestamps into the queue, compute, transport, and
// total phases the demo surfaces for read responsiveness.
function createReadLatencySample({
  phase,
  receivedAt,
  requestKind,
  timing,
}: {
  phase: BulkExperimentReadLatencyPhase;
  receivedAt: number;
  requestKind: BulkExperimentReadRequestKind;
  timing: BulkExperimentReadRequestTiming;
}): BulkExperimentReadRequestLatencySample {
  return {
    computeMs: Math.max(0, timing.workerFinishedAt - timing.workerStartedAt),
    phase,
    receivedAt,
    requestKind,
    queueWaitMs: Math.max(0, timing.workerStartedAt - timing.sentAt),
    sentAt: timing.sentAt,
    totalMs: Math.max(0, receivedAt - timing.sentAt),
    transportMs: Math.max(0, receivedAt - timing.workerFinishedAt),
    workerFinishedAt: timing.workerFinishedAt,
    workerStartedAt: timing.workerStartedAt,
  };
}

function selectPercentile(
  sortedValues: readonly number[],
  fraction: number
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const percentileIndex = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)
  );
  return sortedValues[percentileIndex] ?? null;
}

function summarizeLatencyValues(
  values: readonly number[]
): BulkExperimentLatencyMetricSummary {
  if (values.length === 0) {
    return createEmptyLatencyMetricSummary();
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: total / values.length,
    maxMs: sortedValues.at(-1) ?? null,
    p50Ms: selectPercentile(sortedValues, 0.5),
    p95Ms: selectPercentile(sortedValues, 0.95),
    sampleCount: values.length,
  };
}

function summarizeReadLatencySamples(
  samples: readonly BulkExperimentReadRequestLatencySample[]
): BulkExperimentReadRequestLatencySummary {
  if (samples.length === 0) {
    return createEmptyReadLatencySummary();
  }

  const computeValues: number[] = [];
  const queueWaitValues: number[] = [];
  const totalValues: number[] = [];
  const transportValues: number[] = [];
  for (const sample of samples) {
    computeValues.push(sample.computeMs);
    queueWaitValues.push(sample.queueWaitMs);
    totalValues.push(sample.totalMs);
    transportValues.push(sample.transportMs);
  }

  return {
    compute: summarizeLatencyValues(computeValues),
    queueWait: summarizeLatencyValues(queueWaitValues),
    total: summarizeLatencyValues(totalValues),
    transport: summarizeLatencyValues(transportValues),
  };
}

function summarizeReadLatencyBuckets(
  buckets: BulkExperimentReadLatencyBuckets
): BulkExperimentReadLatencySummaryByKind {
  return {
    visibleIndex: {
      activeIngest: summarizeReadLatencySamples(
        buckets.visibleIndex.activeIngest
      ),
      postCompletion: summarizeReadLatencySamples(
        buckets.visibleIndex.postCompletion
      ),
    },
    visibleRows: {
      activeIngest: summarizeReadLatencySamples(
        buckets.visibleRows.activeIngest
      ),
      postCompletion: summarizeReadLatencySamples(
        buckets.visibleRows.postCompletion
      ),
    },
  };
}

function hasReadLatencySamples(
  summary: BulkExperimentReadLatencySummaryByKind
): boolean {
  return (
    summary.visibleIndex.activeIngest.total.sampleCount > 0 ||
    summary.visibleIndex.postCompletion.total.sampleCount > 0 ||
    summary.visibleRows.activeIngest.total.sampleCount > 0 ||
    summary.visibleRows.postCompletion.total.sampleCount > 0
  );
}

function roundMetric(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(1));
}

function formatMetric(value: number | null): string {
  return value == null ? 'n/a' : `${value.toFixed(1)} ms`;
}

function formatMetricList(values: readonly number[]): string {
  return values.length === 0
    ? 'n/a'
    : values.map((value) => `${value.toFixed(1)} ms`).join(', ');
}

function formatLatencyMetricSummary(
  summary: BulkExperimentLatencyMetricSummary
): string {
  return summary.sampleCount === 0
    ? 'n/a'
    : `n=${String(summary.sampleCount)} p50=${formatMetric(summary.p50Ms)} p95=${formatMetric(summary.p95Ms)} avg=${formatMetric(summary.averageMs)} max=${formatMetric(summary.maxMs)}`;
}

function formatReadLatencySummary(
  summary: BulkExperimentReadRequestLatencySummary
): string {
  return [
    `total=${formatLatencyMetricSummary(summary.total)}`,
    `queue=${formatLatencyMetricSummary(summary.queueWait)}`,
    `compute=${formatLatencyMetricSummary(summary.compute)}`,
    `transport=${formatLatencyMetricSummary(summary.transport)}`,
  ].join(' ');
}

// Worker and main-thread latency phases only compare correctly when both sides
// stamp requests against the same absolute high-resolution clock.
function absoluteNow(): number {
  return typeof performance === 'undefined'
    ? Date.now()
    : performance.timeOrigin + performance.now();
}

function formatProgress(snapshot: BulkExperimentSnapshot): string {
  const { ingestedPathCount, totalPathCount } = snapshot.bulkInfo;
  return totalPathCount == null
    ? ingestedPathCount.toLocaleString()
    : `${ingestedPathCount.toLocaleString()} / ${totalPathCount.toLocaleString()}`;
}

function formatWorkingProgress(snapshot: BulkExperimentSnapshot): string {
  const { totalPathCount } = snapshot.bulkInfo;
  return totalPathCount == null
    ? snapshot.workingIngestedPathCount.toLocaleString()
    : `${snapshot.workingIngestedPathCount.toLocaleString()} / ${totalPathCount.toLocaleString()}`;
}

function formatViewportRowsStats(
  viewportRowsStats: BulkExperimentViewportRowsStats
): string {
  return [
    `sent=${String(viewportRowsStats.requestSentCount)}`,
    `completed=${String(viewportRowsStats.requestCompletedCount)}`,
    `dropped=${String(viewportRowsStats.requestDroppedCount)}`,
    `hits=${String(viewportRowsStats.cacheHitCount)}`,
    `misses=${String(viewportRowsStats.cacheMissCount)}`,
  ].join(' ');
}

function formatRowLabel(row: BulkExperimentVisibleRow): string {
  const flattenedSegments = row.flattenedSegments;
  if (flattenedSegments == null || flattenedSegments.length === 0) {
    return row.name;
  }

  return flattenedSegments.map((segment) => segment.name).join(' / ');
}

interface BulkExperimentVisibleProjection {
  getParentIndex(index: number): number;
  paths: readonly string[];
  posInSetByIndex: Int32Array<ArrayBufferLike>;
  setSizeByIndex: Int32Array<ArrayBufferLike>;
}

function createVisibleProjection(
  projection: PathStoreVisibleTreeProjectionData
): BulkExperimentVisibleProjection {
  return {
    getParentIndex: projection.getParentIndex,
    paths: projection.paths,
    posInSetByIndex: projection.posInSetByIndex,
    setSizeByIndex: projection.setSizeByIndex,
  };
}

// Builds a tiny main-thread fallback for the preview prefix so the first rows do
// not disappear while the worker is busy ingesting deeper ranges.
function createPreviewFallbackRows(
  options: BulkExperimentInitOptions
): readonly BulkExperimentVisibleRow[] {
  const store = new PathStore({
    flattenEmptyDirectories: false,
    ...getBulkExperimentExpansionOptions(
      options.workloadName,
      options.expansionMode
    ),
    preparedInput: PathStore.preparePresortedInput(options.previewPaths),
  });
  const visibleCount = store.getVisibleCount();
  if (visibleCount <= 0) {
    return [];
  }

  const projection = createVisibleProjection(
    store.getVisibleTreeProjectionData()
  );
  const ancestorPathsByIndex = new Map<number, readonly string[]>();
  const getAncestorPaths = (index: number): readonly string[] => {
    const cached = ancestorPathsByIndex.get(index);
    if (cached != null) {
      return cached;
    }

    const parentIndex = projection.getParentIndex(index);
    const ancestorPaths =
      parentIndex < 0
        ? []
        : [
            ...getAncestorPaths(parentIndex),
            projection.paths[parentIndex] ?? '',
          ].filter((path) => path !== '');
    ancestorPathsByIndex.set(index, ancestorPaths);
    return ancestorPaths;
  };

  return store.getVisibleSlice(0, visibleCount - 1).map(
    (row: PathStoreVisibleRow, index) =>
      ({
        ancestorPaths: getAncestorPaths(index),
        depth: row.depth,
        flattenedSegments: row.flattenedSegments?.map((segment) => ({
          isTerminal: segment.isTerminal,
          name: segment.name,
          path: segment.path,
        })),
        hasChildren: row.hasChildren,
        index,
        isExpanded: row.isExpanded,
        isFlattened: row.isFlattened,
        kind: row.kind,
        level: row.depth,
        name: row.name,
        path: projection.paths[index] ?? row.path,
        posInSet: projection.posInSetByIndex[index] ?? 0,
        setSize: projection.setSizeByIndex[index] ?? 0,
      }) satisfies BulkExperimentVisibleRow
  );
}

interface BulkExperimentViewportRowsStats {
  cacheHitCount: number;
  cacheMissCount: number;
  requestCompletedCount: number;
  requestDroppedCount: number;
  requestSentCount: number;
}

interface BulkExperimentViewportRowsSlab {
  end: number;
  rows: readonly BulkExperimentVisibleRow[];
  start: number;
}

interface BulkExperimentViewportRowsRequest {
  desiredRange: FileTreeRange;
  effectiveRange: FileTreeRange;
  reject: (error: Error) => void;
  resolve: (rows: readonly BulkExperimentVisibleRow[]) => void;
}

function createEmptyViewportRowsStats(): BulkExperimentViewportRowsStats {
  return {
    cacheHitCount: 0,
    cacheMissCount: 0,
    requestCompletedCount: 0,
    requestDroppedCount: 0,
    requestSentCount: 0,
  };
}

function rowsCoverRange(
  rows: readonly BulkExperimentVisibleRow[],
  range: FileTreeRange
): boolean {
  if (rows.length === 0) {
    return false;
  }

  const firstRow = rows[0];
  const lastRow = rows.at(-1);
  return (
    (firstRow?.index ?? Number.MAX_SAFE_INTEGER) <= range.start &&
    (lastRow?.index ?? -1) >= range.end
  );
}

function rangeContainsRange(
  outerRange: FileTreeRange,
  innerRange: FileTreeRange
): boolean {
  return (
    outerRange.start <= innerRange.start && outerRange.end >= innerRange.end
  );
}

function sliceViewportRowsFromSlab(
  slab: BulkExperimentViewportRowsSlab,
  range: FileTreeRange
): readonly BulkExperimentVisibleRow[] {
  if (!rangeContainsRange({ end: slab.end, start: slab.start }, range)) {
    return [];
  }

  const sliceStart = range.start - slab.start;
  const sliceEnd = sliceStart + (range.end - range.start) + 1;
  return slab.rows.slice(sliceStart, sliceEnd);
}

function createViewportRowsAbortError(): Error {
  return new DOMException(
    'Viewport rows request was superseded.',
    'AbortError'
  );
}

function resolveViewportReadRange(
  desiredRange: FileTreeRange,
  readStrategy: BulkExperimentReadStrategy,
  readSlabMultiplier: BulkExperimentReadSlabMultiplier
): FileTreeRange {
  if (readStrategy !== 'latest-only-slab') {
    return desiredRange;
  }

  const rowCount = Math.max(1, desiredRange.end - desiredRange.start + 1);
  const extraRowCount = rowCount * (readSlabMultiplier - 1);
  const leadingPadding = Math.floor(extraRowCount / 2);
  const trailingPadding = extraRowCount - leadingPadding;
  return {
    end: desiredRange.end + trailingPadding,
    start: Math.max(0, desiredRange.start - leadingPadding),
  };
}

// Coordinates viewport-driven visibleRows reads so the demo can compare exact
// requests with latest-only coalescing and slab-backed cache reuse.
function useViewportRowsRequester({
  adapter,
  readSlabMultiplier,
  readStrategy,
}: {
  adapter: BulkExperimentAdapter | null;
  readSlabMultiplier: BulkExperimentReadSlabMultiplier;
  readStrategy: BulkExperimentReadStrategy;
}): {
  invalidateCachedRowsFrom: (changeStartIndex: number | null) => void;
  requestViewportRows: (
    start: number,
    end: number
  ) => Promise<readonly BulkExperimentVisibleRow[]>;
  viewportRowsStats: BulkExperimentViewportRowsStats;
} {
  const [viewportRowsStats, setViewportRowsStats] =
    useState<BulkExperimentViewportRowsStats>(() =>
      createEmptyViewportRowsStats()
    );
  const cacheRef = useRef<BulkExperimentViewportRowsSlab | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef<{
    effectiveRange: FileTreeRange;
    promise: Promise<BulkExperimentViewportRowsSlab>;
  } | null>(null);
  const pendingRequestRef = useRef<BulkExperimentViewportRowsRequest | null>(
    null
  );

  const updateViewportRowsStats = useCallback(
    (
      update: (
        previous: BulkExperimentViewportRowsStats
      ) => BulkExperimentViewportRowsStats
    ) => {
      setViewportRowsStats((previous) => update(previous));
    },
    []
  );

  const invalidateCachedRowsFrom = useCallback(
    (changeStartIndex: number | null) => {
      if (changeStartIndex == null) {
        return;
      }

      const cachedSlab = cacheRef.current;
      if (cachedSlab != null && changeStartIndex <= cachedSlab.end) {
        cacheRef.current = null;
      }
    },
    []
  );

  const startViewportRowsRequest = useCallback(
    (
      request: BulkExperimentViewportRowsRequest
    ): Promise<BulkExperimentViewportRowsSlab> => {
      if (adapter == null) {
        request.resolve([]);
        return Promise.resolve({
          end: request.desiredRange.end,
          rows: [],
          start: request.desiredRange.start,
        });
      }

      const requestGeneration = generationRef.current;
      updateViewportRowsStats((previous) => ({
        ...previous,
        cacheMissCount: previous.cacheMissCount + 1,
        requestSentCount: previous.requestSentCount + 1,
      }));

      const promise = adapter
        .getVisibleRows(
          request.effectiveRange.start,
          request.effectiveRange.end
        )
        .then((rows) => {
          const slab = {
            end: request.effectiveRange.end,
            rows,
            start: request.effectiveRange.start,
          } satisfies BulkExperimentViewportRowsSlab;
          if (generationRef.current !== requestGeneration) {
            return slab;
          }

          if (readStrategy === 'latest-only-slab') {
            cacheRef.current = slab;
          }
          updateViewportRowsStats((previous) => ({
            ...previous,
            requestCompletedCount: previous.requestCompletedCount + 1,
          }));
          request.resolve(
            sliceViewportRowsFromSlab(slab, request.desiredRange)
          );
          inFlightRef.current = null;

          const pendingRequest = pendingRequestRef.current;
          pendingRequestRef.current = null;
          if (pendingRequest != null) {
            void startViewportRowsRequest(pendingRequest);
          }

          return slab;
        })
        .catch((error: Error) => {
          if (generationRef.current === requestGeneration) {
            request.reject(error);
            inFlightRef.current = null;
            const pendingRequest = pendingRequestRef.current;
            pendingRequestRef.current = null;
            if (pendingRequest != null) {
              void startViewportRowsRequest(pendingRequest);
            }
          }
          throw error;
        });

      inFlightRef.current = { effectiveRange: request.effectiveRange, promise };
      return promise;
    },
    [adapter, readStrategy, updateViewportRowsStats]
  );

  const requestViewportRows = useCallback(
    (
      start: number,
      end: number
    ): Promise<readonly BulkExperimentVisibleRow[]> => {
      const desiredRange = { end, start };
      const effectiveRange = resolveViewportReadRange(
        desiredRange,
        readStrategy,
        readSlabMultiplier
      );

      const cachedSlab = cacheRef.current;
      if (
        cachedSlab != null &&
        rangeContainsRange(
          { end: cachedSlab.end, start: cachedSlab.start },
          desiredRange
        )
      ) {
        updateViewportRowsStats((previous) => ({
          ...previous,
          cacheHitCount: previous.cacheHitCount + 1,
        }));
        return Promise.resolve(
          sliceViewportRowsFromSlab(cachedSlab, desiredRange)
        );
      }

      if (readStrategy === 'exact') {
        return new Promise((resolve, reject) => {
          void startViewportRowsRequest({
            desiredRange,
            effectiveRange,
            reject,
            resolve,
          });
        });
      }

      const inFlightRequest = inFlightRef.current;
      if (
        inFlightRequest != null &&
        rangesEqual(inFlightRequest.effectiveRange, effectiveRange)
      ) {
        return inFlightRequest.promise.then((slab) =>
          sliceViewportRowsFromSlab(slab, desiredRange)
        );
      }

      return new Promise((resolve, reject) => {
        const pendingRequest = pendingRequestRef.current;
        if (pendingRequest != null) {
          pendingRequest.reject(createViewportRowsAbortError());
          updateViewportRowsStats((previous) => ({
            ...previous,
            requestDroppedCount: previous.requestDroppedCount + 1,
          }));
        }

        const nextRequest = {
          desiredRange,
          effectiveRange,
          reject,
          resolve,
        } satisfies BulkExperimentViewportRowsRequest;
        if (inFlightRef.current == null) {
          void startViewportRowsRequest(nextRequest);
          return;
        }

        pendingRequestRef.current = nextRequest;
      });
    },
    [
      readSlabMultiplier,
      readStrategy,
      startViewportRowsRequest,
      updateViewportRowsStats,
    ]
  );

  useEffect(() => {
    generationRef.current += 1;
    cacheRef.current = null;
    pendingRequestRef.current?.reject(createViewportRowsAbortError());
    pendingRequestRef.current = null;
    inFlightRef.current = null;
    setViewportRowsStats(createEmptyViewportRowsStats());
  }, [adapter, readSlabMultiplier, readStrategy]);

  return {
    invalidateCachedRowsFrom,
    requestViewportRows,
    viewportRowsStats,
  };
}

function createLongTaskMonitor(): { stop(): LongTaskStats } | null {
  if (typeof PerformanceObserver === 'undefined') {
    return null;
  }

  let count = 0;
  let longestMs = 0;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        count += 1;
        longestMs = Math.max(longestMs, entry.duration);
      }
    });
    observer.observe({ type: 'longtask' as never });

    return {
      stop() {
        observer.disconnect();
        return {
          count,
          longestMs: count === 0 ? 0 : longestMs,
        };
      },
    };
  } catch {
    return null;
  }
}

function createInitialSnapshot(
  options: BulkExperimentInitOptions
): BulkExperimentSnapshot {
  return {
    bulkInfo: {
      ingestedPathCount: options.previewPaths.length,
      status: 'idle',
      totalPathCount: options.totalPathCount,
    },
    committedSnapshotAgeMs: 0,
    committedVisibleVersion: 0,
    estimatedVisibleCount: options.finalVisibleCount,
    expansionMode: options.expansionMode,
    headChunkSize: options.headChunkSize,
    ingestMode: options.ingestMode,
    lastCommittedChangeStartIndex: null,
    materializedVisibleCount: options.previewVisibleCount,
    metrics: null,
    unresolvedFrontier: null,
    unpublishedPathCount: 0,
    visibleCount: options.previewVisibleCount,
    workingIngestedPathCount: options.previewPaths.length,
    workloadName: options.workloadName,
  };
}

function createBulkExperimentOptions(
  routeState: BulkExperimentRouteState
): BulkExperimentInitOptions {
  const previewData = BULK_EXPERIMENT_PREVIEW_DATA[routeState.workloadName];
  const finalVisibleCount =
    previewData.finalVisibleCountByExpansionMode[routeState.expansionMode];
  const previewVisibleCount =
    previewData.previewVisibleCountByExpansionMode[routeState.expansionMode];

  return {
    assetUrl: getBulkExperimentAssetUrl(routeState.workloadName),
    expansionMode: routeState.expansionMode,
    finalVisibleCount,
    headChunkSize: routeState.headChunkSize,
    ingestMode: routeState.ingestMode,
    previewPaths: previewData.previewPaths,
    previewVisibleCount,
    publishCheckpointInterval: routeState.publishCheckpointInterval,
    publishPathBudget: routeState.publishPathBudget,
    publishStrategy: routeState.publishStrategy,
    publishTimeBudgetMs: routeState.publishTimeBudgetMs,
    seededExpandedPaths: getBulkExperimentSeededExpandedPaths(
      routeState.workloadName
    ),
    rowTransport: routeState.rowTransport,

    totalPathCount: previewData.totalPathCount,
    workloadName: routeState.workloadName,
  };
}

function createLocalAdapter(
  options: BulkExperimentInitOptions,
  onReadLatencySample?: BulkExperimentReadLatencyListener
): BulkExperimentAdapter {
  const model = new BulkExperimentModel(options);

  const executeRead = <TValue,>(
    requestKind: BulkExperimentReadRequestKind,
    read: () => TValue
  ): Promise<TValue> => {
    const phase = classifyReadLatencyPhase(model.getSnapshot().bulkInfo.status);
    const sentAt = absoluteNow();
    const workerStartedAt = sentAt;
    const value = read();
    const workerFinishedAt = absoluteNow();
    onReadLatencySample?.(
      createReadLatencySample({
        phase,
        receivedAt: workerFinishedAt,
        requestKind,
        timing: { sentAt, workerFinishedAt, workerStartedAt },
      })
    );
    return Promise.resolve(value);
  };

  return {
    async cancelIngest() {
      model.cancelIngest();
    },
    async collapsePath(path) {
      model.collapsePath(path);
    },
    dispose() {
      model.destroy();
    },
    async expandPath(path) {
      model.expandPath(path);
    },
    getSnapshot() {
      return model.getSnapshot();
    },
    async getVisibleIndex(path) {
      return executeRead('visibleIndex', () => model.getVisibleIndex(path));
    },
    async getVisibleRows(start, end) {
      return executeRead('visibleRows', () => model.getVisibleRows(start, end));
    },
    async startIngest() {
      await model.startIngest();
    },
    subscribe(listener) {
      return model.subscribe(listener);
    },
  };
}

async function createWorkerAdapter(
  options: BulkExperimentInitOptions,
  onReadLatencySample?: BulkExperimentReadLatencyListener
): Promise<BulkExperimentAdapter> {
  const worker = new Worker(
    new URL('../_workers/bulkExperiment.worker.ts', import.meta.url),
    { type: 'module' }
  );
  const listeners = new Set<(snapshot: BulkExperimentSnapshot) => void>();
  let nextRequestId = 0;
  let snapshot = createInitialSnapshot(options);
  let resolveFirstSnapshot: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => {
    resolveFirstSnapshot = resolve;
  });
  const pending = new Map<
    number,
    | {
        kind: 'ack';
        reject: (error: Error) => void;
        resolve: () => void;
      }
    | {
        kind: 'index';
        phase: BulkExperimentReadLatencyPhase;
        reject: (error: Error) => void;
        resolve: (index: number | null) => void;
      }
    | {
        kind: 'rows';
        phase: BulkExperimentReadLatencyPhase;
        reject: (error: Error) => void;
        resolve: (rows: readonly BulkExperimentVisibleRow[]) => void;
      }
  >();

  const rejectPending = (error: Error): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  const handleMessage = (
    event: MessageEvent<BulkExperimentWorkerMessage>
  ): void => {
    const message = event.data;
    if (message.type === 'snapshot') {
      snapshot = message.snapshot;
      resolveFirstSnapshot?.();
      resolveFirstSnapshot = null;
      listeners.forEach((listener) => {
        listener(snapshot);
      });
      return;
    }

    const pendingRequest = pending.get(message.id);
    if (pendingRequest == null) {
      return;
    }
    pending.delete(message.id);

    if (message.type === 'error') {
      pendingRequest.reject(new Error(message.error));
      return;
    }

    if (pendingRequest.kind === 'ack') {
      if (message.type !== 'ack') {
        pendingRequest.reject(
          new Error(`Expected an ack response but received ${message.type}.`)
        );
        return;
      }
      pendingRequest.resolve();
      return;
    }

    const receivedAt = absoluteNow();
    if (pendingRequest.kind === 'index') {
      if (message.type !== 'visibleIndex') {
        pendingRequest.reject(
          new Error(
            `Expected a visible index response but received ${message.type}.`
          )
        );
        return;
      }
      onReadLatencySample?.(
        createReadLatencySample({
          phase: pendingRequest.phase,
          receivedAt,
          requestKind: 'visibleIndex',
          timing: message.timing,
        })
      );
      pendingRequest.resolve(message.index);
      return;
    }

    if (message.type !== 'visibleRows') {
      pendingRequest.reject(
        new Error(`Expected visible rows but received ${message.type}.`)
      );
      return;
    }

    onReadLatencySample?.(
      createReadLatencySample({
        phase: pendingRequest.phase,
        receivedAt,
        requestKind: 'visibleRows',
        timing: message.timing,
      })
    );
    pendingRequest.resolve(
      message.rowTransport === 'transferable'
        ? decodeVisibleRowsTransferPayload(message.transferredRows)
        : message.rows
    );
  };

  const handleError = (event: ErrorEvent): void => {
    rejectPending(
      new Error(
        event.message.length > 0
          ? event.message
          : 'Bulk experiment worker crashed.'
      )
    );
  };

  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);

  const requestAck = (request: BulkExperimentAckRequest): Promise<void> => {
    const id = nextRequestId;
    nextRequestId += 1;

    return new Promise<void>((resolve, reject) => {
      pending.set(id, { kind: 'ack', reject, resolve });
      worker.postMessage({
        ...request,
        id,
      } satisfies BulkExperimentWorkerRequest);
    });
  };

  const requestVisibleIndex = (path: string): Promise<number | null> => {
    const id = nextRequestId;
    nextRequestId += 1;
    const phase = classifyReadLatencyPhase(snapshot.bulkInfo.status);
    const sentAt = absoluteNow();

    return new Promise<number | null>((resolve, reject) => {
      pending.set(id, { kind: 'index', phase, reject, resolve });
      worker.postMessage({
        id,
        path,
        sentAt,
        type: 'getVisibleIndex',
      } satisfies BulkExperimentWorkerRequest);
    });
  };

  const requestVisibleRows = (
    start: number,
    end: number
  ): Promise<readonly BulkExperimentVisibleRow[]> => {
    const id = nextRequestId;
    nextRequestId += 1;
    const phase = classifyReadLatencyPhase(snapshot.bulkInfo.status);
    const sentAt = absoluteNow();

    return new Promise<readonly BulkExperimentVisibleRow[]>(
      (resolve, reject) => {
        pending.set(id, { kind: 'rows', phase, reject, resolve });
        worker.postMessage({
          end,
          id,
          sentAt,
          start,
          type: 'getVisibleRows',
        } satisfies BulkExperimentWorkerRequest);
      }
    );
  };

  await requestAck({ options, type: 'initialize' });
  await firstSnapshot;

  return {
    async cancelIngest() {
      await requestAck({ type: 'cancelIngest' });
    },
    async collapsePath(path) {
      await requestAck({ path, type: 'collapsePath' });
    },
    dispose() {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      rejectPending(new Error('Bulk experiment adapter disposed.'));
      listeners.clear();
      worker.terminate();
    },
    async expandPath(path) {
      await requestAck({ path, type: 'expandPath' });
    },
    getSnapshot() {
      return snapshot;
    },
    async getVisibleIndex(path) {
      return requestVisibleIndex(path);
    },
    async getVisibleRows(start, end) {
      return requestVisibleRows(start, end);
    },
    async startIngest() {
      await requestAck({ type: 'startIngest' });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function summarizeSelection(selectedPaths: readonly string[]): string {
  return selectedPaths.length === 0 ? '[]' : `[${selectedPaths.join(', ')}]`;
}

interface BulkIngestDemoClientProps extends BulkExperimentRouteState {
  payloadHtml: string;
}

function applyBulkExperimentRouteState(
  searchParams: URLSearchParams,
  state: BulkExperimentRouteState
): void {
  if (state.workloadName === DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME) {
    searchParams.delete('workload');
  } else {
    searchParams.set('workload', state.workloadName);
  }

  if (state.expansionMode === DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE) {
    searchParams.delete('expansion');
  } else {
    searchParams.set('expansion', state.expansionMode);
  }

  if (state.ingestMode === DEFAULT_BULK_EXPERIMENT_INGEST_MODE) {
    searchParams.delete('ingest');
  } else {
    searchParams.set('ingest', state.ingestMode);
  }

  if (state.ingestMode !== 'head-start') {
    searchParams.delete('head');
  } else if (state.headChunkSize === DEFAULT_BULK_EXPERIMENT_HEAD_CHUNK_SIZE) {
    searchParams.delete('head');
  } else {
    searchParams.set('head', String(state.headChunkSize));
  }

  if (state.readStrategy === DEFAULT_BULK_EXPERIMENT_READ_STRATEGY) {
    searchParams.delete('read');
  } else {
    searchParams.set('read', state.readStrategy);
  }

  if (state.readStrategy !== 'latest-only-slab') {
    searchParams.delete('slab');
  } else if (
    state.readSlabMultiplier === DEFAULT_BULK_EXPERIMENT_READ_SLAB_MULTIPLIER
  ) {
    searchParams.delete('slab');
  } else {
    searchParams.set('slab', String(state.readSlabMultiplier));
  }

  if (state.frontierGating === DEFAULT_BULK_EXPERIMENT_FRONTIER_GATING) {
    searchParams.delete('frontier');
  } else {
    searchParams.set('frontier', state.frontierGating ? '1' : '0');
  }

  if (state.publishStrategy === DEFAULT_BULK_EXPERIMENT_PUBLISH_STRATEGY) {
    searchParams.delete('publish');
  } else {
    searchParams.set('publish', state.publishStrategy);
  }

  if (state.publishStrategy !== 'checkpoint-count') {
    searchParams.delete('publishCheckpoints');
  } else if (
    state.publishCheckpointInterval ===
    DEFAULT_BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL
  ) {
    searchParams.delete('publishCheckpoints');
  } else {
    searchParams.set(
      'publishCheckpoints',
      String(state.publishCheckpointInterval)
    );
  }

  if (state.publishStrategy !== 'time-budget') {
    searchParams.delete('publishMs');
  } else if (
    state.publishTimeBudgetMs === DEFAULT_BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_MS
  ) {
    searchParams.delete('publishMs');
  } else {
    searchParams.set('publishMs', String(state.publishTimeBudgetMs));
  }

  if (state.rowTransport === DEFAULT_BULK_EXPERIMENT_ROW_TRANSPORT) {
    searchParams.delete('transport');
  } else {
    searchParams.set('transport', state.rowTransport);
  }

  if (state.publishStrategy !== 'path-budget') {
    searchParams.delete('publishPaths');
  } else if (
    state.publishPathBudget === DEFAULT_BULK_EXPERIMENT_PUBLISH_PATH_BUDGET
  ) {
    searchParams.delete('publishPaths');
  } else {
    searchParams.set('publishPaths', String(state.publishPathBudget));
  }

  if (state.useWorker) {
    searchParams.delete('worker');
  } else {
    searchParams.set('worker', '0');
  }
}

export function BulkIngestDemoClient({
  expansionMode,
  frontierGating,
  headChunkSize,
  ingestMode,
  payloadHtml,
  publishCheckpointInterval,
  publishPathBudget,
  publishStrategy,
  publishTimeBudgetMs,
  readSlabMultiplier,
  readStrategy,
  rowTransport,

  useWorker,
  workloadName,
}: BulkIngestDemoClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startConfigTransition] = useTransition();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  const currentRouteState = useMemo(
    () => ({
      expansionMode,
      frontierGating,
      headChunkSize,
      ingestMode,
      publishCheckpointInterval,
      publishPathBudget,
      publishStrategy,
      publishTimeBudgetMs,
      readSlabMultiplier,
      readStrategy,
      rowTransport,

      useWorker,
      workloadName,
    }),
    [
      expansionMode,
      frontierGating,
      headChunkSize,
      ingestMode,
      publishCheckpointInterval,
      publishPathBudget,
      publishStrategy,
      publishTimeBudgetMs,
      readSlabMultiplier,
      readStrategy,
      rowTransport,

      useWorker,
      workloadName,
    ]
  );

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const replaceRouteState = useCallback(
    (nextState: BulkExperimentRouteState) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      applyBulkExperimentRouteState(nextSearchParams, nextState);
      const nextUrl =
        nextSearchParams.size > 0
          ? `${pathname}?${nextSearchParams.toString()}`
          : pathname;
      startConfigTransition(() => {
        router.replace(nextUrl, { scroll: false });
      });
    },
    [pathname, router, searchParams, startConfigTransition]
  );

  return (
    <BulkExperimentSession
      key={`${JSON.stringify(currentRouteState)}:${String(resetToken)}`}
      {...currentRouteState}
      onExpansionModeChange={(nextExpansionMode) => {
        replaceRouteState({
          ...currentRouteState,
          expansionMode: nextExpansionMode,
        });
      }}
      onFrontierGatingChange={(nextFrontierGating) => {
        replaceRouteState({
          ...currentRouteState,
          frontierGating: nextFrontierGating,
        });
      }}
      onHeadChunkSizeChange={(nextHeadChunkSize) => {
        replaceRouteState({
          ...currentRouteState,
          headChunkSize: nextHeadChunkSize,
        });
      }}
      onIngestModeChange={(nextIngestMode) => {
        replaceRouteState({
          ...currentRouteState,
          ingestMode: nextIngestMode,
        });
      }}
      onPublishCheckpointIntervalChange={(nextPublishCheckpointInterval) => {
        replaceRouteState({
          ...currentRouteState,
          publishCheckpointInterval: nextPublishCheckpointInterval,
        });
      }}
      onPublishPathBudgetChange={(nextPublishPathBudget) => {
        replaceRouteState({
          ...currentRouteState,
          publishPathBudget: nextPublishPathBudget,
        });
      }}
      onPublishStrategyChange={(nextPublishStrategy) => {
        replaceRouteState({
          ...currentRouteState,
          publishStrategy: nextPublishStrategy,
        });
      }}
      onPublishTimeBudgetMsChange={(nextPublishTimeBudgetMs) => {
        replaceRouteState({
          ...currentRouteState,
          publishTimeBudgetMs: nextPublishTimeBudgetMs,
        });
      }}
      onRowTransportChange={(nextRowTransport) => {
        replaceRouteState({
          ...currentRouteState,
          rowTransport: nextRowTransport,
        });
      }}
      onReadSlabMultiplierChange={(nextReadSlabMultiplier) => {
        replaceRouteState({
          ...currentRouteState,
          readSlabMultiplier: nextReadSlabMultiplier,
        });
      }}
      onReadStrategyChange={(nextReadStrategy) => {
        replaceRouteState({
          ...currentRouteState,
          readStrategy: nextReadStrategy,
        });
      }}
      onReset={() => {
        setResetToken((value) => value + 1);
      }}
      onUseWorkerChange={(nextUseWorker) => {
        replaceRouteState({
          ...currentRouteState,
          useWorker: nextUseWorker,
        });
      }}
      onWorkloadChange={(nextWorkloadName) => {
        replaceRouteState({
          ...currentRouteState,
          workloadName: nextWorkloadName,
        });
      }}
      payloadHtml={payloadHtml}
      showServerPreview={!hasHydrated}
    />
  );
}

interface BulkExperimentSessionProps extends BulkExperimentRouteState {
  onExpansionModeChange: (value: BulkExperimentExpansionMode) => void;
  onFrontierGatingChange: (value: boolean) => void;
  onHeadChunkSizeChange: (value: BulkExperimentHeadChunkSize) => void;
  onIngestModeChange: (value: BulkExperimentIngestMode) => void;
  onPublishCheckpointIntervalChange: (
    value: BulkExperimentPublishCheckpointInterval
  ) => void;
  onPublishPathBudgetChange: (value: BulkExperimentPublishPathBudget) => void;
  onPublishStrategyChange: (value: BulkExperimentPublishStrategy) => void;
  onPublishTimeBudgetMsChange: (
    value: BulkExperimentPublishTimeBudgetMs
  ) => void;
  onReadSlabMultiplierChange: (value: BulkExperimentReadSlabMultiplier) => void;
  onReadStrategyChange: (value: BulkExperimentReadStrategy) => void;
  onRowTransportChange: (value: BulkExperimentRowTransport) => void;

  onReset: () => void;
  onUseWorkerChange: (value: boolean) => void;
  onWorkloadChange: (value: BulkExperimentWorkloadName) => void;
  payloadHtml: string;
  showServerPreview: boolean;
}

function BulkExperimentSession({
  expansionMode,
  frontierGating,
  headChunkSize,
  ingestMode,
  onExpansionModeChange,
  onFrontierGatingChange,
  onHeadChunkSizeChange,
  onIngestModeChange,
  onPublishCheckpointIntervalChange,
  onPublishPathBudgetChange,
  onPublishStrategyChange,
  onPublishTimeBudgetMsChange,
  onReadSlabMultiplierChange,
  onReadStrategyChange,
  onRowTransportChange,

  onReset,
  onUseWorkerChange,
  onWorkloadChange,
  payloadHtml,
  publishCheckpointInterval,
  publishPathBudget,
  publishStrategy,
  publishTimeBudgetMs,
  readSlabMultiplier,
  readStrategy,
  rowTransport,

  showServerPreview,
  useWorker,
  workloadName,
}: BulkExperimentSessionProps) {
  const { addLog, log } = useStateLog();
  const currentRouteState = useMemo(
    () => ({
      expansionMode,
      frontierGating,
      headChunkSize,
      ingestMode,
      publishCheckpointInterval,
      publishPathBudget,
      publishStrategy,
      publishTimeBudgetMs,
      readSlabMultiplier,
      readStrategy,
      rowTransport,

      useWorker,
      workloadName,
    }),
    [
      expansionMode,
      frontierGating,
      headChunkSize,
      ingestMode,
      publishCheckpointInterval,
      publishPathBudget,
      publishStrategy,
      publishTimeBudgetMs,
      readSlabMultiplier,
      readStrategy,
      rowTransport,

      useWorker,
      workloadName,
    ]
  );
  const experimentOptions = useMemo(
    () => createBulkExperimentOptions(currentRouteState),
    [currentRouteState]
  );
  const previewFallbackRows = useMemo(
    () => createPreviewFallbackRows(experimentOptions),
    [experimentOptions]
  );
  const previewData = BULK_EXPERIMENT_PREVIEW_DATA[workloadName];
  const workloadOption = useMemo(
    () =>
      BULK_EXPERIMENT_WORKLOAD_OPTIONS.find(
        (option) => option.name === workloadName
      ) ?? BULK_EXPERIMENT_WORKLOAD_OPTIONS[0],
    [workloadName]
  );
  const [adapter, setAdapter] = useState<BulkExperimentAdapter | null>(null);
  const [snapshot, setSnapshot] = useState<BulkExperimentSnapshot>(() =>
    createInitialSnapshot(experimentOptions)
  );
  const [rows, setRows] = useState<readonly BulkExperimentVisibleRow[]>([]);
  const [itemCount, setItemCount] = useState(snapshot.estimatedVisibleCount);
  const [resolvedViewportHeight, setResolvedViewportHeight] = useState(
    FILE_TREE_PROOF_VIEWPORT_HEIGHT
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [range, setRange] = useState(() =>
    computeWindowRange({
      itemCount: snapshot.estimatedVisibleCount,
      itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
      overscan: FILE_TREE_DEFAULT_OVERSCAN,
      scrollTop: 0,
      viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
    })
  );
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [latestSummary, setLatestSummary] =
    useState<BulkExperimentSummary | null>(null);
  const [readLatencySummary, setReadLatencySummary] =
    useState<BulkExperimentReadLatencySummaryByKind>(() =>
      createEmptyReadLatencySummaryByKind()
    );

  const { invalidateCachedRowsFrom, requestViewportRows, viewportRowsStats } =
    useViewportRowsRequester({
      adapter,
      readSlabMultiplier,
      readStrategy,
    });

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowButtonByPathRef = useRef(new Map<string, HTMLButtonElement>());
  const longTaskMonitorRef = useRef<ReturnType<
    typeof createLongTaskMonitor
  > | null>(null);
  const previousCommittedVersionRef = useRef<number | null>(null);

  const previousBulkInfoKeyRef = useRef<string | null>(null);
  const lastSummaryKeyRef = useRef<string | null>(null);
  const lastReadLatencyLogKeyRef = useRef<string | null>(null);
  const readLatencyBucketsRef = useRef(createEmptyReadLatencyBuckets());
  const readLatencyRefreshTimeoutRef = useRef<number | null>(null);

  const sessionStartedAtRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  );
  const didStartIngestRef = useRef(false);
  const [previewInteractivePaintedAt, setPreviewInteractivePaintedAt] =
    useState<number | null>(null);
  const previousGeometryRef = useRef({
    estimatedVisibleCount: experimentOptions.finalVisibleCount,
    materializedVisibleCount: experimentOptions.previewVisibleCount,
  });
  const topResolvedAnchorRef = useRef<{
    offset: number;
    path: string;
  } | null>(null);
  const milestoneLogRef = useRef({
    fetchCompletedAt: null as number | null,
    headCompletedAt: null as number | null,
    parseCompletedAt: null as number | null,
    tailChunkCount: 0,
  });

  const scheduleReadLatencySummaryRefresh = useCallback(() => {
    if (readLatencyRefreshTimeoutRef.current != null) {
      return;
    }

    readLatencyRefreshTimeoutRef.current = window.setTimeout(() => {
      readLatencyRefreshTimeoutRef.current = null;
      setReadLatencySummary(
        summarizeReadLatencyBuckets(readLatencyBucketsRef.current)
      );
    }, 50);
  }, []);

  const recordReadLatencySample = useCallback(
    (sample: BulkExperimentReadRequestLatencySample): void => {
      readLatencyBucketsRef.current[sample.requestKind][sample.phase].push(
        sample
      );
      scheduleReadLatencySummaryRefresh();
    },
    [scheduleReadLatencySummaryRefresh]
  );

  useEffect(() => {
    if (
      previousCommittedVersionRef.current === snapshot.committedVisibleVersion
    ) {
      return;
    }

    invalidateCachedRowsFrom(snapshot.lastCommittedChangeStartIndex);
    previousCommittedVersionRef.current = snapshot.committedVisibleVersion;
  }, [
    invalidateCachedRowsFrom,
    snapshot.committedVisibleVersion,
    snapshot.lastCommittedChangeStartIndex,
  ]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let nextAdapter: BulkExperimentAdapter | null = null;

    void (async () => {
      const createdAdapter = useWorker
        ? await createWorkerAdapter(experimentOptions, recordReadLatencySample)
        : createLocalAdapter(experimentOptions, recordReadLatencySample);
      if (disposed) {
        createdAdapter.dispose();
        return;
      }

      nextAdapter = createdAdapter;
      setAdapter(createdAdapter);
      setSnapshot(createdAdapter.getSnapshot());
      unsubscribe = createdAdapter.subscribe((nextSnapshot) => {
        if (!disposed) {
          setSnapshot(nextSnapshot);
        }
      });
      addLog(
        `mode:${useWorker ? 'worker' : 'main'} workload:${workloadName} expansion:${expansionMode} ingest:${ingestMode} read:${readStrategy}${readStrategy === 'latest-only-slab' ? ` x${String(readSlabMultiplier)}` : ''} transport:${rowTransport} publish:${publishStrategy} frontier:${frontierGating ? 'on' : 'off'}`
      );
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      nextAdapter?.dispose();
      longTaskMonitorRef.current?.stop();
      longTaskMonitorRef.current = null;
      if (readLatencyRefreshTimeoutRef.current != null) {
        window.clearTimeout(readLatencyRefreshTimeoutRef.current);
        readLatencyRefreshTimeoutRef.current = null;
      }
    };
  }, [
    addLog,
    expansionMode,
    experimentOptions,
    frontierGating,
    ingestMode,
    publishStrategy,
    readSlabMultiplier,
    readStrategy,
    rowTransport,

    recordReadLatencySample,
    useWorker,
    workloadName,
  ]);

  useEffect(() => {
    if (showServerPreview || adapter == null || didStartIngestRef.current) {
      return;
    }

    if (snapshot.bulkInfo.status !== 'idle') {
      return;
    }

    const requestFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);
    const cancelFrame =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : (handle: number) => {
            window.clearTimeout(handle);
          };

    const frameHandle = requestFrame(() => {
      const paintedAt = roundMetric(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
          sessionStartedAtRef.current
      );
      setPreviewInteractivePaintedAt(paintedAt);
      if (paintedAt != null) {
        addLog(`preview:interactive-painted at=${paintedAt.toFixed(1)}ms`);
      }

      didStartIngestRef.current = true;
      void adapter.startIngest();
    });

    return () => {
      cancelFrame(frameHandle);
    };
  }, [adapter, addLog, showServerPreview, snapshot.bulkInfo.status]);

  useLayoutEffect(() => {
    if (showServerPreview || adapter == null) {
      return;
    }

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollElement = scrollRef.current;
    const listElement = listRef.current;
    if (scrollElement == null) {
      return;
    }

    const update = (): void => {
      const nextItemCount = snapshot.estimatedVisibleCount;
      const nextViewportHeight =
        scrollElement.clientHeight > 0
          ? scrollElement.clientHeight
          : FILE_TREE_PROOF_VIEWPORT_HEIGHT;
      const maxScrollTop = Math.max(
        0,
        nextItemCount * FILE_TREE_DEFAULT_ITEM_HEIGHT - nextViewportHeight
      );
      if (scrollElement.scrollTop > maxScrollTop) {
        scrollElement.scrollTop = maxScrollTop;
      }

      const nextScrollTop = Math.min(scrollElement.scrollTop, maxScrollTop);
      setScrollTop((previousScrollTop) =>
        previousScrollTop === nextScrollTop ? previousScrollTop : nextScrollTop
      );
      setItemCount((previousCount) =>
        previousCount === nextItemCount ? previousCount : nextItemCount
      );
      setResolvedViewportHeight((previousViewportHeight) =>
        previousViewportHeight === nextViewportHeight
          ? previousViewportHeight
          : nextViewportHeight
      );
      setRange((previousRange) => {
        const nextRange = computeWindowRange(
          {
            itemCount: nextItemCount,
            itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
            overscan: FILE_TREE_DEFAULT_OVERSCAN,
            scrollTop: nextScrollTop,
            viewportHeight: nextViewportHeight,
          },
          previousRange
        );
        return rangesEqual(previousRange, nextRange)
          ? previousRange
          : nextRange;
      });
    };

    const onScroll = (): void => {
      update();
      if (listElement == null) {
        return;
      }

      listElement.dataset.isScrolling ??= '';
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      scrollTimer = setTimeout(() => {
        delete listElement.dataset.isScrolling;
        scrollTimer = null;
      }, 50);
    };

    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            update();
          })
        : null;
    resizeObserver?.observe(scrollElement);
    update();

    return () => {
      scrollElement.removeEventListener('scroll', onScroll);
      if (scrollTimer != null) {
        clearTimeout(scrollTimer);
      }
      if (listElement != null) {
        delete listElement.dataset.isScrolling;
      }
      resizeObserver?.disconnect();
    };
  }, [adapter, showServerPreview, snapshot.estimatedVisibleCount]);
  const displayRows = useMemo(() => {
    const rangedRows = rows.filter(
      (row) => row.index >= range.start && row.index <= range.end
    );
    if (range.end < range.start || range.start >= previewFallbackRows.length) {
      return rangedRows;
    }

    const previewOverlapEnd = Math.min(
      range.end,
      previewFallbackRows.length - 1
    );
    const rowsByIndex = new Map(rangedRows.map((row) => [row.index, row]));
    const mergedRows: BulkExperimentVisibleRow[] = [];
    for (let index = range.start; index <= previewOverlapEnd; index += 1) {
      const nextRow = rowsByIndex.get(index) ?? previewFallbackRows[index];
      if (nextRow != null) {
        mergedRows.push(nextRow);
      }
    }

    for (const row of rangedRows) {
      if (row.index > previewOverlapEnd) {
        mergedRows.push(row);
      }
    }

    return mergedRows;
  }, [previewFallbackRows, range.end, range.start, rows]);

  useEffect(() => {
    if (snapshot.materializedVisibleCount <= 0 || displayRows.length === 0) {
      topResolvedAnchorRef.current = null;
      return;
    }

    const anchorIndex = Math.max(
      0,
      Math.min(
        snapshot.materializedVisibleCount - 1,
        Math.floor(scrollTop / FILE_TREE_DEFAULT_ITEM_HEIGHT)
      )
    );
    const anchorRow = displayRows.find((row) => row.index === anchorIndex);
    if (anchorRow == null) {
      return;
    }

    topResolvedAnchorRef.current = {
      offset: Math.max(
        0,
        Math.min(
          FILE_TREE_DEFAULT_ITEM_HEIGHT - 1,
          scrollTop - anchorIndex * FILE_TREE_DEFAULT_ITEM_HEIGHT
        )
      ),
      path: anchorRow.path,
    };
  }, [displayRows, scrollTop, snapshot.materializedVisibleCount]);

  useEffect(() => {
    const previousGeometry = previousGeometryRef.current;
    if (
      adapter == null ||
      previousGeometry.estimatedVisibleCount === snapshot.estimatedVisibleCount
    ) {
      previousGeometryRef.current = {
        estimatedVisibleCount: snapshot.estimatedVisibleCount,
        materializedVisibleCount: snapshot.materializedVisibleCount,
      };
      return;
    }

    previousGeometryRef.current = {
      estimatedVisibleCount: snapshot.estimatedVisibleCount,
      materializedVisibleCount: snapshot.materializedVisibleCount,
    };
    const anchor = topResolvedAnchorRef.current;
    if (anchor == null) {
      return;
    }

    if (
      frontierGating &&
      snapshot.lastCommittedChangeStartIndex != null &&
      range.end < snapshot.lastCommittedChangeStartIndex
    ) {
      return;
    }

    const nextEstimatedVisibleCount = snapshot.estimatedVisibleCount;
    void adapter.getVisibleIndex(anchor.path).then((nextIndex) => {
      const nextScrollElement = scrollRef.current;
      if (nextIndex == null || nextScrollElement == null) {
        return;
      }

      const maxScrollTop = Math.max(
        0,
        nextEstimatedVisibleCount * FILE_TREE_DEFAULT_ITEM_HEIGHT -
          resolvedViewportHeight
      );
      const nextScrollTop = Math.min(
        maxScrollTop,
        nextIndex * FILE_TREE_DEFAULT_ITEM_HEIGHT + anchor.offset
      );
      nextScrollElement.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    });
  }, [
    adapter,
    frontierGating,
    range.end,
    resolvedViewportHeight,
    snapshot.estimatedVisibleCount,
    snapshot.lastCommittedChangeStartIndex,
    snapshot.materializedVisibleCount,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (adapter == null || range.end < range.start) {
      setRows([]);
      return;
    }

    if (
      frontierGating &&
      snapshot.lastCommittedChangeStartIndex != null &&
      range.end < snapshot.lastCommittedChangeStartIndex &&
      rowsCoverRange(rows, range)
    ) {
      return;
    }

    void requestViewportRows(range.start, range.end)
      .then((nextRows) => {
        if (!cancelled) {
          setRows(nextRows);
        }
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    frontierGating,
    range.end,
    range.start,
    requestViewportRows,
    snapshot.committedVisibleVersion,
    snapshot.lastCommittedChangeStartIndex,
  ]);

  const stickyLayout = useMemo(
    () =>
      computeStickyWindowLayout({
        itemCount,
        itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
        range,
        viewportHeight: resolvedViewportHeight,
      }),
    [itemCount, range, resolvedViewportHeight]
  );

  useEffect(() => {
    const metrics = snapshot.metrics;
    if (metrics == null) {
      return;
    }

    if (
      metrics.fetchCompletedAt != null &&
      milestoneLogRef.current.fetchCompletedAt !== metrics.fetchCompletedAt
    ) {
      milestoneLogRef.current.fetchCompletedAt = metrics.fetchCompletedAt;
      addLog(`fetch:complete at=${metrics.fetchCompletedAt.toFixed(1)}ms`);
    }
    if (
      metrics.parseCompletedAt != null &&
      milestoneLogRef.current.parseCompletedAt !== metrics.parseCompletedAt
    ) {
      milestoneLogRef.current.parseCompletedAt = metrics.parseCompletedAt;
      addLog(`parse:complete at=${metrics.parseCompletedAt.toFixed(1)}ms`);
    }
    if (
      metrics.headChunk != null &&
      milestoneLogRef.current.headCompletedAt !== metrics.headChunk.completedAt
    ) {
      milestoneLogRef.current.headCompletedAt = metrics.headChunk.completedAt;
      addLog(
        `head:checkpoint at=${metrics.headChunk.completedAt.toFixed(1)}ms published=${metrics.headChunk.published ? 'yes' : 'no'} committed=${metrics.headChunk.committedIngestedPathCount.toLocaleString()} working=${metrics.headChunk.workingIngestedPathCount.toLocaleString()} frontier=${metrics.headChunk.materializedVisibleCount.toLocaleString()} rows`
      );
    }
    if (milestoneLogRef.current.tailChunkCount !== metrics.tailChunks.length) {
      const nextTailChunks = metrics.tailChunks.slice(
        milestoneLogRef.current.tailChunkCount
      );
      milestoneLogRef.current.tailChunkCount = metrics.tailChunks.length;
      for (const chunk of nextTailChunks) {
        addLog(
          `tail:checkpoint at=${chunk.completedAt.toFixed(1)}ms published=${chunk.published ? 'yes' : 'no'} committed=${chunk.committedIngestedPathCount.toLocaleString()} working=${chunk.workingIngestedPathCount.toLocaleString()}`
        );
      }
    }
  }, [addLog, snapshot.metrics]);

  useEffect(() => {
    const bulkInfoKey = `${snapshot.bulkInfo.status}:${snapshot.bulkInfo.ingestedPathCount}:${snapshot.workingIngestedPathCount}:${snapshot.unpublishedPathCount}:${String(snapshot.bulkInfo.totalPathCount)}:${snapshot.bulkInfo.errorMessage ?? ''}`;
    if (previousBulkInfoKeyRef.current === bulkInfoKey) {
      return;
    }
    previousBulkInfoKeyRef.current = bulkInfoKey;

    addLog(
      `bulk:${snapshot.bulkInfo.status} committed=${formatProgress(snapshot)} working=${formatWorkingProgress(snapshot)} unpublished=${snapshot.unpublishedPathCount.toLocaleString()}${snapshot.bulkInfo.errorMessage == null ? '' : ` error=${snapshot.bulkInfo.errorMessage}`}`
    );
  }, [addLog, snapshot]);

  useEffect(() => {
    if (snapshot.bulkInfo.status === 'ingesting') {
      longTaskMonitorRef.current ??= createLongTaskMonitor();
      return;
    }

    if (
      snapshot.metrics == null ||
      (snapshot.bulkInfo.status !== 'completed' &&
        snapshot.bulkInfo.status !== 'cancelled' &&
        snapshot.bulkInfo.status !== 'failed')
    ) {
      return;
    }

    const longTaskStats = longTaskMonitorRef.current?.stop() ?? {
      count: null,
      longestMs: null,
    };
    longTaskMonitorRef.current = null;

    const summaryKey = JSON.stringify([
      snapshot.bulkInfo.status,
      snapshot.bulkInfo.ingestedPathCount,
      snapshot.metrics.totalMs,
      snapshot.metrics.committedPublishCount,
      snapshot.metrics.workingCheckpointCount,
      viewportRowsStats.requestSentCount,
      viewportRowsStats.requestDroppedCount,
      longTaskStats.count,
      longTaskStats.longestMs,
    ]);
    if (lastSummaryKeyRef.current === summaryKey) {
      return;
    }
    lastSummaryKeyRef.current = summaryKey;

    const summary: BulkExperimentSummary = {
      applyMs: roundMetric(snapshot.metrics.applyMs) ?? 0,
      committedIngestedPathCount: snapshot.bulkInfo.ingestedPathCount,
      committedPublishCount: snapshot.metrics.committedPublishCount,
      expansionMode,
      fetchCompletedAt: roundMetric(snapshot.metrics.fetchCompletedAt),
      fetchMs: roundMetric(snapshot.metrics.fetchMs) ?? 0,
      frontierGating,
      headChunkCompletedAt: roundMetric(
        snapshot.metrics.headChunk?.completedAt ?? null
      ),
      headChunkMaterializedVisibleCount:
        snapshot.metrics.headChunk?.materializedVisibleCount ?? null,
      ingestMode,
      longTaskCount: longTaskStats.count,
      longestLongTaskMs: roundMetric(longTaskStats.longestMs),
      parseCompletedAt: roundMetric(snapshot.metrics.parseCompletedAt),
      parseMs: roundMetric(snapshot.metrics.parseMs) ?? 0,
      previewInteractivePaintedAt,
      publishP95Ms: roundMetric(snapshot.metrics.publishMs.p95Ms),
      publishSampleCount: snapshot.metrics.publishMs.sampleCount,
      publishStrategy,
      readSlabMultiplier,
      readStrategy,
      rowTransport,

      status: snapshot.bulkInfo.status,
      tailChunkCompletedAt: snapshot.metrics.tailChunks.map(
        (chunk) => roundMetric(chunk.completedAt) ?? 0
      ),
      totalMs: roundMetric(snapshot.metrics.totalMs) ?? 0,
      unpublishedPathCount: snapshot.unpublishedPathCount,
      viewportRowsCacheHitCount: viewportRowsStats.cacheHitCount,
      viewportRowsCacheMissCount: viewportRowsStats.cacheMissCount,
      viewportRowsRequestCompletedCount:
        viewportRowsStats.requestCompletedCount,
      viewportRowsRequestDroppedCount: viewportRowsStats.requestDroppedCount,
      viewportRowsRequestSentCount: viewportRowsStats.requestSentCount,
      workerMode: useWorker ? 'worker' : 'main',
      workingCheckpointCount: snapshot.metrics.workingCheckpointCount,
      workingIngestedPathCount: snapshot.workingIngestedPathCount,
      workloadName,
    };
    setLatestSummary(summary);
    console.table([summary]);
  }, [
    expansionMode,
    frontierGating,
    ingestMode,
    previewInteractivePaintedAt,
    publishStrategy,
    readSlabMultiplier,
    readStrategy,
    rowTransport,

    snapshot,
    useWorker,
    viewportRowsStats,
    workloadName,
  ]);

  useEffect(() => {
    if (
      snapshot.bulkInfo.status === 'idle' ||
      snapshot.bulkInfo.status === 'ingesting' ||
      !hasReadLatencySamples(readLatencySummary)
    ) {
      return;
    }

    const summaryKey = JSON.stringify(readLatencySummary);
    if (lastReadLatencyLogKeyRef.current === summaryKey) {
      return;
    }
    lastReadLatencyLogKeyRef.current = summaryKey;

    addLog(
      `visibleRows:active ${formatReadLatencySummary(readLatencySummary.visibleRows.activeIngest)}`
    );
    if (readLatencySummary.visibleRows.postCompletion.total.sampleCount > 0) {
      addLog(
        `visibleRows:post ${formatReadLatencySummary(readLatencySummary.visibleRows.postCompletion)}`
      );
    }

    if (readLatencySummary.visibleIndex.activeIngest.total.sampleCount > 0) {
      addLog(
        `visibleIndex:active ${formatReadLatencySummary(readLatencySummary.visibleIndex.activeIngest)}`
      );
    }
    if (readLatencySummary.visibleIndex.postCompletion.total.sampleCount > 0) {
      addLog(
        `visibleIndex:post ${formatReadLatencySummary(readLatencySummary.visibleIndex.postCompletion)}`
      );
    }
  }, [addLog, readLatencySummary, snapshot.bulkInfo.status]);

  useLayoutEffect(() => {
    if (focusedPath == null) {
      return;
    }

    const target = rowButtonByPathRef.current.get(focusedPath);
    if (target != null && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  }, [focusedPath, rows]);

  const selectedPathSet = useMemo(
    () => new Set(selectedPaths),
    [selectedPaths]
  );

  const ensureIndexVisible = useCallback((index: number) => {
    const scrollElement = scrollRef.current;
    if (scrollElement == null) {
      return;
    }

    const rowTop = index * FILE_TREE_DEFAULT_ITEM_HEIGHT;
    const rowBottom = rowTop + FILE_TREE_DEFAULT_ITEM_HEIGHT;
    if (rowTop < scrollElement.scrollTop) {
      scrollElement.scrollTop = rowTop;
      return;
    }

    const visibleBottom =
      scrollElement.scrollTop + FILE_TREE_PROOF_VIEWPORT_HEIGHT;
    if (rowBottom > visibleBottom) {
      scrollElement.scrollTop = rowBottom - FILE_TREE_PROOF_VIEWPORT_HEIGHT;
    }
  }, []);

  const moveFocus = useCallback(
    async (offset: number) => {
      if (adapter == null || snapshot.materializedVisibleCount === 0) {
        return;
      }

      const currentIndex = focusedIndex ?? 0;
      const nextIndex = Math.max(
        0,
        Math.min(snapshot.materializedVisibleCount - 1, currentIndex + offset)
      );
      const nextRows = await adapter.getVisibleRows(nextIndex, nextIndex);
      const nextRow = nextRows[0];
      if (nextRow == null) {
        return;
      }

      setFocusedIndex(nextIndex);
      setFocusedPath(nextRow.path);
      ensureIndexVisible(nextIndex);
    },
    [
      adapter,
      ensureIndexVisible,
      focusedIndex,
      snapshot.materializedVisibleCount,
    ]
  );

  const setSelectionForRow = useCallback(
    (row: BulkExperimentVisibleRow, additive: boolean) => {
      setFocusedIndex(row.index);
      setFocusedPath(row.path);
      setSelectedPaths((previous) => {
        if (!additive) {
          return [row.path];
        }

        return previous.includes(row.path)
          ? previous.filter((path) => path !== row.path)
          : [...previous, row.path];
      });
    },
    []
  );

  const handleRowClick = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      row: BulkExperimentVisibleRow
    ) => {
      setSelectionForRow(row, event.metaKey || event.ctrlKey);
    },
    [setSelectionForRow]
  );

  const handleRowKeyDown = useCallback(
    async (
      event: ReactKeyboardEvent<HTMLButtonElement>,
      row: BulkExperimentVisibleRow
    ) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          await moveFocus(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          await moveFocus(-1);
          return;
        case 'ArrowRight':
          if (row.kind === 'directory' && !row.isExpanded && adapter != null) {
            event.preventDefault();
            await adapter.expandPath(row.path);
            addLog(`expand:${row.path}`);
          }
          return;
        case 'ArrowLeft':
          if (row.kind === 'directory' && row.isExpanded && adapter != null) {
            event.preventDefault();
            await adapter.collapsePath(row.path);
            setFocusedIndex(row.index);
            setFocusedPath(row.path);
            addLog(`collapse:${row.path}`);
          }
          return;
        case 'Enter':
        case ' ':
          event.preventDefault();
          setSelectionForRow(row, event.metaKey || event.ctrlKey);
          return;
        default:
          return;
      }
    },
    [adapter, addLog, moveFocus, setSelectionForRow]
  );

  const unresolvedWindowStart = Math.max(
    range.start,
    snapshot.materializedVisibleCount
  );
  const unresolvedWindowCount =
    range.end < unresolvedWindowStart
      ? 0
      : range.end - unresolvedWindowStart + 1;
  const unresolvedWindowHeight =
    unresolvedWindowCount * FILE_TREE_DEFAULT_ITEM_HEIGHT;
  const showLocalUnresolvedBand =
    unresolvedWindowHeight > 0 &&
    snapshot.unresolvedFrontier?.kind === 'subtree' &&
    range.start < snapshot.materializedVisibleCount;
  const unresolvedBandPaddingLeft =
    snapshot.unresolvedFrontier == null
      ? undefined
      : `${String(snapshot.unresolvedFrontier.level * 14 + 4)}px`;
  const showEmptyState =
    displayRows.length === 0 && unresolvedWindowHeight === 0;

  const latestMetricsContent = (
    <div className="text-muted-foreground mt-1 space-y-1">
      <div>
        {useWorker ? 'worker' : 'main'} / {workloadName} / {ingestMode} / read=
        {readStrategy}
        {readStrategy === 'latest-only-slab'
          ? ` x${String(readSlabMultiplier)}`
          : ''}{' '}
        / transport={rowTransport} / publish={publishStrategy}
      </div>
      <div>
        committed={formatProgress(snapshot)} working=
        {formatWorkingProgress(snapshot)}
      </div>
      <div>
        unpublished={snapshot.unpublishedPathCount.toLocaleString()} frontier=
        {snapshot.lastCommittedChangeStartIndex == null
          ? 'n/a'
          : snapshot.lastCommittedChangeStartIndex.toLocaleString()}{' '}
        age=
        {formatMetric(snapshot.committedSnapshotAgeMs)} gating=
        {frontierGating ? 'on' : 'off'}
      </div>
      <div>viewportRows={formatViewportRowsStats(viewportRowsStats)}</div>
      {snapshot.metrics == null ? null : (
        <div>
          publishes={String(snapshot.metrics.committedPublishCount)}{' '}
          checkpoints=
          {String(snapshot.metrics.workingCheckpointCount)} publish=
          {formatLatencyMetricSummary(snapshot.metrics.publishMs)}
        </div>
      )}
      {latestSummary == null ? (
        <span className="italic">
          Reset the session to replay preview activation, ingest milestones, and
          final latency summaries.
        </span>
      ) : (
        <>
          <div>
            preview={formatMetric(latestSummary.previewInteractivePaintedAt)}{' '}
            fetch={formatMetric(latestSummary.fetchCompletedAt)} parse=
            {formatMetric(latestSummary.parseCompletedAt)}
          </div>
          <div>
            head={formatMetric(latestSummary.headChunkCompletedAt)} frontier=
            {latestSummary.headChunkMaterializedVisibleCount == null
              ? 'n/a'
              : `${latestSummary.headChunkMaterializedVisibleCount.toLocaleString()} rows`}
          </div>
          <div>tail={formatMetricList(latestSummary.tailChunkCompletedAt)}</div>
          <div>
            apply={formatMetric(latestSummary.applyMs)} total=
            {formatMetric(latestSummary.totalMs)}
          </div>
          <div>
            longtasks=
            {latestSummary.longTaskCount == null
              ? 'n/a'
              : String(latestSummary.longTaskCount)}
            {' / '}longest={formatMetric(latestSummary.longestLongTaskMs)}
          </div>
        </>
      )}
      <div className="pt-1">
        rows(active)=
        {formatReadLatencySummary(readLatencySummary.visibleRows.activeIngest)}
      </div>
      <div>
        rows(post)=
        {formatReadLatencySummary(
          readLatencySummary.visibleRows.postCompletion
        )}
      </div>
      <div>
        index(active)=
        {formatReadLatencySummary(readLatencySummary.visibleIndex.activeIngest)}
      </div>
      <div>
        index(post)=
        {formatReadLatencySummary(
          readLatencySummary.visibleIndex.postCompletion
        )}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
      <ExampleCard
        className="max-w-none"
        title="Bulk ingest worker experiment"
        description={`Previewing ${experimentOptions.previewPaths.length.toLocaleString()} of ${previewData.totalPathCount.toLocaleString()} ${workloadOption.label} paths. The same demo-local model runs either on the main thread or inside a worker so this page can compare responsiveness while holding the renderer and workload constant.`}
      >
        <div className="mb-3 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-5">
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              checked={useWorker}
              type="checkbox"
              onChange={(event) => {
                onUseWorkerChange(event.target.checked);
              }}
            />
            Use worker
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Workload</span>
            <select
              value={workloadName}
              onChange={(event) => {
                onWorkloadChange(
                  event.target.value as BulkExperimentWorkloadName
                );
              }}
            >
              {BULK_EXPERIMENT_WORKLOAD_OPTIONS.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Expansion mode</span>
            <select
              value={expansionMode}
              onChange={(event) => {
                onExpansionModeChange(
                  event.target.value as BulkExperimentExpansionMode
                );
              }}
            >
              {BULK_EXPERIMENT_EXPANSION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Ingest mode</span>
            <select
              value={ingestMode}
              onChange={(event) => {
                onIngestModeChange(
                  event.target.value as BulkExperimentIngestMode
                );
              }}
            >
              {BULK_EXPERIMENT_INGEST_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {ingestMode === 'head-start' ? (
            <label className="grid gap-1">
              <span className="font-medium">Head chunk</span>
              <select
                value={headChunkSize}
                onChange={(event) => {
                  onHeadChunkSizeChange(
                    Number(event.target.value) as BulkExperimentHeadChunkSize
                  );
                }}
              >
                {BULK_EXPERIMENT_HEAD_CHUNK_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="mb-3 grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1">
            <span className="font-medium">Read strategy</span>
            <select
              value={readStrategy}
              onChange={(event) => {
                onReadStrategyChange(
                  event.target.value as BulkExperimentReadStrategy
                );
              }}
            >
              {BULK_EXPERIMENT_READ_STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {readStrategy === 'latest-only-slab' ? (
            <label className="grid gap-1">
              <span className="font-medium">Read slab</span>
              <select
                value={readSlabMultiplier}
                onChange={(event) => {
                  onReadSlabMultiplierChange(
                    Number(
                      event.target.value
                    ) as BulkExperimentReadSlabMultiplier
                  );
                }}
              >
                {BULK_EXPERIMENT_READ_SLAB_MULTIPLIER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-1">
            <span className="font-medium">Row transport</span>
            <select
              value={rowTransport}
              onChange={(event) => {
                onRowTransportChange(
                  event.target.value as BulkExperimentRowTransport
                );
              }}
            >
              {BULK_EXPERIMENT_ROW_TRANSPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              checked={frontierGating}
              type="checkbox"
              onChange={(event) => {
                onFrontierGatingChange(event.target.checked);
              }}
            />
            Frontier gating
          </label>

          <label className="grid gap-1">
            <span className="font-medium">Publish strategy</span>
            <select
              value={publishStrategy}
              onChange={(event) => {
                onPublishStrategyChange(
                  event.target.value as BulkExperimentPublishStrategy
                );
              }}
            >
              {BULK_EXPERIMENT_PUBLISH_STRATEGY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {publishStrategy === 'checkpoint-count' ? (
            <label className="grid gap-1">
              <span className="font-medium">Publish every</span>
              <select
                value={publishCheckpointInterval}
                onChange={(event) => {
                  onPublishCheckpointIntervalChange(
                    Number(
                      event.target.value
                    ) as BulkExperimentPublishCheckpointInterval
                  );
                }}
              >
                {BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL_OPTIONS.map(
                  (option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </label>
          ) : null}

          {publishStrategy === 'time-budget' ? (
            <label className="grid gap-1">
              <span className="font-medium">Publish budget</span>
              <select
                value={publishTimeBudgetMs}
                onChange={(event) => {
                  onPublishTimeBudgetMsChange(
                    Number(
                      event.target.value
                    ) as BulkExperimentPublishTimeBudgetMs
                  );
                }}
              >
                {BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {publishStrategy === 'path-budget' ? (
            <label className="grid gap-1">
              <span className="font-medium">Publish paths</span>
              <select
                value={publishPathBudget}
                onChange={(event) => {
                  onPublishPathBudgetChange(
                    Number(
                      event.target.value
                    ) as BulkExperimentPublishPathBudget
                  );
                }}
              >
                {BULK_EXPERIMENT_PUBLISH_PATH_BUDGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            disabled={snapshot.bulkInfo.status !== 'ingesting'}
            onClick={() => {
              void adapter?.cancelIngest();
            }}
          >
            Cancel ingest
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={onReset}
          >
            Reset run
          </button>
          <span className="text-muted-foreground self-center">
            auto-start after preview paint
          </span>
          <span className="text-muted-foreground self-center">
            progress={formatProgress(snapshot)}
          </span>
        </div>

        {showServerPreview ? (
          <div
            style={{ height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px` }}
            dangerouslySetInnerHTML={{ __html: payloadHtml }}
            suppressHydrationWarning
          />
        ) : adapter == null ? (
          <div
            className="text-muted-foreground flex items-center justify-center rounded border text-xs"
            style={{
              borderColor: 'var(--color-border)',
              height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px`,
            }}
          >
            Preparing {useWorker ? 'worker' : 'main-thread'} experiment…
          </div>
        ) : (
          <div
            ref={scrollRef}
            data-file-tree-virtualized-scroll="true"
            className="overflow-auto rounded border"
            style={{
              borderColor: 'var(--color-border)',
              height: `${String(FILE_TREE_PROOF_VIEWPORT_HEIGHT)}px`,
            }}
          >
            <div
              ref={listRef}
              data-file-tree-virtualized-list="true"
              style={{
                height: `${stickyLayout.totalHeight}px`,
                minHeight: '100%',
                overflowAnchor: 'none',
                position: 'relative',
                width: '100%',
              }}
            >
              <div
                data-file-tree-virtualized-sticky-offset="true"
                aria-hidden="true"
                style={{
                  contain: 'layout size',
                  height: `${stickyLayout.offsetHeight}px`,
                }}
              />
              <div
                data-file-tree-virtualized-sticky="true"
                role="tree"
                aria-label="Bulk ingest experiment tree"
                style={{
                  bottom: `${stickyLayout.stickyInset}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  height: `${stickyLayout.windowHeight}px`,
                  isolation: 'isolate',
                  position: 'sticky',
                  top: `${stickyLayout.stickyInset}px`,
                  width: '100%',
                }}
              >
                {showEmptyState ? (
                  <div className="text-muted-foreground px-3 py-2 text-xs italic">
                    No visible rows for the current expansion state.
                  </div>
                ) : (
                  <>
                    {displayRows.map((row) => {
                      const isFocused = focusedPath === row.path;
                      const isSelected = selectedPathSet.has(row.path);
                      const canToggle =
                        row.kind === 'directory' && row.hasChildren;
                      return (
                        <div
                          key={`${row.index}:${row.path}`}
                          className="flex items-center gap-1 px-2"
                          style={{
                            minHeight: `${String(FILE_TREE_DEFAULT_ITEM_HEIGHT)}px`,
                            paddingLeft: `${String(row.level * 14 + 4)}px`,
                          }}
                        >
                          <button
                            type="button"
                            className="text-muted-foreground w-5 shrink-0 text-center"
                            aria-hidden={!canToggle}
                            disabled={!canToggle}
                            onClick={() => {
                              if (!canToggle || adapter == null) {
                                return;
                              }

                              if (row.isExpanded) {
                                void adapter.collapsePath(row.path);
                                addLog(`collapse:${row.path}`);
                              } else {
                                void adapter.expandPath(row.path);
                                addLog(`expand:${row.path}`);
                              }
                              setFocusedIndex(row.index);
                              setFocusedPath(row.path);
                            }}
                          >
                            {canToggle ? (row.isExpanded ? '▾' : '▸') : '·'}
                          </button>
                          <button
                            type="button"
                            ref={(element) => {
                              if (element == null) {
                                rowButtonByPathRef.current.delete(row.path);
                                return;
                              }

                              rowButtonByPathRef.current.set(row.path, element);
                            }}
                            role="treeitem"
                            aria-expanded={
                              row.kind === 'directory'
                                ? row.isExpanded
                                : undefined
                            }
                            aria-level={row.level + 1}
                            aria-posinset={row.posInSet + 1}
                            aria-selected={isSelected}
                            aria-setsize={row.setSize}
                            className="min-w-0 flex-1 rounded-sm px-2 py-1 text-left text-xs"
                            data-row-path={row.path}
                            style={{
                              backgroundColor: isSelected
                                ? 'var(--color-muted)'
                                : 'transparent',
                              outlineColor: isFocused
                                ? 'var(--color-primary)'
                                : undefined,
                            }}
                            tabIndex={isFocused ? 0 : -1}
                            onClick={(event) => {
                              handleRowClick(event, row);
                            }}
                            onFocus={() => {
                              setFocusedIndex(row.index);
                              setFocusedPath(row.path);
                            }}
                            onKeyDown={(event) => {
                              void handleRowKeyDown(event, row);
                            }}
                          >
                            <span className="truncate">
                              {formatRowLabel(row)}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                    {unresolvedWindowHeight > 0 ? (
                      <div
                        aria-hidden="true"
                        className="text-muted-foreground flex items-start px-2 pt-2 text-xs italic"
                        style={{
                          backgroundColor: 'var(--color-muted)',
                          height: `${String(unresolvedWindowHeight)}px`,
                          paddingLeft: showLocalUnresolvedBand
                            ? unresolvedBandPaddingLeft
                            : undefined,
                        }}
                      >
                        {showLocalUnresolvedBand
                          ? 'Unresolved descendants continue past the materialized frontier.'
                          : 'Viewport has outrun the materialized frontier.'}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </ExampleCard>

      <div className="space-y-6">
        <ExampleCard
          className="max-w-none"
          title="Experiment state"
          description="Status and progress come from the demo-local model boundary. Focus and selection stay on the main thread so the worker can own only the tree model work while the page still handles viewport math and interaction overlays."
        >
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Status</strong>
              <div className="text-muted-foreground mt-1">
                {snapshot.bulkInfo.status}
                {snapshot.bulkInfo.errorMessage == null
                  ? ''
                  : ` (${snapshot.bulkInfo.errorMessage})`}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Progress</strong>
              <div className="text-muted-foreground mt-1">
                {formatProgress(snapshot)}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Interaction state</strong>
              <div className="text-muted-foreground mt-1">
                focus={focusedPath ?? 'null'}
                <br />
                selection={summarizeSelection(selectedPaths)}
              </div>
            </div>
            <div
              className="rounded-sm border px-3 py-2"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <strong>Latest run summary</strong>
              {latestMetricsContent}
            </div>
          </div>
        </ExampleCard>

        <ExampleCard
          className="max-w-none"
          title="Experiment log"
          description="Each run logs the active mode plus bulk state transitions. When a run completes, cancels, or fails, the page also prints a console.table row with fetch, parse, apply, total, and main-thread long-task metrics."
        >
          <StateLog entries={log} />
        </ExampleCard>
      </div>
    </div>
  );
}
