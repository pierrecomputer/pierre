import type { ContextContent, FileDiffMetadata } from '../types';

export function diffAcceptRejectHunk(
  diff: FileDiffMetadata,
  hunkIndex: number,
  type: 'accept' | 'reject'
): FileDiffMetadata {
  diff = {
    ...diff,
    hunks: [...diff.hunks],
    oldLines: type === 'accept' ? [...diff.oldLines] : diff.oldLines,
    newLines: type === 'reject' ? [...diff.newLines] : diff.newLines,
    // Automatically update cacheKey if it exists, since content is changing
    cacheKey:
      diff.cacheKey != null
        ? `${diff.cacheKey}:${type[0]}-${hunkIndex}`
        : undefined,
  };
  // Fix the content lines
  const { newLines, oldLines } = diff;
  if (newLines != null && oldLines != null) {
    const hunk = diff.hunks[hunkIndex];
    if (hunk == null) {
      console.error({ diff, hunkIndex });
      throw new Error(
        `diffResolveRejectHunk: Invalid hunk index: ${hunkIndex}`
      );
    }
    if (type === 'reject') {
      newLines.splice(
        hunk.newLinesIndex,
        hunk.additionCount,
        ...oldLines.slice(
          hunk.oldLinesIndex,
          hunk.oldLinesIndex + hunk.deletionCount
        )
      );
    } else {
      oldLines.splice(
        hunk.oldLinesIndex,
        hunk.deletionCount,
        ...newLines.slice(
          hunk.newLinesIndex,
          hunk.newLinesIndex + hunk.additionCount
        )
      );
    }
  }
  let deletionOffset = 0;
  let additionOffset = 0;
  let splitOffset = 0;
  let unifiedOffset = 0;
  for (let i = hunkIndex; i < diff.hunks.length; i++) {
    let hunk = diff.hunks[i];
    if (hunk == null) {
      console.error({ hunk, i, hunkIndex, diff });
      throw new Error(
        'diffResolveRejectHunk: iterating through hunks, hunk doesnt exist...'
      );
    }
    diff.hunks[i] = hunk = { ...hunk };
    if (i === hunkIndex) {
      const newContent: ContextContent = {
        type: 'context',
        lines: 0,
        noEOFCR: false,
      };
      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          newContent.lines += content.lines;
          newContent.noEOFCR = content.noEOFCR;
        } else if (type === 'accept') {
          newContent.lines += content.additions;
          newContent.noEOFCR = content.noEOFCRAdditions;
        } else if (type === 'reject') {
          newContent.lines += content.deletions;
          newContent.noEOFCR = content.noEOFCRDeletions;
        }
      }
      const lineCount = newContent.lines;
      hunk.hunkContent = [newContent];
      splitOffset = lineCount - hunk.splitLineCount;
      hunk.splitLineCount = lineCount;
      unifiedOffset = lineCount - hunk.unifiedLineCount;
      hunk.unifiedLineCount = lineCount;
      deletionOffset = lineCount - hunk.deletionCount;
      hunk.deletionCount = lineCount;
      hunk.deletionLines = 0;
      additionOffset = lineCount - hunk.additionCount;
      hunk.additionCount = lineCount;
      hunk.additionLines = 0;
      diff.splitLineCount += splitOffset;
      diff.unifiedLineCount += unifiedOffset;
      // If we don't need to make any value offset differences for the rest of
      // the hunks, we done
      if (
        splitOffset === 0 &&
        unifiedOffset === 0 &&
        additionOffset === 0 &&
        deletionOffset === 0
      ) {
        break;
      }
    } else {
      hunk.splitLineStart += splitOffset;
      hunk.unifiedLineStart += unifiedOffset;

      hunk.additionStart += additionOffset;
      hunk.newLinesIndex += additionOffset;

      hunk.oldLinesIndex += deletionOffset;
      hunk.deletionStart += deletionOffset;
    }
  }
  return diff;
}
