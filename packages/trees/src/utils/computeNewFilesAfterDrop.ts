import { FLATTENED_PREFIX } from '../constants';

/**
 * Computes the new file list after dragging items to a target folder.
 *
 * @param currentFiles - The current flat list of file paths
 * @param draggedPaths - Paths being dragged (may include `f::` prefix)
 * @param targetFolderPath - Destination folder path, or `'root'` for top level
 * @returns A new file list with the dragged items moved
 */
export function computeNewFilesAfterDrop(
  currentFiles: string[],
  draggedPaths: string[],
  targetFolderPath: string
): string[] {
  // Strip f:: prefix from dragged paths and target
  const normalizedDragged = draggedPaths.map((p) =>
    p.startsWith(FLATTENED_PREFIX) ? p.slice(FLATTENED_PREFIX.length) : p
  );
  const normalizedTarget = targetFolderPath.startsWith(FLATTENED_PREFIX)
    ? targetFolderPath.slice(FLATTENED_PREFIX.length)
    : targetFolderPath;

  // Separate folder paths (those that are prefixes of other files) from file paths
  const folderPrefixes: string[] = [];
  const filePaths: string[] = [];
  for (const dp of normalizedDragged) {
    const prefix = dp + '/';
    if (currentFiles.some((f) => f.startsWith(prefix))) {
      folderPrefixes.push(dp);
    } else {
      filePaths.push(dp);
    }
  }

  const targetPrefix =
    normalizedTarget === 'root' ? '' : normalizedTarget + '/';

  const result: string[] = [];
  for (const file of currentFiles) {
    // Check if this file is one of the dragged files
    if (filePaths.includes(file)) {
      const name = file.slice(file.lastIndexOf('/') + 1);
      result.push(targetPrefix + name);
      continue;
    }

    // Check if this file is inside one of the dragged folders
    let matched = false;
    for (const folder of folderPrefixes) {
      const folderPrefix = folder + '/';
      if (file === folder || file.startsWith(folderPrefix)) {
        const folderName = folder.slice(folder.lastIndexOf('/') + 1);
        const suffix = file.slice(folder.length);
        result.push(targetPrefix + folderName + suffix);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push(file);
    }
  }

  return result;
}
