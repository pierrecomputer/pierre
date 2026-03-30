import type { FileTreeNode } from '../../src/types';
import {
  buildFileListToTreeFlattenedNodes,
  buildFileListToTreeFolderNodes,
  buildFileListToTreePathGraph,
  createFileListToTreeBuildContext,
  type FileListToTreeOptions,
  hashFileListToTreeKeys,
} from '../../src/utils/fileListToTree';
import { defaultChildrenComparator } from '../../src/utils/sortChildren';

export const FILE_LIST_TO_TREE_STAGE_ORDER = [
  'buildPathGraph',
  'buildFlattenedNodes',
  'buildFolderNodes',
  'hashTreeKeys',
] as const;

export type FileListToTreeStageName =
  (typeof FILE_LIST_TO_TREE_STAGE_ORDER)[number];

type FileListToTreeStageTimings = Record<FileListToTreeStageName, number>;

interface FileListToTreeBenchmarkResult {
  tree: Record<string, FileTreeNode>;
  stageTimingsMs: FileListToTreeStageTimings;
}

function createStageTimings(): FileListToTreeStageTimings {
  return {
    buildPathGraph: 0,
    buildFlattenedNodes: 0,
    buildFolderNodes: 0,
    hashTreeKeys: 0,
  };
}

function timeStage<T>(run: () => T): [result: T, elapsedMs: number] {
  const startTime = performance.now();
  const result = run();
  return [result, performance.now() - startTime];
}

// Keeps detailed stage timing in scripts so the shipped runtime only contains
// the tree-building logic that production code actually executes.
export function benchmarkFileListToTreeStages(
  filePaths: string[],
  options: FileListToTreeOptions = {}
): FileListToTreeBenchmarkResult {
  const {
    rootId = 'root',
    rootName = rootId,
    sortComparator = defaultChildrenComparator,
  } = options;
  const stageTimingsMs = createStageTimings();

  const [state, buildPathGraphMs] = timeStage(() =>
    buildFileListToTreePathGraph(filePaths, rootId)
  );
  stageTimingsMs.buildPathGraph = buildPathGraphMs;

  const context = createFileListToTreeBuildContext(
    state.folderChildren,
    sortComparator
  );
  const [intermediateFolders, buildFlattenedNodesMs] = timeStage(() =>
    buildFileListToTreeFlattenedNodes(state, context)
  );
  stageTimingsMs.buildFlattenedNodes = buildFlattenedNodesMs;

  const [, buildFolderNodesMs] = timeStage(() => {
    buildFileListToTreeFolderNodes(
      state,
      context,
      rootId,
      rootName,
      intermediateFolders
    );
  });
  stageTimingsMs.buildFolderNodes = buildFolderNodesMs;

  const [tree, hashTreeKeysMs] = timeStage(() =>
    hashFileListToTreeKeys(state.tree)
  );
  stageTimingsMs.hashTreeKeys = hashTreeKeysMs;

  return {
    tree,
    stageTimingsMs,
  };
}
