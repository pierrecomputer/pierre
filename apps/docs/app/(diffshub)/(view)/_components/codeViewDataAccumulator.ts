import {
  type ChangeTypes,
  type CodeViewItem,
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

import { getPatchTreePathPrefix } from './gitPatchMetadata';
import type {
  CodeViewCommentFileByItemId,
  CodeViewCommentSidebarFile,
  CodeViewDiffStats,
  CodeViewFileTreeSource,
  CommentMetadata,
} from './types';
import {
  createCodeViewFileTreeSource,
  mapChangeTypeToGitStatus,
} from './utils';

export interface CodeViewDataAccumulator {
  fileIndex: number;
  gitStatusByPath: Map<string, GitStatusEntry>;
  itemIdToFile: Map<string, CodeViewCommentSidebarFile>;
  items: CodeViewItem<CommentMetadata>[];
  pendingItems: CodeViewItem<CommentMetadata>[];
  pendingItemById: Map<string, CodeViewItem<CommentMetadata>>;
  pathToItemId: Map<string, string>;
  pathStateByTreePath: Map<string, CodeViewPathState>;
  paths: string[];
  nextCollisionSuffixByBase: Map<string, number>;
  diffStats: CodeViewDiffStats;
}

export interface CodeViewItemIdRename {
  oldId: string;
  newId: string;
}

interface CodeViewPathState {
  currentItem: CodeViewItem<CommentMetadata>;
  currentItemId: string;
  currentType: ChangeTypes;
  sawDeleted: boolean;
}

export interface LoadedCodeViewData {
  itemIdToFile: CodeViewCommentFileByItemId;
  diffStats: CodeViewDiffStats;
  items: CodeViewItem<CommentMetadata>[];
  treeSource: CodeViewFileTreeSource;
}

export function createCodeViewDataAccumulator(): CodeViewDataAccumulator {
  return {
    fileIndex: 0,
    gitStatusByPath: new Map(),
    itemIdToFile: new Map(),
    items: [],
    pendingItems: [],
    pendingItemById: new Map(),
    pathToItemId: new Map(),
    pathStateByTreePath: new Map(),
    paths: [],
    nextCollisionSuffixByBase: new Map(),
    diffStats: {
      addedLines: 0,
      deletedLines: 0,
      fileCount: 0,
      totalLinesOfCode: 0,
    },
  };
}

export function appendFileDiffToCodeViewData(
  accumulator: CodeViewDataAccumulator,
  fileDiff: FileDiffMetadata,
  treePathPrefix: string | undefined
): CodeViewItemIdRename | undefined {
  const { diffStats } = accumulator;
  diffStats.fileCount++;
  diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
  for (const hunk of fileDiff.hunks) {
    diffStats.addedLines += hunk.additionLines;
    diffStats.deletedLines += hunk.deletionLines;
  }

  const path = fileDiff.name;
  const treePath = treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
  const previousPathState =
    path.length === 0
      ? undefined
      : accumulator.pathStateByTreePath.get(treePath);
  const itemIdRename =
    previousPathState == null
      ? undefined
      : renameCurrentPathItem(accumulator, treePath, previousPathState);
  const id = accumulator.itemIdToFile.has(treePath)
    ? createFallbackItemId(accumulator, treePath)
    : treePath;
  // Streaming cache keys read fileIndex before this append, so keep advancing
  // it even though item ids are now path-based.
  accumulator.fileIndex++;
  const fileOrder = accumulator.items.length;

  const item: CodeViewItem<CommentMetadata> = {
    id,
    type: 'diff',
    collapsed: fileDiff.type === 'deleted',
    fileDiff,
    version: 0,
  };
  accumulator.items.push(item);
  accumulator.pendingItems.push(item);
  accumulator.pendingItemById.set(id, item);

  accumulator.itemIdToFile.set(id, { fileOrder, path });
  if (path.length === 0) {
    return itemIdRename;
  }

  if (previousPathState == null) {
    accumulator.paths.push(treePath);
  }
  accumulator.pathToItemId.set(treePath, id);
  updateGitStatusByPath(
    accumulator,
    treePath,
    fileDiff.type,
    previousPathState?.sawDeleted === true
  );
  accumulator.pathStateByTreePath.set(treePath, {
    currentItem: item,
    currentItemId: id,
    currentType: fileDiff.type,
    sawDeleted:
      previousPathState?.sawDeleted === true || fileDiff.type === 'deleted',
  });

  return itemIdRename;
}

export function takePendingCodeViewItems(
  accumulator: CodeViewDataAccumulator
): CodeViewItem<CommentMetadata>[] {
  const { pendingItems } = accumulator;
  accumulator.pendingItems = [];
  accumulator.pendingItemById.clear();
  return pendingItems;
}

export function snapshotCodeViewTreeSource(
  accumulator: CodeViewDataAccumulator
): CodeViewFileTreeSource {
  return createCodeViewFileTreeSource(
    accumulator.paths.slice(),
    new Map(accumulator.pathToItemId),
    Array.from(accumulator.gitStatusByPath.values())
  );
}

// Moves the current CodeView item for a path off the canonical tree id so the
// next diff entry for that same path can own tree navigation without rebuilding.
function renameCurrentPathItem(
  accumulator: CodeViewDataAccumulator,
  treePath: string,
  pathState: CodeViewPathState
): CodeViewItemIdRename | undefined {
  const oldId = pathState.currentItemId;
  const newId = createSupersededItemId(
    accumulator,
    treePath,
    pathState.currentType
  );
  pathState.currentItem.id = newId;
  pathState.currentItemId = newId;

  const file = accumulator.itemIdToFile.get(oldId);
  if (file != null) {
    accumulator.itemIdToFile.delete(oldId);
    accumulator.itemIdToFile.set(newId, file);
  }

  const pendingItem = accumulator.pendingItemById.get(oldId);
  if (pendingItem != null) {
    accumulator.pendingItemById.delete(oldId);
    accumulator.pendingItemById.set(newId, pendingItem);
    return undefined;
  }

  return { oldId, newId };
}

function createSupersededItemId(
  accumulator: CodeViewDataAccumulator,
  treePath: string,
  changeType: ChangeTypes
): string {
  const semanticSuffix = changeType === 'deleted' ? '?deleted' : '?previous';
  return createUniqueItemId(accumulator, `${treePath}${semanticSuffix}`);
}

function createFallbackItemId(
  accumulator: CodeViewDataAccumulator,
  treePath: string
): string {
  return createUniqueItemId(accumulator, `${treePath}?2`);
}

// Resolves rare id collisions by advancing a per-base suffix instead of scanning
// accumulated items.
function createUniqueItemId(
  accumulator: CodeViewDataAccumulator,
  baseId: string
): string {
  if (!accumulator.itemIdToFile.has(baseId)) {
    return baseId;
  }

  let suffix = accumulator.nextCollisionSuffixByBase.get(baseId) ?? 2;
  let itemId = `${baseId}-${suffix}`;
  while (accumulator.itemIdToFile.has(itemId)) {
    suffix++;
    itemId = `${baseId}-${suffix}`;
  }
  accumulator.nextCollisionSuffixByBase.set(baseId, suffix + 1);
  return itemId;
}

// Maintains the file tree status for a real path while repeated patch entries
// replace the path's final CodeView item.
function updateGitStatusByPath(
  accumulator: CodeViewDataAccumulator,
  treePath: string,
  changeType: ChangeTypes,
  hadDeletedEntry: boolean
): void {
  if (hadDeletedEntry && changeType !== 'deleted') {
    accumulator.gitStatusByPath.delete(treePath);
    return;
  }

  // Modified files are excluded so they render as the visual default. Only
  // added, deleted, and renamed files retain status indicators.
  const gitStatusEntry = mapChangeTypeToGitStatus(changeType);
  if (gitStatusEntry === 'modified') {
    accumulator.gitStatusByPath.delete(treePath);
  } else {
    accumulator.gitStatusByPath.set(treePath, {
      path: treePath,
      status: gitStatusEntry,
    });
  }
}

export function snapshotCodeViewData(
  accumulator: CodeViewDataAccumulator
): LoadedCodeViewData {
  return {
    itemIdToFile: new Map(accumulator.itemIdToFile),
    diffStats: { ...accumulator.diffStats },
    items: accumulator.items.slice(),
    treeSource: snapshotCodeViewTreeSource(accumulator),
  };
}

// Converts raw patch text into the exact state slices consumed by the diff
// viewer, sidebar tree, stats panel, and comment index in one linear pass.
export function buildCodeViewData(
  patchContent: string,
  githubPath: string
): LoadedCodeViewData {
  console.time('--  parsing patches');
  const parsedPatches = parsePatchFiles(
    patchContent,
    // Use the url as a cache key
    encodeURIComponent(githubPath)
  );
  console.timeEnd('--  parsing patches');

  console.time('-- computing layout');
  const accumulator = createCodeViewDataAccumulator();
  const shouldPrefixTreePaths = parsedPatches.length > 1;
  for (const [patchIndex, patch] of parsedPatches.entries()) {
    const treePathPrefix = shouldPrefixTreePaths
      ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;
    for (const fileDiff of patch.files) {
      appendFileDiffToCodeViewData(accumulator, fileDiff, treePathPrefix);
    }
  }
  console.timeEnd('-- computing layout');

  return snapshotCodeViewData(accumulator);
}
