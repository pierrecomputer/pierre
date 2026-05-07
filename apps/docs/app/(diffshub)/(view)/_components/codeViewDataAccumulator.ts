import {
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
  gitStatus: GitStatusEntry[];
  itemIdToFile: Map<string, CodeViewCommentSidebarFile>;
  items: CodeViewItem<CommentMetadata>[];
  pendingItems: CodeViewItem<CommentMetadata>[];
  pathToItemId: Map<string, string>;
  paths: string[];
  diffStats: CodeViewDiffStats;
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
    gitStatus: [],
    itemIdToFile: new Map(),
    items: [],
    pendingItems: [],
    pathToItemId: new Map(),
    paths: [],
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
): void {
  const { diffStats } = accumulator;
  diffStats.fileCount++;
  diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
  for (const hunk of fileDiff.hunks) {
    diffStats.addedLines += hunk.additionLines;
    diffStats.deletedLines += hunk.deletionLines;
  }

  const id = `${treePathPrefix != null ? treePathPrefix + '/' : ''}${fileDiff.name}`;
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

  const path = fileDiff.name;
  accumulator.itemIdToFile.set(id, { fileOrder, path });
  const treePath = treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
  if (path.length === 0 || accumulator.pathToItemId.has(treePath)) {
    return;
  }

  accumulator.paths.push(treePath);
  accumulator.pathToItemId.set(treePath, id);
  // Modified files are excluded so they render as the visual default. Only
  // added, deleted, and renamed files retain status indicators.
  const gitStatusEntry = mapChangeTypeToGitStatus(fileDiff.type);
  if (gitStatusEntry !== 'modified') {
    accumulator.gitStatus.push({ path: treePath, status: gitStatusEntry });
  }
}

export function takePendingCodeViewItems(
  accumulator: CodeViewDataAccumulator
): CodeViewItem<CommentMetadata>[] {
  const { pendingItems } = accumulator;
  accumulator.pendingItems = [];
  return pendingItems;
}

export function snapshotCodeViewTreeSource(
  accumulator: CodeViewDataAccumulator
): CodeViewFileTreeSource {
  return createCodeViewFileTreeSource(
    accumulator.paths.slice(),
    new Map(accumulator.pathToItemId),
    accumulator.gitStatus.slice()
  );
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
