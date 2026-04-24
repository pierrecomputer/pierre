import type { GitStatus, GitStatusEntry } from '../publicTypes';
import { getGitStatusSignature } from '../utils/getGitStatusSignature';
import { normalizeInputPath } from '../utils/normalizeInputPath';

export interface FileTreeGitStatusState {
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

  const segments = normalizedPath.split('/');
  return segments
    .slice(0, -1)
    .map((_, index) => `${segments.slice(0, index + 1).join('/')}/`);
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

  for (const entry of entries ?? []) {
    const normalizedPath = normalizeInputPath(entry.path);
    if (normalizedPath == null) {
      continue;
    }

    const canonicalPath = getCanonicalGitStatusPath(
      normalizedPath.path,
      normalizedPath.isDirectory
    );
    statusByPath.set(canonicalPath, entry.status);
    if (entry.status === 'ignored' && normalizedPath.isDirectory) {
      ignoredDirectoryPaths.add(canonicalPath);
    } else if (normalizedPath.isDirectory) {
      ignoredDirectoryPaths.delete(canonicalPath);
    }

    for (const ancestorPath of getAncestorDirectoryPaths(normalizedPath.path)) {
      directoriesWithChanges.add(ancestorPath);
    }
  }

  return {
    directoriesWithChanges,
    ignoredDirectoryPaths,
    signature,
    statusByPath,
  };
}
