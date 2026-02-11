import { FLATTENED_PREFIX } from '../constants';

/**
 * Sort comparator for file tree children.
 * Receives two paths and a function to check if a path is a folder.
 * Should return negative if a < b, positive if a > b, 0 if equal.
 */
export type ChildrenComparator = (
  a: string,
  b: string,
  isFolder: (path: string) => boolean
) => number;

function stripFlattenedPrefix(path: string): string {
  return path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;
}

/**
 * Extracts the name (last segment) from a path.
 * Handles f:: prefixed paths by stripping the prefix first.
 */
function getNameFromPath(path: string): string {
  const actualPath = stripFlattenedPrefix(path);
  const lastSlash = actualPath.lastIndexOf('/');
  return lastSlash >= 0 ? actualPath.slice(lastSlash + 1) : actualPath;
}

function isFolderPath(
  path: string,
  isFolder: (path: string) => boolean
): boolean {
  if (path.startsWith(FLATTENED_PREFIX)) {
    return true; // Flattened nodes are always folders
  }
  return isFolder(path);
}

/**
 * Simple alphabetical comparator
 */
export const alphabeticalChildrenComparator: ChildrenComparator = (a, b) => {
  const aName = getNameFromPath(a);
  const bName = getNameFromPath(b);
  return aName.localeCompare(bName);
};

/**
 * Default semantic comparator for file tree children.
 * Sort order:
 * 1. Folders before files
 * 2. Dot-prefixed (hidden) items before others within each group
 * 3. Case-insensitive alphabetical within each subgroup
 */
export const defaultChildrenComparator: ChildrenComparator = (
  a,
  b,
  isFolder
) => {
  const aIsFolder = isFolderPath(a, isFolder);
  const bIsFolder = isFolderPath(b, isFolder);

  // Folders before files
  if (aIsFolder !== bIsFolder) {
    return aIsFolder ? -1 : 1;
  }

  const aName = getNameFromPath(a);
  const bName = getNameFromPath(b);

  const aIsDot = aName.startsWith('.');
  const bIsDot = bName.startsWith('.');

  // Dot-prefixed before others
  if (aIsDot !== bIsDot) {
    return aIsDot ? -1 : 1;
  }

  // Case-insensitive alphabetical
  return aName.toLowerCase().localeCompare(bName.toLowerCase());
};

/**
 * Sorts an array of child paths using the provided comparator.
 *
 * @param children - Array of child paths to sort
 * @param isFolder - Function to check if a path is a folder
 * @param comparator - Comparator function (defaults to semantic sort)
 * @returns New sorted array
 */
export function sortChildren(
  children: string[],
  isFolder: (path: string) => boolean,
  comparator: ChildrenComparator = defaultChildrenComparator
): string[] {
  return [...children].sort((a, b) => comparator(a, b, isFolder));
}
