import type { CreatePatchOptionsNonabortable } from 'diff';

import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import {
  type DiffLines,
  joinLineRange,
  joinLines,
  lineAt,
  plainLines,
} from './diffLines';
import {
  getHunkSideEndBoundary,
  getHunkSideStartBoundary,
} from './getHunkSideBoundaries';
import { parseDiffFromFile } from './parseDiffFromFile';
import { hasTrailingContextMismatch } from './virtualDiffLayout';

type HunkContent = ContextContent | ChangeContent;

type HunkMetadataUpdate = Pick<
  FileDiffMetadata,
  'hunks' | 'splitLineCount' | 'unifiedLineCount' | 'type'
>;

type FullDiffHunkUpdate = HunkMetadataUpdate &
  Pick<FileDiffMetadata, 'additionLines' | 'deletionLines'>;

/** Rebuilds all hunk metadata from the current deletion/addition line arrays. */
export function recomputeDiffHunks(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): FullDiffHunkUpdate {
  const recomputed = parseDiffFromFile(
    {
      name: diff.prevName ?? diff.name,
      contents: joinLines(diff.deletionLines),
    },
    {
      name: diff.name,
      contents: joinLines(diff.additionLines),
      lang: diff.lang,
    },
    parseDiffOptions
  );
  return {
    hunks: recomputed.hunks,
    splitLineCount: recomputed.splitLineCount,
    unifiedLineCount: recomputed.unifiedLineCount,
    additionLines: recomputed.additionLines,
    deletionLines: recomputed.deletionLines,
    type: recomputed.type,
  };
}

// Builds placeholder addition contents that diff as one top-aligned change row per
// line. Bare `\\n` sentinels align as context against the first deletion lines,
// which pushes the real addition rows down in split view.
function buildTopAlignedAdditionSentinel(
  lineCount: number,
  deletionContents: string
): string {
  const count = Math.max(lineCount, 1);
  let sentinel = Array.from(
    { length: count },
    (_, index) => `${' '.repeat(index + 1)}\n`
  ).join('');
  if (sentinel === deletionContents) {
    sentinel = Array.from(
      { length: count },
      (_, index) => `\u0000${' '.repeat(index)}\n`
    ).join('');
  }
  return sentinel;
}

function hasOnlyBlankAdditionContents(additionLines: DiffLines): boolean {
  for (let index = 0; index < additionLines.length; index++) {
    if (lineAt(additionLines, index).trim().length > 0) {
      return false;
    }
  }
  return true;
}

// After delete-all the editable side is blank and much shorter than the deletion
// side. A normal recompute can still treat newline-only additions as context and
// render the first editable row deep in split view instead of at the top.
export function shouldTopAlignAdditionRecompute(
  diff: FileDiffMetadata,
  additionLines: DiffLines
): boolean {
  return (
    additionLines.length > 0 &&
    additionLines.length < diff.deletionLines.length &&
    hasOnlyBlankAdditionContents(additionLines)
  );
}

// Rebuilds hunk metadata while keeping the editable addition rows top-aligned in
// split view. The sentinel only shapes hunks; the caller's addition lines are
// preserved so the editor document stays the source of truth.
export function recomputeTopAlignedAdditionDiff(
  diff: FileDiffMetadata,
  additionLines: DiffLines,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): FullDiffHunkUpdate {
  const deletionContents = joinLines(diff.deletionLines);
  const additionSentinel = buildTopAlignedAdditionSentinel(
    additionLines.length,
    deletionContents
  );
  const recomputed = parseDiffFromFile(
    {
      name: diff.prevName ?? diff.name,
      contents: deletionContents,
    },
    {
      name: diff.name,
      contents: additionSentinel,
      lang: diff.lang,
    },
    parseDiffOptions
  );
  return {
    hunks: recomputed.hunks,
    splitLineCount: recomputed.splitLineCount,
    unifiedLineCount: recomputed.unifiedLineCount,
    additionLines,
    deletionLines: recomputed.deletionLines,
    type: recomputed.type,
  };
}

// Rebuilds hunk metadata when the editable side has been emptied of all text.
//
// The editor always keeps one (empty) line for an empty document, but an empty
// string splits into zero addition lines, so a normal recompute produces a diff
// with no addition rows at all. Rendering that leaves the attached editor with
// no line element to host its caret.
export function recomputeEmptyDocumentDiff(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): FullDiffHunkUpdate {
  return recomputeTopAlignedAdditionDiff(
    diff,
    plainLines(['']),
    parseDiffOptions
  );
}

/** Rebuilds diff hunks after an edit, top-aligning sparse addition sides when needed. */
export function recomputeDiffHunksForEdit(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): FullDiffHunkUpdate {
  if (diff.additionLines.length === 0) {
    return recomputeEmptyDocumentDiff(diff, parseDiffOptions);
  }
  if (shouldTopAlignAdditionRecompute(diff, diff.additionLines)) {
    return recomputeTopAlignedAdditionDiff(
      diff,
      diff.additionLines,
      parseDiffOptions
    );
  }
  const additionLines = diff.additionLines;
  const recomputed = recomputeDiffHunks(diff, parseDiffOptions);
  preserveTrailingEditorBlankLine(recomputed, additionLines);
  return recomputed;
}

function hasTrailingEditorBlankLine(additionLines: DiffLines): boolean {
  return (
    additionLines.length > 1 &&
    lineAt(additionLines, additionLines.length - 1) === ''
  );
}

// Re-adds the editor's phantom trailing empty line (a document ending in a
// newline exposes one extra empty line) as an addition row when the last
// hunk's final change block can absorb it, so the caret keeps a rendered row.
export function preserveTrailingEditorBlankLine(
  recomputed: Pick<
    FullDiffHunkUpdate,
    'hunks' | 'additionLines' | 'splitLineCount' | 'unifiedLineCount'
  >,
  additionLines: DiffLines
): void {
  if (!hasTrailingEditorBlankLine(additionLines)) {
    return;
  }
  const extraLineCount = additionLines.length - recomputed.additionLines.length;
  if (extraLineCount <= 0) {
    return;
  }
  const extraAdditionLineIndex = recomputed.additionLines.length;

  const lastHunk = recomputed.hunks.at(-1);
  if (lastHunk == null) {
    return;
  }

  const lastHunkAdditionEnd = getHunkSideEndBoundary(
    lastHunk.additionStart,
    lastHunk.additionCount
  );
  if (lastHunkAdditionEnd !== extraAdditionLineIndex) {
    return;
  }

  for (const content of lastHunk.hunkContent) {
    if (
      content.type === 'change' &&
      content.additions < content.deletions &&
      content.additionLineIndex + content.additions === extraAdditionLineIndex
    ) {
      recomputed.additionLines = additionLines;
      content.additions += extraLineCount;
      lastHunk.additionCount += extraLineCount;
      lastHunk.additionLines += extraLineCount;
      recomputeDiffRenderLineCounts(recomputed);
      return;
    }
  }
}

/** Updates hunk metadata after addition lines change; re-parses affected hunks only. */
export function updateDiffHunks(
  diff: FileDiffMetadata,
  changedAdditionLineIndexes: Iterable<number>,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): HunkMetadataUpdate {
  if (diff.isPartial) {
    return applyHunkUpdateResult(
      diff,
      recomputeDiffHunks(diff, parseDiffOptions)
    );
  }

  if (diff.deletionLines.length !== diff.additionLines.length) {
    return applyHunkUpdateResult(
      diff,
      recomputeDiffHunks(diff, parseDiffOptions)
    );
  }

  const changedLines = Array.from(changedAdditionLineIndexes);
  if (changedLines.length === 0) {
    return applyHunkUpdateResult(diff, {
      hunks: diff.hunks,
      splitLineCount: diff.splitLineCount,
      unifiedLineCount: diff.unifiedLineCount,
      type: diff.type,
    });
  }
  for (const line of changedLines) {
    const additionLine = lineAt(diff.additionLines, line);
    const deletionLine = lineAt(diff.deletionLines, line);
    if (additionLine == null || deletionLine == null) {
      return applyHunkUpdateResult(
        diff,
        recomputeDiffHunks(diff, parseDiffOptions)
      );
    }
    // Restoring a line to the old side can merge/split hunks across context windows.
    if (cleanLastNewline(additionLine) === cleanLastNewline(deletionLine)) {
      return applyHunkUpdateResult(
        diff,
        recomputeDiffHunks(diff, parseDiffOptions)
      );
    }
  }

  const affectedHunkIndexes = getAffectedHunkIndexes(diff, changedLines);
  if (affectedHunkIndexes.size === 0) {
    return applyHunkUpdateResult(
      diff,
      recomputeDiffHunks(diff, parseDiffOptions)
    );
  }

  for (const hunkIndex of affectedHunkIndexes) {
    const updated = reparseHunkRegion(diff, hunkIndex, parseDiffOptions);
    if (!updated) {
      return applyHunkUpdateResult(
        diff,
        recomputeDiffHunks(diff, parseDiffOptions)
      );
    }
  }

  recomputeDiffRenderLineCounts(diff);

  if (hasTrailingContextMismatch(diff)) {
    return applyHunkUpdateResult(
      diff,
      recomputeDiffHunks(diff, parseDiffOptions)
    );
  }

  return applyHunkUpdateResult(diff, {
    hunks: diff.hunks,
    splitLineCount: diff.splitLineCount,
    unifiedLineCount: diff.unifiedLineCount,
    type: diff.type,
  });
}

function applyHunkUpdateResult<T extends HunkMetadataUpdate>(
  diff: FileDiffMetadata,
  result: T
): T {
  Object.assign(diff, result);
  return result;
}

function getAffectedHunkIndexes(
  diff: FileDiffMetadata,
  changedAdditionLineIndexes: Iterable<number>
): Set<number> {
  const indexes = new Set<number>();
  for (const line of changedAdditionLineIndexes) {
    const hunkIndex = findHunkIndexForAdditionLine(diff, line);
    if (hunkIndex == null) {
      return new Set();
    }
    indexes.add(hunkIndex);
  }
  return indexes;
}

function findHunkIndexForAdditionLine(
  diff: FileDiffMetadata,
  line: number
): number | undefined {
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    const end = hunk.additionLineIndex + hunk.additionCount;
    if (line >= hunk.additionLineIndex && line < end) {
      return hunkIndex;
    }
  }
  return undefined;
}

function reparseHunkRegion(
  diff: FileDiffMetadata,
  hunkIndex: number,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): boolean {
  const hunk = diff.hunks[hunkIndex];
  if (hunk == null) {
    return false;
  }

  const deletionSlice = joinLineRange(
    diff.deletionLines,
    hunk.deletionLineIndex,
    hunk.deletionLineIndex + hunk.deletionCount
  );
  const additionSlice = joinLineRange(
    diff.additionLines,
    hunk.additionLineIndex,
    hunk.additionLineIndex + hunk.additionCount
  );

  const reparsed = parseDiffFromFile(
    {
      name: diff.prevName ?? diff.name,
      contents: deletionSlice,
    },
    {
      name: diff.name,
      contents: additionSlice,
      lang: diff.lang,
    },
    { ...parseDiffOptions, context: 0 }
  );

  const reparsedHunk = reparsed.hunks[0];
  if (reparsedHunk == null || reparsed.hunks.length !== 1) {
    return false;
  }

  applyReparsedHunk(hunk, reparsedHunk);
  syncHunkNoEOFCRFromFullFile(diff, hunkIndex);
  return true;
}

export function syncHunkNoEOFCRFromFullFile(
  diff: FileDiffMetadata,
  hunkIndex: number
): void {
  const hunk = diff.hunks[hunkIndex];
  if (hunk == null) {
    return;
  }

  const isLastHunk = hunkIndex === diff.hunks.length - 1;
  if (!isLastHunk) {
    hunk.noEOFCRAdditions = false;
    hunk.noEOFCRDeletions = false;
    return;
  }

  const lastAdditionLine = lineAt(
    diff.additionLines,
    diff.additionLines.length - 1
  );
  const lastDeletionLine = lineAt(
    diff.deletionLines,
    diff.deletionLines.length - 1
  );
  hunk.noEOFCRAdditions =
    lastAdditionLine != null &&
    lastAdditionLine !== '' &&
    !lastAdditionLine.endsWith('\n');
  hunk.noEOFCRDeletions =
    lastDeletionLine != null &&
    lastDeletionLine !== '' &&
    !lastDeletionLine.endsWith('\n');
}

function applyReparsedHunk(target: Hunk, parsed: Hunk): void {
  const additionOffset = target.additionLineIndex;
  const deletionOffset = target.deletionLineIndex;

  target.hunkContent = parsed.hunkContent.map((content) =>
    offsetHunkContent(content, additionOffset, deletionOffset)
  );
  target.additionLineIndex = additionOffset + parsed.additionLineIndex;
  target.additionStart = target.additionStart + parsed.additionLineIndex;
  target.additionCount = parsed.additionCount;
  target.additionLines = parsed.additionLines;
  if (parsed.deletionLineIndex >= 0) {
    target.deletionLineIndex = deletionOffset + parsed.deletionLineIndex;
    target.deletionStart = target.deletionStart + parsed.deletionLineIndex;
  }
  target.deletionCount = parsed.deletionCount;
  target.deletionLines = parsed.deletionLines;
  target.noEOFCRAdditions = parsed.noEOFCRAdditions;
  target.noEOFCRDeletions = parsed.noEOFCRDeletions;

  recomputeHunkRenderLineCounts(target);
}

export function offsetHunkContent(
  content: HunkContent,
  additionOffset: number,
  deletionOffset: number
): HunkContent {
  return {
    ...content,
    additionLineIndex: content.additionLineIndex + additionOffset,
    deletionLineIndex: content.deletionLineIndex + deletionOffset,
  };
}

export function recomputeHunkRenderLineCounts(hunk: Hunk): void {
  let splitLineCount = 0;
  let unifiedLineCount = 0;

  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      splitLineCount += content.lines;
      unifiedLineCount += content.lines;
    } else {
      splitLineCount += Math.max(content.additions, content.deletions);
      unifiedLineCount += content.additions + content.deletions;
    }
  }

  hunk.splitLineCount = splitLineCount;
  hunk.unifiedLineCount = unifiedLineCount;
}

export function recomputeDiffRenderLineCounts(
  diff: Pick<
    FileDiffMetadata,
    'hunks' | 'splitLineCount' | 'unifiedLineCount' | 'additionLines'
  >
): void {
  let splitTotal = 0;
  let unifiedTotal = 0;
  let lastHunkAdditionEnd = 0;

  for (const hunk of diff.hunks) {
    hunk.collapsedBefore = Math.max(
      getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) -
        lastHunkAdditionEnd,
      0
    );
    hunk.splitLineStart = splitTotal + hunk.collapsedBefore;
    hunk.unifiedLineStart = unifiedTotal + hunk.collapsedBefore;

    recomputeHunkRenderLineCounts(hunk);

    splitTotal += hunk.collapsedBefore + hunk.splitLineCount;
    unifiedTotal += hunk.collapsedBefore + hunk.unifiedLineCount;
    lastHunkAdditionEnd = getHunkSideEndBoundary(
      hunk.additionStart,
      hunk.additionCount
    );
  }

  if (diff.hunks.length > 0) {
    const lastHunk = diff.hunks[diff.hunks.length - 1];
    const collapsedAfter = Math.max(
      diff.additionLines.length -
        getHunkSideEndBoundary(lastHunk.additionStart, lastHunk.additionCount),
      0
    );
    splitTotal += collapsedAfter;
    unifiedTotal += collapsedAfter;
  }

  diff.splitLineCount = splitTotal;
  diff.unifiedLineCount = unifiedTotal;
}
