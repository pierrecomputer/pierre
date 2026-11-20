import type { FileDiffMetadata, SelectionSide } from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';

// The row a line sits on in a diff, as `[unifiedIndex, splitIndex]`. A partial
// diff only has rows for the lines in its hunks; any other line has none.
export function getLineIndexForDiff(
  fileDiff: FileDiffMetadata | undefined,
  lineNumber: number,
  side: SelectionSide
): [number, number] | undefined {
  if (fileDiff == null) {
    return undefined;
  }
  const lastHunk = fileDiff.hunks.at(-1);
  let targetUnifiedIndex: number | undefined;
  let targetSplitIndex: number | undefined;
  hunkIterator: for (const hunk of fileDiff.hunks) {
    const hunkStart =
      side === 'deletions' ? hunk.deletionStart : hunk.additionStart;
    const hunkCount =
      side === 'deletions' ? hunk.deletionCount : hunk.additionCount;
    let currentLineNumber = getHunkSideStartBoundary(hunkStart, hunkCount) + 1;
    let splitIndex = hunk.splitLineStart;
    let unifiedIndex = hunk.unifiedLineStart;

    // If we've selected a line between or before a hunk,
    // we should grab its index here
    if (lineNumber < currentLineNumber) {
      if (fileDiff.isPartial) return undefined;
      const difference = currentLineNumber - lineNumber;
      targetUnifiedIndex = Math.max(unifiedIndex - difference, 0);
      targetSplitIndex = Math.max(splitIndex - difference, 0);
      break hunkIterator;
    }

    if (lineNumber >= currentLineNumber + hunkCount) {
      if (hunk === lastHunk) {
        if (fileDiff.isPartial) return undefined;
        const difference = lineNumber - (currentLineNumber + hunkCount);
        targetUnifiedIndex = unifiedIndex + hunk.unifiedLineCount + difference;
        targetSplitIndex = splitIndex + hunk.splitLineCount + difference;
        break hunkIterator;
      }
      continue;
    }

    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        if (lineNumber < currentLineNumber + content.lines) {
          const difference = lineNumber - currentLineNumber;
          targetSplitIndex = splitIndex + difference;
          targetUnifiedIndex = unifiedIndex + difference;
          break hunkIterator;
        } else {
          currentLineNumber += content.lines;
          splitIndex += content.lines;
          unifiedIndex += content.lines;
        }
      } else {
        const sideCount =
          side === 'deletions' ? content.deletions : content.additions;
        if (lineNumber < currentLineNumber + sideCount) {
          const indexDifference = lineNumber - currentLineNumber;
          targetUnifiedIndex =
            unifiedIndex +
            (side === 'additions' ? content.deletions : 0) +
            indexDifference;
          targetSplitIndex = splitIndex + indexDifference;

          break hunkIterator;
        } else {
          currentLineNumber += sideCount;
          splitIndex += Math.max(content.deletions, content.additions);
          unifiedIndex += content.deletions + content.additions;
        }
      }
    }

    break hunkIterator;
  }

  if (targetUnifiedIndex == null || targetSplitIndex == null) {
    return undefined;
  }
  return [targetUnifiedIndex, targetSplitIndex];
}
