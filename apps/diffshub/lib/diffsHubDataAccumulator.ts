import {
  type ChangeTypes,
  type CodeViewItem,
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/diffs';
import type { FileTreeGitStatusPatch, GitStatusEntry } from '@pierre/trees';

import { getPatchTreePathPrefix } from './gitPatchMetadata';
import { mapChangeTypeToGitStatus } from './mapChangeTypeToGitStatus';
import type {
  CommentMetadata,
  DiffsHubCommentFileByItemId,
  DiffsHubCommentSidebarFile,
  DiffsHubDiffStats,
  DiffsHubFileTreeSource,
} from './types';

export interface DiffsHubDataAccumulator {
  diffStats: DiffsHubDiffStats;
  directoryPaths: Set<string>;
  fileIndex: number;
  gitStatusByPath: Map<string, GitStatusEntry>;
  itemIdToFile: Map<string, DiffsHubCommentSidebarFile>;
  items: CodeViewItem<CommentMetadata>[];
  // The last tree source emitted by snapshotDiffsHubTreeSource for this
  // accumulator. Each new snapshot links back to this so the consumer can
  // recognize append-only growth and skip the full PathStore rebuild.
  lastTreeSource: DiffsHubFileTreeSource | undefined;
  nextCollisionSuffixByBase: Map<string, number>;
  pendingGitStatusRemovePaths: Set<string>;
  pendingGitStatusSetByPath: Map<string, GitStatusEntry>;
  pendingItems: CodeViewItem<CommentMetadata>[];
  pendingItemById: Map<string, CodeViewItem<CommentMetadata>>;
  pathToItemId: Map<string, string>;
  pathStateByPatchPath: Map<string, CodeViewPathState>;
  pathStateByTreePath: Map<string, CodeViewPathState>;
  paths: string[];
}

export interface DiffsHubItemIdRename {
  oldId: string;
  newId: string;
}

interface CodeViewPathState {
  currentItem: CodeViewItem<CommentMetadata>;
  currentItemId: string;
  currentType: ChangeTypes;
  pathIndex: number;
  sawDeleted: boolean;
  treePath: string;
}

export interface LoadedDiffsHubData {
  itemIdToFile: DiffsHubCommentFileByItemId;
  diffStats: DiffsHubDiffStats;
  items: CodeViewItem<CommentMetadata>[];
  treeSource: DiffsHubFileTreeSource;
}

export function createDiffsHubDataAccumulator(): DiffsHubDataAccumulator {
  return {
    diffStats: {
      addedLines: 0,
      deletedLines: 0,
      fileCount: 0,
      totalLinesOfCode: 0,
    },
    directoryPaths: new Set(),
    fileIndex: 0,
    gitStatusByPath: new Map(),
    itemIdToFile: new Map(),
    items: [],
    lastTreeSource: undefined,
    nextCollisionSuffixByBase: new Map(),
    pendingGitStatusRemovePaths: new Set(),
    pendingGitStatusSetByPath: new Map(),
    pendingItems: [],
    pendingItemById: new Map(),
    pathToItemId: new Map(),
    pathStateByPatchPath: new Map(),
    pathStateByTreePath: new Map(),
    paths: [],
  };
}

export function appendFileDiffToDiffsHubData(
  accumulator: DiffsHubDataAccumulator,
  fileDiff: FileDiffMetadata,
  treePathPrefix: string | undefined
): DiffsHubItemIdRename | undefined {
  const { diffStats } = accumulator;
  diffStats.fileCount++;
  diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
  for (const hunk of fileDiff.hunks) {
    diffStats.addedLines += hunk.additionLines;
    diffStats.deletedLines += hunk.deletionLines;
  }

  const path = fileDiff.name;
  const patchPath = treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
  const previousPathState =
    path.length === 0
      ? undefined
      : accumulator.pathStateByPatchPath.get(patchPath);
  const itemIdRename =
    previousPathState == null
      ? undefined
      : renameCurrentPathItem(accumulator, patchPath, previousPathState);
  const id = accumulator.itemIdToFile.has(patchPath)
    ? createFallbackItemId(accumulator, patchPath)
    : patchPath;
  // Streaming cache keys read fileIndex before this append, so keep advancing
  // it even though item ids are now path-based.
  accumulator.fileIndex++;
  const fileOrder = accumulator.items.length;

  const item: CodeViewItem<CommentMetadata> = {
    id,
    type: 'diff',
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

  let pathState = previousPathState;
  if (pathState == null) {
    const treePath = claimTreePath(accumulator, patchPath);
    pathState = {
      currentItem: item,
      currentItemId: id,
      currentType: fileDiff.type,
      pathIndex: accumulator.paths.length,
      sawDeleted: false,
      treePath,
    };
    accumulator.paths.push(treePath);
    accumulator.pathStateByPatchPath.set(patchPath, pathState);
    accumulator.pathStateByTreePath.set(treePath, pathState);
  }
  const { treePath } = pathState;
  accumulator.pathToItemId.set(treePath, id);
  updateGitStatusByPath(
    accumulator,
    treePath,
    fileDiff.type,
    pathState.sawDeleted
  );
  pathState.currentItem = item;
  pathState.currentItemId = id;
  pathState.currentType = fileDiff.type;
  pathState.sawDeleted ||= fileDiff.type === 'deleted';

  return itemIdRename;
}

// Picks the file tree path for a patch path seen for the first time. The tree
// cannot hold a file and a directory at the same path, yet a patch can, e.g.
// when it deletes a symlink `lib/actions` and adds `lib/actions/index.ts`. The
// directory always keeps its real path and the file is shown under a suffixed
// name instead, so an already-placed file whose path a later patch path turns
// into a directory is renamed.
function claimTreePath(
  accumulator: DiffsHubDataAccumulator,
  patchPath: string
): string {
  const { directoryPaths, pathStateByTreePath } = accumulator;
  // Ancestors are visited deepest-first, so reaching a known directory means
  // every shallower ancestor is already a directory too.
  let slashIndex = patchPath.lastIndexOf('/');
  while (slashIndex > 0) {
    const directoryPath = patchPath.slice(0, slashIndex);
    if (directoryPaths.has(directoryPath)) {
      break;
    }
    const fileState = pathStateByTreePath.get(directoryPath);
    if (fileState != null) {
      renameTreeFile(accumulator, fileState);
    }
    directoryPaths.add(directoryPath);
    slashIndex = patchPath.lastIndexOf('/', slashIndex - 1);
  }

  return directoryPaths.has(patchPath) || pathStateByTreePath.has(patchPath)
    ? createFileTreePath(accumulator, patchPath)
    : patchPath;
}

// Renames a file already in the tree to a suffixed path, carrying its item
// link and git status along. Published snapshots alias `paths` and
// `pathToItemId`, so renaming a file the last snapshot already shows first
// gives the accumulator its own copies and drops the snapshot link. The next
// snapshot is then unlinked, so the tree consumer rebuilds from it in patch
// order instead of extending a tree that still holds the old file path.
function renameTreeFile(
  accumulator: DiffsHubDataAccumulator,
  pathState: CodeViewPathState
): void {
  const { lastTreeSource } = accumulator;
  if (
    lastTreeSource != null &&
    pathState.pathIndex < lastTreeSource.pathCount
  ) {
    accumulator.paths = accumulator.paths.slice();
    accumulator.pathToItemId = new Map(accumulator.pathToItemId);
    accumulator.lastTreeSource = undefined;
  }

  const { gitStatusByPath, pathStateByTreePath, pathToItemId } = accumulator;
  const from = pathState.treePath;
  const to = createFileTreePath(accumulator, from);
  pathState.treePath = to;
  accumulator.paths[pathState.pathIndex] = to;
  pathStateByTreePath.delete(from);
  pathStateByTreePath.set(to, pathState);
  pathToItemId.delete(from);
  pathToItemId.set(to, pathState.currentItemId);

  const gitStatusEntry = gitStatusByPath.get(from);
  if (gitStatusEntry != null) {
    gitStatusByPath.delete(from);
    recordGitStatusRemove(accumulator, from);
    const renamedEntry = { path: to, status: gitStatusEntry.status };
    gitStatusByPath.set(to, renamedEntry);
    recordGitStatusSet(accumulator, renamedEntry);
  }
}

// Returns an unused tree path for a file whose own path is taken by a
// directory (or by another file that was already renamed).
function createFileTreePath(
  accumulator: DiffsHubDataAccumulator,
  path: string
): string {
  const { directoryPaths, pathStateByTreePath } = accumulator;
  let treePath = `${path} (file)`;
  let suffix = 2;
  while (directoryPaths.has(treePath) || pathStateByTreePath.has(treePath)) {
    treePath = `${path} (file ${suffix})`;
    suffix++;
  }
  return treePath;
}

export function takePendingDiffsHubItems(
  accumulator: DiffsHubDataAccumulator
): CodeViewItem<CommentMetadata>[] {
  const { pendingItems } = accumulator;
  accumulator.pendingItems = [];
  accumulator.pendingItemById.clear();
  return pendingItems;
}

// Produces a tree source snapshot, linking it to the previous snapshot from
// the same accumulator. The consumer treats that link as a hint that the new
// paths array is an append-only extension of the prior one and applies the
// delta with model.batch instead of rebuilding the whole PathStore. Consumers
// that recreate the accumulator (e.g. a new request) discard the prior link
// implicitly because lastTreeSource is undefined on a fresh accumulator.
export function snapshotDiffsHubTreeSource(
  accumulator: DiffsHubDataAccumulator
): DiffsHubFileTreeSource {
  const previousSource = accumulator.lastTreeSource;
  const gitStatusPatch = takePendingGitStatusPatch(accumulator);
  const snapshot: DiffsHubFileTreeSource = {
    gitStatus: Array.from(accumulator.gitStatusByPath.values()),
    gitStatusPatch: previousSource == null ? undefined : gitStatusPatch,
    pathCount: accumulator.paths.length,
    paths: accumulator.paths,
    pathToItemId: accumulator.pathToItemId,
    previousSource,
  };
  accumulator.lastTreeSource = snapshot;
  return snapshot;
}

function takePendingGitStatusPatch(
  accumulator: DiffsHubDataAccumulator
): FileTreeGitStatusPatch | undefined {
  const { pendingGitStatusRemovePaths, pendingGitStatusSetByPath } =
    accumulator;
  if (
    pendingGitStatusRemovePaths.size === 0 &&
    pendingGitStatusSetByPath.size === 0
  ) {
    return undefined;
  }

  const patch: FileTreeGitStatusPatch = {};
  if (pendingGitStatusRemovePaths.size > 0) {
    patch.remove = [...pendingGitStatusRemovePaths];
    pendingGitStatusRemovePaths.clear();
  }
  if (pendingGitStatusSetByPath.size > 0) {
    patch.set = [...pendingGitStatusSetByPath.values()];
    pendingGitStatusSetByPath.clear();
  }
  return patch;
}

// Moves the current CodeView item for a path off the canonical tree id so the
// next diff entry for that same path can own tree navigation without rebuilding.
function renameCurrentPathItem(
  accumulator: DiffsHubDataAccumulator,
  patchPath: string,
  pathState: CodeViewPathState
): DiffsHubItemIdRename | undefined {
  const oldId = pathState.currentItemId;
  const newId = createSupersededItemId(
    accumulator,
    patchPath,
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
  accumulator: DiffsHubDataAccumulator,
  patchPath: string,
  changeType: ChangeTypes
): string {
  const semanticSuffix = changeType === 'deleted' ? '?deleted' : '?previous';
  return createUniqueItemId(accumulator, `${patchPath}${semanticSuffix}`);
}

function createFallbackItemId(
  accumulator: DiffsHubDataAccumulator,
  patchPath: string
): string {
  return createUniqueItemId(accumulator, `${patchPath}?2`);
}

// Resolves rare id collisions by advancing a per-base suffix instead of scanning
// accumulated items.
function createUniqueItemId(
  accumulator: DiffsHubDataAccumulator,
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
  accumulator: DiffsHubDataAccumulator,
  treePath: string,
  changeType: ChangeTypes,
  hadDeletedEntry: boolean
): void {
  if (hadDeletedEntry && changeType !== 'deleted') {
    if (accumulator.gitStatusByPath.delete(treePath)) {
      recordGitStatusRemove(accumulator, treePath);
    }
    return;
  }

  // Modified files are excluded so they render as the visual default. Only
  // added, deleted, and renamed files retain status indicators.
  const gitStatusEntry = mapChangeTypeToGitStatus(changeType);
  if (gitStatusEntry === 'modified') {
    if (accumulator.gitStatusByPath.delete(treePath)) {
      recordGitStatusRemove(accumulator, treePath);
    }
  } else {
    const previousStatus = accumulator.gitStatusByPath.get(treePath)?.status;
    if (previousStatus === gitStatusEntry) {
      return;
    }

    const entry = {
      path: treePath,
      status: gitStatusEntry,
    };
    accumulator.gitStatusByPath.set(treePath, entry);
    recordGitStatusSet(accumulator, entry);
  }
}

function recordGitStatusSet(
  accumulator: DiffsHubDataAccumulator,
  entry: GitStatusEntry
): void {
  accumulator.pendingGitStatusRemovePaths.delete(entry.path);
  accumulator.pendingGitStatusSetByPath.set(entry.path, entry);
}

function recordGitStatusRemove(
  accumulator: DiffsHubDataAccumulator,
  path: string
): void {
  accumulator.pendingGitStatusSetByPath.delete(path);
  accumulator.pendingGitStatusRemovePaths.add(path);
}

export function snapshotDiffsHubData(
  accumulator: DiffsHubDataAccumulator
): LoadedDiffsHubData {
  return {
    itemIdToFile: new Map(accumulator.itemIdToFile),
    diffStats: { ...accumulator.diffStats },
    items: accumulator.items.slice(),
    treeSource: snapshotDiffsHubTreeSource(accumulator),
  };
}

// Converts raw patch text into the exact state slices consumed by the diff
// viewer, sidebar tree, stats panel, and comment index in one linear pass.
export function buildDiffsHubData(
  patchContent: string,
  githubPath: string
): LoadedDiffsHubData {
  const parsedPatches = parsePatchFiles(
    patchContent,
    // Use the url as a cache key
    encodeURIComponent(githubPath)
  );

  const accumulator = createDiffsHubDataAccumulator();
  const shouldPrefixTreePaths = parsedPatches.length > 1;
  for (const [patchIndex, patch] of parsedPatches.entries()) {
    const treePathPrefix = shouldPrefixTreePaths
      ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;
    for (const fileDiff of patch.files) {
      appendFileDiffToDiffsHubData(accumulator, fileDiff, treePathPrefix);
    }
  }

  return snapshotDiffsHubData(accumulator);
}
