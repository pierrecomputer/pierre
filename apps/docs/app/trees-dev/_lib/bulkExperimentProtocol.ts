import type { FileTreeBulkIngestInfo } from '@pierre/trees';

import type {
  BulkExperimentExpansionMode,
  BulkExperimentHeadChunkSize,
  BulkExperimentIngestMode,
  BulkExperimentPublishCheckpointInterval,
  BulkExperimentPublishPathBudget,
  BulkExperimentPublishStrategy,
  BulkExperimentPublishTimeBudgetMs,
  BulkExperimentRowTransport,
  BulkExperimentWorkloadName,
} from './bulkExperimentMeta';

export interface BulkExperimentVisibleSegment {
  isTerminal: boolean;
  name: string;
  path: string;
}

export interface BulkExperimentVisibleRow {
  ancestorPaths: readonly string[];
  depth: number;
  flattenedSegments?: readonly BulkExperimentVisibleSegment[];
  hasChildren: boolean;
  index: number;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  level: number;
  name: string;
  path: string;
  posInSet: number;
  setSize: number;
}

export interface BulkExperimentVisibleRowsTransferPayload {
  ancestorValueIndices: Uint32Array;
  ancestorValueOffsets: Uint32Array;
  depthByRow: Uint16Array;
  flattenedNameValueIndices: Uint32Array;
  flattenedPathValueIndices: Uint32Array;
  flattenedTerminalFlags: Uint8Array;
  flattenedValueOffsets: Uint32Array;
  nameValueIndices: Uint32Array;
  pathValueIndices: Uint32Array;
  posInSetByRow: Uint32Array;
  rowCount: number;
  rowStartIndex: number;
  setSizeByRow: Uint32Array;
  stringByteOffsets: Uint32Array;
  stringBytes: Uint8Array;
  visibilityFlagsByRow: Uint8Array;
}

export interface BulkExperimentChunkMilestone {
  committedIngestedPathCount: number;
  completedAt: number;
  estimatedVisibleCount: number;
  materializedVisibleCount: number;
  published: boolean;
  workingIngestedPathCount: number;
}

export type BulkExperimentReadLatencyPhase = 'activeIngest' | 'postCompletion';
export type BulkExperimentReadRequestKind = 'visibleIndex' | 'visibleRows';

export interface BulkExperimentReadRequestTiming {
  sentAt: number;
  workerFinishedAt: number;
  workerStartedAt: number;
}

export interface BulkExperimentReadRequestLatencySample {
  computeMs: number;
  phase: BulkExperimentReadLatencyPhase;
  receivedAt: number;
  requestKind: BulkExperimentReadRequestKind;
  queueWaitMs: number;
  sentAt: number;
  totalMs: number;
  transportMs: number;
  workerFinishedAt: number;
  workerStartedAt: number;
}

export interface BulkExperimentLatencyMetricSummary {
  averageMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  sampleCount: number;
}

export interface BulkExperimentReadRequestLatencySummary {
  compute: BulkExperimentLatencyMetricSummary;
  queueWait: BulkExperimentLatencyMetricSummary;
  total: BulkExperimentLatencyMetricSummary;
  transport: BulkExperimentLatencyMetricSummary;
}

export interface BulkExperimentReadLatencySummaryByPhase {
  activeIngest: BulkExperimentReadRequestLatencySummary;
  postCompletion: BulkExperimentReadRequestLatencySummary;
}

export interface BulkExperimentReadLatencySummaryByKind {
  visibleIndex: BulkExperimentReadLatencySummaryByPhase;
  visibleRows: BulkExperimentReadLatencySummaryByPhase;
}

export interface BulkExperimentRunMetrics {
  applyMs: number;
  committedPublishCount: number;
  completedAt: number;
  expansionMode: BulkExperimentExpansionMode;
  fetchCompletedAt: number | null;
  fetchMs: number;
  headChunk: BulkExperimentChunkMilestone | null;
  headChunkSize: BulkExperimentHeadChunkSize | null;
  ingestMode: BulkExperimentIngestMode;
  lastCommittedPublishCompletedAt: number | null;
  parseCompletedAt: number | null;
  parseMs: number;
  publishMs: BulkExperimentLatencyMetricSummary;
  tailChunks: readonly BulkExperimentChunkMilestone[];
  totalMs: number;
  workingCheckpointCount: number;
  workloadName: BulkExperimentWorkloadName;
}

export interface BulkExperimentUnresolvedFrontier {
  kind: 'global' | 'subtree';
  level: number;
  parentPath: string | null;
}

export interface BulkExperimentSnapshot {
  bulkInfo: FileTreeBulkIngestInfo;
  committedSnapshotAgeMs: number;
  committedVisibleVersion: number;
  estimatedVisibleCount: number;
  expansionMode: BulkExperimentExpansionMode;
  headChunkSize: BulkExperimentHeadChunkSize;
  ingestMode: BulkExperimentIngestMode;
  lastCommittedChangeStartIndex: number | null;
  materializedVisibleCount: number;
  metrics: BulkExperimentRunMetrics | null;
  unresolvedFrontier: BulkExperimentUnresolvedFrontier | null;
  unpublishedPathCount: number;
  visibleCount: number;
  workingIngestedPathCount: number;
  workloadName: BulkExperimentWorkloadName;
}

export interface BulkExperimentInitOptions {
  assetUrl: string;
  expansionMode: BulkExperimentExpansionMode;
  finalVisibleCount: number;
  headChunkSize: BulkExperimentHeadChunkSize;
  ingestMode: BulkExperimentIngestMode;
  previewPaths: readonly string[];
  previewVisibleCount: number;
  publishCheckpointInterval: BulkExperimentPublishCheckpointInterval;
  publishPathBudget: BulkExperimentPublishPathBudget;
  publishStrategy: BulkExperimentPublishStrategy;
  publishTimeBudgetMs: BulkExperimentPublishTimeBudgetMs;
  rowTransport: BulkExperimentRowTransport;

  seededExpandedPaths: readonly string[];
  totalPathCount: number;
  workloadName: BulkExperimentWorkloadName;
}

export type BulkExperimentWorkerRequest =
  | { id: number; type: 'cancelIngest' }
  | { id: number; type: 'collapsePath'; path: string }
  | { id: number; type: 'dispose' }
  | { id: number; type: 'expandPath'; path: string }
  | { id: number; path: string; sentAt: number; type: 'getVisibleIndex' }
  | {
      id: number;
      end: number;
      sentAt: number;
      start: number;
      type: 'getVisibleRows';
    }
  | { id: number; type: 'initialize'; options: BulkExperimentInitOptions }
  | { id: number; type: 'startIngest' };

export type BulkExperimentWorkerResponse =
  | { id: number; type: 'ack' }
  | { error: string; id: number; type: 'error' }
  | {
      id: number;
      index: number | null;
      timing: BulkExperimentReadRequestTiming;
      type: 'visibleIndex';
    }
  | {
      id: number;
      rowTransport: 'clone';
      rows: readonly BulkExperimentVisibleRow[];
      timing: BulkExperimentReadRequestTiming;
      type: 'visibleRows';
    }
  | {
      id: number;
      rowTransport: 'transferable';
      timing: BulkExperimentReadRequestTiming;
      transferredRows: BulkExperimentVisibleRowsTransferPayload;
      type: 'visibleRows';
    };

export interface BulkExperimentWorkerSnapshotMessage {
  snapshot: BulkExperimentSnapshot;
  type: 'snapshot';
}

export type BulkExperimentWorkerMessage =
  | BulkExperimentWorkerResponse
  | BulkExperimentWorkerSnapshotMessage;
