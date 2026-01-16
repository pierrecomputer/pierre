import type { TreeDataLoader } from '@headless-tree/core';

import type { FileTreeData, FileTreeNode } from '../types';

export interface SyncDataLoaderOptions {
  collapseFolders?: boolean;
}

export function generateSyncDataLoader(
  data: FileTreeData,
  options: SyncDataLoaderOptions = {}
): TreeDataLoader<FileTreeNode> {
  return {
    getItem: (id: string) => data[id],
    getChildren: (id: string) => {
      const children = data[id]?.children;
      if (children == null) {
        return [];
      }
      if (options.collapseFolders === true) {
        if (children.collapsed != null) {
          return children.collapsed;
        }
      }
      return children.direct;
    },
  };
}
