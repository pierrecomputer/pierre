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

export type ChildrenSortOption = ChildrenComparator | false;

const FLATTENED_PREFIX_LENGTH = FLATTENED_PREFIX.length;

function isFlattenedPath(path: string): boolean {
  return (
    path.length >= FLATTENED_PREFIX_LENGTH &&
    path.charCodeAt(0) === 102 &&
    path.charCodeAt(1) === 58 &&
    path.charCodeAt(2) === 58
  );
}

function stripFlattenedPrefix(path: string): string {
  return isFlattenedPath(path) ? path.slice(FLATTENED_PREFIX_LENGTH) : path;
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
  if (isFlattenedPath(path)) {
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

  const aIsDot = aName.charCodeAt(0) === 46;
  const bIsDot = bName.charCodeAt(0) === 46;

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
 * @param parentPathLength - When provided, enables a fast name-extraction path
 *   using `path.slice(parentPathLength + 1)` instead of a backward `lastIndexOf`
 *   scan. Only valid for non-flattened children.
 * @returns New sorted array
 */
export function sortChildren(
  children: string[],
  isFolder: (path: string) => boolean,
  comparator: ChildrenSortOption = defaultChildrenComparator,
  parentPathLength?: number
): string[] {
  if (children.length <= 1) {
    return children.slice();
  }

  if (comparator === false) {
    // Preserve insertion order without paying Array.sort() cost.
    return children.slice();
  }

  if (comparator === defaultChildrenComparator) {
    // When parentPathLength is known, extract the child name via a direct
    // slice instead of scanning backwards with lastIndexOf. Flattened paths
    // (f:: prefix) still need the generic helper.
    const nameSliceStart = parentPathLength != null ? parentPathLength + 1 : -1;
    const n = children.length;
    const decorated: Array<{
      path: string;
      isFolder: boolean;
      isDot: boolean;
      lowerName: string;
    }> = new Array(n);

    for (let di = 0; di < n; di++) {
      const path = children[di];
      const name =
        nameSliceStart > 0 && !isFlattenedPath(path)
          ? path.slice(nameSliceStart)
          : getNameFromPath(path);
      decorated[di] = {
        path,
        isFolder: isFolderPath(path, isFolder),
        isDot: name.charCodeAt(0) === 46,
        lowerName: name.toLowerCase(),
      };
    }

    decorated.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }
      if (a.isDot !== b.isDot) {
        return a.isDot ? -1 : 1;
      }
      return a.lowerName.localeCompare(b.lowerName);
    });

    // Extract paths with a pre-sized array + index loop instead of .map()
    // to avoid per-element callback invocation overhead.
    const sorted: string[] = new Array(decorated.length);
    for (let si = 0; si < decorated.length; si++) {
      sorted[si] = decorated[si].path;
    }
    return sorted;
  }

  return [...children].sort((a, b) => comparator(a, b, isFolder));
}
