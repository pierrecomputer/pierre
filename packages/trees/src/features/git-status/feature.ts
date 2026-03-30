import { FLATTENED_PREFIX } from '../../constants';
import type {
  FeatureImplementation,
  TreeConfig,
  TreeInstance,
} from '../../core/types/core';
import type { FileTreeNode, GitStatus, GitStatusEntry } from '../../types';
import { getGitStatusSignature } from '../../utils/getGitStatusSignature';
import type { GitStatusConfig } from './types';

export type { GitStatusEntry } from '../../types';

type GitStatusCache = {
  gitStatusSignature: string;
  gitStatusPathToId?: Map<string, string>;
  dataLoader: TreeConfig<FileTreeNode>['dataLoader'];
  statusById: Map<string, GitStatus>;
  foldersWithChanges: Set<string>;
};

type GitStatusDataRef = {
  gitStatusCache?: GitStatusCache;
};

const normalizeGitPath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

const getParentPath = (path: string): string | null => {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return null;
  return path.slice(0, slash);
};

const addFolderIdsByPath = (
  pathToId: Map<string, string>,
  path: string,
  foldersWithChanges: Set<string>
) => {
  const regularId = pathToId.get(path);
  if (regularId != null) {
    foldersWithChanges.add(regularId);
  }
  const flattenedId = pathToId.get(`${FLATTENED_PREFIX}${path}`);
  if (flattenedId != null) {
    foldersWithChanges.add(flattenedId);
  }
};

const buildPathToIdMapFromTree = (
  tree: TreeInstance<FileTreeNode>
): Map<string, string> => {
  const pathToId = new Map<string, string>();
  const rootItemId = tree.getConfig().rootItemId;

  const rootItem = tree.getItemInstance(rootItemId);
  const rootPath = rootItem.getItemData()?.path;
  if (rootPath != null) {
    pathToId.set(rootPath, rootItemId);
  }

  const walk = (parentId: string) => {
    const children = tree.retrieveChildrenIds(parentId) ?? [];
    for (const childId of children) {
      const item = tree.getItemInstance(childId);
      const childPath = item.getItemData()?.path;
      if (childPath != null) {
        pathToId.set(childPath, childId);
      }
      walk(childId);
    }
  };

  walk(rootItemId);
  return pathToId;
};

const buildGitStatusCache = (
  tree: TreeInstance<FileTreeNode>,
  gitStatus: GitStatusEntry[],
  gitStatusSignature: string,
  gitStatusPathToId: Map<string, string> | undefined
): GitStatusCache => {
  const config = tree.getConfig();
  const pathToId = gitStatusPathToId ?? buildPathToIdMapFromTree(tree);

  // Build statusById and foldersWithChanges directly from status paths.
  const foldersWithChanges = new Set<string>();
  const statusById = new Map<string, GitStatus>();

  for (const entry of gitStatus) {
    const normalizedPath = normalizeGitPath(entry.path);

    const idCandidates = [
      pathToId.get(entry.path),
      pathToId.get(normalizedPath),
      pathToId.get(`${FLATTENED_PREFIX}${normalizedPath}`),
    ];
    for (const id of idCandidates) {
      if (id != null) {
        statusById.set(id, entry.status);
      }
    }

    let ancestorPath = getParentPath(normalizedPath);
    while (ancestorPath != null) {
      addFolderIdsByPath(pathToId, ancestorPath, foldersWithChanges);
      ancestorPath = getParentPath(ancestorPath);
    }
  }

  return {
    gitStatusSignature,
    gitStatusPathToId,
    dataLoader: config.dataLoader,
    statusById,
    foldersWithChanges,
  };
};

const getGitStatusCache = (
  tree: TreeInstance<FileTreeNode>
): GitStatusCache | null => {
  const config = tree.getConfig() as GitStatusConfig;
  const gitStatus = config.gitStatus;
  if (gitStatus == null || gitStatus.length === 0) return null;
  const gitStatusPathToId = config.gitStatusPathToId;
  const gitStatusSignature =
    config.gitStatusSignature ?? getGitStatusSignature(gitStatus);

  const dataRef = tree.getDataRef<GitStatusDataRef>();
  const cached = dataRef.current.gitStatusCache;

  if (
    cached != null &&
    cached.gitStatusSignature === gitStatusSignature &&
    cached.dataLoader === tree.getConfig().dataLoader &&
    cached.gitStatusPathToId === gitStatusPathToId
  ) {
    return cached;
  }

  const cache = buildGitStatusCache(
    tree,
    gitStatus,
    gitStatusSignature,
    gitStatusPathToId
  );
  dataRef.current.gitStatusCache = cache;
  return cache;
};

/**
 * Returns the gitStatus statusById map for use in rendering (Root.tsx).
 */
export const getGitStatusMap = (
  tree: TreeInstance<FileTreeNode>
): {
  statusById: Map<string, GitStatus>;
  foldersWithChanges: Set<string>;
} | null => {
  return getGitStatusCache(tree);
};

export const gitStatusFeature: FeatureImplementation = {
  key: 'git-status',

  itemInstance: {
    getGitStatus: ({ tree, item }) => {
      const cache = getGitStatusCache(
        tree as unknown as TreeInstance<FileTreeNode>
      );
      if (cache == null) return null;
      return cache.statusById.get(item.getId()) ?? null;
    },
    containsGitChange: ({ tree, item }) => {
      const cache = getGitStatusCache(
        tree as unknown as TreeInstance<FileTreeNode>
      );
      if (cache == null) return false;
      return cache.foldersWithChanges.has(item.getId());
    },
  },
};

declare module '../../core/types/core' {
  // oxlint-disable-next-line @typescript-oxlint/no-unused-vars
  interface ItemInstance<T> {
    getGitStatus(): GitStatus | null;
    containsGitChange(): boolean;
  }
}
