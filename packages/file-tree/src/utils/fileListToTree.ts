export interface FileTreeNode {
  name: string;
  children?: string[];
}

export interface FileListToTreeOptions {
  root?: {
    id: string;
    name: string;
  };
}

/**
 * Converts a list of file paths into a tree structure suitable for use with FileTree.
 *
 * @param filePaths - Array of file path strings (e.g., ['src/index.ts', 'src/utils/helper.ts'])
 * @param options - Optional configuration for root node
 * @returns A record mapping node IDs (full paths) to FileTreeNode objects
 *
 * @example
 * const tree = fileListToTree(['src/index.ts', 'src/utils/helper.ts']);
 * // Returns:
 * // {
 * //   root: { name: 'root', children: ['src'] },
 * //   src: { name: 'src', children: ['src/index.ts', 'src/utils'] },
 * //   'src/index.ts': { name: 'index.ts' },
 * //   'src/utils': { name: 'utils', children: ['src/utils/helper.ts'] },
 * //   'src/utils/helper.ts': { name: 'helper.ts' },
 * // }
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

  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    let currentPath;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const parentPath = currentPath ?? rootId;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      // Ensure parent has a children set
      if (!folderChildren.has(parentPath)) {
        folderChildren.set(parentPath, new Set());
      }
      folderChildren.get(parentPath)!.add(currentPath);

      // Create file node (no children)
      if (isFile) {
        tree[currentPath] ??= { name: part };
      }
      // Ensure folder has a children set for tracking
      else if (!folderChildren.has(currentPath)) {
        folderChildren.set(currentPath, new Set());
      }
    }
  }

  // Create folder nodes from the children map
  for (const [path, children] of folderChildren) {
    if (path === rootId) {
      tree[rootId] = {
        name: rootName,
        children: Array.from(children),
      };
    } else if (tree[path] === undefined) {
      // This is a folder (intermediate path)
      const name = path.includes('/') ? path.split('/').pop()! : path;
      tree[path] = {
        name,
        children: Array.from(children),
      };
    }
  }

  const result: Record<string, FileTreeNode> = {};
  for (const [key, node] of Object.entries(tree)) {
    if (node !== undefined) {
      result[key] = node;
    }
  }

  return result;
}
