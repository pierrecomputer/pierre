import type { PathStoreInitialExpansion } from '@pierre/path-store';

import {
  AOSP_UPGRADE_DATA_URL,
  getRequestedSearchParamValue,
  getWorkloadOption,
  type TreesWorkloadOption,
} from './workloadMeta';

export type BulkExperimentWorkloadName =
  | 'linux-1x'
  | 'linux-5x'
  | 'linux-10x'
  | 'aosp';
export type BulkExperimentIngestMode = 'chunked' | 'head-start' | 'oneshot';
export type BulkExperimentExpansionMode = 'all-open' | 'all-closed' | 'seeded';
export type BulkExperimentHeadChunkSize = 1000 | 5000 | 10000 | 25000;
export type BulkExperimentReadStrategy =
  | 'exact'
  | 'latest-only'
  | 'latest-only-slab';
export type BulkExperimentReadSlabMultiplier = 1 | 2 | 4;
export type BulkExperimentPublishStrategy =
  | 'every-checkpoint'
  | 'checkpoint-count'
  | 'time-budget'
  | 'path-budget';
export type BulkExperimentPublishCheckpointInterval = 1 | 2 | 4;
export type BulkExperimentPublishTimeBudgetMs = 50 | 100 | 250;
export type BulkExperimentPublishPathBudget = 40_000 | 80_000 | 160_000;
export type BulkExperimentRowTransport = 'clone' | 'transferable';

export interface BulkExperimentPageSearchParams {
  expansion?: string | readonly string[];
  frontier?: string | readonly string[];
  head?: string | readonly string[];
  ingest?: string | readonly string[];
  publish?: string | readonly string[];
  publishCheckpoints?: string | readonly string[];
  publishMs?: string | readonly string[];
  publishPaths?: string | readonly string[];
  read?: string | readonly string[];
  slab?: string | readonly string[];
  transport?: string | readonly string[];
  worker?: string | readonly string[];
  workload?: string | readonly string[];
}

export interface BulkExperimentRouteState {
  expansionMode: BulkExperimentExpansionMode;
  frontierGating: boolean;
  headChunkSize: BulkExperimentHeadChunkSize;
  ingestMode: BulkExperimentIngestMode;
  publishCheckpointInterval: BulkExperimentPublishCheckpointInterval;
  publishPathBudget: BulkExperimentPublishPathBudget;
  publishStrategy: BulkExperimentPublishStrategy;
  publishTimeBudgetMs: BulkExperimentPublishTimeBudgetMs;
  readSlabMultiplier: BulkExperimentReadSlabMultiplier;
  readStrategy: BulkExperimentReadStrategy;
  rowTransport: BulkExperimentRowTransport;
  useWorker: boolean;
  workloadName: BulkExperimentWorkloadName;
}

export interface BulkExperimentExpansionOptions {
  initialExpandedPaths?: readonly string[];
  initialExpansion: PathStoreInitialExpansion;
}

export interface BulkExperimentVisibleCountByExpansionMode {
  'all-open': number;
  'all-closed': number;
  seeded: number;
}

export const BULK_PREVIEW_PATH_COUNT = 100;
export const BULK_EXPERIMENT_CHUNK_SIZE = 40_000;
export const BULK_EXPERIMENT_HEAD_START_TAIL_CHUNK_COUNT = 4;
export const DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME: BulkExperimentWorkloadName =
  'aosp';
export const DEFAULT_BULK_EXPERIMENT_INGEST_MODE: BulkExperimentIngestMode =
  'head-start';
export const DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE: BulkExperimentExpansionMode =
  'all-open';
export const DEFAULT_BULK_EXPERIMENT_HEAD_CHUNK_SIZE: BulkExperimentHeadChunkSize = 10_000;
export const DEFAULT_BULK_EXPERIMENT_READ_STRATEGY: BulkExperimentReadStrategy =
  'latest-only-slab';
export const DEFAULT_BULK_EXPERIMENT_READ_SLAB_MULTIPLIER: BulkExperimentReadSlabMultiplier = 2;
export const DEFAULT_BULK_EXPERIMENT_FRONTIER_GATING = true;
export const DEFAULT_BULK_EXPERIMENT_PUBLISH_STRATEGY: BulkExperimentPublishStrategy =
  'checkpoint-count';
export const DEFAULT_BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL: BulkExperimentPublishCheckpointInterval = 2;
export const DEFAULT_BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_MS: BulkExperimentPublishTimeBudgetMs = 100;
export const DEFAULT_BULK_EXPERIMENT_PUBLISH_PATH_BUDGET: BulkExperimentPublishPathBudget = 80_000;
export const DEFAULT_BULK_EXPERIMENT_ROW_TRANSPORT: BulkExperimentRowTransport =
  'clone';

export const BULK_EXPERIMENT_WORKLOAD_NAMES = [
  'linux-1x',
  'linux-5x',
  'linux-10x',
  'aosp',
] as const satisfies readonly BulkExperimentWorkloadName[];

export const BULK_EXPERIMENT_WORKLOAD_OPTIONS =
  BULK_EXPERIMENT_WORKLOAD_NAMES.map((name) =>
    getWorkloadOption(name)
  ) satisfies readonly TreesWorkloadOption[];

export const BULK_EXPERIMENT_INGEST_OPTIONS = [
  { label: 'Head start', value: 'head-start' },
  { label: 'Chunked apply', value: 'chunked' },
  { label: 'One-shot apply', value: 'oneshot' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentIngestMode;
}[];

export const BULK_EXPERIMENT_HEAD_CHUNK_SIZE_OPTIONS = [
  { label: '1k', value: 1_000 },
  { label: '5k', value: 5_000 },
  { label: '10k', value: 10_000 },
  { label: '25k', value: 25_000 },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentHeadChunkSize;
}[];

export const BULK_EXPERIMENT_EXPANSION_OPTIONS = [
  { label: 'All open', value: 'all-open' },
  { label: 'All closed', value: 'all-closed' },
  { label: 'Seeded', value: 'seeded' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentExpansionMode;
}[];

export const BULK_EXPERIMENT_READ_STRATEGY_OPTIONS = [
  { label: 'Exact', value: 'exact' },
  { label: 'Latest only', value: 'latest-only' },
  { label: 'Latest only + slab cache', value: 'latest-only-slab' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentReadStrategy;
}[];

export const BULK_EXPERIMENT_READ_SLAB_MULTIPLIER_OPTIONS = [
  { label: '1x viewport', value: 1 },
  { label: '2x viewport', value: 2 },
  { label: '4x viewport', value: 4 },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentReadSlabMultiplier;
}[];
export const BULK_EXPERIMENT_ROW_TRANSPORT_OPTIONS = [
  { label: 'Structured clone', value: 'clone' },
  { label: 'Transferable slab', value: 'transferable' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentRowTransport;
}[];

export const BULK_EXPERIMENT_PUBLISH_STRATEGY_OPTIONS = [
  { label: 'Every checkpoint', value: 'every-checkpoint' },
  { label: 'Every N checkpoints', value: 'checkpoint-count' },
  { label: 'Time budget', value: 'time-budget' },
  { label: 'Path budget', value: 'path-budget' },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentPublishStrategy;
}[];

export const BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL_OPTIONS = [
  { label: '1 checkpoint', value: 1 },
  { label: '2 checkpoints', value: 2 },
  { label: '4 checkpoints', value: 4 },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentPublishCheckpointInterval;
}[];

export const BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_OPTIONS = [
  { label: '50 ms', value: 50 },
  { label: '100 ms', value: 100 },
  { label: '250 ms', value: 250 },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentPublishTimeBudgetMs;
}[];

export const BULK_EXPERIMENT_PUBLISH_PATH_BUDGET_OPTIONS = [
  { label: '40k paths', value: 40_000 },
  { label: '80k paths', value: 80_000 },
  { label: '160k paths', value: 160_000 },
] as const satisfies readonly {
  label: string;
  value: BulkExperimentPublishPathBudget;
}[];

const BULK_WORKLOAD_ASSET_URL_BY_NAME = {
  'linux-1x': '/trees-dev/linux-1x.json.gz',
  'linux-5x': '/trees-dev/linux-5x.json.gz',
  'linux-10x': '/trees-dev/linux-10x.json.gz',
  aosp: AOSP_UPGRADE_DATA_URL,
} as const satisfies Record<BulkExperimentWorkloadName, string>;

const SEEDED_RELATIVE_EXPANDED_PATHS = [
  'arch/',
  'drivers/',
  'include/',
] as const;
const AOSP_SEEDED_EXPANDED_PATHS = [
  'art',
  'art/artd',
  'art/artd/binder',
  'art/artd/tests',
  'art/benchmark',
  'art/build',
  'art/build/apex',
  'art/build/boot',
  'art/build/flags',
  'art/build/sdk',
] as const;

function createReplicaRootNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `linux-${index + 1}`);
}

// Keeps the seeded mode intentionally small so the experiment can exercise a
// mixed expansion state without carrying the large per-workload expanded-folder
// fixtures that the main demo uses.
export function getBulkExperimentSeededExpandedPaths(
  workloadName: BulkExperimentWorkloadName
): readonly string[] {
  if (workloadName === 'aosp') {
    return [...AOSP_SEEDED_EXPANDED_PATHS];
  }

  if (workloadName === 'linux-1x') {
    return [...SEEDED_RELATIVE_EXPANDED_PATHS];
  }

  const rootCount = workloadName === 'linux-5x' ? 5 : 10;
  const seededPaths = new Array<string>(
    rootCount + rootCount * SEEDED_RELATIVE_EXPANDED_PATHS.length
  );
  let nextIndex = 0;

  for (const rootName of createReplicaRootNames(rootCount)) {
    seededPaths[nextIndex++] = `${rootName}/`;
    for (const relativePath of SEEDED_RELATIVE_EXPANDED_PATHS) {
      seededPaths[nextIndex++] = `${rootName}/${relativePath}`;
    }
  }

  return seededPaths;
}

export function getBulkExperimentExpansionOptions(
  workloadName: BulkExperimentWorkloadName,
  expansionMode: BulkExperimentExpansionMode
): BulkExperimentExpansionOptions {
  switch (expansionMode) {
    case 'all-open':
      return { initialExpansion: 'open' };
    case 'seeded':
      return {
        initialExpandedPaths:
          getBulkExperimentSeededExpandedPaths(workloadName),
        initialExpansion: 'closed',
      };
    default:
      return { initialExpansion: 'closed' };
  }
}

export function getBulkExperimentAssetUrl(
  workloadName: BulkExperimentWorkloadName
): string {
  return BULK_WORKLOAD_ASSET_URL_BY_NAME[workloadName];
}

export function resolveBulkExperimentWorkloadName(
  value: string | null | undefined
): BulkExperimentWorkloadName {
  return BULK_EXPERIMENT_WORKLOAD_NAMES.some((workload) => workload === value)
    ? (value as BulkExperimentWorkloadName)
    : DEFAULT_BULK_EXPERIMENT_WORKLOAD_NAME;
}

export function resolveBulkExperimentIngestMode(
  value: string | null | undefined
): BulkExperimentIngestMode {
  return BULK_EXPERIMENT_INGEST_OPTIONS.some((option) => option.value === value)
    ? (value as BulkExperimentIngestMode)
    : DEFAULT_BULK_EXPERIMENT_INGEST_MODE;
}

export function resolveBulkExperimentExpansionMode(
  value: string | null | undefined
): BulkExperimentExpansionMode {
  return BULK_EXPERIMENT_EXPANSION_OPTIONS.some(
    (option) => option.value === value
  )
    ? (value as BulkExperimentExpansionMode)
    : DEFAULT_BULK_EXPERIMENT_EXPANSION_MODE;
}

export function resolveBulkExperimentHeadChunkSize(
  value: string | null | undefined
): BulkExperimentHeadChunkSize {
  const parsedValue = Number(value);
  return BULK_EXPERIMENT_HEAD_CHUNK_SIZE_OPTIONS.some(
    (option) => option.value === parsedValue
  )
    ? (parsedValue as BulkExperimentHeadChunkSize)
    : DEFAULT_BULK_EXPERIMENT_HEAD_CHUNK_SIZE;
}

export function resolveBulkExperimentReadStrategy(
  value: string | null | undefined
): BulkExperimentReadStrategy {
  return BULK_EXPERIMENT_READ_STRATEGY_OPTIONS.some(
    (option) => option.value === value
  )
    ? (value as BulkExperimentReadStrategy)
    : DEFAULT_BULK_EXPERIMENT_READ_STRATEGY;
}

export function resolveBulkExperimentReadSlabMultiplier(
  value: string | null | undefined
): BulkExperimentReadSlabMultiplier {
  const parsedValue = Number(value);
  return BULK_EXPERIMENT_READ_SLAB_MULTIPLIER_OPTIONS.some(
    (option) => option.value === parsedValue
  )
    ? (parsedValue as BulkExperimentReadSlabMultiplier)
    : DEFAULT_BULK_EXPERIMENT_READ_SLAB_MULTIPLIER;
}

export function resolveBulkExperimentFrontierGating(
  value: string | null | undefined
): boolean {
  if (value == null) {
    return DEFAULT_BULK_EXPERIMENT_FRONTIER_GATING;
  }

  return value === '1' || value === 'true';
}

export function resolveBulkExperimentPublishStrategy(
  value: string | null | undefined
): BulkExperimentPublishStrategy {
  return BULK_EXPERIMENT_PUBLISH_STRATEGY_OPTIONS.some(
    (option) => option.value === value
  )
    ? (value as BulkExperimentPublishStrategy)
    : DEFAULT_BULK_EXPERIMENT_PUBLISH_STRATEGY;
}

export function resolveBulkExperimentPublishCheckpointInterval(
  value: string | null | undefined
): BulkExperimentPublishCheckpointInterval {
  const parsedValue = Number(value);
  return BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL_OPTIONS.some(
    (option) => option.value === parsedValue
  )
    ? (parsedValue as BulkExperimentPublishCheckpointInterval)
    : DEFAULT_BULK_EXPERIMENT_PUBLISH_CHECKPOINT_INTERVAL;
}

export function resolveBulkExperimentPublishTimeBudgetMs(
  value: string | null | undefined
): BulkExperimentPublishTimeBudgetMs {
  const parsedValue = Number(value);
  return BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_OPTIONS.some(
    (option) => option.value === parsedValue
  )
    ? (parsedValue as BulkExperimentPublishTimeBudgetMs)
    : DEFAULT_BULK_EXPERIMENT_PUBLISH_TIME_BUDGET_MS;
}

export function resolveBulkExperimentPublishPathBudget(
  value: string | null | undefined
): BulkExperimentPublishPathBudget {
  const parsedValue = Number(value);
  return BULK_EXPERIMENT_PUBLISH_PATH_BUDGET_OPTIONS.some(
    (option) => option.value === parsedValue
  )
    ? (parsedValue as BulkExperimentPublishPathBudget)
    : DEFAULT_BULK_EXPERIMENT_PUBLISH_PATH_BUDGET;
}

export function resolveBulkExperimentRowTransport(
  value: string | null | undefined
): BulkExperimentRowTransport {
  return BULK_EXPERIMENT_ROW_TRANSPORT_OPTIONS.some(
    (option) => option.value === value
  )
    ? (value as BulkExperimentRowTransport)
    : DEFAULT_BULK_EXPERIMENT_ROW_TRANSPORT;
}

export function resolveBulkExperimentUseWorker(
  value: string | null | undefined
): boolean {
  if (value == null) {
    return true;
  }

  return value === '1' || value === 'true';
}

export function getRequestedBulkExperimentRouteState(
  searchParams: BulkExperimentPageSearchParams | undefined
): BulkExperimentRouteState {
  return {
    expansionMode: resolveBulkExperimentExpansionMode(
      getRequestedSearchParamValue(searchParams?.expansion)
    ),
    frontierGating: resolveBulkExperimentFrontierGating(
      getRequestedSearchParamValue(searchParams?.frontier)
    ),
    headChunkSize: resolveBulkExperimentHeadChunkSize(
      getRequestedSearchParamValue(searchParams?.head)
    ),
    ingestMode: resolveBulkExperimentIngestMode(
      getRequestedSearchParamValue(searchParams?.ingest)
    ),
    publishCheckpointInterval: resolveBulkExperimentPublishCheckpointInterval(
      getRequestedSearchParamValue(searchParams?.publishCheckpoints)
    ),
    publishPathBudget: resolveBulkExperimentPublishPathBudget(
      getRequestedSearchParamValue(searchParams?.publishPaths)
    ),
    publishStrategy: resolveBulkExperimentPublishStrategy(
      getRequestedSearchParamValue(searchParams?.publish)
    ),
    publishTimeBudgetMs: resolveBulkExperimentPublishTimeBudgetMs(
      getRequestedSearchParamValue(searchParams?.publishMs)
    ),
    readSlabMultiplier: resolveBulkExperimentReadSlabMultiplier(
      getRequestedSearchParamValue(searchParams?.slab)
    ),
    readStrategy: resolveBulkExperimentReadStrategy(
      getRequestedSearchParamValue(searchParams?.read)
    ),
    rowTransport: resolveBulkExperimentRowTransport(
      getRequestedSearchParamValue(searchParams?.transport)
    ),
    useWorker: resolveBulkExperimentUseWorker(
      getRequestedSearchParamValue(searchParams?.worker)
    ),
    workloadName: resolveBulkExperimentWorkloadName(
      getRequestedSearchParamValue(searchParams?.workload)
    ),
  };
}
