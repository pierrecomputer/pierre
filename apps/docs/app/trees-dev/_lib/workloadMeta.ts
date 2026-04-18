export interface TreesPageSearchParams {
  expansion?: string | readonly string[];
  workload?: string | readonly string[];
}

export type TreesExpansionMode = 'all' | 'collapsed' | 'workload';

export type TreesWorkloadName =
  | 'demo-small'
  | 'pierre-snapshot'
  | 'half-linux'
  | 'linux'
  | 'linux-1x'
  | 'linux-5x'
  | 'linux-10x'
  | 'aosp';

export interface TreesWorkloadOption {
  label: string;
  name: TreesWorkloadName;
  rootCount: number;
}

export const TREES_WORKLOAD_OPTIONS = [
  {
    label: 'Small demo workload',
    name: 'demo-small',
    rootCount: 1,
  },
  // This is a pinned fixture snapshot, not a live index of the current repo.
  // It is allowed to drift when trees-dev files are deleted or renamed.
  {
    label: 'Pierre repo snapshot',
    name: 'pierre-snapshot',
    rootCount: 1,
  },
  {
    label: 'Half Linux fixture',
    name: 'half-linux',
    rootCount: 1,
  },
  {
    label: 'Linux fixture',
    name: 'linux',
    rootCount: 1,
  },
  {
    label: 'Linux fixture x1',
    name: 'linux-1x',
    rootCount: 1,
  },
  {
    label: 'Linux fixture x5',
    name: 'linux-5x',
    rootCount: 5,
  },
  {
    label: 'Linux fixture x10',
    name: 'linux-10x',
    rootCount: 10,
  },
  {
    label: 'AOSP fixture',
    name: 'aosp',
    rootCount: 1,
  },
] satisfies readonly TreesWorkloadOption[];

export interface TreesWorkloadSummary extends TreesWorkloadOption {
  fileCountLabel: string;
}

export interface TreesWorkloadDataPayload {
  initialExpandedPaths: readonly string[];
  paths: readonly string[];
  pathsArePresorted: boolean;
  selectedWorkload: TreesWorkloadSummary;
  // When present, tells the client it can fetch a gzipped full path list and
  // upgrade the file tree in place. SSR only ships a small preview slice for
  // these workloads so the serverless function stays small and fast.
  upgradeDataUrl?: string;
}

export const DEFAULT_TREES_WORKLOAD_NAME: TreesWorkloadName = 'linux-1x';

export const FILE_TREE_PROOF_VIEWPORT_HEIGHT = 700;

// Committed by generateAospArtifacts.ts. Served by the Vercel CDN — never by
// the Next serverless function, which can't afford the 130 MB decompression.
export const AOSP_UPGRADE_DATA_URL = '/trees-dev/aosp-files.json.gz';

export function getRequestedSearchParamValue(
  value: string | readonly string[] | undefined
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return value?.[0];
}

export function resolveWorkloadName(
  value: string | null | undefined
): TreesWorkloadName {
  return TREES_WORKLOAD_OPTIONS.some((workload) => workload.name === value)
    ? (value as TreesWorkloadName)
    : DEFAULT_TREES_WORKLOAD_NAME;
}

export function getRequestedWorkloadName(
  searchParams: TreesPageSearchParams | undefined
): TreesWorkloadName {
  return resolveWorkloadName(
    getRequestedSearchParamValue(searchParams?.workload)
  );
}

export function getRequestedExpansionMode(
  searchParams: TreesPageSearchParams | undefined
): TreesExpansionMode {
  const expansionMode = getRequestedSearchParamValue(searchParams?.expansion);
  return expansionMode === 'all' || expansionMode === 'collapsed'
    ? expansionMode
    : 'workload';
}

export function getWorkloadOption(
  workloadName: TreesWorkloadName
): TreesWorkloadOption {
  return (
    TREES_WORKLOAD_OPTIONS.find((workload) => workload.name === workloadName) ??
    TREES_WORKLOAD_OPTIONS[0]
  );
}
