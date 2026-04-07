import { preparePaths as sortCanonicalPathsFromPathStore } from '../path-store/src/builder.ts';
import linuxFixture from './linux-files.json';
import pierreSnapshotFiles from './pierre-snapshot-files.json';

/**
 * @typedef {'demo-small' | 'pierre-snapshot' | 'half-linux' | 'linux' | 'linux-1x' | 'linux-5x' | 'linux-10x'} VirtualizationWorkloadName
 */

/**
 * @typedef {{
 *   files: string[];
 *   folders: string[];
 * }} LinuxKernelFixture
 */

/**
 * @typedef {{
 *   expandedFolders: string[];
 *   fileCountLabel: string;
 *   files: string[];
 *   label: string;
 *   name: VirtualizationWorkloadName;
 *   presortedFiles: string[];
 *   rootCount: number;
 * }} VirtualizationWorkload
 */

/** @type {readonly VirtualizationWorkloadName[]} */
export const VIRTUALIZATION_WORKLOAD_NAMES = [
  'demo-small',
  'pierre-snapshot',
  'half-linux',
  'linux',
  'linux-1x',
  'linux-5x',
  'linux-10x',
];

export const DEFAULT_VIRTUALIZATION_WORKLOAD_NAME = 'linux-5x';

/** @type {LinuxKernelFixture} */
export const linuxKernelFixture = linuxFixture;
export { pierreSnapshotFiles };

/**
 * Collects every ancestor folder that should start expanded for a path list.
 *
 * The datasets are already canonical, so this stays intentionally light and
 * only derives parent prefixes needed by the tree demos and benchmarks.
 *
 * @param {readonly string[]} paths
 * @returns {string[]}
 */
function deriveExpandedFolders(paths) {
  const folders = new Set();

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

    while (searchIndex >= 0 && searchIndex < limit) {
      folders.add(normalizedPath.slice(0, searchIndex));
      searchIndex = normalizedPath.indexOf('/', searchIndex + 1);
    }

    if (isDirectory) {
      folders.add(normalizedPath);
    }
  }

  return [...folders];
}

// Tree fixtures reuse path-store's canonical sorter so the benchmark and
// workload data stay aligned with the runtime package's ordering rules.

/**
 * @param {readonly string[]} files
 * @returns {string[]}
 */
export function sortCanonicalPaths(files) {
  return sortCanonicalPathsFromPathStore(files);
}

/**
 * @param {number} count
 * @returns {string[]}
 */
function createReplicaRootNames(count) {
  return Array.from({ length: count }, (_, index) => `linux-${index + 1}`);
}

/**
 * @param {readonly string[]} files
 * @param {readonly string[]} folders
 * @param {readonly string[]} roots
 * @returns {{ expandedFolders: string[]; files: string[] }}
 */
function cloneFileTreeIntoRoots(files, folders, roots) {
  const prefixedFiles = new Array(files.length * roots.length);
  const prefixedFolders = new Array((folders.length + 1) * roots.length);

  let nextFileIndex = 0;
  let nextFolderIndex = 0;

  for (const root of roots) {
    const prefix = `${root}/`;

    prefixedFolders[nextFolderIndex++] = root;
    for (const folder of folders) {
      prefixedFolders[nextFolderIndex++] = `${prefix}${folder}`;
    }

    for (const file of files) {
      prefixedFiles[nextFileIndex++] = `${prefix}${file}`;
    }
  }

  return {
    expandedFolders: prefixedFolders,
    files: prefixedFiles,
  };
}

/**
 * @param {VirtualizationWorkloadName} name
 * @param {string} label
 * @param {string[]} files
 * @param {string[]} expandedFolders
 * @param {number} rootCount
 * @returns {VirtualizationWorkload}
 */
function createWorkload(
  name,
  label,
  files,
  expandedFolders,
  rootCount,
  filesArePresorted = false
) {
  /** @type {string[] | undefined} */
  let presortedFiles = filesArePresorted ? files : undefined;

  return {
    expandedFolders,
    fileCountLabel: `${files.length.toLocaleString()} files across ${expandedFolders.length.toLocaleString()} expanded folders`,
    files,
    label,
    name,
    get presortedFiles() {
      presortedFiles ??= sortCanonicalPaths(files);
      return presortedFiles;
    },
    rootCount,
  };
}

// linux-files.json stores canonical path order so the main linux workload can
// be used directly without re-sorting on every consumer load.
const linuxFiles = linuxFixture.files;
const halfLinuxFiles = linuxFiles.filter((_, index) => index % 2 === 0);
const demoSmallFiles = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
];
const linux5xWorkloadData = cloneFileTreeIntoRoots(
  linuxFiles,
  linuxFixture.folders,
  sortCanonicalPaths(createReplicaRootNames(5))
);
const linux10xWorkloadData = cloneFileTreeIntoRoots(
  linuxFiles,
  linuxFixture.folders,
  sortCanonicalPaths(createReplicaRootNames(10))
);

/** @type {Record<VirtualizationWorkloadName, VirtualizationWorkload>} */
const workloadsByName = {
  'demo-small': createWorkload(
    'demo-small',
    'Small demo workload',
    demoSmallFiles,
    deriveExpandedFolders(demoSmallFiles),
    1
  ),
  'pierre-snapshot': createWorkload(
    'pierre-snapshot',
    'Pierre repo snapshot',
    pierreSnapshotFiles,
    deriveExpandedFolders(pierreSnapshotFiles),
    1
  ),
  'half-linux': createWorkload(
    'half-linux',
    'Half Linux fixture',
    halfLinuxFiles,
    deriveExpandedFolders(halfLinuxFiles),
    1,
    true
  ),
  linux: createWorkload(
    'linux',
    'Linux fixture',
    linuxFiles,
    linuxFixture.folders,
    1,
    true
  ),
  'linux-1x': createWorkload(
    'linux-1x',
    'Linux fixture x1',
    linuxFiles,
    linuxFixture.folders,
    1,
    true
  ),
  'linux-5x': createWorkload(
    'linux-5x',
    'Linux fixture x5',
    linux5xWorkloadData.files,
    linux5xWorkloadData.expandedFolders,
    5,
    true
  ),
  'linux-10x': createWorkload(
    'linux-10x',
    'Linux fixture x10',
    linux10xWorkloadData.files,
    linux10xWorkloadData.expandedFolders,
    10,
    true
  ),
};

/**
 * @param {string | null | undefined} [workloadName]
 * @returns {VirtualizationWorkload}
 */
export function getVirtualizationWorkload(workloadName) {
  if (workloadName == null || workloadName === '') {
    return workloadsByName[DEFAULT_VIRTUALIZATION_WORKLOAD_NAME];
  }

  if (!(workloadName in workloadsByName)) {
    throw new Error(
      `Unknown virtualization workload '${workloadName}'. Expected one of: ${VIRTUALIZATION_WORKLOAD_NAMES.join(
        ', '
      )}.`
    );
  }

  return workloadsByName[
    /** @type {VirtualizationWorkloadName} */ (workloadName)
  ];
}

/**
 * @returns {VirtualizationWorkload[]}
 */
export function listVirtualizationWorkloads() {
  return VIRTUALIZATION_WORKLOAD_NAMES.map((name) => workloadsByName[name]);
}
