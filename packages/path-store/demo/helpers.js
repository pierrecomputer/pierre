/**
 * @typedef {import('../src/index').PathStore} PathStore
 * @typedef {import('../src/public-types').PathStoreVisibleRow} PathStoreVisibleRow
 */

/**
 * @param {string} path
 * @returns {{ isDirectory: boolean; name: string; parentPath: string }}
 */
export function splitPath(path) {
  const isDirectory = path.endsWith('/');
  const normalizedPath = isDirectory ? path.slice(0, -1) : path;
  const lastSlashIndex = normalizedPath.lastIndexOf('/');

  return {
    isDirectory,
    name:
      lastSlashIndex === -1
        ? normalizedPath
        : normalizedPath.slice(lastSlashIndex + 1),
    parentPath:
      lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex + 1),
  };
}

/**
 * @param {string} path
 * @param {string} destinationDirectoryPath
 * @returns {string}
 */
export function getMovedPathIntoDirectory(path, destinationDirectoryPath) {
  const { isDirectory, name } = splitPath(path);
  return `${destinationDirectoryPath}${name}${isDirectory ? '/' : ''}`;
}

/**
 * Returns the move-to-parent destination only when the path is deep enough and
 * the moved path would not collide with an existing entry.
 *
 * @param {PathStore} store
 * @param {string} path
 * @returns {{ destinationPath: string; movedPath: string } | null}
 */
export function getMovePathToParentPlan(store, path) {
  const parentPath = splitPath(path).parentPath;
  if (parentPath === '') {
    return null;
  }

  const destinationPath = splitPath(parentPath).parentPath;
  if (destinationPath === '') {
    return null;
  }

  const movedPath = getMovedPathIntoDirectory(path, destinationPath);
  if (store.list(movedPath).length > 0) {
    return null;
  }

  return {
    destinationPath,
    movedPath,
  };
}

/**
 * Returns the move-to-parent destination for a folder only when the moved path
 * would not collide with an existing entry.
 *
 * @param {PathStore} store
 * @param {string} path
 * @returns {{ destinationPath: string; movedPath: string } | null}
 */
export function getMoveVisibleFolderToParentPlan(store, path) {
  return path.endsWith('/') ? getMovePathToParentPlan(store, path) : null;
}

/**
 * Picks the first visible folder whose move-to-parent destination would not
 * collide with an existing path.
 *
 * @param {PathStore} store
 * @param {readonly PathStoreVisibleRow[]} rows
 * @returns {PathStoreVisibleRow | null}
 */
export function findMoveVisibleFolderToParentCandidate(store, rows) {
  return (
    rows.find(
      (row) =>
        row.kind === 'directory' &&
        getMoveVisibleFolderToParentPlan(store, row.path) != null
    ) ?? null
  );
}

/**
 * Picks the first visible file whose move-to-parent destination would not
 * collide with an existing path.
 *
 * @param {PathStore} store
 * @param {readonly PathStoreVisibleRow[]} rows
 * @returns {PathStoreVisibleRow | null}
 */
export function findMoveVisibleLeafToParentCandidate(store, rows) {
  return (
    rows.find(
      (row) =>
        row.kind === 'file' && getMovePathToParentPlan(store, row.path) != null
    ) ?? null
  );
}
