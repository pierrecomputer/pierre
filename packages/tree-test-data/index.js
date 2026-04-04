import linuxFixture from './linux-files.json';
import pierreSnapshotFiles from './pierre-snapshot-files.json';

/**
 * @typedef {'demo-small' | 'pierre-snapshot' | 'half-linux' | 'linux' | 'linux-5x' | 'linux-10x'} VirtualizationWorkloadName
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

const DIGIT_SEQUENCE_REGEX = /\d+/g;

/**
 * @param {string} value
 * @returns {(number | string)[]}
 */
function splitIntoNaturalTokens(value) {
  /** @type {(number | string)[]} */
  const tokens = [];
  let lastIndex = 0;

  for (const match of value.matchAll(DIGIT_SEQUENCE_REGEX)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokens.push(value.slice(lastIndex, matchIndex));
    }

    const numberValue = Number.parseInt(match[0], 10);
    tokens.push(Number.isNaN(numberValue) ? match[0] : numberValue);
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < value.length) {
    tokens.push(value.slice(lastIndex));
  }

  return tokens;
}

/**
 * @param {readonly (number | string)[]} leftTokens
 * @param {readonly (number | string)[]} rightTokens
 * @returns {number}
 */
function compareNaturalTokens(leftTokens, rightTokens) {
  const tokenCount = Math.min(leftTokens.length, rightTokens.length);

  for (let index = 0; index < tokenCount; index++) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];

    if (leftToken === rightToken) {
      continue;
    }

    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      return leftToken < rightToken ? -1 : 1;
    }

    const leftString = String(leftToken);
    const rightString = String(rightToken);
    if (leftString !== rightString) {
      return leftString < rightString ? -1 : 1;
    }
  }

  if (leftTokens.length !== rightTokens.length) {
    return leftTokens.length < rightTokens.length ? -1 : 1;
  }

  return 0;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareSegmentValues(left, right) {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const tokenComparison = compareNaturalTokens(
    splitIntoNaturalTokens(leftLower),
    splitIntoNaturalTokens(rightLower)
  );
  if (tokenComparison !== 0) {
    return tokenComparison;
  }

  if (leftLower !== rightLower) {
    return leftLower < rightLower ? -1 : 1;
  }

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * @param {string} path
 * @returns {{ isDirectory: boolean; segments: string[] }}
 */
function parsePathForSort(path) {
  const isDirectory = path.endsWith('/');
  const normalizedPath = isDirectory ? path.slice(0, -1) : path;
  return {
    isDirectory,
    segments: normalizedPath.split('/'),
  };
}

/**
 * @param {{ isDirectory: boolean; segments: readonly string[] }} entry
 * @param {number} depth
 * @returns {'directory' | 'file'}
 */
function getKindAtDepth(entry, depth) {
  const isTerminalSegment = depth === entry.segments.length - 1;
  if (!isTerminalSegment) {
    return 'directory';
  }

  return entry.isDirectory ? 'directory' : 'file';
}

/**
 * @param {string} leftPath
 * @param {string} rightPath
 * @returns {number}
 */
function compareCanonicalPaths(leftPath, rightPath) {
  const left = parsePathForSort(leftPath);
  const right = parsePathForSort(rightPath);
  const sharedDepth = Math.min(left.segments.length, right.segments.length);

  for (let depth = 0; depth < sharedDepth; depth++) {
    const leftSegment = left.segments[depth];
    const rightSegment = right.segments[depth];

    if (leftSegment === rightSegment) {
      continue;
    }

    const leftKind = getKindAtDepth(left, depth);
    const rightKind = getKindAtDepth(right, depth);
    if (leftKind !== rightKind) {
      return leftKind === 'directory' ? -1 : 1;
    }

    return compareSegmentValues(leftSegment, rightSegment);
  }

  if (left.segments.length !== right.segments.length) {
    return left.segments.length < right.segments.length ? -1 : 1;
  }

  if (left.isDirectory === right.isDirectory) {
    return 0;
  }

  return left.isDirectory ? -1 : 1;
}

/**
 * @param {readonly string[]} files
 * @returns {string[]}
 */
export function sortCanonicalPaths(files) {
  return [...files].sort(compareCanonicalPaths);
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
function createWorkload(name, label, files, expandedFolders, rootCount) {
  /** @type {string[] | undefined} */
  let presortedFiles;

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

const halfLinuxFiles = linuxFixture.files.filter((_, index) => index % 2 === 0);
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
  linuxFixture.files,
  linuxFixture.folders,
  createReplicaRootNames(5)
);
const linux10xWorkloadData = cloneFileTreeIntoRoots(
  linuxFixture.files,
  linuxFixture.folders,
  createReplicaRootNames(10)
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
    1
  ),
  linux: createWorkload(
    'linux',
    'Linux fixture',
    linuxFixture.files,
    linuxFixture.folders,
    1
  ),
  'linux-5x': createWorkload(
    'linux-5x',
    'Linux fixture x5',
    linux5xWorkloadData.files,
    linux5xWorkloadData.expandedFolders,
    5
  ),
  'linux-10x': createWorkload(
    'linux-10x',
    'Linux fixture x10',
    linux10xWorkloadData.files,
    linux10xWorkloadData.expandedFolders,
    10
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
