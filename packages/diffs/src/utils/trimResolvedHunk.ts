import type { ChangeContent, ContextContent, Hunk } from '../types';

export interface TrimmedResolvedHunk {
  additionStart: number;
  additionCount: number;
  additionLines: number;
  additionLineIndex: number;
  deletionStart: number;
  deletionCount: number;
  deletionLines: number;
  deletionLineIndex: number;
  splitLineCount: number;
  unifiedLineCount: number;
  hunkContent: (ContextContent | ChangeContent)[];
}

interface ContextBuffer {
  segments: BufferedContextContent[];
  totalLines: number;
}

interface BlockStarts {
  additionStart: number;
  deletionStart: number;
}

interface BufferedContextContent extends ContextContent, BlockStarts {}

interface BufferedChangeContent extends ChangeContent, BlockStarts {}

type BufferedContent = BufferedContextContent | BufferedChangeContent;

/**
 * Trim one resolved hunk down to the context needed around its remaining
 * change blocks, and split it when a large context run separates those blocks.
 */
export function trimResolvedHunk(
  hunk: Hunk,
  contextSize: number
): TrimmedResolvedHunk[] {
  if (!hunk.hunkContent.some((content) => content.type === 'change')) {
    return [];
  }

  const normalizedContextSize = Number.isFinite(contextSize)
    ? Math.max(0, Math.trunc(contextSize))
    : 0;
  const trimmedHunks: TrimmedResolvedHunk[] = [];
  const currentBlocks: BufferedContent[] = [];
  let pendingContext: ContextBuffer = createEmptyContextBuffer();
  let { additionStart: nextAdditionStart, deletionStart: nextDeletionStart } =
    hunk;

  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      appendContext(
        pendingContext,
        content,
        nextAdditionStart,
        nextDeletionStart
      );
      nextAdditionStart += content.lines;
      nextDeletionStart += content.lines;
      continue;
    }

    if (
      currentBlocks.length > 0 &&
      pendingContext.totalLines > normalizedContextSize * 2
    ) {
      pushContents(
        currentBlocks,
        takeLeadingContext(pendingContext, normalizedContextSize)
      );
      trimmedHunks.push(createTrimmedResolvedHunk(currentBlocks));

      const trailingContext = takeTrailingContext(
        pendingContext,
        normalizedContextSize
      );
      currentBlocks.length = 0;
      pushContents(currentBlocks, trailingContext);
    } else if (currentBlocks.length === 0) {
      pushContents(
        currentBlocks,
        takeTrailingContext(pendingContext, normalizedContextSize)
      );
    } else {
      pushContents(currentBlocks, pendingContext.segments);
    }

    pendingContext = createEmptyContextBuffer();
    pushContent(currentBlocks, {
      ...content,
      additionStart: nextAdditionStart,
      deletionStart: nextDeletionStart,
    });
    nextAdditionStart += content.additions;
    nextDeletionStart += content.deletions;
  }

  if (currentBlocks.length === 0) {
    return [];
  }

  pushContents(
    currentBlocks,
    takeLeadingContext(pendingContext, normalizedContextSize)
  );
  trimmedHunks.push(createTrimmedResolvedHunk(currentBlocks));

  return trimmedHunks;
}

function createTrimmedResolvedHunk(
  blocks: BufferedContent[]
): TrimmedResolvedHunk {
  const firstBlock = blocks[0];
  if (firstBlock == null) {
    throw new Error('createTrimmedResolvedHunk: missing hunk content');
  }

  let additionCount = 0;
  let deletionCount = 0;
  let additionLines = 0;
  let deletionLines = 0;
  let splitLineCount = 0;
  let unifiedLineCount = 0;
  const hunkContent: (ContextContent | ChangeContent)[] = [];

  for (const content of blocks) {
    if (content.type === 'context') {
      additionCount += content.lines;
      deletionCount += content.lines;
      splitLineCount += content.lines;
      unifiedLineCount += content.lines;
      hunkContent.push({
        type: 'context',
        lines: content.lines,
        additionLineIndex: content.additionLineIndex,
        deletionLineIndex: content.deletionLineIndex,
      });
      continue;
    }

    additionCount += content.additions;
    deletionCount += content.deletions;
    additionLines += content.additions;
    deletionLines += content.deletions;
    splitLineCount += Math.max(content.deletions, content.additions);
    unifiedLineCount += content.deletions + content.additions;
    hunkContent.push({
      type: 'change',
      additions: content.additions,
      deletions: content.deletions,
      additionLineIndex: content.additionLineIndex,
      deletionLineIndex: content.deletionLineIndex,
    });
  }

  return {
    additionStart: firstBlock.additionStart,
    additionCount,
    additionLines,
    additionLineIndex: firstBlock.additionLineIndex,
    deletionStart: firstBlock.deletionStart,
    deletionCount,
    deletionLines,
    deletionLineIndex: firstBlock.deletionLineIndex,
    splitLineCount,
    unifiedLineCount,
    hunkContent,
  };
}

function createEmptyContextBuffer(): ContextBuffer {
  return {
    segments: [],
    totalLines: 0,
  };
}

function appendContext(
  buffer: ContextBuffer,
  content: ContextContent,
  additionStart: number,
  deletionStart: number
) {
  if (content.lines <= 0) {
    return;
  }

  buffer.segments.push({
    ...content,
    additionStart,
    deletionStart,
  });
  buffer.totalLines += content.lines;
}

function takeLeadingContext(
  buffer: ContextBuffer,
  lineCount: number
): BufferedContextContent[] {
  if (lineCount <= 0) {
    return [];
  }

  const leadingContext: BufferedContextContent[] = [];
  let remaining = lineCount;

  for (const segment of buffer.segments) {
    if (remaining <= 0) {
      break;
    }

    const keptLines = Math.min(segment.lines, remaining);
    leadingContext.push({
      type: 'context',
      lines: keptLines,
      additionLineIndex: segment.additionLineIndex,
      deletionLineIndex: segment.deletionLineIndex,
      additionStart: segment.additionStart,
      deletionStart: segment.deletionStart,
    });
    remaining -= keptLines;
  }

  return leadingContext;
}

function takeTrailingContext(
  buffer: ContextBuffer,
  lineCount: number
): BufferedContextContent[] {
  if (lineCount <= 0) {
    return [];
  }

  const trailingContext: BufferedContextContent[] = [];
  let remaining = lineCount;

  for (let index = buffer.segments.length - 1; index >= 0; index--) {
    if (remaining <= 0) {
      break;
    }

    const segment = buffer.segments[index];
    if (segment == null) {
      continue;
    }

    const keptLines = Math.min(segment.lines, remaining);
    trailingContext.unshift({
      type: 'context',
      lines: keptLines,
      additionLineIndex: segment.additionLineIndex + segment.lines - keptLines,
      deletionLineIndex: segment.deletionLineIndex + segment.lines - keptLines,
      additionStart: segment.additionStart + segment.lines - keptLines,
      deletionStart: segment.deletionStart + segment.lines - keptLines,
    });
    remaining -= keptLines;
  }

  return trailingContext;
}

function pushContents(target: BufferedContent[], contents: BufferedContent[]) {
  for (const content of contents) {
    pushContent(target, content);
  }
}

function pushContent(target: BufferedContent[], content: BufferedContent) {
  if (content.type === 'context') {
    if (content.lines <= 0) {
      return;
    }

    const previous = target.at(-1);
    if (
      previous?.type === 'context' &&
      previous.additionLineIndex + previous.lines ===
        content.additionLineIndex &&
      previous.deletionLineIndex + previous.lines === content.deletionLineIndex
    ) {
      previous.lines += content.lines;
      return;
    }
  }

  target.push({ ...content });
}
