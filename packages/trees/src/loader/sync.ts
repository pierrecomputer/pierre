import type { TreeDataLoader } from '@headless-tree/core';

import type { FileTreeNode } from '../types';
import { fileListToTree } from '../utils/fileListToTree';
import type { DataLoaderOptions } from './index';

/**
 * Creates a sync data loader that pre-builds all nodes upfront.
 * Best for small-to-medium trees or workflows that touch most nodes.
 * Tradeoff: higher upfront cost, but faster random access afterward.
 *
 * @param filePaths - Array of file path strings
 * @param options - Configuration options
 */
export function generateSyncDataLoader(
  filePaths: string[],
  options: DataLoaderOptions = {}
): TreeDataLoader<FileTreeNode> {
  const {
    flattenEmptyDirectories = false,
    rootId,
    rootName,
    sortComparator,
  } = options;

  const tree = fileListToTree(filePaths, { rootId, rootName, sortComparator });

  return {
    getItem: (id: string) => tree[id],
    getChildren: (id: string) => {
      const children = tree[id]?.children;
      if (children == null) {
        return [];
      }
      if (flattenEmptyDirectories === true) {
        if (children.flattened != null) {
          return children.flattened;
        }
      }
      return children.direct;
    },
  };
}
