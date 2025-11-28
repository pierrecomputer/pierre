import type { ContextContent, FileDiffMetadata } from 'src/types';

export function diffAcceptRejectHunk(
  diff: FileDiffMetadata,
  hunkIndex: number,
  type: 'accept' | 'reject'
): FileDiffMetadata {
  diff = {
    ...diff,
    hunks: [...diff.hunks],
    oldLines: diff.oldLines != null ? [...diff.oldLines] : undefined,
    newLines: diff.newLines != null ? [...diff.newLines] : undefined,
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
        hunk.additionStart - 1,
        hunk.additionCount,
        ...oldLines.slice(
          hunk.deletionStart - 1,
          hunk.deletionStart - 1 + hunk.deletionCount
        )
      );
    } else {
      oldLines.splice(
        hunk.deletionStart - 1,
        hunk.deletionCount,
        ...newLines.slice(
          hunk.additionStart - 1,
          hunk.additionStart - 1 + hunk.additionCount
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
    hunk = { ...hunk };
    diff.hunks[i] = hunk;
    if (i === hunkIndex) {
      const newContent: ContextContent = {
        type: 'context',
        lines: [],
        noEOFCR: false,
      };
      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          newContent.lines.push(...content.lines);
          newContent.noEOFCR = content.noEOFCR;
        } else if (type === 'accept') {
          newContent.lines.push(...content.additions);
          newContent.noEOFCR = content.noEOFCRAdditions;
        } else if (type === 'reject') {
          newContent.lines.push(...content.deletions);
          newContent.noEOFCR = content.noEOFCRDeletions;
        }
      }
      const lineCount = newContent.lines.length;
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
    } else {
      hunk.splitLineStart += splitOffset;
      hunk.unifiedLineStart += unifiedOffset;
      hunk.additionStart += additionOffset;
      hunk.deletionStart += deletionOffset;
    }
  }
  return diff;
}
