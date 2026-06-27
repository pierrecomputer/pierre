import type {
  FileContents,
  FileDiffContentsLoader,
  FileDiffMetadata,
  Hunk,
} from '../types';
import { cloneFileDiffMetadata } from './cloneFileDiffMetadata';
import { splitFileContents } from './splitFileContents';

type LoadedFiles = Awaited<ReturnType<FileDiffContentsLoader>>;

interface HydratedHunksResult {
  hunks: Hunk[];
  splitLineCount: number;
  unifiedLineCount: number;
}

/**
 * Hydrates a partial diff in place with full file line arrays.
 */
export function hydratePartialDiff(
  type: 'clone' | 'merge',
  fileDiff: FileDiffMetadata,
  files: LoadedFiles
): FileDiffMetadata {
  const targetFileDiff =
    type === 'clone' ? cloneFileDiffMetadata(fileDiff) : fileDiff;

  if (!targetFileDiff.isPartial) {
    throw new Error('hydratePartialDiff: fileDiff must be partial');
  }

  switch (targetFileDiff.type) {
    case 'change':
    case 'rename-changed': {
      const oldFile = requireOldFile(targetFileDiff, files);
      const newFile = requireNewFile(targetFileDiff, files);
      return hydrateTwoSidedFileDiff(targetFileDiff, oldFile, newFile);
    }
    case 'rename-pure': {
      const newFile = requireNewFile(targetFileDiff, files);
      const lines = splitFileContents(newFile.contents);
      targetFileDiff.isPartial = false;
      targetFileDiff.deletionLines = lines;
      targetFileDiff.additionLines = lines;
      setHydratedCacheKey(targetFileDiff, files.oldFile, newFile);
      return targetFileDiff;
    }
  }
  throw new Error(
    `hydratePartialDiff: ${targetFileDiff.type} diffs cannot be hydrated from loaded files`
  );
}

function hydrateTwoSidedFileDiff(
  fileDiff: FileDiffMetadata,
  oldFile: FileContents,
  newFile: FileContents
): FileDiffMetadata {
  const deletionLines = splitFileContents(oldFile.contents);
  const additionLines = splitFileContents(newFile.contents);
  const { hunks, splitLineCount, unifiedLineCount } = hydrateHunks(
    fileDiff.hunks,
    additionLines.length
  );

  fileDiff.hunks = hunks;
  fileDiff.splitLineCount = splitLineCount;
  fileDiff.unifiedLineCount = unifiedLineCount;
  fileDiff.isPartial = false;
  fileDiff.deletionLines = deletionLines;
  fileDiff.additionLines = additionLines;
  setHydratedCacheKey(fileDiff, oldFile, newFile);
  return fileDiff;
}

function hydrateHunks(
  hunks: Hunk[],
  totalAdditionLines: number
): HydratedHunksResult {
  let splitLineCount = 0;
  let unifiedLineCount = 0;
  let lastHunkAdditionEnd = 0;

  const hydratedHunks: Hunk[] = [];

  for (const hunk of hunks) {
    const additionLineIndex = Math.max(hunk.additionStart - 1, 0);
    const deletionLineIndex = Math.max(hunk.deletionStart - 1, 0);
    let contentAdditionLineIndex = additionLineIndex;
    let contentDeletionLineIndex = deletionLineIndex;
    let hunkAdditionLines = 0;
    let hunkDeletionLines = 0;
    let hunkSplitLineCount = 0;
    let hunkUnifiedLineCount = 0;
    const hunkContent: Hunk['hunkContent'] = [];

    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        hunkContent.push({
          ...content,
          additionLineIndex: contentAdditionLineIndex,
          deletionLineIndex: contentDeletionLineIndex,
        });
        contentAdditionLineIndex += content.lines;
        contentDeletionLineIndex += content.lines;
        hunkSplitLineCount += content.lines;
        hunkUnifiedLineCount += content.lines;
        continue;
      }

      hunkContent.push({
        ...content,
        additionLineIndex: contentAdditionLineIndex,
        deletionLineIndex: contentDeletionLineIndex,
      });
      contentAdditionLineIndex += content.additions;
      contentDeletionLineIndex += content.deletions;
      hunkAdditionLines += content.additions;
      hunkDeletionLines += content.deletions;
      hunkSplitLineCount += Math.max(content.additions, content.deletions);
      hunkUnifiedLineCount += content.additions + content.deletions;
    }

    const collapsedBefore = Math.max(
      hunk.additionStart - 1 - lastHunkAdditionEnd,
      0
    );
    hydratedHunks.push({
      ...hunk,
      collapsedBefore,
      additionLineIndex,
      deletionLineIndex,
      additionLines: hunkAdditionLines,
      deletionLines: hunkDeletionLines,
      hunkContent,
      splitLineStart: splitLineCount + collapsedBefore,
      unifiedLineStart: unifiedLineCount + collapsedBefore,
      splitLineCount: hunkSplitLineCount,
      unifiedLineCount: hunkUnifiedLineCount,
    });

    splitLineCount += collapsedBefore + hunkSplitLineCount;
    unifiedLineCount += collapsedBefore + hunkUnifiedLineCount;
    lastHunkAdditionEnd = hunk.additionStart + hunk.additionCount - 1;
  }

  if (hydratedHunks.length > 0) {
    const lastHunk = hydratedHunks[hydratedHunks.length - 1];
    const lastHunkEnd = Math.max(
      lastHunk.additionStart + lastHunk.additionCount - 1,
      0
    );
    const collapsedAfter = Math.max(totalAdditionLines - lastHunkEnd, 0);
    splitLineCount += collapsedAfter;
    unifiedLineCount += collapsedAfter;
  }

  return { hunks: hydratedHunks, splitLineCount, unifiedLineCount };
}

function requireOldFile(
  fileDiff: FileDiffMetadata,
  files: LoadedFiles
): FileContents {
  if (files.oldFile == null) {
    throw new Error(
      `hydratePartialDiff: ${fileDiff.type} diff for ${fileDiff.name} requires oldFile`
    );
  }
  return files.oldFile;
}

function requireNewFile(
  fileDiff: FileDiffMetadata,
  files: LoadedFiles
): FileContents {
  if (files.newFile == null) {
    throw new Error(
      `hydratePartialDiff: ${fileDiff.type} diff for ${fileDiff.name} requires newFile`
    );
  }
  return files.newFile;
}

function getHydratedCacheKey(
  fileDiff: FileDiffMetadata,
  oldFile: FileContents | null,
  newFile: FileContents | null
): string | undefined {
  const loadedFileCacheKey = getLoadedFileCacheKey(oldFile, newFile);
  if (loadedFileCacheKey != null) {
    return loadedFileCacheKey;
  }
  return fileDiff.cacheKey != null
    ? `${fileDiff.cacheKey}:hydrated`
    : undefined;
}

function setHydratedCacheKey(
  fileDiff: FileDiffMetadata,
  oldFile: FileContents | null,
  newFile: FileContents | null
): void {
  const cacheKey = getHydratedCacheKey(fileDiff, oldFile, newFile);
  if (cacheKey == null) {
    delete fileDiff.cacheKey;
    return;
  }
  fileDiff.cacheKey = cacheKey;
}

function getLoadedFileCacheKey(
  oldFile: FileContents | null,
  newFile: FileContents | null
): string | undefined {
  if (oldFile?.cacheKey != null && newFile?.cacheKey != null) {
    return `${oldFile.cacheKey}:${newFile.cacheKey}`;
  }
  return oldFile?.cacheKey ?? newFile?.cacheKey;
}
