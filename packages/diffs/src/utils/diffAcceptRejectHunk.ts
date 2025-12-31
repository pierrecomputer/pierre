import type { ContextContent, FileDiffMetadata } from '../types';

export function diffAcceptRejectHunk(
  diff: FileDiffMetadata,
  hunkIndex: number,
  type: 'accept' | 'reject'
): FileDiffMetadata {
  diff = {
    ...diff,
    hunks: [...diff.hunks],
    deletionLines:
      type === 'accept' ? [...diff.deletionLines] : diff.deletionLines,
    additionLines:
      type === 'reject' ? [...diff.additionLines] : diff.additionLines,
    // Automatically update cacheKey if it exists, since content is changing
    cacheKey:
      diff.cacheKey != null
        ? `${diff.cacheKey}:${type[0]}-${hunkIndex}`
        : undefined,
  };
  // Fix the content lines
  const { additionLines, deletionLines } = diff;
  if (additionLines != null && deletionLines != null) {
    const hunk = diff.hunks[hunkIndex];
    if (hunk == null) {
      console.error({ diff, hunkIndex });
      throw new Error(
        `diffResolveRejectHunk: Invalid hunk index: ${hunkIndex}`
      );
    }
    if (type === 'reject') {
      additionLines.splice(
        hunk.additionLineIndex,
        hunk.additionCount,
        ...deletionLines.slice(
          hunk.deletionLineIndex,
          hunk.deletionLineIndex + hunk.deletionCount
        )
      );
    } else {
      deletionLines.splice(
        hunk.deletionLineIndex,
        hunk.deletionCount,
        ...additionLines.slice(
          hunk.additionLineIndex,
          hunk.additionLineIndex + hunk.additionCount
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
        additionLineIndex: hunk.additionLineIndex,
        deletionLineIndex: hunk.deletionLineIndex,
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
      hunk.additionLineIndex += additionOffset;

      hunk.deletionLineIndex += deletionOffset;
      hunk.deletionStart += deletionOffset;

      if (additionOffset > 0 || additionOffset > 0) {
        let i = 0;
        while (i < hunk.hunkContent.length) {
          const content = hunk.hunkContent[i];
          hunk.hunkContent[i] = {
            ...content,
            additionLineIndex: content.additionLineIndex + additionOffset,
            deletionLineIndex: content.deletionLineIndex + deletionOffset,
          };
          i++;
        }
      }
    }
  }
  return diff;
}
