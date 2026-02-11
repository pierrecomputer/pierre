import { FLATTENED_PREFIX } from '../constants';

/**
 * Builds a flattened children array by replacing flattenable folders with f::-prefixed IDs.
 * Returns undefined if flattened would be identical to direct (no flattenable children).
 */
function buildFlattenedChildren(
  directChildren: string[],
  isFolder: (path: string) => boolean,
  getEndpoint: (path: string) => string | null
): string[] | undefined {
  let flattened: string[] | undefined;

  for (let i = 0; i < directChildren.length; i++) {
    const child = directChildren[i];
    if (isFolder(child)) {
      const endpoint = getEndpoint(child);
      if (endpoint != null) {
        flattened ??= directChildren.slice(0, i);
        flattened.push(`${FLATTENED_PREFIX}${endpoint}`);
      } else if (flattened != null) {
        flattened.push(child);
      }
    } else if (flattened != null) {
      flattened.push(child);
    }
  }

  return flattened;
}

/**
 * Builds a display name for a flattened chain from start to end path.
 * Example: buildFlattenedName('src/utils', 'src/utils/deep/nested') => 'utils/deep/nested'
 */
function buildFlattenedName(startPath: string, endPath: string): string {
  const lastSlashIndex = startPath.lastIndexOf('/');
  const startName =
    lastSlashIndex >= 0 ? startPath.slice(lastSlashIndex + 1) : startPath;
  const relativeSuffix = endPath.slice(startPath.length + 1);
  return relativeSuffix !== '' ? `${startName}/${relativeSuffix}` : startName;
}

/**
 * Collects all folder paths in a flattenable chain from start to end.
 */
function collectFlattenedFolders(
  startPath: string,
  endPath: string,
  getChildren: (path: string) => string[]
): string[] {
  const folders: string[] = [startPath];
  let current = startPath;

  while (current !== endPath) {
    const children = getChildren(current);
    if (children.length !== 1) break;
    current = children[0];
    folders.push(current);
  }

  return folders;
}

/**
 * Finds the deepest folder in a single-child chain starting from startPath.
 * Returns null if the starting folder is not flattenable (has multiple children or file child).
 */
function getFlattenedEndpoint(
  startPath: string,
  getChildren: (path: string) => string[],
  isFolder: (path: string) => boolean
): string | null {
  let current = startPath;
  let endpoint: string | null = null;

  while (true) {
    const children = getChildren(current);
    if (children.length !== 1) break;

    const onlyChild = children[0];
    if (!isFolder(onlyChild)) break;

    endpoint = onlyChild;
    current = onlyChild;
  }

  return endpoint;
}

export interface LoaderUtils {
  buildFlattenedChildren: (directChildren: string[]) => string[] | undefined;
  buildFlattenedName: (startPath: string, endPath: string) => string;
  collectFlattenedFolders: (startPath: string, endPath: string) => string[];
  getFlattenedEndpoint: (path: string) => string | null;
}

/**
 * Creates a set of utility functions for building file tree nodes.
 *
 * @param isFolder - Function to check if a path is a folder
 * @param getChildren - Function to get children of a path
 */
export function createLoaderUtils(
  isFolder: (path: string) => boolean,
  getChildren: (path: string) => string[]
): LoaderUtils {
  const flattenedEndpointCache = new Map<string, string | null>();

  const getCachedFlattenedEndpoint = (path: string): string | null => {
    const cached = flattenedEndpointCache.get(path);
    if (cached !== undefined) return cached;

    const result = getFlattenedEndpoint(path, getChildren, isFolder);
    flattenedEndpointCache.set(path, result);
    return result;
  };

  return {
    getFlattenedEndpoint: getCachedFlattenedEndpoint,
    buildFlattenedChildren: (directChildren) =>
      buildFlattenedChildren(
        directChildren,
        isFolder,
        getCachedFlattenedEndpoint
      ),
    collectFlattenedFolders: (startPath, endPath) =>
      collectFlattenedFolders(startPath, endPath, getChildren),
    buildFlattenedName,
  };
}
