import type { CreatePatchOptionsNonabortable } from 'diff';

import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import { parseDiffFromFile } from './parseDiffFromFile';
import {
  offsetHunkContent,
  preserveTrailingEditorBlankLine,
  recomputeDiffHunksForEdit,
  recomputeDiffRenderLineCounts,
  recomputeHunkRenderLineCounts,
  syncHunkNoEOFCRFromFullFile,
} from './updateDiffHunks';
import {
  getExpandedRegion,
  getTrailingExpandedRegion,
} from './virtualDiffLayout';

// While an editor is attached to a FileDiff, each hunk is a persistent region
// identified by its old-side range. Structural passes rebuild those regions
// from one canonical old/current diff; a reverted region remains as context so
// its rows keep rendering until the genuine session-exit recompute.

export interface DivergenceCore {
  start: number;
  deletionEnd: number;
  additionEnd: number;
}

interface PreviousRegionSpan {
  firstIndex: number;
  lastIndex: number;
}

/** Maps rebuilt regions back to the previous skeleton for expansion remapping. */
export interface SessionRegionChange {
  regions: Array<PreviousRegionSpan | undefined>;
}

interface RegionBounds {
  additionStart: number;
  additionEnd: number;
  deletionStart: number;
  deletionEnd: number;
}

interface RegionPlan {
  deletionStart: number;
  deletionEnd: number;
  blocks: ChangeContent[];
  previousSpan: PreviousRegionSpan | undefined;
}

const deletionLineSetCache = new WeakMap<
  FileDiffMetadata,
  { lines: string[]; set: Set<string> }
>();

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
 * Find the complete old/current divergence core. The old side is immutable
 * during an edit session, so this result needs no prior-pass snapshot.
 */
export function findDivergenceCore(
  deletionLines: string[],
  additionLines: string[]
): DivergenceCore | undefined {
  const maxStart = Math.min(deletionLines.length, additionLines.length);
  let start = 0;
  while (start < maxStart && deletionLines[start] === additionLines[start]) {
    start++;
  }
  let deletionEnd = deletionLines.length;
  let additionEnd = additionLines.length;
  while (
    deletionEnd > start &&
    additionEnd > start &&
    deletionLines[deletionEnd - 1] === additionLines[additionEnd - 1]
  ) {
    deletionEnd--;
    additionEnd--;
  }
  if (start === deletionEnd && start === additionEnd) {
    return undefined;
  }
  return { start, deletionEnd, additionEnd };
}

/**
 * Rebuild the session skeleton as a pure function of the immutable old lines,
 * current new lines, and old-side ranges of the previous regions. One
 * canonical parse supplies the same change blocks that session exit will use.
 */
export function rebuildSessionHunks(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): SessionRegionChange | undefined {
  const previousHunks = diff.hunks;
  const editorAdditionLines = diff.additionLines;
  const canonicalAdditionLines = normalizeEditorLines(editorAdditionLines);
  const canonicalDiff =
    canonicalAdditionLines === editorAdditionLines
      ? diff
      : { ...diff, additionLines: canonicalAdditionLines };
  const blocks = parseCanonicalChangeBlocks(canonicalDiff, parseDiffOptions);
  const plans = buildRegionPlans(
    previousHunks,
    blocks,
    diff.deletionLines.length
  );

  const nextHunks = buildRegionHunks(canonicalDiff, plans);
  diff.additionLines = canonicalAdditionLines;
  diff.hunks = nextHunks;
  diff.editSessionDirty = true;
  finalizeSessionHunks(diff);
  preserveTrailingEditorBlankLine(diff, editorAdditionLines);
  const layoutChanged = hasRegionOrSplitLayoutChanged(
    previousHunks,
    diff.hunks
  );
  if (!layoutChanged) {
    return undefined;
  }
  return { regions: plans.map((plan) => plan.previousSpan) };
}

/**
 * Keep a cheap content-only path when a same-line-count pass cannot alter the
 * canonical blocks. Gap, ambiguous, or multi-region edits rebuild statelessly.
 */
export function applySessionChangedLines(
  diff: FileDiffMetadata,
  changedAdditionLineIndexes: Iterable<number>,
  parseDiffOptions?: CreatePatchOptionsNonabortable,
  previousAdditionLines?: ReadonlyMap<number, string>
): SessionRegionChange | undefined {
  const lines = Array.from(new Set(changedAdditionLineIndexes))
    .filter((line) => line >= 0 && line < diff.additionLines.length)
    .sort((a, b) => a - b);
  if (lines.length === 0) {
    return undefined;
  }

  const { hunks } = diff;
  let regionIndex: number | undefined;
  let hunkIndex = 0;
  for (const line of lines) {
    while (hunkIndex < hunks.length) {
      const hunk = hunks[hunkIndex];
      const start = getHunkAdditionStart(hunk);
      if (line < start + hunk.additionCount) break;
      hunkIndex++;
    }
    const hunk = hunks[hunkIndex];
    const start = hunk == null ? undefined : getHunkAdditionStart(hunk);
    if (
      start == null ||
      line < start ||
      (regionIndex != null && regionIndex !== hunkIndex)
    ) {
      return rebuildSessionHunks(diff, parseDiffOptions);
    }
    regionIndex = hunkIndex;
  }

  if (regionIndex == null) {
    return undefined;
  }
  if (
    canRetainCanonicalBlocks(
      diff,
      lines,
      regionIndex,
      previousAdditionLines,
      parseDiffOptions
    )
  ) {
    diff.editSessionDirty = true;
    return undefined;
  }
  return rebuildSessionHunks(diff, parseDiffOptions);
}

// Existing balanced change blocks remain canonical when every edited line was
// unmatched before and stays unmatched now: the old/new equality matrix is
// unchanged, and similarity realignment never reorders a balanced block.
function canRetainCanonicalBlocks(
  diff: FileDiffMetadata,
  changedLines: number[],
  regionIndex: number,
  previousAdditionLines: ReadonlyMap<number, string> | undefined,
  parseDiffOptions: CreatePatchOptionsNonabortable | undefined
): boolean {
  if (
    previousAdditionLines == null ||
    parseDiffOptions?.ignoreWhitespace === true ||
    parseDiffOptions?.stripTrailingCr === true
  ) {
    return false;
  }
  const deletionLineSet = getDeletionLineSet(diff);
  const hunk = diff.hunks[regionIndex];
  if (hunk.hunkContent.some(isPureChange)) {
    return false;
  }
  for (const line of changedLines) {
    const previousLine = previousAdditionLines.get(line);
    const additionLine = diff.additionLines[line];
    if (
      previousLine == null ||
      additionLine == null ||
      deletionLineSet.has(previousLine) ||
      deletionLineSet.has(additionLine)
    ) {
      return false;
    }
    let insideBalancedChange = false;
    for (const content of hunk.hunkContent) {
      if (
        content.type === 'change' &&
        content.additions === content.deletions &&
        line >= content.additionLineIndex &&
        line < content.additionLineIndex + content.additions
      ) {
        insideBalancedChange = true;
        break;
      }
    }
    if (!insideBalancedChange) {
      return false;
    }
  }
  return true;
}

function getDeletionLineSet(diff: FileDiffMetadata): Set<string> {
  const cached = deletionLineSetCache.get(diff);
  if (cached?.lines === diff.deletionLines) {
    return cached.set;
  }
  const set = new Set(diff.deletionLines);
  deletionLineSetCache.set(diff, { lines: diff.deletionLines, set });
  return set;
}

function isPureChange(
  content: ContextContent | ChangeContent | undefined
): boolean {
  return (
    content?.type === 'change' &&
    (content.additions === 0 || content.deletions === 0)
  );
}

/** Preserve expansion at the surviving outer edges of rebuilt old-side gaps. */
export function remapExpandedHunksForRegionChange(
  expandedHunks: Map<number, HunkExpansionRegion>,
  change: SessionRegionChange
): Map<number, HunkExpansionRegion> {
  const remapped = new Map<number, HunkExpansionRegion>();
  const { regions } = change;
  for (let key = 0; key <= regions.length; key++) {
    const previous = regions[key - 1];
    const next = regions[key];
    const fromStartSource =
      key === 0
        ? expandedHunks.get(0)
        : previous == null
          ? undefined
          : expandedHunks.get(previous.lastIndex + 1);
    const fromEndSource =
      next == null ? undefined : expandedHunks.get(next.firstIndex);
    const fromStart = fromStartSource?.fromStart ?? 0;
    const fromEnd = fromEndSource?.fromEnd ?? 0;
    if (fromStart > 0 || fromEnd > 0) {
      remapped.set(key, { fromStart, fromEnd });
    }
  }
  return remapped;
}

/**
 * An expanded gap-edge slice in old-side (deletion-line) coordinates as a
 * `[start, end)` range. Old-side coordinates survive the exit recompute
 * unchanged — edits only touch the new side — so these anchor best-effort
 * expansion preservation across the recompute.
 */
export type ExpansionAnchorRange = [start: number, end: number];

/** Snapshot the expanded gap-edge slices before the exit recompute. */
export function captureExpansionAnchors(
  diff: FileDiffMetadata,
  expandedHunks: Map<number, HunkExpansionRegion>,
  collapsedContextThreshold: number
): ExpansionAnchorRange[] {
  const anchors: ExpansionAnchorRange[] = [];
  if (diff.isPartial) {
    return anchors;
  }
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    const region = getExpandedRegion({
      isPartial: diff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex,
      collapsedContextThreshold,
    });
    // Gaps at or below the threshold render on their own; only explicit
    // expansion state needs preserving.
    if (region.rangeSize <= collapsedContextThreshold) {
      continue;
    }
    const gapEnd = getHunkDeletionStart(hunk);
    const gapStart = gapEnd - region.rangeSize;
    if (region.fromStart > 0) {
      anchors.push([gapStart, gapStart + region.fromStart]);
    }
    if (region.fromEnd > 0) {
      anchors.push([gapEnd - region.fromEnd, gapEnd]);
    }
  }
  const trailingRegion = getTrailingExpandedRegion({
    fileDiff: diff,
    hunkIndex: diff.hunks.length - 1,
    expandedHunks,
    collapsedContextThreshold,
    errorPrefix: 'captureExpansionAnchors',
  });
  if (
    trailingRegion != null &&
    trailingRegion.fromStart > 0 &&
    trailingRegion.rangeSize > collapsedContextThreshold
  ) {
    const lastHunk = diff.hunks[diff.hunks.length - 1];
    const gapStart = getHunkDeletionStart(lastHunk) + lastHunk.deletionCount;
    anchors.push([gapStart, gapStart + trailingRegion.fromStart]);
  }
  return anchors;
}

/**
 * Rebuild gap expansion state against the recomputed hunks: for each new
 * gap, an anchor touching the gap's start edge restores `fromStart`, one
 * touching its end edge restores `fromEnd`, and anchors for gaps that no
 * longer exist drop.
 */
export function rebuildExpansionFromAnchors(
  diff: FileDiffMetadata,
  anchors: ExpansionAnchorRange[]
): Map<number, HunkExpansionRegion> {
  const rebuilt = new Map<number, HunkExpansionRegion>();
  if (anchors.length === 0) {
    return rebuilt;
  }
  const applyGap = (key: number, gapStart: number, gapEnd: number) => {
    if (gapEnd <= gapStart) {
      return;
    }
    let fromStart = 0;
    let fromEnd = 0;
    for (const [start, end] of anchors) {
      if (end <= gapStart || start >= gapEnd) {
        continue;
      }
      if (start <= gapStart) {
        fromStart = Math.max(fromStart, Math.min(end, gapEnd) - gapStart);
      }
      if (end >= gapEnd) {
        fromEnd = Math.max(fromEnd, gapEnd - Math.max(start, gapStart));
      }
    }
    if (fromStart > 0 || fromEnd > 0) {
      rebuilt.set(key, { fromStart, fromEnd });
    }
  };
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    const gapEnd = getHunkDeletionStart(hunk);
    applyGap(hunkIndex, gapEnd - Math.max(hunk.collapsedBefore, 0), gapEnd);
  }
  const lastHunk = diff.hunks[diff.hunks.length - 1];
  if (lastHunk != null && !diff.isPartial && diff.deletionLines.length > 0) {
    applyGap(
      diff.hunks.length,
      getHunkDeletionStart(lastHunk) + lastHunk.deletionCount,
      diff.deletionLines.length
    );
  }
  return rebuilt;
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

// Parse the complete old/current files once with the same context policy as
// session exit. Equal boundary lines affect Myers tie-breaking, while parsed
// context is required for the blank-run alignment post-pass; only canonical
// change blocks are retained. Running cursors normalize unified N,0 indexes.
function parseCanonicalChangeBlocks(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): ChangeContent[] {
  if (findDivergenceCore(diff.deletionLines, diff.additionLines) == null) {
    return [];
  }
  const parsed = parseDiffFromFile(
    {
      name: diff.prevName ?? diff.name,
      contents: diff.deletionLines.join(''),
    },
    {
      name: diff.name,
      contents: diff.additionLines.join(''),
      lang: diff.lang,
    },
    parseDiffOptions
  );

  const blocks: ChangeContent[] = [];
  let coveredAdditions = 0;
  let coveredDeletions = 0;
  for (const hunk of parsed.hunks) {
    const contextLines =
      hunk.additionCount > 0
        ? hunk.additionLineIndex - coveredAdditions
        : hunk.deletionLineIndex - coveredDeletions;
    coveredAdditions += contextLines;
    coveredDeletions += contextLines;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        coveredAdditions += content.lines;
        coveredDeletions += content.lines;
        continue;
      }
      const block = offsetHunkContent(content, 0, 0) as ChangeContent;
      if (block.additions === 0) {
        block.additionLineIndex = coveredAdditions;
      }
      if (block.deletions === 0) {
        block.deletionLineIndex = coveredDeletions;
      }
      blocks.push(block);
      coveredAdditions += block.additions;
      coveredDeletions += block.deletions;
    }
  }
  return blocks;
}

// Co-walk canonical blocks and previous old-side regions. A block touching a
// region grows it; touching several merges them; a block wholly in a gap gets
// its own region. Pure insertions/deletions absorb one adjacent context line
// when available so the region stays renderable on both sides and after undo.
function buildRegionPlans(
  previousHunks: Hunk[],
  blocks: ChangeContent[],
  deletionLineCount: number
): RegionPlan[] {
  const previousPlans = previousHunks.map((hunk, index): RegionPlan => {
    const deletionStart = getHunkDeletionStart(hunk);
    return {
      deletionStart,
      deletionEnd: deletionStart + hunk.deletionCount,
      blocks: [],
      previousSpan: { firstIndex: index, lastIndex: index },
    };
  });
  const plans: RegionPlan[] = [];
  let previousIndex = 0;

  for (const block of blocks) {
    const blockStart = block.deletionLineIndex;
    const blockEnd = blockStart + block.deletions;
    while (
      previousIndex < previousPlans.length &&
      previousPlans[previousIndex].deletionEnd < blockStart
    ) {
      plans.push(previousPlans[previousIndex]);
      previousIndex++;
    }

    let plan =
      plans.length > 0 &&
      blockTouchesRegion(blockStart, blockEnd, plans[plans.length - 1])
        ? plans.pop()
        : undefined;
    while (
      previousIndex < previousPlans.length &&
      previousPlans[previousIndex].deletionStart <= blockEnd
    ) {
      plan = mergeRegionPlans(plan, previousPlans[previousIndex]);
      previousIndex++;
    }

    if (plan == null) {
      let deletionStart = blockStart;
      let deletionEnd = blockEnd;
      if (
        (block.deletions === 0 || block.additions === 0) &&
        deletionLineCount > block.deletions
      ) {
        const previousEnd = plans[plans.length - 1]?.deletionEnd ?? 0;
        const nextStart =
          previousPlans[previousIndex]?.deletionStart ?? deletionLineCount;
        if (blockStart > previousEnd) {
          deletionStart--;
        } else if (blockEnd < nextStart) {
          deletionEnd++;
        }
      }
      plan = {
        deletionStart,
        deletionEnd,
        blocks: [],
        previousSpan: undefined,
      };
    }
    plan.deletionStart = Math.min(plan.deletionStart, blockStart);
    plan.deletionEnd = Math.max(plan.deletionEnd, blockEnd);
    plan.blocks.push(block);
    plans.push(plan);
  }

  while (previousIndex < previousPlans.length) {
    plans.push(previousPlans[previousIndex]);
    previousIndex++;
  }
  return plans;
}

function blockTouchesRegion(
  blockStart: number,
  blockEnd: number,
  region: RegionPlan
): boolean {
  return blockStart <= region.deletionEnd && blockEnd >= region.deletionStart;
}

function mergeRegionPlans(
  target: RegionPlan | undefined,
  source: RegionPlan
): RegionPlan {
  if (target == null) {
    return source;
  }
  target.deletionStart = Math.min(target.deletionStart, source.deletionStart);
  target.deletionEnd = Math.max(target.deletionEnd, source.deletionEnd);
  target.blocks.push(...source.blocks);
  if (source.previousSpan != null) {
    target.previousSpan ??= { ...source.previousSpan };
    target.previousSpan.firstIndex = Math.min(
      target.previousSpan.firstIndex,
      source.previousSpan.firstIndex
    );
    target.previousSpan.lastIndex = Math.max(
      target.previousSpan.lastIndex,
      source.previousSpan.lastIndex
    );
  }
  return target;
}

// One paired-context walk constructs every region's new-side range. There is
// no downstream coordinate shifting: each boundary is derived from the
// canonical blocks that precede it.
function buildRegionHunks(diff: FileDiffMetadata, plans: RegionPlan[]): Hunk[] {
  const hunks: Hunk[] = [];
  let deletionCursor = 0;
  let additionCursor = 0;
  for (const plan of plans) {
    const contextBefore = plan.deletionStart - deletionCursor;
    if (contextBefore < 0) {
      throw new Error('buildRegionHunks: overlapping old-side regions');
    }
    deletionCursor += contextBefore;
    additionCursor += contextBefore;
    const additionStart = additionCursor;
    const hunkContent: Array<ContextContent | ChangeContent> = [];

    for (const canonicalBlock of plan.blocks) {
      const deletionContext = canonicalBlock.deletionLineIndex - deletionCursor;
      const additionContext = canonicalBlock.additionLineIndex - additionCursor;
      if (deletionContext < 0 || deletionContext !== additionContext) {
        throw new Error('buildRegionHunks: canonical block context mismatch');
      }
      pushContext(hunkContent, deletionContext, additionCursor, deletionCursor);
      deletionCursor += deletionContext;
      additionCursor += additionContext;
      hunkContent.push({ ...canonicalBlock });
      deletionCursor += canonicalBlock.deletions;
      additionCursor += canonicalBlock.additions;
    }

    const trailingContext = plan.deletionEnd - deletionCursor;
    if (trailingContext < 0) {
      throw new Error('buildRegionHunks: block exceeds its old-side region');
    }
    pushContext(hunkContent, trailingContext, additionCursor, deletionCursor);
    deletionCursor += trailingContext;
    additionCursor += trailingContext;
    hunks.push(
      createRegionHunk(
        diff,
        {
          additionStart,
          additionEnd: additionCursor,
          deletionStart: plan.deletionStart,
          deletionEnd: plan.deletionEnd,
        },
        hunkContent
      )
    );
  }

  if (
    diff.deletionLines.length - deletionCursor !==
    diff.additionLines.length - additionCursor
  ) {
    throw new Error('buildRegionHunks: trailing context mismatch');
  }
  return hunks;
}

function createRegionHunk(
  diff: FileDiffMetadata,
  bounds: RegionBounds,
  hunkContent: Array<ContextContent | ChangeContent>
): Hunk {
  const additionCount = bounds.additionEnd - bounds.additionStart;
  const deletionCount = bounds.deletionEnd - bounds.deletionStart;
  let additionLines = 0;
  let deletionLines = 0;
  for (const content of hunkContent) {
    if (content.type === 'change') {
      additionLines += content.additions;
      deletionLines += content.deletions;
    }
  }
  const hunk: Hunk = {
    collapsedBefore: 0,
    additionStart: getUnifiedStart(bounds.additionStart, additionCount),
    additionCount,
    additionLines,
    additionLineIndex: getUnifiedLineIndex(bounds.additionStart, additionCount),
    deletionStart: getUnifiedStart(bounds.deletionStart, deletionCount),
    deletionCount,
    deletionLines,
    deletionLineIndex: getUnifiedLineIndex(bounds.deletionStart, deletionCount),
    hunkContent,
    hunkSpecs: `@@ -${getUnifiedStart(bounds.deletionStart, deletionCount)},${deletionCount} +${getUnifiedStart(bounds.additionStart, additionCount)},${additionCount} @@`,
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

function pushContext(
  hunkContent: Array<ContextContent | ChangeContent>,
  lines: number,
  additionLineIndex: number,
  deletionLineIndex: number
): void {
  if (lines > 0) {
    hunkContent.push({
      type: 'context',
      lines,
      additionLineIndex,
      deletionLineIndex,
    });
  }
}

function hasRegionOrSplitLayoutChanged(
  previous: Hunk[],
  next: Hunk[]
): boolean {
  if (previous.length !== next.length) {
    return true;
  }
  for (let index = 0; index < previous.length; index++) {
    const previousHunk = previous[index];
    const nextHunk = next[index];
    if (
      getHunkDeletionStart(previousHunk) !== getHunkDeletionStart(nextHunk) ||
      previousHunk.deletionCount !== nextHunk.deletionCount ||
      getHunkAdditionStart(previousHunk) !== getHunkAdditionStart(nextHunk) ||
      previousHunk.additionCount !== nextHunk.additionCount ||
      previousHunk.splitLineCount !== nextHunk.splitLineCount ||
      !haveSameSplitRowMapping(previousHunk, nextHunk)
    ) {
      return true;
    }
  }
  return false;
}

function haveSameSplitRowMapping(previous: Hunk, next: Hunk): boolean {
  const previousRows = iterateSplitRowMapping(previous);
  const nextRows = iterateSplitRowMapping(next);
  while (true) {
    const previousRow = previousRows.next();
    const nextRow = nextRows.next();
    if (previousRow.done === true || nextRow.done === true) {
      return previousRow.done === nextRow.done;
    }
    if (
      previousRow.value[0] !== nextRow.value[0] ||
      previousRow.value[1] !== nextRow.value[1]
    ) {
      return false;
    }
  }
}

function* iterateSplitRowMapping(
  hunk: Hunk
): Generator<
  [deletionLine: number | undefined, additionLine: number | undefined]
> {
  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      for (let offset = 0; offset < content.lines; offset++) {
        yield [
          content.deletionLineIndex + offset,
          content.additionLineIndex + offset,
        ];
      }
      continue;
    }
    const rowCount = Math.max(content.deletions, content.additions);
    for (let offset = 0; offset < rowCount; offset++) {
      yield [
        offset < content.deletions
          ? content.deletionLineIndex + offset
          : undefined,
        offset < content.additions
          ? content.additionLineIndex + offset
          : undefined,
      ];
    }
  }
}

function getHunkAdditionStart(hunk: Hunk): number {
  return getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount);
}

function getHunkDeletionStart(hunk: Hunk): number {
  return getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount);
}

function getUnifiedStart(lineIndex: number, count: number): number {
  return count === 0 ? lineIndex : lineIndex + 1;
}

function getUnifiedLineIndex(lineIndex: number, count: number): number {
  return count === 0 ? lineIndex - 1 : lineIndex;
}

function finalizeSessionHunks(diff: FileDiffMetadata): void {
  recomputeDiffRenderLineCounts(diff);
  for (let index = 0; index < diff.hunks.length; index++) {
    syncHunkNoEOFCRFromFullFile(diff, index);
  }
}
