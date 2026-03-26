import { FLATTENED_PREFIX } from '../constants';
import type { FileTreeNode } from '../types';
import { createIdMaps } from './createIdMaps';
import { createLoaderUtils, type LoaderUtils } from './createLoaderUtils';
import { normalizeInputPath } from './normalizeInputPath';
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

  for (const filePath of filePaths) {
    const normalizedPath = normalizeInputPath(filePath);
    if (normalizedPath == null) continue;

    const { isDirectory, path } = normalizedPath;
    let currentPath: string | undefined;
    let segmentStart = 0;

    while (segmentStart < path.length) {
      const nextSlashIndex = path.indexOf('/', segmentStart);
      const segmentEnd = nextSlashIndex === -1 ? path.length : nextSlashIndex;
      const part = path.slice(segmentStart, segmentEnd);
      const isFile = !isDirectory && nextSlashIndex === -1;
      const parentPath = currentPath ?? rootId;
      currentPath = currentPath != null ? `${currentPath}/${part}` : part;

      let parentChildren = folderChildren.get(parentPath);
      if (parentChildren == null) {
        parentChildren = new Set();
        folderChildren.set(parentPath, parentChildren);
      }
      parentChildren.add(currentPath);

      if (isFile) {
        tree[currentPath] ??= { name: part, path: currentPath };
      } else if (!folderChildren.has(currentPath)) {
        folderChildren.set(currentPath, new Set());
      }

      if (nextSlashIndex === -1) {
        break;
      }
      segmentStart = nextSlashIndex + 1;
    }
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
  const getChildrenArray = (path: string): string[] => {
    const children = folderChildren.get(path);
    return children != null ? [...children] : [];
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
 * all children/flattens references to use the same hashed IDs. Keys are sorted
 * before hashing so collision resolution stays stable across runtimes.
 */
function hashTreeKeys(
  tree: Record<string, FileTreeNode>,
  rootId: string
): Record<string, FileTreeNode> {
  const { getIdForKey } = createIdMaps(rootId);
  const mapKey = (key: string) => getIdForKey(key);
  const hashedTree: Record<string, FileTreeNode> = {};
  const keys = Object.keys(tree).sort();

  for (const key of keys) {
    const node = tree[key];
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
