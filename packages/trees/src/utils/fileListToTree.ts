import { FLATTENED_PREFIX } from '../constants';
import {
  type BenchmarkInstrumentation,
  getBenchmarkInstrumentation,
  setBenchmarkCounter,
  withBenchmarkPhase,
} from '../internal/benchmarkInstrumentation';
import type { FileTreeNode } from '../types';
import { createLoaderUtils, type LoaderUtils } from './createLoaderUtils';
import type { ChildrenSortOption } from './sortChildren';
import { defaultChildrenComparator, sortChildren } from './sortChildren';

export interface FileListToTreeOptions {
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenSortOption;
}

export interface FileListToTreeBuildState {
  /** Map-based tree for fast has/get/set during construction (~37% faster
   *  than plain-object property access for 99K string-keyed entries). */
  tree: Map<string, FileTreeNode>;
  // Children are append-only and written once per unique edge, so arrays are
  // cheaper than Sets while preserving deterministic insertion order.
  folderChildren: Map<string, string[]>;
}

export interface FileListToTreeBuildContext {
  isFolder: (path: string) => boolean;
  sortChildrenArray: (
    children: string[],
    parentPathLength?: number
  ) => string[];
  utils: LoaderUtils;
}

const ROOT_ID = 'root';
const FILE_LIST_TO_TREE_PATH_TO_ID_MAP: unique symbol = Symbol(
  'fileListToTree.pathToIdMap'
);

function createBuildState(rootId: string): FileListToTreeBuildState {
  const folderChildren = new Map<string, string[]>();
  folderChildren.set(rootId, []);
  return {
    tree: new Map(),
    folderChildren,
  };
}

/**
 * Walks every file path segment-by-segment, creating file nodes and tracking
 * parent-to-child folder relationships in a Map of Sets.
 */
export function buildFileListToTreePathGraph(
  filePaths: string[],
  rootId: string,
  instrumentation?: BenchmarkInstrumentation
): FileListToTreeBuildState {
  const state = createBuildState(rootId);
  const { tree, folderChildren } = state;
  const rootChildren = folderChildren.get(rootId)!;
  let segmentCount = 0;

  // Track the previous path's folder-depth stack so consecutive paths that
  // share a directory prefix can skip re-scanning those segments. For each
  // depth d, parentStack[d] holds the children Set and pathStack[d] holds
  // the folder path string at that depth (reused to avoid re-slicing).
  const parentStack: Array<string[]> = [rootChildren];
  const pathStack: string[] = [rootId];
  let prevPath = '';
  let prevDepth = 0;
  let reusedPrefixHitCount = 0;
  let reusedPrefixSegments = 0;
  let maxReusedPrefixDepth = 0;
  let createdFileNodeCount = 0;

  for (const path of filePaths) {
    if (path.length === 0) continue;
    const isDirectory = path.charCodeAt(path.length - 1) === 47;

    // Single-pass prefix comparison that simultaneously compares characters,
    // counts segment boundaries (slashes), detects double slashes, and tracks
    // the position of the last complete segment boundary. This replaces three
    // separate loops (compare, back-up, count) with one unified scan.
    let commonPrefixLen = 0;
    let reuseDepth = 0;
    if (prevPath.length > 0) {
      const scanLimit = Math.min(path.length, prevPath.length);
      let lastSlashPos = 0;
      let prevCharWasSlash = false;
      let ci = 0;

      while (ci < scanLimit) {
        const c = path.charCodeAt(ci);
        if (c !== prevPath.charCodeAt(ci)) break;
        ci++;
        if (c === 47) {
          if (prevCharWasSlash) {
            // Double slash: reuse is unsafe.
            reuseDepth = 0;
            lastSlashPos = 0;
            break;
          }
          reuseDepth++;
          lastSlashPos = ci; // position right after the '/'
          prevCharWasSlash = true;
        } else {
          prevCharWasSlash = false;
        }
      }

      commonPrefixLen = lastSlashPos; // snap to segment boundary
      if (reuseDepth > prevDepth) {
        reuseDepth = 0;
        commonPrefixLen = 0;
      }
    }

    // Either resume from the deepest shared folder or start from root.
    let segmentStart: number;
    let parentChildren: string[];
    let currentPath: string | undefined;
    let currentDepth: number;
    let hasEmptySegment = false;

    if (reuseDepth > 0) {
      reusedPrefixHitCount += 1;
      reusedPrefixSegments += reuseDepth;
      if (reuseDepth > maxReusedPrefixDepth) {
        maxReusedPrefixDepth = reuseDepth;
      }
      segmentStart = commonPrefixLen;
      parentChildren = parentStack[reuseDepth];
      currentPath = pathStack[reuseDepth]; // reuse stored path (no allocation)
      currentDepth = reuseDepth;
    } else {
      segmentStart = 0;
      parentChildren = rootChildren;
      currentPath = undefined;
      currentDepth = 0;
    }

    while (segmentStart < path.length) {
      const nextSlashIndex = path.indexOf('/', segmentStart);
      const segmentEnd = nextSlashIndex === -1 ? path.length : nextSlashIndex;

      if (segmentEnd === segmentStart) {
        hasEmptySegment = true;
        if (nextSlashIndex === -1) {
          break;
        }
        segmentStart = nextSlashIndex + 1;
        continue;
      }

      segmentCount += 1;

      const isFile = !isDirectory && nextSlashIndex === -1;

      // For normalized paths (no empty segments), extract currentPath as a
      // prefix slice of the original string instead of concatenating
      // `${currentPath}/${part}`. This avoids creating an intermediate segment
      // string and a new concatenated string on every folder level.
      if (hasEmptySegment) {
        const part = path.slice(segmentStart, segmentEnd);
        currentPath = currentPath != null ? `${currentPath}/${part}` : part;
      } else {
        currentPath = path.slice(0, segmentEnd);
      }

      if (isFile) {
        if (!tree.has(currentPath)) {
          parentChildren.push(currentPath);
          const node: FileTreeNode = {
            name: path.slice(segmentStart, segmentEnd),
            path: currentPath,
          };
          tree.set(currentPath, node);
          createdFileNodeCount += 1;
        }
      } else {
        let nextParentChildren = folderChildren.get(currentPath);
        if (nextParentChildren == null) {
          parentChildren.push(currentPath);
          nextParentChildren = [];
          folderChildren.set(currentPath, nextParentChildren);
        }
        currentDepth++;
        parentStack[currentDepth] = nextParentChildren;
        pathStack[currentDepth] = currentPath;
        parentChildren = nextParentChildren;
      }

      if (nextSlashIndex === -1) {
        break;
      }
      segmentStart = nextSlashIndex + 1;
    }

    prevPath = path;
    prevDepth = currentDepth;
  }

  const totalInputSegments = segmentCount + reusedPrefixSegments;
  setBenchmarkCounter(instrumentation, 'workload.inputFiles', filePaths.length);
  setBenchmarkCounter(
    instrumentation,
    'workload.inputPathSegments',
    totalInputSegments
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphProcessedSegments',
    segmentCount
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphReusedPrefixSegments',
    reusedPrefixSegments
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphReuseHitCount',
    reusedPrefixHitCount
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphMaxReusedPrefixDepth',
    maxReusedPrefixDepth
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphFolders',
    folderChildren.size
  );
  setBenchmarkCounter(instrumentation, 'workload.pathGraphEntries', tree.size);
  setBenchmarkCounter(
    instrumentation,
    'workload.pathGraphCreatedFileNodes',
    createdFileNodeCount
  );
  return state;
}

export function createFileListToTreeBuildContext(
  folderChildren: Map<string, string[]>,
  sortComparator: ChildrenSortOption
): FileListToTreeBuildContext {
  const isFolder = folderChildren.has.bind(folderChildren) as (
    path: string
  ) => boolean;
  const sortChildrenArray = (
    children: string[],
    parentPathLength?: number
  ): string[] =>
    sortComparator === false
      ? children.slice()
      : sortChildren(children, isFolder, sortComparator, parentPathLength);
  const childrenArrayCache = new Map<string, string[]>();
  const getChildrenArray = (path: string): string[] => {
    const cached = childrenArrayCache.get(path);
    if (cached != null) {
      return cached;
    }

    const children = folderChildren.get(path);
    const childArray = children != null ? children.slice() : [];
    childrenArrayCache.set(path, childArray);
    return childArray;
  };

  return {
    isFolder,
    sortChildrenArray,
    utils: createLoaderUtils(isFolder, getChildrenArray),
  };
}

/**
 * Identifies single-child folder chains and creates flattened nodes that
 * collapse them into one entry (e.g. "src/utils" instead of "src" > "utils").
 * Returns the set of intermediate folders consumed by flattening so
 * buildFolderNodes can skip them.
 */
export function buildFileListToTreeFlattenedNodes(
  state: FileListToTreeBuildState,
  context: FileListToTreeBuildContext,
  instrumentation?: BenchmarkInstrumentation
): Set<string> {
  const intermediateFolders = new Set<string>();
  const { tree, folderChildren } = state;
  const { isFolder, sortChildrenArray, utils } = context;
  let flattenedNodeCount = 0;

  for (const children of folderChildren.values()) {
    for (const child of children) {
      if (!isFolder(child)) continue;

      const flattenedEndpoint = utils.getFlattenedEndpoint(child);
      if (flattenedEndpoint == null) continue;

      const flattenedFolders = utils.collectFlattenedFolders(
        child,
        flattenedEndpoint
      );
      for (let index = 0; index < flattenedFolders.length - 1; index++) {
        intermediateFolders.add(flattenedFolders[index]);
      }

      const flattenedKey = `${FLATTENED_PREFIX}${flattenedEndpoint}`;
      if (tree.has(flattenedKey)) continue;

      const flattenedName = utils.buildFlattenedName(child, flattenedEndpoint);
      const endpointChildren = folderChildren.get(flattenedEndpoint);
      const endpointDirectChildren =
        endpointChildren != null
          ? sortChildrenArray(endpointChildren, flattenedEndpoint.length)
          : [];
      const endpointFlattenedChildren = utils.buildFlattenedChildren(
        endpointDirectChildren
      );

      const flatNode: FileTreeNode = {
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
      tree.set(flattenedKey, flatNode);
      flattenedNodeCount += 1;
    }
  }

  setBenchmarkCounter(
    instrumentation,
    'workload.flattenedNodes',
    flattenedNodeCount
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.intermediateFlattenedFolders',
    intermediateFolders.size
  );
  return intermediateFolders;
}

/**
 * Creates a FileTreeNode for every folder (including root), attaching sorted
 * direct children and optional flattened children. Intermediate folders that
 * were absorbed into a flattened node get their flattened children omitted.
 */
export function buildFileListToTreeFolderNodes(
  state: FileListToTreeBuildState,
  context: FileListToTreeBuildContext,
  rootId: string,
  rootName: string,
  intermediateFolders: Set<string>,
  instrumentation?: BenchmarkInstrumentation
): void {
  const { tree, folderChildren } = state;
  const { sortChildrenArray, utils } = context;

  for (const [path, children] of folderChildren) {
    // Pass parent path length for fast name extraction. Root children don't
    // have a "root/" prefix, so skip the hint for the root folder.
    const parentLen = path === rootId ? undefined : path.length;
    const directChildren = sortChildrenArray(children, parentLen);
    const flattenedChildren = intermediateFolders.has(path)
      ? undefined
      : utils.buildFlattenedChildren(directChildren);

    let name: string;
    if (path === rootId) {
      name = rootName;
    } else {
      const lastSlashIndex = path.lastIndexOf('/');
      name = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
    }

    const folderNode: FileTreeNode = {
      name,
      path,
      children: {
        direct: directChildren,
        ...(flattenedChildren != null && { flattened: flattenedChildren }),
      },
    };
    tree.set(path, folderNode);
  }

  setBenchmarkCounter(
    instrumentation,
    'workload.folderNodes',
    folderChildren.size
  );
}

/**
 * Finalizes the built tree object and attaches a precomputed path->id lookup
 * map that Root can consume directly.
 */
export function hashFileListToTreeKeys(
  tree: Map<string, FileTreeNode>,
  instrumentation?: BenchmarkInstrumentation
): Record<string, FileTreeNode> {
  const hashedTree: FileListToTreeWithPathToIdMap = Object.create(null);
  const pathToId = new Map<string, string>();

  // Use path IDs directly (including f:: flattened paths) so we avoid a full
  // hash+remap pass before the initial render.
  for (const [key, node] of tree) {
    hashedTree[key] = node;
    pathToId.set(node.path, key);
  }

  setBenchmarkCounter(instrumentation, 'workload.treeNodes', tree.size);
  setBenchmarkCounter(instrumentation, 'workload.hashKeysResolveIdCalls', 0);
  setBenchmarkCounter(
    instrumentation,
    'workload.hashKeysResolveIdCacheHits',
    0
  );
  setBenchmarkCounter(instrumentation, 'workload.hashKeysDirectChildRemaps', 0);
  setBenchmarkCounter(
    instrumentation,
    'workload.hashKeysFlattenedChildRemaps',
    0
  );
  setBenchmarkCounter(instrumentation, 'workload.hashKeysFlattenPathRemaps', 0);

  // Attach the lookup map as hidden metadata so Root can reuse it without
  // rescanning the full tree object in a second O(n) pass.
  Object.defineProperty(hashedTree, FILE_LIST_TO_TREE_PATH_TO_ID_MAP, {
    configurable: false,
    enumerable: false,
    value: pathToId,
    writable: false,
  });

  return hashedTree;
}

type FileListToTreeWithPathToIdMap = Record<string, FileTreeNode> & {
  [FILE_LIST_TO_TREE_PATH_TO_ID_MAP]?: Map<string, string>;
};

/**
 * Returns the precomputed path->id lookup map that hashFileListToTreeKeys
 * attaches to the tree object for Root's hot path. Falls back to null when the
 * input tree came from an older builder that does not attach this metadata.
 */
export function getFileListToTreePathToIdMap(
  tree: Record<string, FileTreeNode>
): Map<string, string> | null {
  const map = (tree as FileListToTreeWithPathToIdMap)[
    FILE_LIST_TO_TREE_PATH_TO_ID_MAP
  ];
  return map instanceof Map ? map : null;
}

function fileListToTreeInternal(
  filePaths: string[],
  options: FileListToTreeOptions
): Record<string, FileTreeNode> {
  const {
    rootId = ROOT_ID,
    rootName = ROOT_ID,
    sortComparator = defaultChildrenComparator,
  } = options;
  const instrumentation = getBenchmarkInstrumentation(options) ?? undefined;

  const state = withBenchmarkPhase(
    instrumentation,
    'fileListToTree.pathGraph',
    () => buildFileListToTreePathGraph(filePaths, rootId, instrumentation)
  );
  const context = createFileListToTreeBuildContext(
    state.folderChildren,
    sortComparator
  );
  const intermediateFolders = withBenchmarkPhase(
    instrumentation,
    'fileListToTree.flattenedNodes',
    () => buildFileListToTreeFlattenedNodes(state, context, instrumentation)
  );

  withBenchmarkPhase(instrumentation, 'fileListToTree.folderNodes', () =>
    buildFileListToTreeFolderNodes(
      state,
      context,
      rootId,
      rootName,
      intermediateFolders,
      instrumentation
    )
  );

  return withBenchmarkPhase(instrumentation, 'fileListToTree.hashKeys', () =>
    hashFileListToTreeKeys(state.tree, instrumentation)
  );
}

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
  return fileListToTreeInternal(filePaths, options);
}
