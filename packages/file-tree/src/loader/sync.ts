import type { TreeDataLoader } from '@headless-tree/core';

import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createLoaderUtils } from '../utils/createLoaderUtils';
import type { ChildrenComparator } from '../utils/sortChildren';
import { defaultChildrenComparator, sortChildren } from '../utils/sortChildren';
import type { DataLoaderOptions } from './index';

/**
 * Converts a list of file paths into a tree structure.
 */
function fileListToTree(
  filePaths: string[],
  options: {
    rootId?: string;
    rootName?: string;
    sortComparator?: ChildrenComparator;
  } = {}
): Record<string, FileTreeNode> {
  const {
    rootId = 'root',
    rootName = 'root',
    sortComparator = defaultChildrenComparator,
  } = options;

  const tree: Record<string, FileTreeNode> = {};
  const folderChildren: Map<string, Set<string>> = new Map();

  folderChildren.set(rootId, new Set());

  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    let currentPath: string | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const parentPath = currentPath ?? rootId;
      currentPath = currentPath != null ? `${currentPath}/${part}` : part;

      let parentChildren = folderChildren.get(parentPath);
      if (parentChildren == null) {
        parentChildren = new Set();
        folderChildren.set(parentPath, parentChildren);
      }
      parentChildren.add(currentPath);

      if (isFile) {
        tree[currentPath] ??= { name: part };
      } else if (!folderChildren.has(currentPath)) {
        folderChildren.set(currentPath, new Set());
      }
    }
  }

  const isFolder = (path: string): boolean => folderChildren.has(path);

  const sortChildrenArray = (children: string[]): string[] =>
    sortChildren(children, isFolder, sortComparator);

  const getChildrenArray = (path: string): string[] => {
    const children = folderChildren.get(path);
    return children != null ? [...children] : [];
  };

  const utils = createLoaderUtils(isFolder, getChildrenArray);

  const intermediateFolders = new Set<string>();

  // First pass: identify intermediate folders and create flattened nodes
  for (const children of folderChildren.values()) {
    for (const child of children) {
      if (!isFolder(child)) continue;

      const flattenedEndpoint = utils.getFlattenedEndpoint(child);
      if (flattenedEndpoint == null) continue;

      const flattenedFolders = utils.collectFlattenedFolders(
        child,
        flattenedEndpoint
      );
      for (let i = 0; i < flattenedFolders.length - 1; i++) {
        intermediateFolders.add(flattenedFolders[i]);
      }

      const flattenedKey = `${FLATTENED_PREFIX}${flattenedEndpoint}`;
      if (tree[flattenedKey] != null) continue;

      const flattenedName = utils.buildFlattenedName(child, flattenedEndpoint);
      const endpointChildren = folderChildren.get(flattenedEndpoint);
      const endpointDirectChildren =
        endpointChildren != null
          ? sortChildrenArray([...endpointChildren])
          : [];
      const endpointFlattenedChildren = utils.buildFlattenedChildren(
        endpointDirectChildren
      );

      tree[flattenedKey] = {
        name: flattenedName,
        flattens: flattenedFolders,
        children: {
          direct: endpointDirectChildren,
          ...(endpointFlattenedChildren != null && {
            flattened: endpointFlattenedChildren,
          }),
        },
      };
    }
  }

  // Second pass: create regular folder nodes
  for (const [path, children] of folderChildren) {
    const directChildren = sortChildrenArray([...children]);
    const isIntermediate = intermediateFolders.has(path);

    const flattenedChildren = isIntermediate
      ? undefined
      : utils.buildFlattenedChildren(directChildren);

    if (path === rootId) {
      tree[rootId] = {
        name: rootName,
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    } else if (tree[path] == null) {
      const lastSlashIndex = path.lastIndexOf('/');
      const name = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
      tree[path] = {
        name,
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    }
  }

  return tree;
}

/**
 * Creates a sync data loader that pre-builds all nodes upfront.
 * Suitable for small-to-medium file trees or when all nodes will be accessed.
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
