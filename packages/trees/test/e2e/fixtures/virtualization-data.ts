import pierreSnapshotRaw from '../../../scripts/fixtures/fileListToTree-monorepo-snapshot.txt?raw';
import {
  forEachFolderInNormalizedPath,
  normalizeInputPath,
} from '../../../src/utils/normalizeInputPath';
import linuxData from './virtualization-linux-files.json';

export const VIRTUALIZATION_WORKLOAD_NAMES = [
  'pierre-snapshot',
  'half-linux',
  'linux',
  'linux-5x',
  'linux-10x',
] as const;

export type VirtualizationWorkloadName =
  (typeof VIRTUALIZATION_WORKLOAD_NAMES)[number];

export interface VirtualizationWorkload {
  name: VirtualizationWorkloadName;
  label: string;
  fileCountLabel: string;
  files: string[];
  expandedFolders: string[];
}

export const DEFAULT_VIRTUALIZATION_WORKLOAD_NAME: VirtualizationWorkloadName =
  'linux-5x';

function parseRawFileList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function deriveExpandedFolders(files: readonly string[]): string[] {
  const folders = new Set<string>();

  for (const filePath of files) {
    const normalizedPath = normalizeInputPath(filePath);
    if (normalizedPath == null) {
      continue;
    }

    forEachFolderInNormalizedPath(
      normalizedPath.path,
      normalizedPath.isDirectory,
      (folderPath) => {
        folders.add(folderPath);
      }
    );
  }

  return Array.from(folders);
}

function createReplicaRootNames(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `linux-${String(index + 1)}`
  );
}

/** Mirrors the docs workload by prefixing a fixture under multiple roots. */
function cloneFileTreeIntoRoots(
  files: readonly string[],
  folders: readonly string[],
  roots: readonly string[]
): { files: string[]; folders: string[] } {
  const prefixedFiles = new Array<string>(files.length * roots.length);
  const prefixedFolders = new Array<string>(
    (folders.length + 1) * roots.length
  );

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

  return { files: prefixedFiles, folders: prefixedFolders };
}

function createWorkload(
  name: VirtualizationWorkloadName,
  files: string[],
  expandedFolders: string[],
  label: string
): VirtualizationWorkload {
  return {
    name,
    label,
    fileCountLabel: `${files.length.toLocaleString()} files across ${expandedFolders.length.toLocaleString()} expanded folders`,
    files,
    expandedFolders,
  };
}

const pierreSnapshotFiles = parseRawFileList(pierreSnapshotRaw);
const halfLinuxFiles = linuxData.files.filter((_, index) => index % 2 === 0);
const linux5xData = cloneFileTreeIntoRoots(
  linuxData.files,
  linuxData.folders,
  createReplicaRootNames(5)
);
const linux10xData = cloneFileTreeIntoRoots(
  linuxData.files,
  linuxData.folders,
  createReplicaRootNames(10)
);

const workloadsByName: Record<
  VirtualizationWorkloadName,
  VirtualizationWorkload
> = {
  'pierre-snapshot': createWorkload(
    'pierre-snapshot',
    pierreSnapshotFiles,
    deriveExpandedFolders(pierreSnapshotFiles),
    'Pierre repo snapshot'
  ),
  'half-linux': createWorkload(
    'half-linux',
    halfLinuxFiles,
    deriveExpandedFolders(halfLinuxFiles),
    'Half Linux fixture'
  ),
  linux: createWorkload(
    'linux',
    linuxData.files,
    linuxData.folders,
    'Linux fixture'
  ),
  'linux-5x': createWorkload(
    'linux-5x',
    linux5xData.files,
    linux5xData.folders,
    'Linux fixture x5'
  ),
  'linux-10x': createWorkload(
    'linux-10x',
    linux10xData.files,
    linux10xData.folders,
    'Linux fixture x10'
  ),
};

export function getVirtualizationWorkload(
  workloadName: string | null | undefined
): VirtualizationWorkload {
  if (workloadName == null || workloadName === '') {
    return workloadsByName[DEFAULT_VIRTUALIZATION_WORKLOAD_NAME];
  }

  const workload =
    workloadsByName[workloadName as VirtualizationWorkloadName] ?? null;
  if (workload == null) {
    throw new Error(
      `Unknown virtualization workload '${workloadName}'. Expected one of: ${VIRTUALIZATION_WORKLOAD_NAMES.join(
        ', '
      )}.`
    );
  }

  return workload;
}

export function listVirtualizationWorkloads(): VirtualizationWorkload[] {
  return VIRTUALIZATION_WORKLOAD_NAMES.map((name) => workloadsByName[name]);
}

const defaultWorkload = getVirtualizationWorkload(
  DEFAULT_VIRTUALIZATION_WORKLOAD_NAME
);

export const linuxKernelFiles = defaultWorkload.files;
export const linuxKernelAllFolders = defaultWorkload.expandedFolders;
export const linuxKernelReplicaCount = 5;
