import type { GitStatus, GitStatusEntry } from '../publicTypes';
import { getGitStatusSignature } from '../utils/getGitStatusSignature';
import { normalizeInputPath } from '../utils/normalizeInputPath';
import type { FileTreeGitStatusPatch } from './publicTypes';

export interface FileTreeGitStatusState {
  readonly changeCountByDirectoryPath: ReadonlyMap<string, number>;
  readonly directoriesWithChanges: ReadonlySet<string>;
  readonly ignoredDirectoryPaths: ReadonlySet<string>;
  readonly signature: string;
  readonly statusByPath: ReadonlyMap<string, GitStatus>;
}

// Git status is keyed by canonical paths in the file tree so runtime tree
// mutations can reuse the same decoration state without rebuilding ID maps.
function getAncestorDirectoryPaths(path: string): readonly string[] {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0) {
    return [];
  }

  const ancestors: string[] = [];
  let searchIndex = 0;
  for (;;) {
    const slashIndex = normalizedPath.indexOf('/', searchIndex);
    if (slashIndex === -1) {
      break;
    }

    ancestors.push(normalizedPath.slice(0, slashIndex + 1));
    searchIndex = slashIndex + 1;
  }
  return ancestors;
}

function getCanonicalGitStatusPath(path: string, isDirectory: boolean): string {
  return isDirectory ? `${path}/` : path;
}

export function resolveFileTreeGitStatusState(
  entries: readonly GitStatusEntry[] | undefined,
  previous: FileTreeGitStatusState | null = null
): FileTreeGitStatusState | null {
  const signature = getGitStatusSignature(
    entries == null ? undefined : [...entries]
  );
  if (signature === '0') {
    return null;
  }

  if (previous?.signature === signature) {
    return previous;
  }

  const statusByPath = new Map<string, GitStatus>();
  const directoriesWithChanges = new Set<string>();
  const ignoredDirectoryPaths = new Set<string>();
  const changeCountByDirectoryPath = new Map<string, number>();

  for (const entry of entries ?? []) {
    const resolved = resolveGitStatusEntry(entry);
    if (resolved == null) {
      continue;
    }

    setGitStatusPath({
      canonicalPath: resolved.canonicalPath,
      changeCountByDirectoryPath,
      directoriesWithChanges,
      ignoredDirectoryPaths,
      isDirectory: resolved.isDirectory,
      status: entry.status,
      statusByPath,
    });
  }

  if (statusByPath.size === 0) {
    return null;
  }

  return {
    changeCountByDirectoryPath,
    directoriesWithChanges,
    ignoredDirectoryPaths,
    signature,
    statusByPath,
  };
}

export function applyFileTreeGitStatusPatch(
  previous: FileTreeGitStatusState | null,
  patch: FileTreeGitStatusPatch | undefined
): FileTreeGitStatusState | null {
  const removeEntries = patch?.remove ?? [];
  const setEntries = patch?.set ?? [];
  if (removeEntries.length === 0 && setEntries.length === 0) {
    return previous;
  }

  const statusByPath = new Map(previous?.statusByPath);
  const directoriesWithChanges = new Set(previous?.directoriesWithChanges);
  const ignoredDirectoryPaths = new Set(previous?.ignoredDirectoryPaths);
  const changeCountByDirectoryPath = new Map(
    previous?.changeCountByDirectoryPath
  );
  let changed = false;

  for (const path of removeEntries) {
    const resolved = resolveGitStatusPath(path);
    if (resolved == null) {
      continue;
    }

    changed =
      removeGitStatusPath({
        canonicalPath: resolved.canonicalPath,
        changeCountByDirectoryPath,
        directoriesWithChanges,
        ignoredDirectoryPaths,
        statusByPath,
      }) || changed;
  }

  for (const entry of setEntries) {
    const resolved = resolveGitStatusEntry(entry);
    if (resolved == null) {
      continue;
    }

    changed =
      setGitStatusPath({
        canonicalPath: resolved.canonicalPath,
        changeCountByDirectoryPath,
        directoriesWithChanges,
        ignoredDirectoryPaths,
        isDirectory: resolved.isDirectory,
        status: entry.status,
        statusByPath,
      }) || changed;
  }

  if (!changed) {
    return previous;
  }
  if (statusByPath.size === 0) {
    return null;
  }

  return {
    changeCountByDirectoryPath,
    directoriesWithChanges,
    ignoredDirectoryPaths,
    signature: getGitStatusStateSignature(statusByPath),
    statusByPath,
  };
}

interface GitStatusPathResolution {
  canonicalPath: string;
  isDirectory: boolean;
}

function resolveGitStatusEntry(
  entry: GitStatusEntry
): GitStatusPathResolution | undefined {
  return resolveGitStatusPath(entry.path);
}

function resolveGitStatusPath(
  path: string
): GitStatusPathResolution | undefined {
  const normalizedPath = normalizeInputPath(path);
  if (normalizedPath == null) {
    return undefined;
  }

  return {
    canonicalPath: getCanonicalGitStatusPath(
      normalizedPath.path,
      normalizedPath.isDirectory
    ),
    isDirectory: normalizedPath.isDirectory,
  };
}

function removeGitStatusPath({
  canonicalPath,
  changeCountByDirectoryPath,
  directoriesWithChanges,
  ignoredDirectoryPaths,
  statusByPath,
}: {
  canonicalPath: string;
  changeCountByDirectoryPath: Map<string, number>;
  directoriesWithChanges: Set<string>;
  ignoredDirectoryPaths: Set<string>;
  statusByPath: Map<string, GitStatus>;
}): boolean {
  const previousStatus = statusByPath.get(canonicalPath);
  if (previousStatus == null) {
    return false;
  }

  statusByPath.delete(canonicalPath);
  if (previousStatus === 'ignored' && canonicalPath.endsWith('/')) {
    ignoredDirectoryPaths.delete(canonicalPath);
  }
  decrementAncestorChangeCounts(
    changeCountByDirectoryPath,
    directoriesWithChanges,
    canonicalPath
  );
  return true;
}

function setGitStatusPath({
  canonicalPath,
  changeCountByDirectoryPath,
  directoriesWithChanges,
  ignoredDirectoryPaths,
  isDirectory,
  status,
  statusByPath,
}: {
  canonicalPath: string;
  changeCountByDirectoryPath: Map<string, number>;
  directoriesWithChanges: Set<string>;
  ignoredDirectoryPaths: Set<string>;
  isDirectory: boolean;
  status: GitStatus;
  statusByPath: Map<string, GitStatus>;
}): boolean {
  const previousStatus = statusByPath.get(canonicalPath);
  if (previousStatus === status) {
    return false;
  }

  if (previousStatus == null) {
    incrementAncestorChangeCounts(
      changeCountByDirectoryPath,
      directoriesWithChanges,
      canonicalPath
    );
  }

  statusByPath.set(canonicalPath, status);
  if (status === 'ignored' && isDirectory) {
    ignoredDirectoryPaths.add(canonicalPath);
  } else if (isDirectory) {
    ignoredDirectoryPaths.delete(canonicalPath);
  }
  return true;
}

function incrementAncestorChangeCounts(
  changeCountByDirectoryPath: Map<string, number>,
  directoriesWithChanges: Set<string>,
  path: string
): void {
  for (const ancestorPath of getAncestorDirectoryPaths(path)) {
    changeCountByDirectoryPath.set(
      ancestorPath,
      (changeCountByDirectoryPath.get(ancestorPath) ?? 0) + 1
    );
    directoriesWithChanges.add(ancestorPath);
  }
}

function decrementAncestorChangeCounts(
  changeCountByDirectoryPath: Map<string, number>,
  directoriesWithChanges: Set<string>,
  path: string
): void {
  for (const ancestorPath of getAncestorDirectoryPaths(path)) {
    const nextCount = (changeCountByDirectoryPath.get(ancestorPath) ?? 0) - 1;
    if (nextCount > 0) {
      changeCountByDirectoryPath.set(ancestorPath, nextCount);
    } else {
      changeCountByDirectoryPath.delete(ancestorPath);
      directoriesWithChanges.delete(ancestorPath);
    }
  }
}

function getGitStatusStateSignature(
  statusByPath: ReadonlyMap<string, GitStatus>
): string {
  let signature = `${statusByPath.size}`;
  for (const [path, status] of statusByPath) {
    signature += `\0${path}\0${status}`;
  }
  return signature;
}
