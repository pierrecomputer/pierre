import type {
  FileContents,
  FileDiffMetadata,
  Hunk,
  MergeConflictMarkerRow,
  MergeConflictMarkerRowType,
  MergeConflictRegion,
  ProcessFileConflictData,
} from '../types';

export interface ParseMergeConflictDiffFromFileResult {
  fileDiff: FileDiffMetadata;
  currentFile: FileContents;
  incomingFile: FileContents;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
}

export interface MergeConflictDiffAction extends ProcessFileConflictData {
  // Kept for callback consumers that still need the original unresolved-region
  // source-line coordinates alongside structural hunk-content anchors.
  conflict: MergeConflictRegion;
  conflictIndex: number;
  markerLines: {
    start: string;
    base?: string;
    separator: string;
    end: string;
  };
}

interface GetMergeConflictActionAnchorReturn {
  hunkIndex: number;
  lineIndex: number;
}

type MergeConflictStage = 'current' | 'base' | 'incoming';
type MergeConflictSide = MergeConflictStage;
type MergeConflictMarkerType = 'start' | 'base' | 'separator' | 'end';
type ContextFlushMode = 'before-change' | 'leading' | 'trailing';

interface HunkBuilder {
  additionStart: number;
  deletionStart: number;
  additionCount: number;
  deletionCount: number;
  additionLines: number;
  deletionLines: number;
  additionLineIndex: number;
  deletionLineIndex: number;
  hunkContent: Hunk['hunkContent'];
  // Context buffer: instead of storing per-line index arrays, we track the
  // starting indices and a count. Since context lines always push to both
  // additionLines and deletionLines consecutively, indices can be derived.
  contextBufferAdditionStart: number;
  contextBufferDeletionStart: number;
  contextBufferCount: number;
  // Sparse map of buffer-offset → conflictIndex for base-section context lines.
  // Empty for most buffers since base lines are rare.
  contextBufferBaseConflicts: Map<number, number> | undefined;
}

interface ConflictFrame {
  conflictIndex: number;
  stage: MergeConflictStage;
  startLineIndex: number;
  baseMarkerLineIndex?: number;
  separatorLineIndex?: number;
  markerLines: {
    start: string;
    base?: string;
    separator?: string;
  };
}

interface ConflictActionBuilder {
  action: MergeConflictDiffAction;
  completed: boolean;
}

export function getMergeConflictActionAnchor(
  action: MergeConflictDiffAction,
  fileDiff: FileDiffMetadata
): GetMergeConflictActionAnchorReturn | undefined {
  const hunk = fileDiff.hunks[action.hunkIndex];
  if (hunk == null) {
    return undefined;
  }
  return {
    hunkIndex: action.hunkIndex,
    lineIndex: getUnifiedLineStartForContent(hunk, action.startContentIndex),
  };
}

export function parseMergeConflictDiffFromFile(
  file: FileContents,
  maxContextLines: number = 10
): ParseMergeConflictDiffFromFileResult {
  // Never allow maxContextLines to drop below 1 or else things break.
  maxContextLines = Math.max(maxContextLines, 1);
  const maxContextLines2 = maxContextLines * 2;

  const deletionLines: string[] = [];
  const additionLines: string[] = [];
  const conflictStack: ConflictFrame[] = [];
  const conflictBuilders: ConflictActionBuilder[] = [];
  const actions: (MergeConflictDiffAction | undefined)[] = [];
  const hunks: Hunk[] = [];

  let nextConflictIndex = 0;
  let splitLineCount = 0;
  let unifiedLineCount = 0;
  let lastHunkEnd = 0;
  let activeHunk: HunkBuilder | undefined;

  const ensureActiveHunk = () => {
    activeHunk ??= createHunkBuilder(
      additionLines.length + 1,
      deletionLines.length + 1
    );
    return activeHunk;
  };

  const assignConflictContent = (
    conflictIndex: number,
    role: MergeConflictSide,
    contentIndex: number
  ) => {
    const builder = conflictBuilders[conflictIndex];
    if (builder == null) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to locate conflict action ${conflictIndex}`
      );
    }

    const action = builder.action;
    const hunkIndex = hunks.length;
    if (action.hunkIndex < 0) {
      action.hunkIndex = hunkIndex;
    } else if (action.hunkIndex !== hunkIndex) {
      throw new Error(
        `parseMergeConflictDiffFromFile: conflict ${conflictIndex} spans multiple hunks and cannot be anchored`
      );
    }

    if (action.startContentIndex < 0) {
      action.startContentIndex = contentIndex;
    }
    action.endContentIndex = contentIndex;
    action.endMarkerContentIndex = contentIndex;

    if (role === 'current') {
      action.currentContentIndex ??= contentIndex;
      return;
    }
    if (role === 'base') {
      action.baseContentIndex ??= contentIndex;
      return;
    }
    action.incomingContentIndex = contentIndex;
  };

  // Append a context line, coalescing with the previous group if also context.
  const appendContextLine = (
    hunk: HunkBuilder,
    additionLineIndex: number,
    deletionLineIndex: number
  ): number => {
    const hunkContent = hunk.hunkContent;
    const lastContent = hunkContent[hunkContent.length - 1];
    if (lastContent?.type === 'context') {
      lastContent.lines++;
      return hunkContent.length - 1;
    }
    hunkContent.push({
      type: 'context',
      lines: 1,
      additionLineIndex,
      deletionLineIndex,
    });
    return hunkContent.length - 1;
  };

  // Append a change line, coalescing with the previous group if also a change.
  const appendChangeLine = (
    hunk: HunkBuilder,
    lineType: 'addition' | 'deletion',
    additionLineIndex: number,
    deletionLineIndex: number
  ): number => {
    const hunkContent = hunk.hunkContent;
    const lastContent = hunkContent[hunkContent.length - 1];
    if (lastContent?.type === 'change') {
      if (lineType === 'addition') {
        lastContent.additions++;
      } else {
        lastContent.deletions++;
      }
      return hunkContent.length - 1;
    }
    hunkContent.push({
      type: 'change',
      additions: lineType === 'addition' ? 1 : 0,
      deletions: lineType === 'deletion' ? 1 : 0,
      additionLineIndex,
      deletionLineIndex,
    });
    return hunkContent.length - 1;
  };

  const flushBufferedContext = (hunk: HunkBuilder, mode: ContextFlushMode) => {
    let count = hunk.contextBufferCount;
    let addStart = hunk.contextBufferAdditionStart;
    let delStart = hunk.contextBufferDeletionStart;

    if (mode === 'leading' && count > maxContextLines) {
      const difference = count - maxContextLines;
      addStart += difference;
      delStart += difference;
      count = maxContextLines;
      hunk.additionStart += difference;
      hunk.deletionStart += difference;
      hunk.additionLineIndex += difference;
      hunk.deletionLineIndex += difference;
    }

    if (mode === 'trailing' && count > maxContextLines) {
      count = maxContextLines;
    }

    if (count === 0) {
      hunk.contextBufferCount = 0;
      hunk.contextBufferBaseConflicts = undefined;
      return;
    }

    const baseConflicts = hunk.contextBufferBaseConflicts;
    const bufferStartOffset = addStart - hunk.contextBufferAdditionStart;
    for (let i = 0; i < count; i++) {
      const contentIndex = appendContextLine(hunk, addStart + i, delStart + i);
      hunk.additionCount++;
      hunk.deletionCount++;
      if (baseConflicts != null) {
        const baseConflictIndex = baseConflicts.get(bufferStartOffset + i);
        if (baseConflictIndex != null) {
          assignConflictContent(baseConflictIndex, 'base', contentIndex);
        }
      }
    }
    hunk.contextBufferCount = 0;
    hunk.contextBufferBaseConflicts = undefined;
  };

  const finalizeActiveHunk = () => {
    if (activeHunk == null) {
      return;
    }

    const hunk = activeHunk;
    activeHunk = undefined;
    if (hunk.hunkContent.length === 0) {
      return;
    }

    let hunkSplitLineCount = 0;
    let hunkUnifiedLineCount = 0;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        hunkSplitLineCount += content.lines;
        hunkUnifiedLineCount += content.lines;
      } else {
        hunkSplitLineCount += Math.max(content.additions, content.deletions);
        hunkUnifiedLineCount += content.additions + content.deletions;
      }
    }

    const collapsedBefore = Math.max(hunk.additionStart - 1 - lastHunkEnd, 0);
    const finalizedHunk: Hunk = {
      collapsedBefore,
      additionStart: hunk.additionStart,
      additionCount: hunk.additionCount,
      additionLines: hunk.additionLines,
      additionLineIndex: hunk.additionLineIndex,
      deletionStart: hunk.deletionStart,
      deletionCount: hunk.deletionCount,
      deletionLines: hunk.deletionLines,
      deletionLineIndex: hunk.deletionLineIndex,
      hunkContent: hunk.hunkContent,
      hunkContext: undefined,
      hunkSpecs: `@@ -${formatHunkRange(hunk.deletionStart, hunk.deletionCount)} +${formatHunkRange(hunk.additionStart, hunk.additionCount)} @@\n`,
      splitLineStart: splitLineCount + collapsedBefore,
      splitLineCount: hunkSplitLineCount,
      unifiedLineStart: unifiedLineCount + collapsedBefore,
      unifiedLineCount: hunkUnifiedLineCount,
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
    };

    hunks.push(finalizedHunk);
    splitLineCount += collapsedBefore + hunkSplitLineCount;
    unifiedLineCount += collapsedBefore + hunkUnifiedLineCount;
    lastHunkEnd = hunk.additionStart + hunk.additionCount - 1;
  };

  const splitHunkWithBufferedContext = () => {
    if (activeHunk == null) {
      return;
    }

    const hunk = activeHunk;
    const count = hunk.contextBufferCount;
    const omittedContextLineCount = count - maxContextLines2;

    // Save trailing context start indices for the next hunk.
    const nextAddStart =
      hunk.contextBufferAdditionStart + count - maxContextLines;
    const nextDelStart =
      hunk.contextBufferDeletionStart + count - maxContextLines;

    // Extract base conflicts that fall within the trailing portion.
    let nextBaseConflicts: Map<number, number> | undefined;
    if (hunk.contextBufferBaseConflicts != null) {
      const tailOffset = count - maxContextLines;
      for (const [offset, ci] of hunk.contextBufferBaseConflicts) {
        if (offset >= tailOffset) {
          nextBaseConflicts ??= new Map();
          nextBaseConflicts.set(offset - tailOffset, ci);
        }
      }
    }

    flushBufferedContext(hunk, 'trailing');
    const emittedAdditionCount = hunk.additionCount;
    const emittedDeletionCount = hunk.deletionCount;
    finalizeActiveHunk();

    activeHunk = createHunkBuilder(
      hunk.additionStart + emittedAdditionCount + omittedContextLineCount,
      hunk.deletionStart + emittedDeletionCount + omittedContextLineCount
    );
    activeHunk.contextBufferAdditionStart = nextAddStart;
    activeHunk.contextBufferDeletionStart = nextDelStart;
    activeHunk.contextBufferCount = maxContextLines;
    activeHunk.contextBufferBaseConflicts = nextBaseConflicts;
  };

  // Emit a context line. For base-section lines inside a conflict, pass the
  // conflict index; otherwise defaults to -1 (no conflict association).
  const emitContextLine = (line: string, baseConflictIndex: number = -1) => {
    const hunk = ensureActiveHunk();
    // Reset buffer start on first line after a flush/creation.
    if (hunk.contextBufferCount === 0) {
      hunk.contextBufferAdditionStart = additionLines.length;
      hunk.contextBufferDeletionStart = deletionLines.length;
    }
    additionLines.push(line);
    deletionLines.push(line);
    if (baseConflictIndex >= 0) {
      hunk.contextBufferBaseConflicts ??= new Map();
      hunk.contextBufferBaseConflicts.set(
        hunk.contextBufferCount,
        baseConflictIndex
      );
    }
    hunk.contextBufferCount++;
  };

  const emitChangeLine = (
    lineType: 'addition' | 'deletion',
    line: string,
    conflictIndex: number,
    role: MergeConflictSide
  ) => {
    const hunk = ensureActiveHunk();
    if (
      hunk.hunkContent.length > 0 &&
      hunk.contextBufferCount > maxContextLines2
    ) {
      splitHunkWithBufferedContext();
    }

    const targetHunk = ensureActiveHunk();
    flushBufferedContext(
      targetHunk,
      targetHunk.hunkContent.length === 0 ? 'leading' : 'before-change'
    );

    const additionLineIndex = additionLines.length;
    const deletionLineIndex = deletionLines.length;
    if (lineType === 'addition') {
      additionLines.push(line);
    } else {
      deletionLines.push(line);
    }

    const contentIndex = appendChangeLine(
      targetHunk,
      lineType,
      additionLineIndex,
      deletionLineIndex
    );

    if (lineType === 'addition') {
      targetHunk.additionCount++;
      targetHunk.additionLines++;
    } else {
      targetHunk.deletionCount++;
      targetHunk.deletionLines++;
    }
    assignConflictContent(conflictIndex, role, contentIndex);
  };

  const finalizeConflict = (
    frame: ConflictFrame,
    endLineIndex: number,
    endMarkerLine: string
  ) => {
    if (
      frame.separatorLineIndex == null ||
      frame.markerLines.separator == null
    ) {
      throw new Error(
        `parseMergeConflictDiffFromFile: conflict ${frame.conflictIndex} is missing a separator marker`
      );
    }

    const builder = conflictBuilders[frame.conflictIndex];
    if (builder == null) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to finalize conflict ${frame.conflictIndex}`
      );
    }

    const action = builder.action;
    action.markerLines.separator = frame.markerLines.separator;
    action.markerLines.end = endMarkerLine;
    if (frame.markerLines.base != null) {
      action.markerLines.base = frame.markerLines.base;
    }

    action.conflict = {
      conflictIndex: frame.conflictIndex,
      startLineIndex: frame.startLineIndex,
      startLineNumber: frame.startLineIndex + 1,
      separatorLineIndex: frame.separatorLineIndex,
      separatorLineNumber: frame.separatorLineIndex + 1,
      endLineIndex,
      endLineNumber: endLineIndex + 1,
      baseMarkerLineIndex: frame.baseMarkerLineIndex,
      baseMarkerLineNumber:
        frame.baseMarkerLineIndex != null
          ? frame.baseMarkerLineIndex + 1
          : undefined,
    };

    const fallbackContentIndex =
      action.currentContentIndex ?? action.incomingContentIndex;
    action.currentContentIndex ??= fallbackContentIndex;
    action.incomingContentIndex ??= fallbackContentIndex;
    if (action.startContentIndex < 0 && fallbackContentIndex != null) {
      action.startContentIndex = fallbackContentIndex;
    }
    if (action.endContentIndex < 0 && fallbackContentIndex != null) {
      action.endContentIndex = fallbackContentIndex;
    }
    if (action.endMarkerContentIndex < 0 && fallbackContentIndex != null) {
      action.endMarkerContentIndex = fallbackContentIndex;
    }

    if (
      action.hunkIndex < 0 ||
      action.startContentIndex < 0 ||
      action.endContentIndex < 0 ||
      action.endMarkerContentIndex < 0
    ) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to anchor merge conflict ${frame.conflictIndex}`
      );
    }

    actions[action.conflictIndex] = action;
    builder.completed = true;
  };

  forEachFileLine(file.contents, (line, index) => {
    const markerType = getMergeConflictMarkerType(line);

    if (markerType === 'start') {
      const conflictIndex = nextConflictIndex;
      nextConflictIndex++;
      conflictStack.push({
        conflictIndex,
        stage: 'current',
        startLineIndex: index,
        markerLines: { start: line },
      });
      conflictBuilders[conflictIndex] = {
        completed: false,
        action: {
          conflict: {
            conflictIndex,
            startLineIndex: index,
            startLineNumber: index + 1,
            separatorLineIndex: index,
            separatorLineNumber: index + 1,
            endLineIndex: index,
            endLineNumber: index + 1,
            baseMarkerLineIndex: undefined,
            baseMarkerLineNumber: undefined,
          },
          conflictIndex,
          hunkIndex: -1,
          startContentIndex: -1,
          endContentIndex: -1,
          endMarkerContentIndex: -1,
          markerLines: {
            start: line,
            separator: '',
            end: '',
          },
        },
      };
      return;
    }

    const frame = conflictStack[conflictStack.length - 1];
    if (markerType === 'base') {
      if (frame == null) {
        emitContextLine(line);
      } else {
        frame.stage = 'base';
        frame.baseMarkerLineIndex = index;
        frame.markerLines.base = line;
      }
      return;
    }

    if (markerType === 'separator') {
      if (frame == null) {
        emitContextLine(line);
      } else {
        frame.stage = 'incoming';
        frame.separatorLineIndex = index;
        frame.markerLines.separator = line;
      }
      return;
    }

    if (markerType === 'end') {
      if (frame == null) {
        emitContextLine(line);
      } else {
        const completedFrame = conflictStack.pop();
        if (completedFrame == null) {
          throw new Error(
            'parseMergeConflictDiffFromFile: encountered end marker before start marker'
          );
        }
        finalizeConflict(completedFrame, index, line);
      }
      return;
    }

    if (frame == null) {
      emitContextLine(line);
      return;
    }

    if (frame.stage === 'current') {
      emitChangeLine('deletion', line, frame.conflictIndex, 'current');
    } else if (frame.stage === 'base') {
      emitContextLine(line, frame.conflictIndex);
    } else {
      emitChangeLine('addition', line, frame.conflictIndex, 'incoming');
    }
  });

  if (conflictStack.length > 0) {
    throw new Error(
      'parseMergeConflictDiffFromFile: unfinished merge conflict marker stack'
    );
  }

  if (activeHunk != null && activeHunk.hunkContent.length > 0) {
    flushBufferedContext(activeHunk, 'trailing');
    finalizeActiveHunk();
  }

  for (
    let conflictIndex = 0;
    conflictIndex < conflictBuilders.length;
    conflictIndex++
  ) {
    const builder = conflictBuilders[conflictIndex];
    if (builder == null || !builder.completed) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to build merge conflict action ${conflictIndex}`
      );
    }
  }

  if (
    hunks.length > 0 &&
    additionLines.length > 0 &&
    deletionLines.length > 0
  ) {
    const lastHunk = hunks[hunks.length - 1];
    const collapsedAfter = Math.max(
      additionLines.length -
        (lastHunk.additionStart + lastHunk.additionCount - 1),
      0
    );
    splitLineCount += collapsedAfter;
    unifiedLineCount += collapsedAfter;
  }

  const currentContents = deletionLines.join('');
  const incomingContents = additionLines.join('');
  const currentFile = createResolvedConflictFile(
    file,
    'current',
    currentContents
  );
  const incomingFile = createResolvedConflictFile(
    file,
    'incoming',
    incomingContents
  );

  let type: FileDiffMetadata['type'] = 'change';
  if (incomingContents === '') {
    type = 'deleted';
  } else if (currentContents === '') {
    type = 'new';
  }

  const fileDiff: FileDiffMetadata = {
    name: file.name,
    prevName: undefined,
    type,
    hunks,
    splitLineCount,
    unifiedLineCount,
    isPartial: false,
    deletionLines,
    additionLines,
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-diff`
        : undefined,
  };

  return {
    fileDiff,
    currentFile,
    incomingFile,
    actions,
    markerRows: buildMergeConflictMarkerRows(fileDiff, actions),
  };
}

function createHunkBuilder(
  additionStart: number,
  deletionStart: number
): HunkBuilder {
  return {
    additionStart,
    deletionStart,
    additionCount: 0,
    deletionCount: 0,
    additionLines: 0,
    deletionLines: 0,
    additionLineIndex: Math.max(additionStart - 1, 0),
    deletionLineIndex: Math.max(deletionStart - 1, 0),
    hunkContent: [],
    contextBufferAdditionStart: Math.max(additionStart - 1, 0),
    contextBufferDeletionStart: Math.max(deletionStart - 1, 0),
    contextBufferCount: 0,
    contextBufferBaseConflicts: undefined,
  };
}

// Iterate file contents line-by-line while preserving trailing newlines.
// This avoids allocating an intermediate `string[]` for large conflict files.
function forEachFileLine(
  contents: string,
  callback: (line: string, index: number) => void
) {
  const contentLength = contents.length;
  if (contentLength === 0) {
    return;
  }

  let lineStart = 0;
  let lineIndex = 0;
  for (let index = 0; index < contentLength; index++) {
    if (contents.charCodeAt(index) !== 10) {
      continue;
    }

    callback(contents.slice(lineStart, index + 1), lineIndex);
    lineStart = index + 1;
    lineIndex++;
  }

  if (lineStart < contentLength) {
    callback(contents.slice(lineStart), lineIndex);
  }
}

function formatHunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

function getMergeConflictMarkerType(
  line: string
): MergeConflictMarkerType | undefined {
  if (line.length < 7) {
    return undefined;
  }

  const markerCode = line.charCodeAt(0);
  if (
    markerCode !== 60 &&
    markerCode !== 62 &&
    markerCode !== 61 &&
    markerCode !== 124
  ) {
    return undefined;
  }

  const lineEnd = getLineContentEndIndex(line);
  if (lineEnd < 7) {
    return undefined;
  }

  let markerLength = 1;
  while (
    markerLength < lineEnd &&
    line.charCodeAt(markerLength) === markerCode
  ) {
    markerLength++;
  }

  if (markerLength < 7) {
    return undefined;
  }

  if (markerCode === 61) {
    return markerLength === lineEnd ? 'separator' : undefined;
  }

  if (
    markerLength !== lineEnd &&
    !isWhitespaceCode(line.charCodeAt(markerLength))
  ) {
    return undefined;
  }

  if (markerCode === 60) {
    return 'start';
  }
  if (markerCode === 62) {
    return 'end';
  }
  return 'base';
}

function getLineContentEndIndex(line: string): number {
  let end = line.length;
  if (end > 0 && line.charCodeAt(end - 1) === 10) {
    end--;
  }
  if (end > 0 && line.charCodeAt(end - 1) === 13) {
    end--;
  }
  return end;
}

function isWhitespaceCode(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 11 ||
    code === 12 ||
    code === 13 ||
    code === 32
  );
}

function createResolvedConflictFile(
  file: FileContents,
  side: 'current' | 'incoming',
  contents: string
): FileContents {
  return {
    ...file,
    contents,
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-${side}`
        : undefined,
  };
}

export function buildMergeConflictMarkerRows(
  fileDiff: FileDiffMetadata,
  actions: (MergeConflictDiffAction | undefined)[]
): MergeConflictMarkerRow[] {
  const markerRows: MergeConflictMarkerRow[] = [];
  const hunkLineStartCache: (number[] | undefined)[] = new Array(
    fileDiff.hunks.length
  );

  const getLineStart = (hunkIndex: number, contentIndex: number): number => {
    const hunk = fileDiff.hunks[hunkIndex];
    if (hunk == null) {
      return 0;
    }
    let starts = hunkLineStartCache[hunkIndex];
    if (starts == null) {
      starts = new Array<number>(hunk.hunkContent.length + 1);
      let lineIndex = hunk.unifiedLineStart;
      starts[0] = lineIndex;
      for (let index = 0; index < hunk.hunkContent.length; index++) {
        const content = hunk.hunkContent[index];
        lineIndex +=
          content.type === 'context'
            ? content.lines
            : content.deletions + content.additions;
        starts[index + 1] = lineIndex;
      }
      hunkLineStartCache[hunkIndex] = starts;
    }
    return starts[Math.max(contentIndex, 0)] ?? hunk.unifiedLineStart;
  };

  const getLineEnd = (hunkIndex: number, contentIndex: number): number => {
    const lineStart = getLineStart(hunkIndex, contentIndex);
    const starts = hunkLineStartCache[hunkIndex];
    const lineEndExclusive =
      starts?.[Math.max(contentIndex + 1, 0)] ??
      getLineStart(hunkIndex, contentIndex + 1);
    return Math.max(lineStart, lineEndExclusive - 1);
  };

  for (const action of actions) {
    if (action == null) {
      continue;
    }

    const hunk = fileDiff.hunks[action.hunkIndex];
    if (hunk == null) {
      continue;
    }

    const actionLineIndex = getLineStart(
      action.hunkIndex,
      action.startContentIndex
    );
    markerRows.push(
      createMergeConflictMarkerRow(
        action,
        'marker-start',
        action.startContentIndex,
        action.markerLines.start,
        actionLineIndex
      )
    );

    if (action.baseContentIndex != null) {
      const currentContentIndex = action.currentContentIndex;
      const incomingContentIndex = action.incomingContentIndex;
      if (currentContentIndex == null || incomingContentIndex == null) {
        continue;
      }

      const baseMarkerLine = action.markerLines.base;
      if (baseMarkerLine == null) {
        continue;
      }

      const currentChange = hunk.hunkContent[currentContentIndex];
      const baseContext = hunk.hunkContent[action.baseContentIndex];
      const incomingChange = hunk.hunkContent[incomingContentIndex];
      if (
        currentChange?.type !== 'change' ||
        baseContext?.type !== 'context' ||
        incomingChange?.type !== 'change'
      ) {
        continue;
      }

      const currentStart = getLineStart(action.hunkIndex, currentContentIndex);
      const incomingStart = getLineStart(
        action.hunkIndex,
        incomingContentIndex
      );
      markerRows.push(
        createMergeConflictMarkerRow(
          action,
          'marker-base',
          action.baseContentIndex,
          baseMarkerLine,
          currentStart + currentChange.deletions
        )
      );

      markerRows.push(
        createMergeConflictMarkerRow(
          action,
          'marker-separator',
          action.baseContentIndex,
          action.markerLines.separator,
          incomingStart
        ),
        createMergeConflictMarkerRow(
          action,
          'marker-end',
          action.endMarkerContentIndex,
          action.markerLines.end,
          getLineEnd(action.hunkIndex, action.endMarkerContentIndex)
        )
      );
      continue;
    }

    const currentContentIndex = action.currentContentIndex;
    if (currentContentIndex == null) {
      continue;
    }
    const content = hunk.hunkContent[currentContentIndex];
    if (content?.type !== 'change') {
      continue;
    }

    const contentStart = getLineStart(action.hunkIndex, currentContentIndex);
    const separatorLineIndex =
      content.deletions > 0
        ? contentStart + content.deletions
        : actionLineIndex;

    markerRows.push(
      createMergeConflictMarkerRow(
        action,
        'marker-separator',
        currentContentIndex,
        action.markerLines.separator,
        separatorLineIndex
      ),
      createMergeConflictMarkerRow(
        action,
        'marker-end',
        action.endMarkerContentIndex,
        action.markerLines.end,
        getLineEnd(action.hunkIndex, action.endMarkerContentIndex)
      )
    );
  }

  return markerRows;
}

function createMergeConflictMarkerRow(
  action: MergeConflictDiffAction,
  type: MergeConflictMarkerRowType,
  contentIndex: number,
  lineText: string,
  lineIndex: number
): MergeConflictMarkerRow {
  return {
    type,
    hunkIndex: action.hunkIndex,
    contentIndex,
    conflictIndex: action.conflictIndex,
    lineText,
    lineIndex,
  };
}

function getUnifiedLineStartForContent(
  hunk: Hunk,
  contentIndex: number
): number {
  let lineIndex = hunk.unifiedLineStart;
  for (let index = 0; index < contentIndex; index++) {
    const content = hunk.hunkContent[index];
    lineIndex +=
      content.type === 'context'
        ? content.lines
        : content.deletions + content.additions;
  }
  return lineIndex;
}
