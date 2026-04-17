import 'server-only';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import {
  AOSP_PREVIEW_ALL_EXPANDED_PATHS,
  AOSP_PREVIEW_PATHS,
  AOSP_TOTAL_PATH_COUNT,
} from './aospPreview';
import {
  AOSP_UPGRADE_DATA_URL,
  getPathStorePoweredWorkloadOption,
  type PathStorePoweredExpansionMode,
  type PathStorePoweredWorkloadDataPayload,
  type PathStorePoweredWorkloadName,
} from './pathStorePoweredWorkloadMeta';

interface PathStorePoweredLoadedWorkload {
  defaultExpandedPaths: readonly string[];
  fileCountLabel: string;
  label: string;
  name: PathStorePoweredWorkloadName;
  paths: readonly string[];
  pathsArePresorted: boolean;
  rootCount: number;
  upgradeDataUrl?: string;
}

const workloadPromiseCache = new Map<
  PathStorePoweredWorkloadName,
  Promise<PathStorePoweredLoadedWorkload>
>();

// Derives every ancestor folder path once so the demo can switch between the
// workload default, fully expanded, and fully collapsed tree states.
function deriveExpandedPaths(paths: readonly string[]): string[] {
  const folders = new Set<string>();

  for (const path of paths) {
    const isDirectory = path.endsWith('/');
    const normalizedPath = isDirectory ? path.slice(0, -1) : path;
    if (normalizedPath.length === 0) {
      continue;
    }

    let searchIndex = normalizedPath.indexOf('/');
    const limit = isDirectory
      ? normalizedPath.length
      : normalizedPath.lastIndexOf('/');

    while (searchIndex >= 0 && searchIndex <= limit) {
      folders.add(normalizedPath.slice(0, searchIndex));
      searchIndex = normalizedPath.indexOf('/', searchIndex + 1);
    }

    if (isDirectory) {
      folders.add(normalizedPath);
    }
  }

  return [...folders];
}

function adaptSharedWorkload(
  name: Exclude<PathStorePoweredWorkloadName, 'aosp'>
): PathStorePoweredLoadedWorkload {
  const workload = getVirtualizationWorkload(name);
  return {
    defaultExpandedPaths: workload.expandedFolders,
    fileCountLabel: workload.fileCountLabel,
    label: workload.label,
    name,
    paths: workload.presortedFiles,
    pathsArePresorted: true,
    rootCount: workload.rootCount,
  };
}

// The AOSP workload is served in two phases: SSR ships the baked preview so
// the Vercel function never needs to parse the 141 MB source, and the client
// upgrades the tree once it has downloaded and gunzipped the full path list
// from the CDN-served static asset.
function buildAospWorkload(): PathStorePoweredLoadedWorkload {
  return {
    defaultExpandedPaths: [],
    fileCountLabel: `${AOSP_TOTAL_PATH_COUNT.toLocaleString()} files across 0 expanded folders`,
    label: 'AOSP fixture',
    name: 'aosp',
    paths: AOSP_PREVIEW_PATHS,
    pathsArePresorted: true,
    rootCount: 1,
    upgradeDataUrl: AOSP_UPGRADE_DATA_URL,
  };
}

function loadPathStorePoweredWorkload(
  workloadName: PathStorePoweredWorkloadName
): Promise<PathStorePoweredLoadedWorkload> {
  const cachedWorkload = workloadPromiseCache.get(workloadName);
  if (cachedWorkload != null) {
    return cachedWorkload;
  }

  const workloadPromise = Promise.resolve(
    workloadName === 'aosp'
      ? buildAospWorkload()
      : adaptSharedWorkload(workloadName)
  );
  workloadPromiseCache.set(workloadName, workloadPromise);
  return workloadPromise;
}

export async function loadPathStorePoweredWorkloadDataPayload(
  workloadName: PathStorePoweredWorkloadName,
  expansionMode: PathStorePoweredExpansionMode
): Promise<PathStorePoweredWorkloadDataPayload> {
  const workload = await loadPathStorePoweredWorkload(workloadName);
  const initialExpandedPaths =
    expansionMode === 'all'
      ? workloadName === 'aosp'
        ? AOSP_PREVIEW_ALL_EXPANDED_PATHS
        : deriveExpandedPaths(workload.paths)
      : expansionMode === 'collapsed'
        ? []
        : workload.defaultExpandedPaths;

  return {
    initialExpandedPaths,
    paths: workload.paths,
    pathsArePresorted: workload.pathsArePresorted,
    selectedWorkload: {
      ...getPathStorePoweredWorkloadOption(workload.name),
      fileCountLabel: workload.fileCountLabel,
    },
    upgradeDataUrl: workload.upgradeDataUrl,
  };
}
