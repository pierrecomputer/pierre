import type { TreeDataLoader } from '@headless-tree/core';

import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createIdMaps } from '../utils/createIdMaps';
import { createLoaderUtils } from '../utils/createLoaderUtils';
import { defaultChildrenComparator, sortChildren } from '../utils/sortChildren';
import type { DataLoaderOptions } from './index';

/**
 * Creates a lazy data loader that computes nodes on-demand.
 * Best for large trees where most folders remain collapsed.
 * Tradeoff: deeper navigation may trigger incremental work and caching.
 *
 * @param filePaths - Array of file path strings
 * @param options - Configuration options
 */
export function generateLazyDataLoader(
  filePaths: string[],
  options: DataLoaderOptions = {}
): TreeDataLoader<FileTreeNode> {
  const {
    flattenEmptyDirectories = false,
    rootId = 'root',
    rootName = 'root',
    sortComparator = defaultChildrenComparator,
  } = options;

  // Pre-sort for efficient prefix matching
  const sortedPaths = [...filePaths].sort();

  const lowerBound = (target: string): number => {
    let lo = 0;
    let hi = sortedPaths.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedPaths[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  // Pre-compute folder set (fast O(n) scan)
  const folderSet = new Set<string>();
  for (const path of sortedPaths) {
    let current = '';
    const parts = path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      current = current !== '' ? `${current}/${parts[i]}` : parts[i];
      folderSet.add(current);
    }
  }

  // Lazy caches - populated as nodes are accessed
  const nodeCache = new Map<string, FileTreeNode>();
  const directChildrenCache = new Map<string, string[]>();

  const isFolder = (path: string): boolean => {
    return path === rootId || folderSet.has(path);
  };

  const getNameFromPath = (path: string): string => {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  };

  const findDirectChildren = (parentPath: string): string[] => {
    const cached = directChildrenCache.get(parentPath);
    if (cached != null) return cached;

    const children = new Set<string>();

    if (parentPath === rootId) {
      for (const path of sortedPaths) {
        const slashIndex = path.indexOf('/');
        const childSegment = slashIndex >= 0 ? path.slice(0, slashIndex) : path;
        if (childSegment !== '') {
          children.add(childSegment);
        }
      }
    } else {
      const prefix = `${parentPath}/`;
      const prefixLen = prefix.length;
      // Jump directly into the matching range; then scan forward until we leave it.
      for (let i = lowerBound(prefix); i < sortedPaths.length; i += 1) {
        const path = sortedPaths[i];
        if (!path.startsWith(prefix)) {
          break;
        }

        const relativePath = path.slice(prefixLen);
        if (relativePath === '') continue;
        const slashIndex = relativePath.indexOf('/');
        const childSegment =
          slashIndex >= 0 ? relativePath.slice(0, slashIndex) : relativePath;
        if (childSegment !== '') {
          children.add(`${parentPath}/${childSegment}`);
        }
      }
    }

    // Sort children using the configured comparator
    const result = sortChildren([...children], isFolder, sortComparator);
    directChildrenCache.set(parentPath, result);
    return result;
  };

  // Create flattening utilities with memoization
  const utils = createLoaderUtils(isFolder, findDirectChildren);

  // Track intermediate folders (those that are part of a flattened chain)
  const intermediateFolders = new Set<string>();
  const flattenedKeys = new Set<string>();

  for (const folder of folderSet) {
    const flattenedEndpoint = utils.getFlattenedEndpoint(folder);
    if (flattenedEndpoint == null) continue;

    const flattenedFolders = utils.collectFlattenedFolders(
      folder,
      flattenedEndpoint
    );
    for (let i = 0; i < flattenedFolders.length - 1; i++) {
      intermediateFolders.add(flattenedFolders[i]);
    }

    flattenedKeys.add(`${FLATTENED_PREFIX}${flattenedEndpoint}`);
  }

  const { getIdForKey, getKeyForId } = createIdMaps(rootId);
  const allKeys = new Set<string>([rootId]);
  for (const path of sortedPaths) {
    allKeys.add(path);
  }
  for (const folder of folderSet) {
    allKeys.add(folder);
  }
  for (const flattenedKey of flattenedKeys) {
    allKeys.add(flattenedKey);
  }
  for (const key of Array.from(allKeys).sort()) {
    getIdForKey(key);
  }

  const mapKey = (key: string) => getIdForKey(key);

  // Find the start of the flattened chain that ends at endPath
  const findFlattenedChainStart = (endPath: string): string => {
    const parts = endPath.split('/');
    // Check from the shallowest ancestor to find where the chain starts
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (utils.getFlattenedEndpoint(ancestorPath) === endPath) {
        return ancestorPath;
      }
    }
    return endPath;
  };

  // === Main TreeDataLoader Implementation ===
  const getItem = (id: string): FileTreeNode => {
    const cached = nodeCache.get(id);
    if (cached != null) return cached;

    const key = getKeyForId(id);
    if (key == null) {
      throw new Error(`generateLazyDataLoader: unknown id ${id}`);
    }

    let node: FileTreeNode;

    if (key === rootId) {
      // Root node
      const directChildren = findDirectChildren(rootId);
      const flattenedChildren = utils.buildFlattenedChildren(directChildren);
      node = {
        name: rootName,
        path: rootId,
        children: {
          direct: directChildren.map(mapKey),
          ...(flattenedChildren != null && {
            flattened: flattenedChildren.map(mapKey),
          }),
        },
      };
    } else if (key.startsWith(FLATTENED_PREFIX)) {
      const endPath = key.slice(FLATTENED_PREFIX.length);
      const startPath = findFlattenedChainStart(endPath);

      const flattenedFolders = utils.collectFlattenedFolders(
        startPath,
        endPath
      );
      const directChildren = findDirectChildren(endPath);
      const flattenedChildren = utils.buildFlattenedChildren(directChildren);

      node = {
        name: utils.buildFlattenedName(startPath, endPath),
        path: key,
        flattens: flattenedFolders.map(mapKey),
        children: {
          direct: directChildren.map(mapKey),
          ...(flattenedChildren != null && {
            flattened: flattenedChildren.map(mapKey),
          }),
        },
      };
    } else if (isFolder(key)) {
      // Regular folder
      const directChildren = findDirectChildren(key);
      const flattenedChildren = intermediateFolders.has(key)
        ? undefined
        : utils.buildFlattenedChildren(directChildren);
      node = {
        name: getNameFromPath(key),
        path: key,
        children: {
          direct: directChildren.map(mapKey),
          ...(flattenedChildren != null && {
            flattened: flattenedChildren.map(mapKey),
          }),
        },
      };
    } else {
      // File
      node = { name: getNameFromPath(key), path: key };
    }

    nodeCache.set(id, node);
    return node;
  };

  const getChildren = (id: string): string[] => {
    const item = getItem(id);
    if (item.children == null) return [];
    if (flattenEmptyDirectories && item.children.flattened != null) {
      return item.children.flattened;
    }
    return item.children.direct;
  };

  return { getItem, getChildren };
}
