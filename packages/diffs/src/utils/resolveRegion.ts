import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
} from '../types';
import { trimResolvedHunk } from './trimResolvedHunk';

interface RegionResolutionTarget {
  hunkIndex: number;
  startContentIndex: number;
  endContentIndex: number;
  resolution: 'deletions' | 'additions' | 'both';
  indexesToDelete?: Set<number>;
  trimContextLines?: number;
}

interface CursorState {
  nextAdditionLineIndex: number;
  nextDeletionLineIndex: number;
  nextAdditionStart: number;
  nextDeletionStart: number;
  splitLineCount: number;
  unifiedLineCount: number;
}

interface EmissionState {
  nextAdditionStart: number;
  nextDeletionStart: number;
  splitLineCount: number;
  unifiedLineCount: number;
}

type EmitReadyHunk = Pick<
  Hunk,
  | 'additionStart'
  | 'additionCount'
  | 'additionLines'
  | 'additionLineIndex'
  | 'deletionStart'
  | 'deletionCount'
  | 'deletionLines'
  | 'deletionLineIndex'
  | 'splitLineCount'
  | 'unifiedLineCount'
  | 'hunkContent'
>;

export function resolveRegion(
  diff: FileDiffMetadata,
  target: RegionResolutionTarget
): FileDiffMetadata {
  const {
    resolution,
    hunkIndex,
    startContentIndex,
    endContentIndex,
    indexesToDelete = new Set(),
    trimContextLines,
  } = target;
  const currentHunk = diff.hunks[hunkIndex];
  if (currentHunk == null) {
    console.error({ diff, hunkIndex });
    throw new Error(`resolveRegion: Invalid hunk index: ${hunkIndex}`);
  }

  if (
    startContentIndex < 0 ||
    endContentIndex >= currentHunk.hunkContent.length ||
    startContentIndex > endContentIndex
  ) {
    throw new Error(
      `resolveRegion: Invalid content range, ${startContentIndex}, ${endContentIndex}`
    );
  }

  const { hunks, additionLines, deletionLines } = diff;
  const resolvedDiff: FileDiffMetadata = {
    ...diff,
    hunks: [],
    deletionLines: [],
    additionLines: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    cacheKey:
      diff.cacheKey != null
        ? `${diff.cacheKey}:${resolution[0]}-${hunkIndex}:${startContentIndex}-${endContentIndex}${trimContextLines != null ? `:t-${trimContextLines}` : ''}`
        : undefined,
  };

  const cursor: CursorState = {
    nextAdditionLineIndex: 0,
    nextDeletionLineIndex: 0,
    nextAdditionStart: 1,
    nextDeletionStart: 1,
    splitLineCount: 0,
    unifiedLineCount: 0,
  };
  const emissionState: EmissionState = {
    nextAdditionStart: 1,
    nextDeletionStart: 1,
    splitLineCount: 0,
    unifiedLineCount: 0,
  };
  const updatesEOFState =
    hunkIndex === hunks.length - 1 &&
    endContentIndex === currentHunk.hunkContent.length - 1;
  const shouldProcessCollapsedContext = !diff.isPartial;

  for (const [index, hunk] of hunks.entries()) {
    processCollapsedContext(
      diff,
      resolvedDiff,
      cursor,
      hunk.deletionLineIndex - hunk.collapsedBefore,
      hunk.additionLineIndex - hunk.collapsedBefore,
      hunk.collapsedBefore,
      shouldProcessCollapsedContext
    );

    const newHunk = createScannedHunk(hunk, cursor);

    for (const [contentIndex, content] of hunk.hunkContent.entries()) {
      // If we are outside of the targeted hunk or content region
      if (
        index !== hunkIndex ||
        contentIndex < startContentIndex ||
        contentIndex > endContentIndex
      ) {
        pushContentLinesToDiff(
          content,
          resolvedDiff,
          deletionLines,
          additionLines
        );
        const newContent = {
          ...content,
          additionLineIndex: cursor.nextAdditionLineIndex,
          deletionLineIndex: cursor.nextDeletionLineIndex,
        };
        newHunk.hunkContent.push(newContent);
        advanceCursor(newContent, cursor, newHunk);
      }
      // If we are at an index to delete, replace with an empty context node
      else if (indexesToDelete.has(contentIndex)) {
        newHunk.hunkContent.push({
          type: 'context',
          lines: 0,
          deletionLineIndex: cursor.nextDeletionLineIndex,
          additionLineIndex: cursor.nextAdditionLineIndex,
        });
      }
      // There's nothing to `resolve` with context nodes, so just push them as
      // they are
      else if (content.type === 'context') {
        pushContentLinesToDiff(
          content,
          resolvedDiff,
          deletionLines,
          additionLines
        );
        const newContent: ContextContent = {
          ...content,
          deletionLineIndex: cursor.nextDeletionLineIndex,
          additionLineIndex: cursor.nextAdditionLineIndex,
        };
        newHunk.hunkContent.push(newContent);
        advanceCursor(newContent, cursor, newHunk);
      }
      // Looks like we have a change to resolve and push
      else {
        pushResolveLinesToDiff(
          resolution,
          content,
          resolvedDiff,
          deletionLines,
          additionLines
        );
        const newContent: ContextContent = {
          type: 'context',
          lines:
            resolution === 'deletions'
              ? content.deletions
              : resolution === 'additions'
                ? content.additions
                : content.deletions + content.additions,
          deletionLineIndex: cursor.nextDeletionLineIndex,
          additionLineIndex: cursor.nextAdditionLineIndex,
        };
        newHunk.hunkContent.push(newContent);
        advanceCursor(newContent, cursor, newHunk);
      }
    }

    if (index === hunkIndex && updatesEOFState) {
      const noEOFCR =
        resolution === 'deletions'
          ? hunk.noEOFCRDeletions
          : hunk.noEOFCRAdditions;
      newHunk.noEOFCRAdditions = noEOFCR;
      newHunk.noEOFCRDeletions = noEOFCR;
    }

    const emittedHunks =
      index === hunkIndex && trimContextLines != null
        ? trimResolvedHunk(newHunk, trimContextLines)
        : [newHunk];

    emitResolvedHunks(resolvedDiff, newHunk, emittedHunks, emissionState);
  }

  if (resolvedDiff.hunks.length === 0) {
    resolvedDiff.deletionLines = [];
    resolvedDiff.additionLines = [];
    resolvedDiff.splitLineCount = 0;
    resolvedDiff.unifiedLineCount = 0;
    return resolvedDiff;
  }

  const finalHunk = hunks.at(-1);
  if (finalHunk != null && !diff.isPartial) {
    pushCollapsedContextLines(
      resolvedDiff,
      deletionLines,
      additionLines,
      finalHunk.deletionLineIndex + finalHunk.deletionCount,
      finalHunk.additionLineIndex + finalHunk.additionCount,
      Math.min(
        deletionLines.length -
          (finalHunk.deletionLineIndex + finalHunk.deletionCount),
        additionLines.length -
          (finalHunk.additionLineIndex + finalHunk.additionCount)
      )
    );
  }

  resolvedDiff.splitLineCount = cursor.splitLineCount;
  resolvedDiff.unifiedLineCount = cursor.unifiedLineCount;

  return resolvedDiff;
}

function createScannedHunk(hunk: Hunk, cursor: CursorState): Hunk {
  return {
    ...hunk,
    collapsedBefore: 0,
    hunkContent: [],
    additionStart: cursor.nextAdditionStart,
    deletionStart: cursor.nextDeletionStart,
    additionLineIndex: cursor.nextAdditionLineIndex,
    deletionLineIndex: cursor.nextDeletionLineIndex,
    additionCount: 0,
    deletionCount: 0,
    deletionLines: 0,
    additionLines: 0,
    splitLineStart: 0,
    unifiedLineStart: 0,
    splitLineCount: 0,
    unifiedLineCount: 0,
  };
}

function emitResolvedHunks(
  diff: FileDiffMetadata,
  sourceHunk: Hunk,
  hunks: EmitReadyHunk[],
  emissionState: EmissionState
) {
  for (const [index, hunk] of hunks.entries()) {
    const collapsedBefore = Math.max(
      hunk.additionStart - emissionState.nextAdditionStart,
      0
    );
    const emittedHunk: Hunk = {
      ...sourceHunk,
      ...hunk,
      collapsedBefore,
      splitLineStart: emissionState.splitLineCount + collapsedBefore,
      unifiedLineStart: emissionState.unifiedLineCount + collapsedBefore,
      hunkSpecs: createHunkSpecs(hunk, sourceHunk.hunkContext),
      noEOFCRAdditions:
        index === hunks.length - 1 ? sourceHunk.noEOFCRAdditions : false,
      noEOFCRDeletions:
        index === hunks.length - 1 ? sourceHunk.noEOFCRDeletions : false,
    };

    diff.hunks.push(emittedHunk);
    emissionState.nextAdditionStart =
      emittedHunk.additionStart + emittedHunk.additionCount;
    emissionState.nextDeletionStart =
      emittedHunk.deletionStart + emittedHunk.deletionCount;
    emissionState.splitLineCount =
      emittedHunk.splitLineStart + emittedHunk.splitLineCount;
    emissionState.unifiedLineCount =
      emittedHunk.unifiedLineStart + emittedHunk.unifiedLineCount;
  }
}

function createHunkSpecs(hunk: EmitReadyHunk, hunkContext: string | undefined) {
  return `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@${hunkContext != null ? ` ${hunkContext}` : ''}\n`;
}

function formatHunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function pushCollapsedContextLines(
  diff: FileDiffMetadata,
  deletionLines: string[],
  additionLines: string[],
  deletionLineIndex: number,
  additionLineIndex: number,
  lineCount: number
) {
  for (let index = 0; index < lineCount; index++) {
    const deletionLine = deletionLines[deletionLineIndex + index];
    const additionLine = additionLines[additionLineIndex + index];
    if (deletionLine == null || additionLine == null) {
      throw new Error(
        'pushCollapsedContextLines: missing collapsed context line'
      );
    }
    diff.deletionLines.push(deletionLine);
    diff.additionLines.push(additionLine);
  }
}

// Partial patches track omitted context in `collapsedBefore`, but those lines do
// not exist in the diff's line arrays. Keep the virtual row counts and file
// positions in sync without inventing hidden lines.
function processCollapsedContext(
  sourceDiff: FileDiffMetadata,
  resolvedDiff: FileDiffMetadata,
  cursor: CursorState,
  deletionLineIndex: number,
  additionLineIndex: number,
  lineCount: number,
  shouldProcessContent: boolean
) {
  if (lineCount <= 0) {
    return;
  }

  if (shouldProcessContent) {
    pushCollapsedContextLines(
      resolvedDiff,
      sourceDiff.deletionLines,
      sourceDiff.additionLines,
      deletionLineIndex,
      additionLineIndex,
      lineCount
    );
    cursor.nextAdditionLineIndex += lineCount;
    cursor.nextDeletionLineIndex += lineCount;
  }

  cursor.nextAdditionStart += lineCount;
  cursor.nextDeletionStart += lineCount;
  cursor.splitLineCount += lineCount;
  cursor.unifiedLineCount += lineCount;
}

function pushContentLinesToDiff(
  content: ContextContent | ChangeContent,
  diff: FileDiffMetadata,
  deletionLines: string[],
  additionLines: string[]
) {
  if (content.type === 'context') {
    for (let i = 0; i < content.lines; i++) {
      const line = additionLines[content.additionLineIndex + i];
      if (line == null) {
        console.error({ additionLines, content, i });
        throw new Error('pushContentLinesToDiff: Context line does not exist');
      }
      diff.deletionLines.push(line);
      diff.additionLines.push(line);
    }
  } else {
    const len = Math.max(content.deletions, content.additions);
    for (let i = 0; i < len; i++) {
      if (i < content.deletions) {
        const line = deletionLines[content.deletionLineIndex + i];
        if (line == null) {
          console.error({ deletionLines, content, i });
          throw new Error(
            'pushContentLinesToDiff: Deletion line does not exist'
          );
        }
        diff.deletionLines.push(line);
      }
      if (i < content.additions) {
        const line = additionLines[content.additionLineIndex + i];
        if (line == null) {
          console.error({ additionLines, content, i });
          throw new Error(
            'pushContentLinesToDiff: Addition line does not exist'
          );
        }
        diff.additionLines.push(line);
      }
    }
  }
}

function pushResolveLinesToDiff(
  resolution: 'deletions' | 'additions' | 'both',
  content: ChangeContent,
  diff: FileDiffMetadata,
  deletionLines: string[],
  additionLines: string[]
) {
  if (resolution === 'deletions' || resolution === 'both') {
    for (let i = 0; i < content.deletions; i++) {
      const line = deletionLines[content.deletionLineIndex + i];
      if (line == null) {
        console.error({ deletionLines, content, i });
        throw new Error('pushResolveLinesToDiff: Deletion line does not exist');
      }
      diff.deletionLines.push(line);
      diff.additionLines.push(line);
    }
  }
  if (resolution === 'additions' || resolution === 'both') {
    for (let i = 0; i < content.additions; i++) {
      const line = additionLines[content.additionLineIndex + i];
      if (line == null) {
        console.error({ additionLines, content, i });
        throw new Error('pushResolveLinesToDiff: Addition line does not exist');
      }
      diff.deletionLines.push(line);
      diff.additionLines.push(line);
    }
  }
}

function advanceCursor(
  content: ChangeContent | ContextContent,
  cursor: CursorState,
  hunk: Hunk
) {
  if (content.type === 'context') {
    cursor.nextAdditionLineIndex += content.lines;
    cursor.nextDeletionLineIndex += content.lines;
    cursor.nextAdditionStart += content.lines;
    cursor.nextDeletionStart += content.lines;
    cursor.splitLineCount += content.lines;
    cursor.unifiedLineCount += content.lines;

    hunk.additionCount += content.lines;
    hunk.deletionCount += content.lines;
    hunk.splitLineCount += content.lines;
    hunk.unifiedLineCount += content.lines;
  } else {
    cursor.nextAdditionLineIndex += content.additions;
    cursor.nextDeletionLineIndex += content.deletions;
    cursor.nextAdditionStart += content.additions;
    cursor.nextDeletionStart += content.deletions;
    cursor.splitLineCount += Math.max(content.deletions, content.additions);
    cursor.unifiedLineCount += content.deletions + content.additions;

    hunk.deletionCount += content.deletions;
    hunk.deletionLines += content.deletions;
    hunk.additionCount += content.additions;
    hunk.additionLines += content.additions;
    hunk.splitLineCount += Math.max(content.deletions, content.additions);
    hunk.unifiedLineCount += content.deletions + content.additions;
  }
}
