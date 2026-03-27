import linuxData from './virtualization-linux-files.json';

export const linuxKernelReplicaNames = [
  'linux-1',
  'linux-2',
  'linux-3',
  'linux-4',
  'linux-5',
] as const;

/** Mirrors the docs workload by prefixing the Linux fixture under five roots. */
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

const expandedLinuxKernelData = cloneFileTreeIntoRoots(
  linuxData.files,
  linuxData.folders,
  linuxKernelReplicaNames
);

export const linuxKernelFiles = expandedLinuxKernelData.files;
export const linuxKernelAllFolders = expandedLinuxKernelData.folders;
export const linuxKernelReplicaCount = linuxKernelReplicaNames.length;
