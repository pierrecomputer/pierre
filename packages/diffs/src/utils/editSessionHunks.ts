import type { CreatePatchOptionsNonabortable } from 'diff';

import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';
import { parseDiffFromFile } from './parseDiffFromFile';
import {
  offsetHunkContent,
  recomputeDiffHunksForEdit,
  recomputeDiffRenderLineCounts,
  recomputeHunkRenderLineCounts,
  syncHunkNoEOFCRFromFullFile,
} from './updateDiffHunks';

// While an editor is attached to a FileDiff, hunks are treated as a frozen
// "region skeleton": each hunk is one region spanning its full range, regions
// never merge/split/drop on their own, and each edit re-diffs only the region
// it lands in. A region whose re-diff comes back empty persists as a
// context-only hunk so its rows keep rendering. The functions here implement
// that per-edit region math; the real hunk recompute runs once on genuine
// session exit (finishEditSessionForDiff).

/**
 * The addition-line span an edit changed, from a common prefix/suffix scan.
 * `start` is the first changed line (identical in pre/post-edit coordinates),
 * `prevEnd`/`nextEnd` are the exclusive ends in pre/post-edit lines.
 */
export interface ChangedLineWindow {
  start: number;
  prevEnd: number;
  nextEnd: number;
}

/** A structural change to the region skeleton (rendered row set changed). */
export type SessionRegionChange =
  | {
      type: 'merge';
      firstIndex: number;
      lastIndex: number;
      previousHunkCount: number;
    }
  | { type: 'insert'; index: number; previousHunkCount: number };

interface RegionBounds {
  additionStart: number;
  additionEnd: number;
  deletionStart: number;
  deletionEnd: number;
}

/**
 * Drops the editor document's phantom trailing empty line (a document ending
 * in a newline exposes one extra empty line the parsed diff never contains)
 * so session line arrays compare like parse-derived ones.
 */
export function normalizeEditorLines(lines: string[]): string[] {
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

/**
 * Common prefix/suffix scan between the last completed pass's lines and the
 * rebuilt document lines. Returns undefined when nothing changed.
 */
export function findChangedLineWindow(
  previousLines: string[],
  nextLines: string[]
): ChangedLineWindow | undefined {
  const maxStart = Math.min(previousLines.length, nextLines.length);
  let start = 0;
  while (start < maxStart && previousLines[start] === nextLines[start]) {
    start++;
  }
  let prevEnd = previousLines.length;
  let nextEnd = nextLines.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    previousLines[prevEnd - 1] === nextLines[nextEnd - 1]
  ) {
    prevEnd--;
    nextEnd--;
  }
  if (start === prevEnd && start === nextEnd) {
    return undefined;
  }
  return { start, prevEnd, nextEnd };
}

/**
 * Applies one contiguous changed window to the session skeleton: regions the
 * window touches merge/grow to cover it (absorbing unchanged gap lines in
 * paired old/new correspondence), a window wholly inside a gap synthesizes a
 * new region, and regions after the window shift by the line delta. The
 * covered region is re-diffed in place. Returns the structural change when
 * the region set itself changed shape (merge/growth/synthesis).
 */
export function applySessionEditWindow(
  diff: FileDiffMetadata,
  window: ChangedLineWindow,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): SessionRegionChange | undefined {
  const { hunks } = diff;
  const delta = window.nextEnd - window.prevEnd;
  diff.editSessionDirty = true;

  if (hunks.length === 0) {
    const bounds: RegionBounds = {
      additionStart: 0,
      additionEnd: diff.additionLines.length,
      deletionStart: 0,
      deletionEnd: diff.deletionLines.length,
    };
    hunks.push(rediffRegion(diff, bounds, parseDiffOptions));
    finalizeSessionHunks(diff, 0);
    return { type: 'insert', index: 0, previousHunkCount: 0 };
  }

  // Locate the span of regions the window touches, treating windows adjacent
  // to a region edge as touching so boundary edits grow the region instead of
  // synthesizing a sibling next to it.
  let firstIndex = -1;
  let lastIndex = -1;
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index];
    const regionStart = hunk.additionLineIndex;
    const regionEnd = regionStart + hunk.additionCount;
    if (regionStart > window.prevEnd) {
      break;
    }
    if (window.start <= regionEnd) {
      if (firstIndex === -1) {
        firstIndex = index;
      }
      lastIndex = index;
    }
  }

  if (firstIndex === -1) {
    return synthesizeRegion(diff, window, delta, parseDiffOptions);
  }

  const firstHunk = hunks[firstIndex];
  const lastHunk = hunks[lastIndex];
  const lastHunkEnd = lastHunk.additionLineIndex + lastHunk.additionCount;
  const additionStart = Math.min(firstHunk.additionLineIndex, window.start);
  const additionEndBefore = Math.max(lastHunkEnd, window.prevEnd);
  // Gap lines are 1:1 paired with old-side lines, so growing a region into a
  // gap absorbs the same number of deletion lines from that gap.
  const bounds: RegionBounds = {
    additionStart,
    additionEnd: additionEndBefore + delta,
    deletionStart:
      firstHunk.deletionLineIndex -
      (firstHunk.additionLineIndex - additionStart),
    deletionEnd:
      lastHunk.deletionLineIndex +
      lastHunk.deletionCount +
      (additionEndBefore - lastHunkEnd),
  };
  const regionHunk = rediffRegion(diff, bounds, parseDiffOptions);
  if (delta !== 0) {
    for (let index = lastIndex + 1; index < hunks.length; index++) {
      shiftHunkAdditionCoords(hunks[index], delta);
    }
  }
  const previousHunkCount = hunks.length;
  hunks.splice(firstIndex, lastIndex - firstIndex + 1, regionHunk);
  finalizeSessionHunks(diff, firstIndex);

  const regionGrew =
    additionStart < firstHunk.additionLineIndex ||
    additionEndBefore > lastHunkEnd;
  if (firstIndex === lastIndex && !regionGrew) {
    return undefined;
  }
  return { type: 'merge', firstIndex, lastIndex, previousHunkCount };
}

/**
 * Applies a set of changed addition-line indexes from a pass with no line
 * count change: lines inside a region re-diff that region in place; lines in
 * a gap synthesize a region per gap (one window spanning that gap's changed
 * lines). Returns the structural changes, if any, for escalation/remapping.
 */
export function applySessionChangedLines(
  diff: FileDiffMetadata,
  changedAdditionLineIndexes: Iterable<number>,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): SessionRegionChange[] {
  const lines = Array.from(new Set(changedAdditionLineIndexes))
    .filter((line) => line >= 0 && line < diff.additionLines.length)
    .sort((a, b) => a - b);
  if (lines.length === 0) {
    return [];
  }

  const { hunks } = diff;
  const regionIndexes = new Set<number>();
  // Changed lines outside every region, grouped per gap (keyed by the index
  // of the region that follows the gap) into one [start, end) window each.
  const gapWindows: Array<[start: number, end: number]> = [];
  let hunkIndex = 0;
  let currentGapKey = -1;
  for (const line of lines) {
    while (
      hunkIndex < hunks.length &&
      line >=
        hunks[hunkIndex].additionLineIndex + hunks[hunkIndex].additionCount
    ) {
      hunkIndex++;
    }
    const hunk = hunks[hunkIndex];
    if (hunk != null && line >= hunk.additionLineIndex) {
      regionIndexes.add(hunkIndex);
      continue;
    }
    const lastWindow = gapWindows[gapWindows.length - 1];
    if (currentGapKey === hunkIndex && lastWindow != null) {
      lastWindow[1] = line + 1;
    } else {
      currentGapKey = hunkIndex;
      gapWindows.push([line, line + 1]);
    }
  }

  // In-place region re-diffs first, while region indexes are still valid.
  for (const index of regionIndexes) {
    const hunk = hunks[index];
    const bounds: RegionBounds = {
      additionStart: hunk.additionLineIndex,
      additionEnd: hunk.additionLineIndex + hunk.additionCount,
      deletionStart: hunk.deletionLineIndex,
      deletionEnd: hunk.deletionLineIndex + hunk.deletionCount,
    };
    hunks[index] = rediffRegion(diff, bounds, parseDiffOptions);
    syncHunkNoEOFCRFromFullFile(diff, index);
    diff.editSessionDirty = true;
  }
  if (regionIndexes.size > 0) {
    recomputeDiffRenderLineCounts(diff);
  }

  // Gap windows in descending order so earlier windows keep valid coordinates
  // while later synthesis inserts hunks behind them.
  const changes: SessionRegionChange[] = [];
  for (let index = gapWindows.length - 1; index >= 0; index--) {
    const [start, end] = gapWindows[index];
    const change = applySessionEditWindow(
      diff,
      { start, prevEnd: end, nextEnd: end },
      parseDiffOptions
    );
    if (change != null) {
      changes.push(change);
    }
  }
  return changes;
}

/**
 * Rebuilds hunk-gap expansion keys after a structural region change so
 * expansion state stays anchored to the same gaps. Merged-away gap keys drop;
 * a synthesized region splits its gap's expansion across the two new gaps.
 * The trailing pseudo-key (old hunk count) follows the same shift.
 */
export function remapExpandedHunksForRegionChange(
  expandedHunks: Map<number, HunkExpansionRegion>,
  change: SessionRegionChange
): Map<number, HunkExpansionRegion> {
  const remapped = new Map<number, HunkExpansionRegion>();
  if (change.type === 'merge') {
    const removed = change.lastIndex - change.firstIndex;
    for (const [key, region] of expandedHunks) {
      if (key <= change.firstIndex) {
        remapped.set(key, region);
      } else if (key > change.lastIndex) {
        remapped.set(key - removed, region);
      }
      // Keys inside (firstIndex, lastIndex] were gaps the merge absorbed.
    }
    return remapped;
  }
  for (const [key, region] of expandedHunks) {
    if (key < change.index) {
      remapped.set(key, region);
    } else if (key > change.index) {
      remapped.set(key + 1, region);
    } else {
      // The gap this key described was split by the new region: keep its
      // start-anchored expansion on the first half and its end-anchored
      // expansion on the second.
      if (region.fromStart > 0) {
        remapped.set(key, { fromStart: region.fromStart, fromEnd: 0 });
      }
      if (region.fromEnd > 0) {
        remapped.set(key + 1, { fromStart: 0, fromEnd: region.fromEnd });
      }
    }
  }
  return remapped;
}

/**
 * Genuine session exit: when session passes reshaped the hunks, run the real
 * full recompute so exit state matches a non-session edit pipeline, and clear
 * the marker. Returns true when a recompute ran.
 */
export function finishEditSessionForDiff(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): boolean {
  if (diff.editSessionDirty !== true) {
    return false;
  }
  diff.editSessionDirty = undefined;
  Object.assign(diff, recomputeDiffHunksForEdit(diff, parseDiffOptions));
  return true;
}

// Synthesizes a region for a window that touches no existing region. When the
// window is empty on either side (pure insert/delete inside a gap), one
// adjacent context line is absorbed so the re-diff anchors on real content.
function synthesizeRegion(
  diff: FileDiffMetadata,
  window: ChangedLineWindow,
  delta: number,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): SessionRegionChange {
  const { hunks } = diff;
  let insertIndex = 0;
  while (
    insertIndex < hunks.length &&
    hunks[insertIndex].additionLineIndex < window.start
  ) {
    insertIndex++;
  }

  // Constant pairing offset between old and new line indexes within this gap.
  const pairOffset =
    insertIndex < hunks.length
      ? hunks[insertIndex].deletionLineIndex -
        hunks[insertIndex].additionLineIndex
      : hunks[insertIndex - 1].deletionLineIndex +
        hunks[insertIndex - 1].deletionCount -
        (hunks[insertIndex - 1].additionLineIndex +
          hunks[insertIndex - 1].additionCount);

  let { start, prevEnd, nextEnd } = window;
  if (start === prevEnd || start === nextEnd) {
    if (start > 0) {
      start--;
    } else if (nextEnd < diff.additionLines.length) {
      prevEnd++;
      nextEnd++;
    }
  }

  const bounds: RegionBounds = {
    additionStart: start,
    additionEnd: nextEnd,
    deletionStart: start + pairOffset,
    deletionEnd: prevEnd + pairOffset,
  };
  const regionHunk = rediffRegion(diff, bounds, parseDiffOptions);
  if (delta !== 0) {
    for (let index = insertIndex; index < hunks.length; index++) {
      shiftHunkAdditionCoords(hunks[index], delta);
    }
  }
  const previousHunkCount = hunks.length;
  hunks.splice(insertIndex, 0, regionHunk);
  finalizeSessionHunks(diff, insertIndex);
  return { type: 'insert', index: insertIndex, previousHunkCount };
}

// Re-diffs a region's old/new slices with zero context, producing one Hunk
// spanning the region's full range. Zero result hunks yield a context-only
// hunk (region persists while the session is active); several result hunks
// merge into one hunkContent with the identical stretches between them
// re-expressed as context blocks.
function rediffRegion(
  diff: FileDiffMetadata,
  bounds: RegionBounds,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): Hunk {
  const deletionSlice = diff.deletionLines.slice(
    bounds.deletionStart,
    bounds.deletionEnd
  );
  const additionSlice = diff.additionLines.slice(
    bounds.additionStart,
    bounds.additionEnd
  );
  const additionCount = additionSlice.length;
  const deletionCount = deletionSlice.length;

  const hunkContent: (ContextContent | ChangeContent)[] = [];
  let additionChangedLines = 0;
  let deletionChangedLines = 0;

  const pushContext = (
    lines: number,
    additionLineIndex: number,
    deletionLineIndex: number
  ) => {
    if (lines > 0) {
      hunkContent.push({
        type: 'context',
        lines,
        additionLineIndex,
        deletionLineIndex,
      });
    }
  };

  if (deletionSlice.join('') === additionSlice.join('')) {
    pushContext(additionCount, bounds.additionStart, bounds.deletionStart);
  } else {
    const reparsed = parseDiffFromFile(
      {
        name: diff.prevName ?? diff.name,
        contents: deletionSlice.join(''),
      },
      {
        name: diff.name,
        contents: additionSlice.join(''),
        lang: diff.lang,
      },
      { ...parseDiffOptions, context: 0 }
    );
    // Walk the zero-context hunks, re-deriving the unchanged stretches
    // between them from the addition side (context is paired, so both sides
    // advance by the same amount).
    let coveredAdditions = 0;
    let coveredDeletions = 0;
    for (const parsedHunk of reparsed.hunks) {
      const contextLines = parsedHunk.additionLineIndex - coveredAdditions;
      pushContext(
        contextLines,
        bounds.additionStart + coveredAdditions,
        bounds.deletionStart + coveredDeletions
      );
      coveredAdditions += contextLines;
      coveredDeletions += contextLines;
      for (const content of parsedHunk.hunkContent) {
        // Parsed content indexes are relative to the slice; offset them into
        // full-file coordinates.
        hunkContent.push(
          offsetHunkContent(content, bounds.additionStart, bounds.deletionStart)
        );
      }
      additionChangedLines += parsedHunk.additionLines;
      deletionChangedLines += parsedHunk.deletionLines;
      coveredAdditions += parsedHunk.additionCount;
      coveredDeletions += parsedHunk.deletionCount;
    }
    pushContext(
      additionCount - coveredAdditions,
      bounds.additionStart + coveredAdditions,
      bounds.deletionStart + coveredDeletions
    );
  }

  const hunk: Hunk = {
    collapsedBefore: 0,
    additionStart: bounds.additionStart + 1,
    additionCount,
    additionLines: additionChangedLines,
    additionLineIndex: bounds.additionStart,
    deletionStart: bounds.deletionStart + 1,
    deletionCount,
    deletionLines: deletionChangedLines,
    deletionLineIndex: bounds.deletionStart,
    hunkContent,
    hunkSpecs: `@@ -${bounds.deletionStart + 1},${deletionCount} +${bounds.additionStart + 1},${additionCount} @@`,
    splitLineStart: 0,
    splitLineCount: 0,
    unifiedLineStart: 0,
    unifiedLineCount: 0,
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
  };
  recomputeHunkRenderLineCounts(hunk);
  return hunk;
}

function shiftHunkAdditionCoords(hunk: Hunk, delta: number): void {
  hunk.additionLineIndex += delta;
  hunk.additionStart += delta;
  for (const content of hunk.hunkContent) {
    content.additionLineIndex += delta;
  }
}

function finalizeSessionHunks(diff: FileDiffMetadata, hunkIndex: number): void {
  recomputeDiffRenderLineCounts(diff);
  syncHunkNoEOFCRFromFullFile(diff, hunkIndex);
}
