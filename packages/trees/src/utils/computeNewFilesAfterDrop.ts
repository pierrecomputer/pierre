import { FLATTENED_PREFIX } from '../constants';

export interface DropCollision {
  origin: string | null;
  destination: string;
}

export interface ComputeDropOptions {
  onCollision?: (collision: DropCollision) => boolean;
}

const normalizePath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

const getBasename = (path: string): string => {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
};

const isDescendantOf = (path: string, ancestor: string): boolean =>
  path.startsWith(`${ancestor}/`);

const hasSelectedFolderAncestor = (
  path: string,
  selectedFolders: Set<string>
): boolean => {
  let slash = path.lastIndexOf('/');
  while (slash !== -1) {
    const parent = path.slice(0, slash);
    if (selectedFolders.has(parent)) {
      return true;
    }
    slash = parent.lastIndexOf('/');
  }
  return false;
};

const buildFolderSet = (files: string[]): Set<string> => {
  const folders = new Set<string>();
  for (const file of files) {
    let slash = file.lastIndexOf('/');
    while (slash !== -1) {
      folders.add(file.slice(0, slash));
      slash = file.lastIndexOf('/', slash - 1);
    }
  }
  return folders;
};

const getSelectedFolderForFile = (
  file: string,
  selectedFolders: Set<string>
): string | undefined => {
  let slash = file.lastIndexOf('/');
  while (slash !== -1) {
    const folder = file.slice(0, slash);
    if (selectedFolders.has(folder)) {
      return folder;
    }
    slash = folder.lastIndexOf('/');
  }
  return undefined;
};

/**
 * Computes the new file list after dragging items to a target folder.
 *
 * @param currentFiles - The current flat list of file paths
 * @param draggedPaths - Paths being dragged (may include `f::` prefix)
 * @param targetFolderPath - Destination folder path, or `'root'` for top level
 * @param options - Optional move behavior, including collision handling
 * @returns A new file list with the dragged items moved
 */
export function computeNewFilesAfterDrop(
  currentFiles: string[],
  draggedPaths: string[],
  targetFolderPath: string,
  options: ComputeDropOptions = {}
): string[] {
  const normalizedTarget = normalizePath(targetFolderPath);
  const targetPrefix =
    normalizedTarget === 'root' ? '' : `${normalizedTarget}/`;

  const currentFileSet = new Set(currentFiles);
  const folderSet = buildFolderSet(currentFiles);

  const normalizedDragged = [...new Set(draggedPaths.map(normalizePath))];
  const orderedDragged = normalizedDragged
    .map((path) => ({
      path,
      kind: folderSet.has(path) ? 'folder' : 'file',
      depth: path.split('/').length,
    }))
    .sort((a, b) => a.depth - b.depth);

  const selectedFolders = new Set<string>();
  const selectedFiles = new Set<string>();
  for (const item of orderedDragged) {
    if (hasSelectedFolderAncestor(item.path, selectedFolders)) {
      continue;
    }
    if (item.kind === 'folder') {
      selectedFolders.add(item.path);
      continue;
    }
    if (currentFileSet.has(item.path)) {
      selectedFiles.add(item.path);
    }
  }

  const proposedDestinationByOrigin = new Map<string, string>();
  for (const file of currentFiles) {
    if (selectedFiles.has(file)) {
      const destination = `${targetPrefix}${getBasename(file)}`;
      if (destination !== file) {
        proposedDestinationByOrigin.set(file, destination);
      }
      continue;
    }

    const selectedFolder = getSelectedFolderForFile(file, selectedFolders);
    if (selectedFolder == null) {
      continue;
    }

    if (
      normalizedTarget === selectedFolder ||
      isDescendantOf(normalizedTarget, selectedFolder)
    ) {
      continue;
    }

    const destination = `${targetPrefix}${getBasename(selectedFolder)}${file.slice(selectedFolder.length)}`;
    if (destination !== file) {
      proposedDestinationByOrigin.set(file, destination);
    }
  }

  const finalPathByOrigin = new Map<string, string | null>();
  const occupantByDestination = new Map<string, string>();
  for (const file of currentFiles) {
    finalPathByOrigin.set(file, file);
    occupantByDestination.set(file, file);
  }

  for (const origin of currentFiles) {
    const destination = proposedDestinationByOrigin.get(origin);
    if (destination == null) {
      continue;
    }

    const currentPath = finalPathByOrigin.get(origin);
    if (currentPath == null || currentPath === destination) {
      continue;
    }

    const existingOccupant = occupantByDestination.get(destination);
    if (existingOccupant != null && existingOccupant !== origin) {
      const allowOverwrite =
        options.onCollision?.({ origin, destination }) === true;
      if (!allowOverwrite) {
        continue;
      }

      const existingPath = finalPathByOrigin.get(existingOccupant);
      if (existingPath != null) {
        occupantByDestination.delete(existingPath);
      }
      finalPathByOrigin.set(existingOccupant, null);
    }

    occupantByDestination.delete(currentPath);
    occupantByDestination.set(destination, origin);
    finalPathByOrigin.set(origin, destination);
  }

  const result: string[] = [];
  for (const file of currentFiles) {
    const next = finalPathByOrigin.get(file);
    if (next != null) {
      result.push(next);
    }
  }

  return result;
}
