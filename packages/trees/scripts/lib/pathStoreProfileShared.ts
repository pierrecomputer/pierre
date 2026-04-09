import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import type { VirtualizationWorkload } from '@pierre/tree-test-data';

import type { PathStoreFileTreeOptions } from '../../src/path-store';

export const PATH_STORE_PROFILE_WORKLOAD_NAMES = [
  'linux-5x',
  'linux-10x',
  'linux',
  'demo-small',
] as const;

export type PathStoreProfileWorkloadName =
  (typeof PATH_STORE_PROFILE_WORKLOAD_NAMES)[number];

export const DEFAULT_PATH_STORE_PROFILE_WORKLOAD_NAME = 'linux-5x';
export const PATH_STORE_PROFILE_VIEWPORT_HEIGHT = 500;

type PathStorePreparedInput = NonNullable<
  PathStoreFileTreeOptions['preparedInput']
>;

export interface PathStoreProfileWorkloadSummary {
  expandedFolderCount: number;
  fileCount: number;
  label: string;
  name: PathStoreProfileWorkloadName;
}

export interface PathStoreProfilePhaseSummary {
  count: number;
  durationMs: number;
  name: string;
  selfDurationMs: number;
}

export interface PathStoreProfileHeapSummary {
  jsHeapSizeLimitBytes: number;
  totalJSHeapSizeAfterBytes: number;
  usedJSHeapSizeAfterBytes: number;
  usedJSHeapSizeBeforeBytes: number;
  usedJSHeapSizeDeltaBytes: number;
}

export interface PathStoreProfileInstrumentationSummary {
  counters: Record<string, number>;
  heap: PathStoreProfileHeapSummary | null;
  phases: PathStoreProfilePhaseSummary[];
}

export interface PathStoreProfilePageSummary {
  instrumentation: PathStoreProfileInstrumentationSummary | null;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  renderDurationMs: number;
  renderedItemCount: number;
  resultText: string | null;
  visibleRowsReadyMs: number;
  workload: PathStoreProfileWorkloadSummary;
}

export function isPathStoreProfileWorkloadName(
  value: string
): value is PathStoreProfileWorkloadName {
  return (PATH_STORE_PROFILE_WORKLOAD_NAMES as readonly string[]).includes(
    value
  );
}

export function getPathStoreProfileWorkload(
  value: string | null | undefined
): VirtualizationWorkload {
  const workloadName = isPathStoreProfileWorkloadName(value ?? '')
    ? value
    : DEFAULT_PATH_STORE_PROFILE_WORKLOAD_NAME;
  return getVirtualizationWorkload(workloadName);
}

export function createPathStorePresortedPreparedInput(
  paths: readonly string[]
): PathStorePreparedInput {
  return {
    paths,
    presortedPaths: paths,
  } as PathStorePreparedInput;
}

export function createPathStoreProfileFixtureOptions(
  workload: VirtualizationWorkload
): Omit<PathStoreFileTreeOptions, 'id' | 'onSelectionChange'> {
  return {
    flattenEmptyDirectories: true,
    initialExpandedPaths: workload.expandedFolders,
    paths: workload.files,
    preparedInput: createPathStorePresortedPreparedInput(workload.files),
    viewportHeight: PATH_STORE_PROFILE_VIEWPORT_HEIGHT,
  };
}

export function createPathStoreProfileWorkloadSummary(
  workload: VirtualizationWorkload
): PathStoreProfileWorkloadSummary {
  return {
    expandedFolderCount: workload.expandedFolders.length,
    fileCount: workload.files.length,
    label: workload.label,
    name: workload.name as PathStoreProfileWorkloadName,
  };
}
