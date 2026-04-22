import { getVirtualizationWorkload } from '@pierre/tree-test-data';

// Keep the profiling fixture on the narrow data-preparation entrypoint so the
// Vite-served page does not accidentally import the source render runtime.
import { preparePresortedFileTreeInput } from '../../src/preparedInput';

export const FILE_TREE_PROFILE_WORKLOAD_NAMES = [
  'linux-5x',
  'linux-10x',
  'linux',
  'aosp',
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

export interface FileTreeProfileWorkload {
  expandedFolders: string[];
  files: string[];
  label: string;
  name: FileTreeProfileWorkloadName;
}

export type FileTreeProfileActionOperation = 'collapse' | 'expand';
export type FileTreeProfileActionInitialExpansion = 'closed' | 'open';
export type FileTreeProfileActionDispatch = 'api' | 'dom-click';
export type FileTreeProfileActionTargetVisibility =
  | 'hidden'
  | 'offscreen'
  | 'sticky'
  | 'visible';

export interface FileTreeProfileActionSetupOperation {
  operation: FileTreeProfileActionOperation;
  path: string;
}

export interface FileTreeProfileActionSummary {
  dispatch: FileTreeProfileActionDispatch;
  id: string;
  initialExpansion: FileTreeProfileActionInitialExpansion;
  label: string;
  operation: FileTreeProfileActionOperation;
  renderedItemCountAfter?: number;
  renderedItemCountBefore?: number;
  setupOperations: FileTreeProfileActionSetupOperation[];
  targetDepth: number;
  targetIsExpandedAfter?: boolean;
  targetPath: string;
  targetVisibility: FileTreeProfileActionTargetVisibility;
  targetWasExpandedBefore?: boolean;
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
  action?: FileTreeProfileActionSummary;
  actionDurationMs?: number;
  instrumentation: FileTreeProfileInstrumentationSummary | null;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  profileKind?: 'action' | 'render';
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
): FileTreeProfileWorkload {
  const requestedWorkloadName = value ?? '';
  const workloadName = isFileTreeProfileWorkloadName(requestedWorkloadName)
    ? requestedWorkloadName
    : DEFAULT_FILE_TREE_PROFILE_WORKLOAD_NAME;
  if (workloadName === 'aosp') {
    throw new Error(
      'The AOSP file-tree profile workload is loaded asynchronously from the browser fixture.'
    );
  }
  const workload = getVirtualizationWorkload(workloadName);
  return {
    expandedFolders: workload.expandedFolders,
    files: workload.files,
    label: workload.label,
    name: workloadName,
  };
}

export function createFileTreeProfileFixtureOptions(
  workload: FileTreeProfileWorkload,
  options: {
    initialExpansion?: FileTreeProfileActionInitialExpansion;
  } = {}
) {
  const initialExpansion = options.initialExpansion ?? 'open';
  return {
    flattenEmptyDirectories: true,
    // All profiling workloads expand every derived directory, so open-default
    // startup is semantically identical to replaying a huge explicit expanded
    // path list and avoids constructor-side expansion normalization work.
    initialExpansion,
    preparedInput: preparePresortedFileTreeInput(workload.files),
    initialVisibleRowCount: FILE_TREE_PROFILE_VIEWPORT_HEIGHT / 30,
    stickyFolders: true,
  };
}

export function createFileTreeProfileWorkloadSummary(
  workload: FileTreeProfileWorkload
): FileTreeProfileWorkloadSummary {
  return {
    expandedFolderCount: workload.expandedFolders.length,
    fileCount: workload.files.length,
    label: workload.label,
    name: workload.name,
  };
}
