// Parses a file containing git merge conflict markers (<<<<<<< / ======= / >>>>>>>)
// into a synthetic unified diff. The core idea: treat the conflict file as though
// "current" lines are deletions and "incoming" lines are additions. Lines outside
// conflicts (and optional "base" sections from diff3) become shared context.
//
// The result is a standard FileDiffMetadata with hunks — identical in shape to what
// you'd get from parsing a real unified diff — plus a parallel array of
// MergeConflictDiffActions that anchor each conflict region to positions within the
// hunk structure. Downstream consumers (e.g. the merge conflict UI) use these
// anchors to overlay conflict markers onto the diff view.
//
// Architecture note: all helper functions are module-level (not closures inside the
// main function) and receive a shared ParseState object by reference. This avoids
// per-call scope-chain traversal on the hot path (~20K lines), where every line
// triggers 2-3 helper calls.
//
// ---
// NOTE: This file was nearly entirely written and optimized by AI. It has a
// verification harness that any future changes (human or AI) should be validated
// against:
//
//   Snapshot tests (from packages/diffs/):
//     bun test parseMergeConflictDiffFromFile
//
//   Performance benchmark (checksum must match 33121550):
//     bun ws diffs benchmark:parse-merge-conflict
//
// If you encounter a bug:
//   1. Add a new test case in test/parseMergeConflictDiffFromFile.test.ts with
//      input that reproduces the failure. Use toMatchSnapshot() so the expected
//      output is captured automatically once fixed.
//   2. Run `bun test parseMergeConflictDiffFromFile` from packages/diffs/ to
//      confirm the new test fails.
//   3. Use an AI agent with extended/high thinking to fix the logic — the
//      snapshot tests and benchmark provide a tight feedback loop. The agent
//      should iterate until all snapshots pass AND the benchmark checksum
//      matches. Update snapshots with `bun test test/parseMergeConflictDiffFromFile.test.ts -u`
//      only after verifying the new output is correct.
// ---

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

// Which section of a conflict we're currently inside while scanning lines.
// Progresses: current → (optional) base → incoming.
type MergeConflictStage = 'current' | 'base' | 'incoming';
type MergeConflictSide = MergeConflictStage;
type MergeConflictMarkerType = 'start' | 'base' | 'separator' | 'end';

// Controls how buffered context lines are trimmed when flushed to hunkContent:
//   'leading'       — first flush of a hunk; trim excess from the start
//   'before-change' — flush between changes; emit all buffered lines
//   'trailing'      — last flush of a hunk; trim excess from the end
type ContextFlushMode = 'before-change' | 'leading' | 'trailing';

// Mutable accumulator for building a single Hunk. Tracks line counts, the
// hunkContent array (sequence of context/change groups), and a "context buffer"
// that defers writing context lines until we know whether they're leading,
// trailing, or mid-hunk context.
//
// The context buffer avoids eagerly committing context lines to hunkContent.
// When a change line arrives, we flush the buffer — trimming to maxContextLines
// if it's the leading or trailing edge of a hunk, or splitting into two hunks
// if the gap between changes exceeds maxContextLines * 2.
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

// Tracks an in-progress conflict as we scan through its lines. Pushed onto
// conflictStack when we hit a <<<<<<< marker, and popped + finalized when we
// hit the matching >>>>>>> marker. The `stage` field tells processLine which
// section we're in so it knows whether to emit deletions, context, or additions.
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

// Bundles all mutable state shared across parse helper functions, replacing
// closure-captured variables with a single object passed by reference.
//
// The two key arrays — deletionLines and additionLines — are the synthetic
// "before" and "after" file contents. Context lines are pushed to both arrays
// (identical on both sides). Current-side conflict lines go only into
// deletionLines; incoming-side lines go only into additionLines. After parsing,
// joining each array produces the resolved file for that side.
interface ParseState {
  // "Before" file lines (context + current-side conflict content).
  deletionLines: string[];
  // "After" file lines (context + incoming-side conflict content).
  additionLines: string[];
  // Stack of open conflict regions (supports nested conflicts, though rare).
  conflictStack: ConflictFrame[];
  // Parallel to actions[]; accumulates content indices during parsing.
  conflictBuilders: ConflictActionBuilder[];
  // Final output: one action per conflict, indexed by conflictIndex.
  actions: (MergeConflictDiffAction | undefined)[];
  // Finalized hunks, appended as context gaps cause hunk splits.
  hunks: Hunk[];
  nextConflictIndex: number;
  // Running line totals used to compute hunk splitLineStart/unifiedLineStart.
  splitLineCount: number;
  unifiedLineCount: number;
  // 1-based line number where the previous hunk ended (for collapsedBefore).
  lastHunkEnd: number;
  // The hunk currently being built; undefined between hunks.
  activeHunk: HunkBuilder | undefined;
  maxContextLines: number;
  // Cached maxContextLines * 2 (the threshold for splitting a hunk).
  maxContextLines2: number;
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

// Main entry point. Walks every line of the conflict file exactly once,
// dispatching each line through processLine which routes it to the appropriate
// emitter (context or change). After the loop, finalizes the last hunk,
// validates all conflicts were closed, and assembles the result.
//
// The three phases are:
//   1. Line-by-line scan  — builds hunks and conflict actions incrementally
//   2. Post-loop cleanup  — flushes trailing context, finalizes last hunk
//   3. Result assembly    — joins line arrays, builds marker rows for the UI
export function parseMergeConflictDiffFromFile(
  file: FileContents,
  maxContextLines: number = 6
): ParseMergeConflictDiffFromFileResult {
  // Never allow maxContextLines to drop below 1 or else things break.
  maxContextLines = Math.max(maxContextLines, 1);

  const s: ParseState = {
    deletionLines: [],
    additionLines: [],
    conflictStack: [],
    conflictBuilders: [],
    actions: [],
    hunks: [],
    nextConflictIndex: 0,
    splitLineCount: 0,
    unifiedLineCount: 0,
    lastHunkEnd: 0,
    activeHunk: undefined,
    maxContextLines,
    maxContextLines2: maxContextLines * 2,
  };

  // Phase 1: Line-by-line scan. We inline the indexOf loop here (rather than
  // calling a helper with a callback) to avoid creating a closure on the hot
  // path. Each line is sliced and dispatched to processLine.
  const contents = file.contents;
  const contentLength = contents.length;
  if (contentLength > 0) {
    let lineStart = 0;
    let lineIndex = 0;
    let newlinePos = contents.indexOf('\n', lineStart);
    while (newlinePos !== -1) {
      processLine(s, contents.slice(lineStart, newlinePos + 1), lineIndex);
      lineStart = newlinePos + 1;
      lineIndex++;
      newlinePos = contents.indexOf('\n', lineStart);
    }
    if (lineStart < contentLength) {
      processLine(s, contents.slice(lineStart), lineIndex);
    }
  }

  // Phase 2: Post-loop cleanup. Any unclosed conflict is an error. If the
  // last hunk has buffered context lines, flush them as trailing context and
  // finalize the hunk.
  if (s.conflictStack.length > 0) {
    throw new Error(
      'parseMergeConflictDiffFromFile: unfinished merge conflict marker stack'
    );
  }

  if (s.activeHunk != null && s.activeHunk.hunkContent.length > 0) {
    flushBufferedContext(s, s.activeHunk, 'trailing');
    finalizeActiveHunk(s);
  }

  for (
    let conflictIndex = 0;
    conflictIndex < s.conflictBuilders.length;
    conflictIndex++
  ) {
    const builder = s.conflictBuilders[conflictIndex];
    if (builder == null || !builder.completed) {
      throw new Error(
        `parseMergeConflictDiffFromFile: failed to build merge conflict action ${conflictIndex}`
      );
    }
  }

  // Phase 3: Result assembly. Account for any collapsed lines after the last
  // hunk, then join the line arrays to produce resolved file contents.
  if (
    s.hunks.length > 0 &&
    s.additionLines.length > 0 &&
    s.deletionLines.length > 0
  ) {
    const lastHunk = s.hunks[s.hunks.length - 1];
    const collapsedAfter = Math.max(
      s.additionLines.length -
        (lastHunk.additionStart + lastHunk.additionCount - 1),
      0
    );
    s.splitLineCount += collapsedAfter;
    s.unifiedLineCount += collapsedAfter;
  }

  const currentContents = s.deletionLines.join('');
  const incomingContents = s.additionLines.join('');
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
    hunks: s.hunks,
    splitLineCount: s.splitLineCount,
    unifiedLineCount: s.unifiedLineCount,
    isPartial: false,
    deletionLines: s.deletionLines,
    additionLines: s.additionLines,
    cacheKey:
      file.cacheKey != null
        ? `${file.cacheKey}:merge-conflict-diff`
        : undefined,
  };

  return {
    fileDiff,
    currentFile,
    incomingFile,
    actions: s.actions,
    markerRows: buildMergeConflictMarkerRows(fileDiff, s.actions),
  };
}

// ---------------------------------------------------------------------------
// Module-level parse helpers. Each receives ParseState by reference rather
// than capturing variables via closure. The call graph from the hot path is:
//
//   processLine
//     ├─ emitContextLine    → ensureActiveHunk
//     ├─ emitChangeLine     → ensureActiveHunk, splitHunkWithBufferedContext,
//     │                       flushBufferedContext, appendChangeLine,
//     │                       assignConflictContent
//     ├─ handleStartMarker
//     └─ finalizeConflict
// ---------------------------------------------------------------------------

// Routes a single source line to the right emitter based on whether we're
// inside a conflict and, if so, which section (current/base/incoming).
// Outside conflicts, only the start marker (<<<<<<< / charCode 60) can
// change state, so we skip the full marker check for non-'<' lines.
function processLine(s: ParseState, line: string, index: number): void {
  const frame = s.conflictStack[s.conflictStack.length - 1];

  // Outside any conflict: only start markers (<<<<<<<) can transition state.
  // Skip the full marker check for lines that can't be start markers.
  if (frame == null) {
    if (
      line.length >= 7 &&
      line.charCodeAt(0) === 60 &&
      getMergeConflictMarkerType(line) === 'start'
    ) {
      handleStartMarker(s, line, index);
      return;
    }
    emitContextLine(s, line);
    return;
  }

  // Inside a conflict: all marker types must be checked.
  const markerType = getMergeConflictMarkerType(line);

  if (markerType === 'start') {
    handleStartMarker(s, line, index);
    return;
  }

  if (markerType === 'base') {
    frame.stage = 'base';
    frame.baseMarkerLineIndex = index;
    frame.markerLines.base = line;
    return;
  }

  if (markerType === 'separator') {
    frame.stage = 'incoming';
    frame.separatorLineIndex = index;
    frame.markerLines.separator = line;
    return;
  }

  if (markerType === 'end') {
    const completedFrame = s.conflictStack.pop();
    if (completedFrame == null) {
      throw new Error(
        'parseMergeConflictDiffFromFile: encountered end marker before start marker'
      );
    }
    finalizeConflict(s, completedFrame, index, line);
    return;
  }

  if (frame.stage === 'current') {
    emitChangeLine(s, 'deletion', line, frame.conflictIndex, 'current');
  } else if (frame.stage === 'base') {
    emitContextLine(s, line, frame.conflictIndex);
  } else {
    emitChangeLine(s, 'addition', line, frame.conflictIndex, 'incoming');
  }
}

// Lazily creates the active HunkBuilder if one doesn't exist yet. The hunk's
// start positions are derived from the current length of the line arrays
// (1-based, matching unified diff conventions).
function ensureActiveHunk(s: ParseState): HunkBuilder {
  s.activeHunk ??= createHunkBuilder(
    s.additionLines.length + 1,
    s.deletionLines.length + 1
  );
  return s.activeHunk;
}

// "Anchors" a conflict to its position in the hunk's content array. Each
// conflict needs to know which hunk it lives in (hunkIndex) and which content
// entries correspond to its current/base/incoming sections. This is called
// every time we emit a change or context line that belongs to a conflict, and
// it incrementally widens the start/end content range.
function assignConflictContent(
  s: ParseState,
  conflictIndex: number,
  role: MergeConflictSide,
  contentIndex: number
): void {
  const builder = s.conflictBuilders[conflictIndex];
  if (builder == null) {
    throw new Error(
      `parseMergeConflictDiffFromFile: failed to locate conflict action ${conflictIndex}`
    );
  }

  const action = builder.action;
  const hunkIndex = s.hunks.length;
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
}

// Appends a change line to the hunk's content array. If the previous entry is
// already a 'change' group, we just bump its addition/deletion count instead
// of creating a new entry — this keeps hunkContent compact. Returns the
// content index so the caller can anchor the conflict to it.
function appendChangeLine(
  hunk: HunkBuilder,
  lineType: 'addition' | 'deletion',
  additionLineIndex: number,
  deletionLineIndex: number
): number {
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
}

// Drains the hunk's context buffer into hunkContent, applying mode-dependent
// trimming. The buffer accumulates context lines without committing them,
// because we don't know yet whether they'll be leading context (trim start),
// trailing context (trim end), or mid-hunk context (keep all). The mode tells
// us which case we're in:
//
//   'leading'       — first change in a new hunk; drop lines beyond
//                     maxContextLines from the front, and shift the hunk's
//                     start position forward accordingly.
//   'trailing'      — last flush before hunk finalization; keep at most
//                     maxContextLines from the front of the buffer.
//   'before-change' — mid-hunk context between two changes; emit everything.
function flushBufferedContext(
  s: ParseState,
  hunk: HunkBuilder,
  mode: ContextFlushMode
): void {
  let count = hunk.contextBufferCount;
  let addStart = hunk.contextBufferAdditionStart;
  let delStart = hunk.contextBufferDeletionStart;

  if (mode === 'leading' && count > s.maxContextLines) {
    const difference = count - s.maxContextLines;
    addStart += difference;
    delStart += difference;
    count = s.maxContextLines;
    hunk.additionStart += difference;
    hunk.deletionStart += difference;
    hunk.additionLineIndex += difference;
    hunk.deletionLineIndex += difference;
  }

  if (mode === 'trailing' && count > s.maxContextLines) {
    count = s.maxContextLines;
  }

  if (count === 0) {
    hunk.contextBufferCount = 0;
    hunk.contextBufferBaseConflicts = undefined;
    return;
  }

  // Bulk-append context: coalesce with previous context entry or create new
  // one. This avoids a per-line loop — significant when maxContextLines is
  // large.
  const hunkContent = hunk.hunkContent;
  const lastContent = hunkContent[hunkContent.length - 1];
  let contentIndex: number;
  if (lastContent?.type === 'context') {
    lastContent.lines += count;
    contentIndex = hunkContent.length - 1;
  } else {
    hunkContent.push({
      type: 'context',
      lines: count,
      additionLineIndex: addStart,
      deletionLineIndex: delStart,
    });
    contentIndex = hunkContent.length - 1;
  }
  hunk.additionCount += count;
  hunk.deletionCount += count;

  // Assign base-section conflict anchors (rare — only when base lines exist)
  const baseConflicts = hunk.contextBufferBaseConflicts;
  if (baseConflicts != null) {
    const bufferStartOffset = addStart - hunk.contextBufferAdditionStart;
    for (const [offset, conflictIndex] of baseConflicts) {
      if (offset >= bufferStartOffset && offset < bufferStartOffset + count) {
        assignConflictContent(s, conflictIndex, 'base', contentIndex);
      }
    }
  }
  hunk.contextBufferCount = 0;
  hunk.contextBufferBaseConflicts = undefined;
}

// Converts the mutable HunkBuilder into an immutable Hunk and pushes it onto
// s.hunks. Computes line counts for split and unified view, the collapsed-
// before gap (lines between the previous hunk and this one), and the hunk
// header string (e.g. "@@ -1,5 +1,7 @@").
function finalizeActiveHunk(s: ParseState): void {
  if (s.activeHunk == null) {
    return;
  }

  const hunk = s.activeHunk;
  s.activeHunk = undefined;
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

  const collapsedBefore = Math.max(hunk.additionStart - 1 - s.lastHunkEnd, 0);
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
    splitLineStart: s.splitLineCount + collapsedBefore,
    splitLineCount: hunkSplitLineCount,
    unifiedLineStart: s.unifiedLineCount + collapsedBefore,
    unifiedLineCount: hunkUnifiedLineCount,
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
  };

  s.hunks.push(finalizedHunk);
  s.splitLineCount += collapsedBefore + hunkSplitLineCount;
  s.unifiedLineCount += collapsedBefore + hunkUnifiedLineCount;
  s.lastHunkEnd = hunk.additionStart + hunk.additionCount - 1;
}

// Called when the context buffer between two changes exceeds maxContextLines*2.
// This means there's a big enough gap to warrant splitting into separate hunks
// (just like `diff -U` does). The procedure:
//   1. Flush the first maxContextLines of the buffer as trailing context
//   2. Finalize the current hunk
//   3. Start a new hunk pre-seeded with the last maxContextLines as leading context
// The middle portion of the buffer (between the two maxContextLines slices) is
// the "collapsed" region — lines omitted from the diff view.
function splitHunkWithBufferedContext(s: ParseState): void {
  if (s.activeHunk == null) {
    return;
  }

  const hunk = s.activeHunk;
  const count = hunk.contextBufferCount;
  const omittedContextLineCount = count - s.maxContextLines2;

  // Save trailing context start indices for the next hunk.
  const nextAddStart =
    hunk.contextBufferAdditionStart + count - s.maxContextLines;
  const nextDelStart =
    hunk.contextBufferDeletionStart + count - s.maxContextLines;

  // Extract base conflicts that fall within the trailing portion.
  let nextBaseConflicts: Map<number, number> | undefined;
  if (hunk.contextBufferBaseConflicts != null) {
    const tailOffset = count - s.maxContextLines;
    for (const [offset, ci] of hunk.contextBufferBaseConflicts) {
      if (offset >= tailOffset) {
        nextBaseConflicts ??= new Map();
        nextBaseConflicts.set(offset - tailOffset, ci);
      }
    }
  }

  flushBufferedContext(s, hunk, 'trailing');
  const emittedAdditionCount = hunk.additionCount;
  const emittedDeletionCount = hunk.deletionCount;
  finalizeActiveHunk(s);

  s.activeHunk = createHunkBuilder(
    hunk.additionStart + emittedAdditionCount + omittedContextLineCount,
    hunk.deletionStart + emittedDeletionCount + omittedContextLineCount
  );
  s.activeHunk.contextBufferAdditionStart = nextAddStart;
  s.activeHunk.contextBufferDeletionStart = nextDelStart;
  s.activeHunk.contextBufferCount = s.maxContextLines;
  s.activeHunk.contextBufferBaseConflicts = nextBaseConflicts;
}

// Adds a context line (identical on both sides of the diff). The line is pushed
// to both additionLines and deletionLines, then buffered in the hunk's context
// buffer rather than committed to hunkContent immediately. This deferred write
// is what enables the leading/trailing trim logic in flushBufferedContext.
//
// For base-section lines inside a diff3 conflict, pass the conflict index so
// the buffer can record the association; when the buffer is flushed, those
// lines get anchored to the conflict via assignConflictContent.
function emitContextLine(
  s: ParseState,
  line: string,
  baseConflictIndex: number = -1
): void {
  const hunk = ensureActiveHunk(s);
  // Reset buffer start on first line after a flush/creation.
  if (hunk.contextBufferCount === 0) {
    hunk.contextBufferAdditionStart = s.additionLines.length;
    hunk.contextBufferDeletionStart = s.deletionLines.length;
  }
  s.additionLines.push(line);
  s.deletionLines.push(line);
  if (baseConflictIndex >= 0) {
    hunk.contextBufferBaseConflicts ??= new Map();
    hunk.contextBufferBaseConflicts.set(
      hunk.contextBufferCount,
      baseConflictIndex
    );
  }
  hunk.contextBufferCount++;
}

// Adds a change line (addition or deletion) to the current hunk. This is the
// main "work" function on the hot path and orchestrates several steps:
//   1. If there's a large context gap since the last change, split the hunk
//   2. Flush any buffered context lines (leading trim on first change, or
//      pass-through for mid-hunk context)
//   3. Push the line to the appropriate line array (additions or deletions)
//   4. Append/coalesce the change into hunkContent
//   5. Anchor the conflict action to the content index
function emitChangeLine(
  s: ParseState,
  lineType: 'addition' | 'deletion',
  line: string,
  conflictIndex: number,
  role: MergeConflictSide
): void {
  let hunk = ensureActiveHunk(s);
  // If the context gap since the last change exceeds 2x maxContextLines,
  // split into two hunks: trailing context for the old, leading for the new.
  if (
    hunk.hunkContent.length > 0 &&
    hunk.contextBufferCount > s.maxContextLines2
  ) {
    splitHunkWithBufferedContext(s);
    hunk = s.activeHunk!;
  }

  flushBufferedContext(
    s,
    hunk,
    hunk.hunkContent.length === 0 ? 'leading' : 'before-change'
  );

  const additionLineIndex = s.additionLines.length;
  const deletionLineIndex = s.deletionLines.length;
  if (lineType === 'addition') {
    s.additionLines.push(line);
  } else {
    s.deletionLines.push(line);
  }

  const contentIndex = appendChangeLine(
    hunk,
    lineType,
    additionLineIndex,
    deletionLineIndex
  );

  if (lineType === 'addition') {
    hunk.additionCount++;
    hunk.additionLines++;
  } else {
    hunk.deletionCount++;
    hunk.deletionLines++;
  }
  assignConflictContent(s, conflictIndex, role, contentIndex);
}

// Called when we hit a >>>>>>> end marker. Takes the completed ConflictFrame
// and writes the final source-line coordinates and marker text into the
// conflict action. Also handles empty-side conflicts: if one side had no
// content lines, we fall back to the other side's content index so the action
// always has valid anchors. This is what makes conflicts like "add vs nothing"
// or "nothing vs add" representable.
function finalizeConflict(
  s: ParseState,
  frame: ConflictFrame,
  endLineIndex: number,
  endMarkerLine: string
): void {
  if (frame.separatorLineIndex == null || frame.markerLines.separator == null) {
    throw new Error(
      `parseMergeConflictDiffFromFile: conflict ${frame.conflictIndex} is missing a separator marker`
    );
  }

  const builder = s.conflictBuilders[frame.conflictIndex];
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

  // If one side of the conflict was empty (e.g. "add vs nothing"), its content
  // index will be undefined. Use the other side as a fallback so the action
  // always has a valid anchor for the UI to render.
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

  s.actions[action.conflictIndex] = action;
  builder.completed = true;
}

// Pushes a new ConflictFrame onto the stack and creates a placeholder
// ConflictActionBuilder. The builder starts with sentinel values (-1 for
// indices) that get filled in as we encounter content lines and markers.
// The frame tracks which section we're scanning (current → base → incoming);
// the builder accumulates the final action that downstream consumers use.
function handleStartMarker(
  s: ParseState,
  line: string,
  lineIndex: number
): void {
  const conflictIndex = s.nextConflictIndex;
  s.nextConflictIndex++;
  s.conflictStack.push({
    conflictIndex,
    stage: 'current',
    startLineIndex: lineIndex,
    markerLines: { start: line },
  });
  s.conflictBuilders[conflictIndex] = {
    completed: false,
    action: {
      conflict: {
        conflictIndex,
        startLineIndex: lineIndex,
        startLineNumber: lineIndex + 1,
        separatorLineIndex: lineIndex,
        separatorLineNumber: lineIndex + 1,
        endLineIndex: lineIndex,
        endLineNumber: lineIndex + 1,
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

function formatHunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

// Detects whether a line is a merge conflict marker by inspecting the first
// character and counting consecutive repetitions. Git conflict markers are
// 7+ repeated characters:
//   '<' (60)  = start   (<<<<<<< current)
//   '|' (124) = base    (||||||| base)
//   '=' (61)  = separator (=======)
//   '>' (62)  = end     (>>>>>>> incoming)
// The separator must be exactly '=======' with no trailing text; other markers
// allow an optional space + label (e.g. "<<<<<<< HEAD").
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

// Builds the marker row array that tells the UI where to render conflict
// decorations (start/base/separator/end lines) in the diff view. Each marker
// row maps a conflict marker to a specific line index in unified view.
//
// This is a post-processing step over the finalized hunks and actions. It
// caches cumulative line-start positions per hunk to avoid recomputing them
// for every marker.
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
