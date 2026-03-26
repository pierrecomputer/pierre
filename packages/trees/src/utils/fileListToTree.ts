import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createLoaderUtils, type LoaderUtils } from './createLoaderUtils';
import type { ChildrenSortOption } from './sortChildren';

// FNV-1a hash inlined here (not imported from ./hashId) so the JIT compiler
// can inline it into getIdForKey without cross-module barriers.
const hashId = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};
import { defaultChildrenComparator, sortChildren } from './sortChildren';

export interface FileListToTreeOptions {
  rootId?: string;
  rootName?: string;
  sortComparator?: ChildrenSortOption;
}

export type FileListToTreeStageName =
  | 'buildPathGraph'
  | 'buildFlattenedNodes'
  | 'buildFolderNodes'
  | 'hashTreeKeys';

type FileListToTreeStageTimings = Record<FileListToTreeStageName, number>;

interface FileListToTreeBenchmarkResult {
  tree: Record<string, FileTreeNode>;
  stageTimingsMs: FileListToTreeStageTimings;
}

interface FileListToTreeBuildState {
  /** Map-based tree for fast has/get/set during construction (~37% faster
   *  than plain-object property access for 99K string-keyed entries). */
  tree: Map<string, FileTreeNode>;
  folderChildren: Map<string, Set<string>>;
  /** Ordered list of [key, node] pairs in insertion order, enabling
   *  hashTreeKeys to iterate without Object.keys + tree[key] lookups. */
  treeEntries: Array<[string, FileTreeNode]>;
}

interface FileListToTreeStageContext {
  isFolder: (path: string) => boolean;
  sortChildrenArray: (
    children: string[],
    parentPathLength?: number
  ) => string[];
  utils: LoaderUtils;
}

type FileListToTreeStageRecorder = (
  stage: FileListToTreeStageName,
  elapsedMs: number
) => void;

const ROOT_ID = 'root';

function createStageTimings(): FileListToTreeStageTimings {
  return {
    buildPathGraph: 0,
    buildFlattenedNodes: 0,
    buildFolderNodes: 0,
    hashTreeKeys: 0,
  };
}

function timeStage<T>(
  stage: FileListToTreeStageName,
  recorder: FileListToTreeStageRecorder | undefined,
  run: () => T
): T {
  if (recorder == null) {
    return run();
  }

  const startTime = performance.now();
  const result = run();
  recorder(stage, performance.now() - startTime);
  return result;
}

function createBuildState(rootId: string): FileListToTreeBuildState {
  const folderChildren = new Map<string, Set<string>>();
  folderChildren.set(rootId, new Set());
  return {
    tree: new Map(),
    folderChildren,
    treeEntries: [],
  };
}

/**
 * Walks every file path segment-by-segment, creating file nodes and tracking
 * parent-to-child folder relationships in a Map of Sets.
 */
function buildPathGraph(
  filePaths: string[],
  rootId: string
): FileListToTreeBuildState {
  const state = createBuildState(rootId);
  const { tree, folderChildren } = state;
  const rootChildren = folderChildren.get(rootId)!;

  // Track the previous path's folder-depth stack so consecutive paths that
  // share a directory prefix can skip re-scanning those segments. For each
  // depth d, parentStack[d] holds the children Set and pathStack[d] holds
  // the folder path string at that depth (reused to avoid re-slicing).
  const parentStack: Array<Set<string>> = [rootChildren];
  const pathStack: string[] = [rootId];
  // Incremental FNV-1a hash state at each folder depth. Allows extending the
  // hash with only the divergent suffix characters instead of rehashing the
  // full path in hashTreeKeys. The final hashed ID string is stored on each
  // node via the NODE_ID symbol during construction.
  const hashStack: number[] = [0];
  let prevPath = '';
  let prevDepth = 0;

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
    let parentChildren: Set<string>;
    let currentPath: string | undefined;
    let currentDepth: number;
    let hasEmptySegment = false;

    let hashValue: number;
    // Whether the next real segment needs a '/' separator in the hash.
    // True when resuming from a prefix (separator between prefix and suffix);
    // false at the start of a fresh path (first segment has no separator).
    let hashNeedsSep: boolean;

    if (reuseDepth > 0) {
      segmentStart = commonPrefixLen;
      parentChildren = parentStack[reuseDepth];
      currentPath = pathStack[reuseDepth]; // reuse stored path (no allocation)
      currentDepth = reuseDepth;
      hashValue = hashStack[reuseDepth]; // reuse stored hash state
      hashNeedsSep = true;
    } else {
      segmentStart = 0;
      parentChildren = rootChildren;
      currentPath = undefined;
      currentDepth = 0;
      hashValue = 0x811c9dc5; // FNV-1a offset basis
      hashNeedsSep = false;
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

      // Extend the running FNV-1a hash with '/' separator + segment characters.
      // This produces the same value as hashId(currentPath) but avoids
      // reprocessing the entire prefix for each deeper level.
      if (hashNeedsSep) {
        hashValue ^= 47; // '/'
        hashValue = Math.imul(hashValue, 0x01000193);
      }
      hashNeedsSep = true;
      for (let hi = segmentStart; hi < segmentEnd; hi++) {
        hashValue ^= path.charCodeAt(hi);
        hashValue = Math.imul(hashValue, 0x01000193);
      }

      if (isFile) {
        parentChildren.add(currentPath);
        if (!tree.has(currentPath)) {
          const node: FileTreeNode = {
            name: path.slice(segmentStart, segmentEnd),
            path: currentPath,
          };
          (node as Record<symbol, string>)[NODE_ID] =
            `n${(hashValue >>> 0).toString(36)}`;
          tree.set(currentPath, node);
          state.treeEntries.push([currentPath, node]);
        }
      } else {
        let nextParentChildren = folderChildren.get(currentPath);
        if (nextParentChildren == null) {
          parentChildren.add(currentPath);
          nextParentChildren = new Set<string>();
          folderChildren.set(currentPath, nextParentChildren);
        }
        currentDepth++;
        parentStack[currentDepth] = nextParentChildren;
        pathStack[currentDepth] = currentPath;
        hashStack[currentDepth] = hashValue;
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

  return state;
}

function createStageContext(
  folderChildren: Map<string, Set<string>>,
  sortComparator: ChildrenSortOption
): FileListToTreeStageContext {
  const isFolder = (path: string): boolean => folderChildren.has(path);
  const sortChildrenArray = (
    children: string[],
    parentPathLength?: number
  ): string[] =>
    sortChildren(children, isFolder, sortComparator, parentPathLength);
  const childrenArrayCache = new Map<string, string[]>();
  const getChildrenArray = (path: string): string[] => {
    const cached = childrenArrayCache.get(path);
    if (cached != null) {
      return cached;
    }

    const children = folderChildren.get(path);
    const childArray = children != null ? [...children] : [];
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
function buildFlattenedNodes(
  state: FileListToTreeBuildState,
  context: FileListToTreeStageContext
): Set<string> {
  const intermediateFolders = new Set<string>();
  const { tree, folderChildren } = state;
  const { isFolder, sortChildrenArray, utils } = context;

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
          ? sortChildrenArray([...endpointChildren], flattenedEndpoint.length)
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
      state.treeEntries.push([flattenedKey, flatNode]);
    }
  }

  return intermediateFolders;
}

/**
 * Creates a FileTreeNode for every folder (including root), attaching sorted
 * direct children and optional flattened children. Intermediate folders that
 * were absorbed into a flattened node get their flattened children omitted.
 */
function buildFolderNodes(
  state: FileListToTreeBuildState,
  context: FileListToTreeStageContext,
  rootId: string,
  rootName: string,
  intermediateFolders: Set<string>
): void {
  const { tree, folderChildren } = state;
  const { sortChildrenArray, utils } = context;

  for (const [path, children] of folderChildren) {
    // Pass parent path length for fast name extraction. Root children don't
    // have a "root/" prefix, so skip the hint for the root folder.
    const parentLen = path === rootId ? undefined : path.length;
    const directChildren = sortChildrenArray([...children], parentLen);
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
    state.treeEntries.push([path, folderNode]);
  }
}

/**
 * Replaces human-readable path keys with deterministic hashed IDs and remaps
 * all children/flattens references to use the same hashed IDs.
 */
// Symbol used to cache hashed IDs directly on tree nodes. Symbol properties
// are invisible to Object.keys / Object.entries / JSON.stringify, so they
// don't leak into the public output while giving O(1) identity-based access
// that's faster than a string-keyed Map lookup.
const NODE_ID: unique symbol = Symbol('id');

function hashTreeKeys(
  tree: Map<string, FileTreeNode>,
  treeEntries: Array<[string, FileTreeNode]>,
  rootId: string
): Record<string, FileTreeNode> {
  // Resolve a path key to its hashed ID via the target node's cached
  // NODE_ID symbol. For child/flattens references where we only have a key.
  const resolveId = (key: string): string => {
    const node = tree.get(key)!;
    const cached = (node as Record<symbol, string>)[NODE_ID];
    if (cached != null) return cached;

    const id = key === rootId ? rootId : `n${hashId(key)}`;
    (node as Record<symbol, string>)[NODE_ID] = id;
    return id;
  };

  const hashedTree: Record<string, FileTreeNode> = Object.create(null);

  // Iterate the pre-built entries array instead of Object.keys(tree) +
  // tree[key] lookups. This avoids one ~99K array allocation and ~99K
  // redundant hash-table property accesses.
  for (let ei = 0; ei < treeEntries.length; ei++) {
    const entry = treeEntries[ei];
    const key = entry[0];
    const node = entry[1];

    // Read cached ID (pre-computed for files, compute for folders/flattened).
    let mappedKey = (node as Record<symbol, string>)[NODE_ID];
    if (mappedKey == null) {
      mappedKey = key === rootId ? rootId : `n${hashId(key)}`;
      (node as Record<symbol, string>)[NODE_ID] = mappedKey;
    }

    const children = node.children;
    if (children != null) {
      for (let index = 0; index < children.direct.length; index += 1) {
        children.direct[index] = resolveId(children.direct[index]);
      }

      const flattened = children.flattened;
      if (flattened != null) {
        for (let index = 0; index < flattened.length; index += 1) {
          flattened[index] = resolveId(flattened[index]);
        }
      }
    }

    const flattens = node.flattens;
    if (flattens != null) {
      for (let index = 0; index < flattens.length; index += 1) {
        flattens[index] = resolveId(flattens[index]);
      }
    }

    hashedTree[mappedKey] = node;
  }

  return hashedTree;
}

function fileListToTreeInternal(
  filePaths: string[],
  options: FileListToTreeOptions,
  recorder?: FileListToTreeStageRecorder
): Record<string, FileTreeNode> {
  const {
    rootId = ROOT_ID,
    rootName = ROOT_ID,
    sortComparator = defaultChildrenComparator,
  } = options;

  const state = timeStage('buildPathGraph', recorder, () =>
    buildPathGraph(filePaths, rootId)
  );
  const context = createStageContext(state.folderChildren, sortComparator);
  const intermediateFolders = timeStage('buildFlattenedNodes', recorder, () =>
    buildFlattenedNodes(state, context)
  );

  timeStage('buildFolderNodes', recorder, () => {
    buildFolderNodes(state, context, rootId, rootName, intermediateFolders);
  });

  return timeStage('hashTreeKeys', recorder, () =>
    hashTreeKeys(state.tree, state.treeEntries, rootId)
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

/**
 * Runs fileListToTree and captures stage timings for the benchmark CLI.
 * This is intentionally kept off the package public surface by remaining an
 * internal module export rather than a root export.
 */
export function benchmarkFileListToTreeStages(
  filePaths: string[],
  options: FileListToTreeOptions = {}
): FileListToTreeBenchmarkResult {
  const stageTimingsMs = createStageTimings();
  const tree = fileListToTreeInternal(
    filePaths,
    options,
    (stage, elapsedMs) => {
      stageTimingsMs[stage] = elapsedMs;
    }
  );

  return {
    tree,
    stageTimingsMs,
  };
}
