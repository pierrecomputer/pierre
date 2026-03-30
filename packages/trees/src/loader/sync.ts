import type { FileTreeData, FileTreeNode } from '../types';
import { fileListToTree } from '../utils/fileListToTree';
import type { DataLoaderOptions } from './types';
import type { TreeDataLoader } from './types';

/**
 * Creates a sync data loader from prebuilt tree data.
 * Useful when callers already need `treeData` for auxiliary maps and want to
 * avoid building the same structure twice.
 */
export function generateSyncDataLoaderFromTreeData(
  tree: FileTreeData,
  options: Pick<DataLoaderOptions, 'flattenEmptyDirectories'> = {}
): TreeDataLoader<FileTreeNode> {
  const { flattenEmptyDirectories = false } = options;

  return {
    getItem: (id: string) => tree[id],
    getChildren: (id: string) => {
      const children = tree[id]?.children;
      if (children == null) {
        return [];
      }
      if (flattenEmptyDirectories === true && children.flattened != null) {
        return children.flattened;
      }
      return children.direct;
    },
  };
}

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
  return generateSyncDataLoaderFromTreeData(tree, { flattenEmptyDirectories });
}
