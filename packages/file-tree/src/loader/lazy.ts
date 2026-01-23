import type { TreeDataLoader } from '@headless-tree/core';

import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createLoaderUtils } from '../utils/createLoaderUtils';
import { defaultChildrenComparator, sortChildren } from '../utils/sortChildren';
import type { DataLoaderOptions } from './index';

/**
 * Creates a lazy data loader that computes nodes on-demand.
 * Suitable for large file trees where most folders stay collapsed.
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
    const prefix = parentPath === rootId ? '' : `${parentPath}/`;
    const prefixLen = prefix.length;

    for (const path of sortedPaths) {
      // For root, all paths are potential children
      // For other parents, only paths starting with the prefix
      if (parentPath === rootId || path.startsWith(prefix)) {
        const relativePath =
          parentPath === rootId ? path : path.slice(prefixLen);
        // Skip empty strings (can happen if prefix matches exactly)
        if (relativePath === '') continue;
        const slashIndex = relativePath.indexOf('/');
        const childSegment =
          slashIndex >= 0 ? relativePath.slice(0, slashIndex) : relativePath;
        const childPath =
          parentPath === rootId
            ? childSegment
            : `${parentPath}/${childSegment}`;
        children.add(childPath);
      }
    }

    // Sort children using the configured comparator
    const result = sortChildren([...children], isFolder, sortComparator);
    directChildrenCache.set(parentPath, result);
    return result;
  };

  // Create flattening utilities with memoization
  const utils = createLoaderUtils(isFolder, findDirectChildren);

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

    let node: FileTreeNode;

    if (id === rootId) {
      // Root node
      const directChildren = findDirectChildren(rootId);
      const flattenedChildren = utils.buildFlattenedChildren(directChildren);
      node = {
        name: rootName,
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    } else if (id.startsWith(FLATTENED_PREFIX)) {
      const endPath = id.slice(FLATTENED_PREFIX.length);
      const startPath = findFlattenedChainStart(endPath);

      const flattenedFolders = utils.collectFlattenedFolders(
        startPath,
        endPath
      );
      const directChildren = findDirectChildren(endPath);
      const flattenedChildren = utils.buildFlattenedChildren(directChildren);

      node = {
        name: utils.buildFlattenedName(startPath, endPath),
        flattens: flattenedFolders,
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    } else if (isFolder(id)) {
      // Regular folder
      const directChildren = findDirectChildren(id);
      const flattenedChildren = utils.buildFlattenedChildren(directChildren);
      node = {
        name: getNameFromPath(id),
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    } else {
      // File
      node = { name: getNameFromPath(id) };
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
