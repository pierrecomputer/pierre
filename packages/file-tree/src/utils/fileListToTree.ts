import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createIdMaps } from './createIdMaps';
import { createLoaderUtils } from './createLoaderUtils';
import type { ChildrenComparator } from './sortChildren';
import { defaultChildrenComparator, sortChildren } from './sortChildren';

export interface FileListToTreeOptions {
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenComparator;
}

const ROOT_ID = 'root';

/**
 * Converts a list of file paths into a tree structure suitable for use with FileTree.
 * Generates both direct children and flattened children (single-child folder chains).
 *
 * Time complexity: O(n * d) where n = number of files, d = average path depth
 * Space complexity: O(n * d) for storing all nodes and folder relationships
 *
 * @param filePaths - Array of file path strings (e.g., ['src/index.ts', 'src/utils/helper.ts'])
 * @param options - Optional configuration for root node
 * @returns A record mapping node IDs (hashed) to FileTreeNode objects
 *   with the original path stored on each node's `path` field
 */
export function fileListToTree(
  filePaths: string[],
  options: FileListToTreeOptions = {}
): Record<string, FileTreeNode> {
  const {
    rootId = ROOT_ID,
    rootName = ROOT_ID,
    sortComparator = defaultChildrenComparator,
  } = options;

  const tree: Record<string, FileTreeNode> = {};
  const folderChildren: Map<string, Set<string>> = new Map();

  // Initialize root's children set
  folderChildren.set(rootId, new Set());

  // Build the folder structure from file paths
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    let currentPath: string | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const parentPath = currentPath ?? rootId;
      currentPath = currentPath != null ? `${currentPath}/${part}` : part;

      // Ensure parent has a children set and add current path
      let parentChildren = folderChildren.get(parentPath);
      if (parentChildren == null) {
        parentChildren = new Set();
        folderChildren.set(parentPath, parentChildren);
      }
      parentChildren.add(currentPath);

      if (isFile) {
        // Create file node (no children)
        tree[currentPath] ??= { name: part, path: currentPath };
      } else if (!folderChildren.has(currentPath)) {
        // Ensure folder has a children set for tracking
        folderChildren.set(currentPath, new Set());
      }
    }
  }

  // Helper to check if a path is a folder
  const isFolder = (path: string): boolean => folderChildren.has(path);

  // Helper to sort children using the configured comparator
  const sortChildrenArray = (children: string[]): string[] =>
    sortChildren(children, isFolder, sortComparator);

  // Adapter to make folderChildren work with the shared helper
  const getChildrenArray = (path: string): string[] => {
    const children = folderChildren.get(path);
    return children != null ? [...children] : [];
  };

  // Create flattening utilities with memoization
  const utils = createLoaderUtils(isFolder, getChildrenArray);

  // Track intermediate folders (those that are part of a flattened chain)
  const intermediateFolders = new Set<string>();

  // First pass: identify all intermediate folders and create flattened nodes
  for (const children of folderChildren.values()) {
    for (const child of children) {
      if (!isFolder(child)) continue;

      const flattenedEndpoint = utils.getFlattenedEndpoint(child);
      if (flattenedEndpoint == null) continue;

      // Mark all folders in the chain as intermediate (except the endpoint)
      const flattenedFolders = utils.collectFlattenedFolders(
        child,
        flattenedEndpoint
      );
      for (let i = 0; i < flattenedFolders.length - 1; i++) {
        intermediateFolders.add(flattenedFolders[i]);
      }

      // Create the flattened node if it doesn't exist
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
        path: flattenedKey,
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

    // Only compute flattened children for non-intermediate folders
    const flattenedChildren = isIntermediate
      ? undefined
      : utils.buildFlattenedChildren(directChildren);

    if (path === rootId) {
      tree[rootId] = {
        name: rootName,
        path: rootId,
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
        path,
        children: {
          direct: directChildren,
          ...(flattenedChildren != null && { flattened: flattenedChildren }),
        },
      };
    }
  }

  const { getIdForKey } = createIdMaps(rootId);
  const mapKey = (key: string) => getIdForKey(key);
  const hashedTree: Record<string, FileTreeNode> = {};

  for (const [key, node] of Object.entries(tree)) {
    const mappedKey = mapKey(key);
    const nextNode: FileTreeNode = {
      ...node,
      ...(node.children != null && {
        children: {
          direct: node.children.direct.map(mapKey),
          ...(node.children.flattened != null && {
            flattened: node.children.flattened.map(mapKey),
          }),
        },
      }),
      ...(node.flattens != null && { flattens: node.flattens.map(mapKey) }),
    };

    hashedTree[mappedKey] = nextNode;
  }

  return hashedTree;
}
