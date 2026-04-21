import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import type { VirtualizationWorkload } from '@pierre/tree-test-data';

// Keep the profiling fixture on the narrow data-preparation entrypoint so the
// Vite-served page does not accidentally import the source render runtime.
import { preparePresortedFileTreeInput } from '../../src/preparedInput';

export const FILE_TREE_PROFILE_WORKLOAD_NAMES = [
  'linux-5x',
  'linux-10x',
  'linux',
  'demo-small',
] as const;

export type FileTreeProfileWorkloadName =
  (typeof FILE_TREE_PROFILE_WORKLOAD_NAMES)[number];

export const DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME = 'linux-5x';
export const FILE_TREE_PROFILE_VIEWPORT_HEIGHT = 500;

export interface FileTreeProfileWorkloadSummary {
  expandedFolderCount: number;
  fileCount: number;
  label: string;
  name: FileTreeProfileWorkloadName;
}

export interface FileTreeProfilePhaseSummary {
  count: number;
  durationMs: number;
  name: string;
  selfDurationMs: number;
}

export interface FileTreeProfileHeapSummary {
  jsHeapSizeLimitBytes: number;
  totalJSHeapSizeAfterBytes: number;
  usedJSHeapSizeAfterBytes: number;
  usedJSHeapSizeBeforeBytes: number;
  usedJSHeapSizeDeltaBytes: number;
}

export interface FileTreeProfileInstrumentationSummary {
  counters: Record<string, number>;
  heap: FileTreeProfileHeapSummary | null;
  phases: FileTreeProfilePhaseSummary[];
}

export interface FileTreeProfilePageSummary {
  instrumentation: FileTreeProfileInstrumentationSummary | null;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  renderDurationMs: number;
  renderedItemCount: number;
  resultText: string | null;
  visibleRowsReadyMs: number;
  workload: FileTreeProfileWorkloadSummary;
}

export function isFileTreeProfileWorkloadName(
  value: string
): value is FileTreeProfileWorkloadName {
  return (FILE_TREE_PROFILE_WORKLOAD_NAMES as readonly string[]).includes(
    value
  );
}

export function getFileTreeProfileWorkload(
  value: string | null | undefined
): VirtualizationWorkload {
  const workloadName = isFileTreeProfileWorkloadName(value ?? '')
    ? value
    : DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME;
  return getVirtualizationWorkload(workloadName);
}

export function createFileTreeProfileFixtureOptions(
  workload: VirtualizationWorkload
) {
  return {
    flattenEmptyDirectories: true,
    // All profiling workloads expand every derived directory, so open-default
    // startup is semantically identical to replaying a huge explicit expanded
    // path list and avoids constructor-side expansion normalization work.
    initialExpansion: 'open' as const,
    preparedInput: preparePresortedFileTreeInput(workload.files),
    initialVisibleRowCount: FILE_TREE_PROFILE_VIEWPORT_HEIGHT / 30,
  };
}

export function createFileTreeProfileWorkloadSummary(
  workload: VirtualizationWorkload
): FileTreeProfileWorkloadSummary {
  return {
    expandedFolderCount: workload.expandedFolders.length,
    fileCount: workload.files.length,
    label: workload.label,
    name: workload.name as FileTreeProfileWorkloadName,
  };
}
