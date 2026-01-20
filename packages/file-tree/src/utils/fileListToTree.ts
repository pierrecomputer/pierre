import type { FileTreeNode } from '../types';

export interface FileListToTreeOptions {
  root?: {
    id: string;
    name: string;
  };
}

const FLATTENED_PREFIX = 'f::';

/**
 * Converts a list of file paths into a tree structure suitable for use with FileTree.
 * Generates both direct children and flattened children (single-child folder chains).
 *
 * @param filePaths - Array of file path strings (e.g., ['src/index.ts', 'src/utils/helper.ts'])
 * @param options - Optional configuration for root node
 * @returns A record mapping node IDs (full paths) to FileTreeNode objects
 */
export function fileListToTree(
  filePaths: string[],
  options: FileListToTreeOptions = {}
): Record<string, FileTreeNode> {
  const { root: rootOptions } = options;
  const { id: rootId = 'root', name: rootName = 'root' } = rootOptions ?? {};

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
        tree[currentPath] ??= { name: part };
      } else if (!folderChildren.has(currentPath)) {
        // Ensure folder has a children set for tracking
        folderChildren.set(currentPath, new Set());
      }
    }
  }

  // Helper to check if a path is a folder
  const isFolder = (path: string): boolean => folderChildren.has(path);

  // Helper to get first element from a Set without creating an array
  const getFirstChild = (children: Set<string>): string | undefined =>
    children.values().next().value ?? undefined;

  // Memoized flattened endpoints to avoid recomputation
  const flattenedEndpointCache = new Map<string, string | null>();

  // Helper to get the flattened endpoint from a folder (iterative, memoized)
  // Returns the deepest folder in a single-child chain, or null if not flattenable
  function getFlattenedEndpoint(startPath: string): string | null {
    const cached = flattenedEndpointCache.get(startPath);
    if (cached !== undefined) return cached;

    let current = startPath;
    let endpoint: string | null = null;

    while (true) {
      const children = folderChildren.get(current);
      if (children == null || children.size !== 1) break;

      const onlyChild = getFirstChild(children);
      if (onlyChild == null || !isFolder(onlyChild)) break; // Single child is a file, not flattenable

      endpoint = onlyChild;
      current = onlyChild;
    }

    flattenedEndpointCache.set(startPath, endpoint);
    return endpoint;
  }

  // Helper to build a flattened name from start to end path
  function buildFlattenedName(startPath: string, endPath: string): string {
    const lastSlashIndex = startPath.lastIndexOf('/');
    const startName =
      lastSlashIndex >= 0 ? startPath.slice(lastSlashIndex + 1) : startPath;
    const relativeSuffix = endPath.slice(startPath.length + 1);
    return relativeSuffix !== '' ? `${startName}/${relativeSuffix}` : startName;
  }

  // Helper to build flattened children array, only if it differs from direct
  // Returns undefined if flattened would be identical to direct
  function buildFlattenedChildren(
    directChildren: string[]
  ): string[] | undefined {
    let flattened: string[] | undefined;

    for (let i = 0; i < directChildren.length; i++) {
      const child = directChildren[i];
      if (isFolder(child)) {
        const flattenedEndpoint = getFlattenedEndpoint(child);
        if (flattenedEndpoint != null) {
          // Found a flattenable folder - initialize flattened array if needed
          flattened ??= directChildren.slice(0, i);
          flattened.push(`${FLATTENED_PREFIX}${flattenedEndpoint}`);
        } else if (flattened != null) {
          flattened.push(child);
        }
      } else if (flattened != null) {
        flattened.push(child);
      }
    }

    return flattened;
  }

  // Helper to collect all folder IDs in a flattenable chain
  function collectFlattenedFolders(
    startPath: string,
    endPath: string
  ): string[] {
    const folders: string[] = [startPath];
    let current = startPath;

    while (current !== endPath) {
      const children = folderChildren.get(current);
      if (children == null || children.size !== 1) break;
      current = getFirstChild(children) as string;
      folders.push(current);
    }

    return folders;
  }

  // Track intermediate folders (those that are part of a flattened chain)
  const intermediateFolders = new Set<string>();

  // First pass: identify all intermediate folders and create flattened nodes
  for (const children of folderChildren.values()) {
    for (const child of children) {
      if (!isFolder(child)) continue;

      const flattenedEndpoint = getFlattenedEndpoint(child);
      if (flattenedEndpoint == null) continue;

      // Mark all folders in the chain as intermediate (except the endpoint)
      const flattenedFolders = collectFlattenedFolders(
        child,
        flattenedEndpoint
      );
      for (let i = 0; i < flattenedFolders.length - 1; i++) {
        intermediateFolders.add(flattenedFolders[i]);
      }

      // Create the flattened node if it doesn't exist
      const flattenedKey = `${FLATTENED_PREFIX}${flattenedEndpoint}`;
      if (tree[flattenedKey] != null) continue;

      const flattenedName = buildFlattenedName(child, flattenedEndpoint);
      const endpointChildren = folderChildren.get(flattenedEndpoint);
      const endpointDirectChildren =
        endpointChildren != null ? [...endpointChildren] : [];
      const endpointFlattenedChildren = buildFlattenedChildren(
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
    const directChildren = [...children];
    const isIntermediate = intermediateFolders.has(path);

    // Only compute flattened children for non-intermediate folders
    const flattenedChildren = isIntermediate
      ? undefined
      : buildFlattenedChildren(directChildren);

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
