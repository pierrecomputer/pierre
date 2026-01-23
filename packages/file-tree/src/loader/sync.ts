import type { TreeDataLoader } from '@headless-tree/core';
import type { FileTreeNode } from '../types';

import { fileListToTree } from '../utils/fileListToTree';

export interface SyncDataLoaderOptions {
  flattenEmptyDirectories?: boolean;
  rootId?: string;
  rootName?: string;
}

/**
 * Creates a sync data loader that pre-builds all nodes upfront.
 *
 * @param filePaths - Array of file path strings
 * @param options - Configuration options
 */
export function generateSyncDataLoader(
  filePaths: string[],
  options: SyncDataLoaderOptions = {}
): TreeDataLoader<FileTreeNode> {
  const {
    flattenEmptyDirectories = false,
    rootId = 'root',
    rootName = 'root',
  } = options;

  const data = fileListToTree(filePaths, {
    root: { id: rootId, name: rootName },
  });

  return {
    getItem: (id: string) => data[id],
    getChildren: (id: string) => {
      const children = data[id]?.children;
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
