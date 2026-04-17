import 'server-only';
import { readFile } from 'node:fs/promises';

import { preparePaths as sortCanonicalPaths } from '../../../../../packages/path-store/src/builder';
import {
  getPathStorePoweredWorkloadOption,
  type PathStorePoweredExpansionMode,
  type PathStorePoweredWorkloadDataPayload,
  type PathStorePoweredWorkloadName,
} from './pathStorePoweredWorkloadMeta';

interface LinuxKernelFixture {
  files: string[];
  folders: string[];
}

interface PathStorePoweredLoadedWorkload {
  defaultExpandedPaths: string[];
  fileCountLabel: string;
  label: string;
  name: PathStorePoweredWorkloadName;
  paths: string[];
  pathsArePresorted: boolean;
  rootCount: number;
}

const demoSmallFiles = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
] as const;

const workloadPromiseCache = new Map<
  PathStorePoweredWorkloadName,
  Promise<PathStorePoweredLoadedWorkload>
>();
let linuxFixturePromise: Promise<LinuxKernelFixture> | null = null;
let pierreSnapshotFilesPromise: Promise<string[]> | null = null;
let aospFilesPromise: Promise<string[]> | null = null;

function loadJsonFile<TValue>(relativePath: string): Promise<TValue> {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').then(
    (file) => JSON.parse(file) as TValue
  );
}

function loadLinuxFixture(): Promise<LinuxKernelFixture> {
  linuxFixturePromise ??= loadJsonFile<LinuxKernelFixture>(
    '../../../../../packages/tree-test-data/linux-files.json'
  );
  return linuxFixturePromise;
}

function loadPierreSnapshotFiles(): Promise<string[]> {
  pierreSnapshotFilesPromise ??= loadJsonFile<string[]>(
    '../../../../../packages/tree-test-data/pierre-snapshot-files.json'
  );
  return pierreSnapshotFilesPromise;
}

function loadAospFiles(): Promise<string[]> {
  aospFilesPromise ??= loadJsonFile<string[]>(
    '../../../../../packages/tree-test-data/aosp-files.json'
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

function createReplicaRootNames(count: number): string[] {
  return sortCanonicalPaths(
    Array.from({ length: count }, (_, index) => `linux-${index + 1}`)
  );
}

function cloneFileTreeIntoRoots(
  files: readonly string[],
  folders: readonly string[],
  roots: readonly string[]
): { expandedPaths: string[]; paths: string[] } {
  const prefixedPaths = new Array(files.length * roots.length);
  const prefixedExpandedPaths = new Array((folders.length + 1) * roots.length);

  let nextPathIndex = 0;
  let nextExpandedPathIndex = 0;

  for (const root of roots) {
    const prefix = `${root}/`;

    prefixedExpandedPaths[nextExpandedPathIndex++] = root;
    for (const folder of folders) {
      prefixedExpandedPaths[nextExpandedPathIndex++] = `${prefix}${folder}`;
    }

    for (const file of files) {
      prefixedPaths[nextPathIndex++] = `${prefix}${file}`;
    }
  }

  return {
    expandedPaths: prefixedExpandedPaths,
    paths: prefixedPaths,
  };
}

function createWorkload(
  name: PathStorePoweredWorkloadName,
  label: string,
  paths: string[],
  defaultExpandedPaths: string[],
  rootCount: number,
  pathsArePresorted: boolean = true
): PathStorePoweredLoadedWorkload {
  const canonicalPaths = pathsArePresorted ? paths : sortCanonicalPaths(paths);

  return {
    defaultExpandedPaths,
    fileCountLabel: `${canonicalPaths.length.toLocaleString()} files across ${defaultExpandedPaths.length.toLocaleString()} expanded folders`,
    label,
    name,
    paths: canonicalPaths,
    pathsArePresorted: true,
    rootCount,
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
      switch (workloadName) {
        case 'demo-small':
          return createWorkload(
            'demo-small',
            'Small demo workload',
            [...demoSmallFiles],
            deriveExpandedPaths(demoSmallFiles),
            1,
            false
          );
        case 'pierre-snapshot': {
          const paths = await loadPierreSnapshotFiles();
          return createWorkload(
            'pierre-snapshot',
            'Pierre repo snapshot',
            paths,
            deriveExpandedPaths(paths),
            1,
            false
          );
        }
        case 'half-linux': {
          const linuxFixture = await loadLinuxFixture();
          const paths = linuxFixture.files.filter(
            (_, index) => index % 2 === 0
          );
          return createWorkload(
            'half-linux',
            'Half Linux fixture',
            paths,
            deriveExpandedPaths(paths),
            1
          );
        }
        case 'linux':
        case 'linux-1x': {
          const linuxFixture = await loadLinuxFixture();
          return createWorkload(
            workloadName,
            workloadName === 'linux' ? 'Linux fixture' : 'Linux fixture x1',
            linuxFixture.files,
            linuxFixture.folders,
            1
          );
        }
        case 'linux-5x': {
          const linuxFixture = await loadLinuxFixture();
          const replicatedWorkload = cloneFileTreeIntoRoots(
            linuxFixture.files,
            linuxFixture.folders,
            createReplicaRootNames(5)
          );
          return createWorkload(
            'linux-5x',
            'Linux fixture x5',
            replicatedWorkload.paths,
            replicatedWorkload.expandedPaths,
            5
          );
        }
        case 'linux-10x': {
          const linuxFixture = await loadLinuxFixture();
          const replicatedWorkload = cloneFileTreeIntoRoots(
            linuxFixture.files,
            linuxFixture.folders,
            createReplicaRootNames(10)
          );
          return createWorkload(
            'linux-10x',
            'Linux fixture x10',
            replicatedWorkload.paths,
            replicatedWorkload.expandedPaths,
            10
          );
        }
        case 'aosp': {
          const paths = await loadAospFiles();
          return createWorkload('aosp', 'AOSP fixture', paths, [], 1);
        }
      }
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
