// Rename parity is defined around basename edits, so this helper strips the
// trailing slash from canonical directory paths before deriving the visible
// editable leaf segment.
export function getRenameLeafName(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const separatorIndex = normalizedPath.lastIndexOf('/');
  return separatorIndex < 0
    ? normalizedPath
    : normalizedPath.slice(separatorIndex + 1);
}

// The legacy rename helper reports folder paths without a trailing slash, but
// the path-store mutation layer still moves canonical directory paths with `/`.
export function toRenameHelperPath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function toCanonicalRenamePath(path: string, isFolder: boolean): string {
  return isFolder && !path.endsWith('/') ? `${path}/` : path;
}
