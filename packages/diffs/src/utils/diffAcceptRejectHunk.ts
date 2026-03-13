import type { ContextContent, FileDiffMetadata } from '../types';

export function diffAcceptRejectHunk(
  diff: FileDiffMetadata,
  hunkIndex: number,
  type: 'accept' | 'reject' | 'both'
): FileDiffMetadata {
  const hunk = diff.hunks[hunkIndex];
  if (hunk == null) {
    console.error({ diff, hunkIndex });
    throw new Error(`diffResolveRejectHunk: Invalid hunk index: ${hunkIndex}`);
  }

  // Build the resolved hunk lines from the original diff data before mutating
  // either backing line array.
  const resolvedLines = buildResolvedLines(diff, hunk, type);

  diff = {
    ...diff,
    hunks: [...diff.hunks],
    deletionLines:
      type === 'accept' || type === 'both'
        ? [...diff.deletionLines]
        : diff.deletionLines,
    additionLines:
      type === 'reject' || type === 'both'
        ? [...diff.additionLines]
        : diff.additionLines,
    // Automatically update cacheKey if it exists, since content is changing
    cacheKey:
      diff.cacheKey != null
        ? `${diff.cacheKey}:${type[0]}-${hunkIndex}`
        : undefined,
  };

  const { additionLines, deletionLines } = diff;

  if (type === 'accept' || type === 'both') {
    deletionLines.splice(
      hunk.deletionLineIndex,
      hunk.deletionCount,
      ...resolvedLines
    );
  }

  if (type === 'reject' || type === 'both') {
    additionLines.splice(
      hunk.additionLineIndex,
      hunk.additionCount,
      ...resolvedLines
    );
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
    const { noEOFCRAdditions, noEOFCRDeletions } = hunk;
    diff.hunks[i] = hunk = { ...hunk };

    if (i === hunkIndex) {
      hunk.noEOFCRDeletions = false;
      hunk.noEOFCRAdditions = false;
      if (
        (type === 'accept' && noEOFCRAdditions) ||
        (type === 'reject' && noEOFCRDeletions) ||
        (type === 'both' && noEOFCRAdditions)
      ) {
        hunk.noEOFCRAdditions = true;
        hunk.noEOFCRDeletions = true;
      }
      const newContent: ContextContent = {
        type: 'context',
        lines: resolvedLines.length,
        additionLineIndex: hunk.additionLineIndex,
        deletionLineIndex: hunk.deletionLineIndex,
      };
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

      if (deletionOffset !== 0 || additionOffset !== 0) {
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

// Rebuild the line sequence that a resolved hunk should contribute by walking
// the original hunk content in order and choosing the kept lines for each mode.
function buildResolvedLines(
  diff: FileDiffMetadata,
  hunk: FileDiffMetadata['hunks'][number],
  type: 'accept' | 'reject' | 'both'
): string[] {
  const resolvedLines: string[] = [];

  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      resolvedLines.push(
        ...diff.additionLines.slice(
          content.additionLineIndex,
          content.additionLineIndex + content.lines
        )
      );
      continue;
    }

    if (type === 'reject' || type === 'both') {
      resolvedLines.push(
        ...diff.deletionLines.slice(
          content.deletionLineIndex,
          content.deletionLineIndex + content.deletions
        )
      );
      if (type === 'reject') {
        continue;
      }
    }

    if (type === 'accept' || type === 'both') {
      resolvedLines.push(
        ...diff.additionLines.slice(
          content.additionLineIndex,
          content.additionLineIndex + content.additions
        )
      );
    }
  }

  return resolvedLines;
}
