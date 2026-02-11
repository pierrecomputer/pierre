import {
  createTree,
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeDataLoader,
} from '@headless-tree/core';

import { FLATTENED_PREFIX } from '../src/constants';
import { fileTreeSearchFeature } from '../src/features/fileTreeSearchFeature';
import { generateLazyDataLoader } from '../src/loader/lazy';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { FileTreeNode } from '../src/types';
import { expandImplicitParentDirectories } from '../src/utils/expandImplicitParentDirectories';
import {
  buildDirectChildCountMap,
  expandPathsWithAncestors,
  filterOrphanedPaths,
  isOrphanedPathForExpandedSet,
} from '../src/utils/expandPaths';

export interface TestConfig {
  label: string;
  flattenEmptyDirectories: boolean;
  createLoader: (
    files: string[],
    opts: { flattenEmptyDirectories?: boolean }
  ) => TreeDataLoader<FileTreeNode>;
}

export const TEST_CONFIGS: TestConfig[] = [
  {
    label: 'sync + flatten',
    flattenEmptyDirectories: true,
    createLoader: generateSyncDataLoader,
  },
  {
    label: 'sync + no-flatten',
    flattenEmptyDirectories: false,
    createLoader: generateSyncDataLoader,
  },
  {
    label: 'lazy + flatten',
    flattenEmptyDirectories: true,
    createLoader: generateLazyDataLoader,
  },
  {
    label: 'lazy + no-flatten',
    flattenEmptyDirectories: false,
    createLoader: generateLazyDataLoader,
  },
];

/**
 * Strip flattened prefix from a path, matching Root.tsx getSelectionPath.
 */
export const getSelectionPath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

/**
 * Walks a loader's tree (both children.direct AND children.flattened) to
 * build pathToId/idToPath maps using the loader's actual IDs. This is critical
 * because the sync loader uses path-based IDs while the lazy loader uses
 * hashed IDs.
 */
export function buildMapsFromLoader(
  loader: TreeDataLoader<FileTreeNode>,
  rootId: string
): { pathToId: Map<string, string>; idToPath: Map<string, string> } {
  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  const visited = new Set<string>();

  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);

    const node = loader.getItem(id) as FileTreeNode;
    if (node == null) return;

    pathToId.set(node.path, id);
    idToPath.set(id, node.path);

    if (node.children != null) {
      for (const childId of node.children.direct) {
        walk(childId);
      }
      if (node.children.flattened != null) {
        for (const childId of node.children.flattened) {
          walk(childId);
        }
      }
    }
  };

  walk(rootId);
  return { pathToId, idToPath };
}

export interface TestTree {
  pathToId: Map<string, string>;
  idToPath: Map<string, string>;
  tree: ReturnType<typeof createTree<FileTreeNode>>;
  setExpandedItems: (paths: string[]) => void;
  setSelectedItems: (paths: string[]) => void;
  expandItem: (path: string) => void;
  collapseItem: (path: string) => void;
  getExpandedItems: () => string[];
  getSelectedItems: () => string[];
}

/**
 * Unified test tree factory replacing both createFileTree and createMockFileTree.
 * Creates a loader from the config, builds maps via buildMapsFromLoader,
 * maps initial state through expandPathsWithAncestors, creates the headless-tree
 * instance, and provides imperative methods.
 */
export function createTestTree(
  files: string[],
  config: TestConfig,
  opts: {
    defaultExpandedItems?: string[];
    defaultSelectedItems?: string[];
  } = {}
): TestTree {
  const { flattenEmptyDirectories } = config;
  const { defaultExpandedItems, defaultSelectedItems } = opts;

  const dataLoader = config.createLoader(files, { flattenEmptyDirectories });
  const { pathToId, idToPath } = buildMapsFromLoader(dataLoader, 'root');

  const mappedExpandedItems =
    defaultExpandedItems != null
      ? expandPathsWithAncestors(defaultExpandedItems, pathToId, {
          flattenEmptyDirectories,
        })
      : undefined;

  const mappedSelectedItems =
    defaultSelectedItems != null
      ? defaultSelectedItems
          .map((path) => {
            if (path.startsWith(FLATTENED_PREFIX)) {
              return pathToId.get(path);
            }
            return flattenEmptyDirectories
              ? (pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path))
              : pathToId.get(path);
          })
          .filter((id): id is string => id != null)
      : undefined;

  const tree = createTree<FileTreeNode>({
    rootItemId: 'root',
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData()?.children?.direct != null,
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      expandAllFeature,
    ],
    ...(mappedExpandedItems != null || mappedSelectedItems != null
      ? {
          initialState: {
            ...(mappedExpandedItems != null && {
              expandedItems: mappedExpandedItems,
            }),
            ...(mappedSelectedItems != null && {
              selectedItems: mappedSelectedItems,
            }),
          },
        }
      : {}),
  });
  tree.setMounted(true);
  tree.rebuildTree();

  // Mirror FileTree.setExpandedItems
  const setExpandedItems = (paths: string[]) => {
    const desiredExpandedSet = new Set(expandImplicitParentDirectories(paths));
    const childCount = buildDirectChildCountMap(pathToId);

    const currentIds = tree.getState().expandedItems ?? [];
    const currentPaths = [
      ...new Set(
        currentIds
          .map((id) => idToPath.get(id))
          .filter((path): path is string => path != null)
          .map(getSelectionPath)
      ),
    ];
    const hiddenPathsToPreserve = currentPaths.filter((path) => {
      if (desiredExpandedSet.has(path)) return false;
      return isOrphanedPathForExpandedSet(path, desiredExpandedSet, pathToId, {
        flattenEmptyDirectories,
        childCount,
      });
    });

    const ids = expandPathsWithAncestors(paths, pathToId, {
      flattenEmptyDirectories,
    });

    const preserveIds = hiddenPathsToPreserve
      .map((path) => {
        if (path.startsWith(FLATTENED_PREFIX)) {
          return pathToId.get(path);
        }
        return flattenEmptyDirectories
          ? (pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path))
          : pathToId.get(path);
      })
      .filter((id): id is string => id != null);

    if (preserveIds.length === 0) {
      tree.applySubStateUpdate('expandedItems', () => ids);
    } else {
      const next = new Set<string>(ids);
      for (const id of preserveIds) next.add(id);
      tree.applySubStateUpdate('expandedItems', () => Array.from(next));
    }
    tree.scheduleRebuildTree();
    // Force sync rebuild for testing (scheduleRebuildTree is lazy)
    tree.rebuildTree();
  };

  // Mirror FileTree.setSelectedItems
  const setSelectedItems = (paths: string[]) => {
    const ids = paths
      .map((path) => {
        if (path.startsWith(FLATTENED_PREFIX)) {
          return pathToId.get(path);
        }
        return flattenEmptyDirectories
          ? (pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path))
          : pathToId.get(path);
      })
      .filter((id): id is string => id != null);
    tree.applySubStateUpdate('selectedItems', () => ids);
  };

  // Mirror FileTree.expandItem
  const expandItem = (path: string) => {
    const current = getExpandedItems();
    if (!current.includes(path)) {
      setExpandedItems([...current, path]);
    }
  };

  // Mirror FileTree.collapseItem
  const collapseItem = (path: string) => {
    const idsToRemove = new Set<string>();
    const id = pathToId.get(path);
    if (id != null) idsToRemove.add(id);
    const flatId = pathToId.get(FLATTENED_PREFIX + path);
    if (flatId != null) idsToRemove.add(flatId);
    if (idsToRemove.size === 0) return;
    const currentIds = tree.getState().expandedItems ?? [];
    tree.applySubStateUpdate('expandedItems', () =>
      currentIds.filter((i) => !idsToRemove.has(i))
    );
    tree.scheduleRebuildTree();
    tree.rebuildTree();
  };

  // Mirror FileTree.getExpandedItems
  const getExpandedItems = (): string[] => {
    const ids = tree.getState().expandedItems ?? [];
    const paths = ids
      .map((id) => idToPath.get(id))
      .filter((path): path is string => path != null);
    const selectionPaths = paths.map(getSelectionPath);
    return filterOrphanedPaths(
      selectionPaths,
      pathToId,
      flattenEmptyDirectories
    );
  };

  // Mirror FileTree.getSelectedItems
  const getSelectedItems = (): string[] => {
    const ids = tree.getState().selectedItems ?? [];
    return ids
      .map((id) => idToPath.get(id))
      .filter((path): path is string => path != null)
      .map(getSelectionPath);
  };

  return {
    pathToId,
    idToPath,
    tree,
    setExpandedItems,
    setSelectedItems,
    expandItem,
    collapseItem,
    getExpandedItems,
    getSelectedItems,
  };
}
