export interface FileTreeNodeChildren {
  collapsed?: string[];
  direct: string[];
}

export interface FileTreeNode {
  name: string;
  children?: FileTreeNodeChildren;
  /** For collapsed nodes, lists the folder IDs that were collapsed into this node */
  collapses?: string[];
}

export interface FileListToTreeOptions {
  root?: {
    id: string;
    name: string;
  };
}

const COLLAPSED_PREFIX = 'c::';

/**
 * Converts a list of file paths into a tree structure suitable for use with FileTree.
 * Generates both direct children and collapsed children (single-child folder chains).
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

  // Memoized collapsed endpoints to avoid recomputation
  const collapsedEndpointCache = new Map<string, string | null>();

  // Helper to get the collapsed endpoint from a folder (iterative, memoized)
  // Returns the deepest folder in a single-child chain, or null if not collapsible
  function getCollapsedEndpoint(startPath: string): string | null {
    const cached = collapsedEndpointCache.get(startPath);
    if (cached !== undefined) return cached;

    let current = startPath;
    let endpoint: string | null = null;

    while (true) {
      const children = folderChildren.get(current);
      if (children == null || children.size !== 1) break;

      const onlyChild = getFirstChild(children);
      if (onlyChild == null || !isFolder(onlyChild)) break; // Single child is a file, not collapsible

      endpoint = onlyChild;
      current = onlyChild;
    }

    collapsedEndpointCache.set(startPath, endpoint);
    return endpoint;
  }

  // Helper to build a collapsed name from start to end path
  function buildCollapsedName(startPath: string, endPath: string): string {
    const lastSlashIndex = startPath.lastIndexOf('/');
    const startName =
      lastSlashIndex >= 0 ? startPath.slice(lastSlashIndex + 1) : startPath;
    const relativeSuffix = endPath.slice(startPath.length + 1);
    return relativeSuffix !== '' ? `${startName}/${relativeSuffix}` : startName;
  }

  // Helper to build collapsed children array, only if it differs from direct
  // Returns undefined if collapsed would be identical to direct
  function buildCollapsedChildren(
    directChildren: string[]
  ): string[] | undefined {
    let collapsed: string[] | undefined;

    for (let i = 0; i < directChildren.length; i++) {
      const child = directChildren[i];
      if (isFolder(child)) {
        const collapsedEndpoint = getCollapsedEndpoint(child);
        if (collapsedEndpoint != null) {
          // Found a collapsible folder - initialize collapsed array if needed
          collapsed ??= directChildren.slice(0, i);
          collapsed.push(`${COLLAPSED_PREFIX}${collapsedEndpoint}`);
        } else if (collapsed != null) {
          collapsed.push(child);
        }
      } else if (collapsed != null) {
        collapsed.push(child);
      }
    }

    return collapsed;
  }

  // Helper to collect all folder IDs in a collapsible chain
  function collectCollapsedFolders(
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

  // Track intermediate folders (those that are part of a collapsed chain)
  const intermediateFolders = new Set<string>();

  // First pass: identify all intermediate folders and create collapsed nodes
  for (const children of folderChildren.values()) {
    for (const child of children) {
      if (!isFolder(child)) continue;

      const collapsedEndpoint = getCollapsedEndpoint(child);
      if (collapsedEndpoint == null) continue;

      // Mark all folders in the chain as intermediate (except the endpoint)
      const collapsedFolders = collectCollapsedFolders(
        child,
        collapsedEndpoint
      );
      for (let i = 0; i < collapsedFolders.length - 1; i++) {
        intermediateFolders.add(collapsedFolders[i]);
      }

      // Create the collapsed node if it doesn't exist
      const collapsedKey = `${COLLAPSED_PREFIX}${collapsedEndpoint}`;
      if (tree[collapsedKey] != null) continue;

      const collapsedName = buildCollapsedName(child, collapsedEndpoint);
      const endpointChildren = folderChildren.get(collapsedEndpoint);
      const endpointDirectChildren =
        endpointChildren != null ? [...endpointChildren] : [];
      const endpointCollapsedChildren = buildCollapsedChildren(
        endpointDirectChildren
      );

      tree[collapsedKey] = {
        name: collapsedName,
        collapses: collapsedFolders,
        children: {
          direct: endpointDirectChildren,
          ...(endpointCollapsedChildren != null && {
            collapsed: endpointCollapsedChildren,
          }),
        },
      };
    }
  }

  // Second pass: create regular folder nodes
  for (const [path, children] of folderChildren) {
    const directChildren = [...children];
    const isIntermediate = intermediateFolders.has(path);

    // Only compute collapsed children for non-intermediate folders
    const collapsedChildren = isIntermediate
      ? undefined
      : buildCollapsedChildren(directChildren);

    if (path === rootId) {
      tree[rootId] = {
        name: rootName,
        children: {
          direct: directChildren,
          ...(collapsedChildren != null && { collapsed: collapsedChildren }),
        },
      };
    } else if (tree[path] == null) {
      const lastSlashIndex = path.lastIndexOf('/');
      const name = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
      tree[path] = {
        name,
        children: {
          direct: directChildren,
          ...(collapsedChildren != null && { collapsed: collapsedChildren }),
        },
      };
    }
  }

  return tree;
}
