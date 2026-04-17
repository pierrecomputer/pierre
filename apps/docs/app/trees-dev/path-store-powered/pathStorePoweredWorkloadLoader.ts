import 'server-only';
import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { preparePaths as sortCanonicalPaths } from '../../../../../packages/path-store/src/builder';
import {
  getPathStorePoweredWorkloadOption,
  type PathStorePoweredExpansionMode,
  type PathStorePoweredWorkloadDataPayload,
  type PathStorePoweredWorkloadName,
} from './pathStorePoweredWorkloadMeta';

interface PathStorePoweredLoadedWorkload {
  defaultExpandedPaths: string[];
  fileCountLabel: string;
  label: string;
  name: PathStorePoweredWorkloadName;
  paths: readonly string[];
  pathsArePresorted: boolean;
  rootCount: number;
}

const workloadPromiseCache = new Map<
  PathStorePoweredWorkloadName,
  Promise<PathStorePoweredLoadedWorkload>
>();
let aospFilesPromise: Promise<string[]> | null = null;

// AOSP fixture is stored via Git LFS and deliberately excluded from the shared
// tree-test-data bundle. Loading it lazily via readFile keeps it out of every
// consumer's JS bundle while still making it available to this server route.
function loadAospFiles(): Promise<string[]> {
  // Anchored at the docs app cwd (apps/docs in dev, /var/task/apps/docs on
  // Vercel) because Turbopack strips import.meta.dirname and polyfills URL in
  // a way that Node's fileURLToPath rejects.
  const fixturePath = resolvePath(
    process.cwd(),
    '../../packages/tree-test-data/aosp-files.json'
  );
  aospFilesPromise ??= readFile(fixturePath, 'utf8').then(
    (file) => JSON.parse(file) as string[]
  );
  return aospFilesPromise;
}

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

async function loadPathStorePoweredWorkload(
  workloadName: PathStorePoweredWorkloadName
): Promise<PathStorePoweredLoadedWorkload> {
  const cachedWorkload = workloadPromiseCache.get(workloadName);
  if (cachedWorkload != null) {
    return cachedWorkload;
  }

  const workloadPromise =
    (async (): Promise<PathStorePoweredLoadedWorkload> => {
      if (workloadName === 'aosp') {
        const rawPaths = await loadAospFiles();
        const paths = sortCanonicalPaths(rawPaths);
        return {
          defaultExpandedPaths: [],
          fileCountLabel: `${paths.length.toLocaleString()} files across 0 expanded folders`,
          label: 'AOSP fixture',
          name: 'aosp',
          paths,
          pathsArePresorted: true,
          rootCount: 1,
        };
      }

      return adaptSharedWorkload(workloadName);
    })();

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
      ? deriveExpandedPaths(workload.paths)
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
  };
}
