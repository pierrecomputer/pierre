import type {
  FileContents,
  FileDiffContentsLoader,
  FileDiffMetadata,
  Hunk,
} from '../types';
import { parseDiffFromFile } from './parseDiffFromFile';
import { splitFileContents } from './splitFileContents';

type LoadedFileDiffContents = Awaited<ReturnType<FileDiffContentsLoader>>;

interface HydratedHunksResult {
  hunks: Hunk[];
  splitLineCount: number;
  unifiedLineCount: number;
}

/**
 * Rebuilds partial diff metadata with full file line arrays while preserving
 * the patch's parsed hunk structure.
 */
export function hydratePartialFileDiff(
  fileDiff: FileDiffMetadata,
  loadedContents: LoadedFileDiffContents
): FileDiffMetadata {
  if (!fileDiff.isPartial) {
    throw new Error('hydratePartialFileDiff: fileDiff must be partial');
  }

  switch (fileDiff.type) {
    case 'change':
    case 'rename-changed': {
      const oldFile = requireOldFile(fileDiff, loadedContents);
      const newFile = requireNewFile(fileDiff, loadedContents);
      return hydrateTwoSidedFileDiff(fileDiff, oldFile, newFile);
    }
    case 'new': {
      const newFile = requireNewFile(fileDiff, loadedContents);
      return hydrateReparsedFileDiff(fileDiff, null, newFile);
    }
    case 'deleted': {
      const oldFile = requireOldFile(fileDiff, loadedContents);
      return hydrateReparsedFileDiff(fileDiff, oldFile, null);
    }
    case 'rename-pure': {
      const newFile = requireNewFile(fileDiff, loadedContents);
      const lines = splitFileContents(newFile.contents);
      return {
        ...fileDiff,
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
        isPartial: false,
        deletionLines: [...lines],
        additionLines: [...lines],
        cacheKey: getHydratedCacheKey(loadedContents.oldFile, newFile),
      };
    }
  }
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

  return {
    ...fileDiff,
    hunks,
    splitLineCount,
    unifiedLineCount,
    isPartial: false,
    deletionLines,
    additionLines,
    cacheKey: getHydratedCacheKey(oldFile, newFile),
  };
}

function hydrateReparsedFileDiff(
  fileDiff: FileDiffMetadata,
  oldFile: FileContents | null,
  newFile: FileContents | null
): FileDiffMetadata {
  const parsed = parseDiffFromFile(oldFile, newFile, undefined, true);
  return {
    ...parsed,
    name: fileDiff.name,
    prevName: fileDiff.prevName,
    lang: fileDiff.lang ?? parsed.lang,
    newObjectId: fileDiff.newObjectId,
    prevObjectId: fileDiff.prevObjectId,
    mode: fileDiff.mode,
    prevMode: fileDiff.prevMode,
    type: fileDiff.type,
    isPartial: false,
  };
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
  loadedContents: LoadedFileDiffContents
): FileContents {
  if (loadedContents.oldFile == null) {
    throw new Error(
      `hydratePartialFileDiff: ${fileDiff.type} diff for ${fileDiff.name} requires oldFile`
    );
  }
  return loadedContents.oldFile;
}

function requireNewFile(
  fileDiff: FileDiffMetadata,
  loadedContents: LoadedFileDiffContents
): FileContents {
  if (loadedContents.newFile == null) {
    throw new Error(
      `hydratePartialFileDiff: ${fileDiff.type} diff for ${fileDiff.name} requires newFile`
    );
  }
  return loadedContents.newFile;
}

function getHydratedCacheKey(
  oldFile: FileContents | null,
  newFile: FileContents | null
): string | undefined {
  if (oldFile?.cacheKey == null || newFile?.cacheKey == null) {
    return undefined;
  }
  return `${oldFile.cacheKey}:${newFile.cacheKey}`;
}
