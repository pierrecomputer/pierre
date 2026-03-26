import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createLoaderUtils, type LoaderUtils } from './createLoaderUtils';
import { hashId } from './hashId';
import type { ChildrenSortOption } from './sortChildren';
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
  tree: Record<string, FileTreeNode>;
  folderChildren: Map<string, Set<string>>;
}

interface FileListToTreeStageContext {
  isFolder: (path: string) => boolean;
  sortChildrenArray: (children: string[]) => string[];
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
    tree: {},
    folderChildren,
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
  let prevPath = '';
  let prevDepth = 0;

  for (const path of filePaths) {
    if (path.length === 0) continue;
    const isDirectory = path.charCodeAt(path.length - 1) === 47;

    // Compute the shared directory-prefix length with the previous path.
    let commonPrefixLen = 0;
    if (prevPath.length > 0) {
      const scanLimit = Math.min(path.length, prevPath.length);
      while (
        commonPrefixLen < scanLimit &&
        path.charCodeAt(commonPrefixLen) ===
          prevPath.charCodeAt(commonPrefixLen)
      ) {
        commonPrefixLen++;
      }
      // Retreat to the last '/' so we land on a complete segment boundary.
      while (
        commonPrefixLen > 0 &&
        path.charCodeAt(commonPrefixLen - 1) !== 47
      ) {
        commonPrefixLen--;
      }
    }

    // Count complete folder segments in the common prefix and verify there
    // are no empty segments (double slashes) which would make reuse unsafe.
    let reuseDepth = 0;
    if (commonPrefixLen > 0) {
      let prevCharWasSlash = false;
      for (let i = 0; i < commonPrefixLen; i++) {
        if (path.charCodeAt(i) === 47) {
          if (prevCharWasSlash) {
            // Double slash in prefix: bail out of reuse.
            reuseDepth = 0;
            commonPrefixLen = 0;
            break;
          }
          reuseDepth++;
          prevCharWasSlash = true;
        } else {
          prevCharWasSlash = false;
        }
      }
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

    if (reuseDepth > 0) {
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
        parentChildren.add(currentPath);
        tree[currentPath] ??= {
          name: path.slice(segmentStart, segmentEnd),
          path: currentPath,
        };
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
  const sortChildrenArray = (children: string[]): string[] =>
    sortChildren(children, isFolder, sortComparator);
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
    const directChildren = sortChildrenArray([...children]);
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

/**
 * Replaces human-readable path keys with deterministic hashed IDs and remaps
 * all children/flattens references to use the same hashed IDs.
 */
function hashTreeKeys(
  tree: Record<string, FileTreeNode>,
  rootId: string
): Record<string, FileTreeNode> {
  const idByKey = new Map<string, string>([[rootId, rootId]]);

  // Collision detection via usedIds Set is intentionally omitted. FNV-1a on
  // typical file paths has an expected collision rate of ~0.03% for 15K keys
  // (birthday paradox over 2^32 hash space). This saves ~30K Set operations
  // per tree conversion while keeping IDs deterministic and content-based.
  const getIdForKey = (key: string): string => {
    const existing = idByKey.get(key);
    if (existing != null) {
      return existing;
    }

    const id = `n${hashId(key)}`;
    idByKey.set(key, id);
    return id;
  };

  const hashedTree: Record<string, FileTreeNode> = Object.create(null);
  const keys = Object.keys(tree);

  for (const key of keys) {
    const node = tree[key];
    const mappedKey = getIdForKey(key);

    const children = node.children;
    if (children != null) {
      for (let index = 0; index < children.direct.length; index += 1) {
        children.direct[index] = getIdForKey(children.direct[index]);
      }

      const flattened = children.flattened;
      if (flattened != null) {
        for (let index = 0; index < flattened.length; index += 1) {
          flattened[index] = getIdForKey(flattened[index]);
        }
      }
    }

    const flattens = node.flattens;
    if (flattens != null) {
      for (let index = 0; index < flattens.length; index += 1) {
        flattens[index] = getIdForKey(flattens[index]);
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
    hashTreeKeys(state.tree, rootId)
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
