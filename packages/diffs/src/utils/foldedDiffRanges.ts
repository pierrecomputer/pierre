import { EMPTY_RESOLVED_FOLDS } from '../constants';
import type {
  AnnotationSide,
  ChangeContent,
  CodeColumnType,
  ContextContent,
  FileDiffMetadata,
  FoldData,
  FoldedRange,
  Hunk,
  ResolvedDiffFold,
} from '../types';
import { getFoldSeparatorSlotName } from './getFoldSeparatorSlotName';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';

interface ResolveFoldedRangesProps {
  fileDiff: FileDiffMetadata;
  foldedRanges: FoldedRange[] | undefined;
  expandedFolds: readonly number[] | undefined;
}

interface BlockSideRange {
  /** One-based first line of the block on the fold's side. */
  start: number;
  /** Line count the block contributes to the fold's side. */
  count: number;
}

interface BlockSelection {
  blockStart: number;
  blockEnd: number;
  start: number;
  end: number;
  lines: number;
  unifiedRows: number;
  splitRows: number;
  unifiedRowStart: number;
  splitRowStart: number;
}

/** Rows a `hunkContent` entry renders in unified layout. */
function getUnifiedBlockRows(content: ContextContent | ChangeContent): number {
  return content.type === 'context'
    ? content.lines
    : content.deletions + content.additions;
}

/** Rows a `hunkContent` entry renders in split layout. */
function getSplitBlockRows(content: ContextContent | ChangeContent): number {
  return content.type === 'context'
    ? content.lines
    : Math.max(content.deletions, content.additions);
}

/**
 * The one-based line span a `hunkContent` entry occupies on one side, given
 * the running line numbers the caller has walked to. A change block that
 * contributes nothing to the requested side reports a zero count, which keeps
 * it out of folds aimed at the other side.
 */
function getBlockSideRange(
  content: ContextContent | ChangeContent,
  side: AnnotationSide,
  additionLineNumber: number,
  deletionLineNumber: number
): BlockSideRange {
  const start = side === 'additions' ? additionLineNumber : deletionLineNumber;
  if (content.type === 'context') {
    return { start, count: content.lines };
  }
  return {
    start,
    count: side === 'additions' ? content.additions : content.deletions,
  };
}

/**
 * Whether a `hunkContent` entry can fold from any line: context, or a change
 * with lines on one side only, whose rows pair with nothing. A change with
 * both sides folds whole, because cutting it would re-pair its rows.
 */
export function foldsAtAnyLine(
  content: ContextContent | ChangeContent
): boolean {
  return (
    content.type === 'context' ||
    content.deletions === 0 ||
    content.additions === 0
  );
}

/**
 * Pick the run of `hunkContent` entries one range folds inside a single hunk.
 *
 * Entries that fold at any line are cut at the fold's edges. A change entry
 * with both sides folds only when every line on the fold's side is inside the
 * range, and its rows on the other side fold with it, so a range folds both
 * split columns as one unit.
 *
 * Only the first contiguous run is kept. A range that skips over an
 * unfoldable entry and resumes later would need a second separator for one
 * host range, so the tail is dropped instead.
 */
function selectFoldedBlocks(
  hunk: Hunk,
  range: FoldedRange
): BlockSelection | undefined {
  let additionLineNumber =
    getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) + 1;
  let deletionLineNumber =
    getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) + 1;
  let unifiedRow = hunk.unifiedLineStart;
  let splitRow = hunk.splitLineStart;
  let selection: BlockSelection | undefined;

  for (let index = 0; index < hunk.hunkContent.length; index++) {
    const content = hunk.hunkContent[index];
    if (content == null) {
      break;
    }

    const { start, count } = getBlockSideRange(
      content,
      range.side,
      additionLineNumber,
      deletionLineNumber
    );
    const foldStart = Math.max(start, range.start);
    const foldEnd = Math.min(start + count - 1, range.end);
    const overlaps = count > 0 && foldEnd >= foldStart;

    if (overlaps) {
      const anyLine = foldsAtAnyLine(content);
      const coversWholeBlock =
        foldStart === start && foldEnd === start + count - 1;
      if (anyLine || coversWholeBlock) {
        const lines = foldEnd - foldStart + 1;
        const unifiedRows = anyLine ? lines : getUnifiedBlockRows(content);
        const splitRows = anyLine ? lines : getSplitBlockRows(content);
        if (selection == null) {
          // A fold can start mid-entry, so its first row is the entry's own
          // start plus however many rows render above it.
          const rowOffset = anyLine ? foldStart - start : 0;
          selection = {
            blockStart: index,
            blockEnd: index,
            start: foldStart,
            end: foldEnd,
            lines,
            unifiedRows,
            splitRows,
            unifiedRowStart: unifiedRow + rowOffset,
            splitRowStart: splitRow + rowOffset,
          };
        } else if (selection.blockEnd === index - 1) {
          selection.blockEnd = index;
          selection.end = foldEnd;
          selection.lines += lines;
          selection.unifiedRows += unifiedRows;
          selection.splitRows += splitRows;
        } else {
          break;
        }
      } else if (selection != null) {
        break;
      }
    } else if (selection != null && index > selection.blockEnd) {
      break;
    }

    unifiedRow += getUnifiedBlockRows(content);
    splitRow += getSplitBlockRows(content);
    if (content.type === 'context') {
      additionLineNumber += content.lines;
      deletionLineNumber += content.lines;
    } else {
      additionLineNumber += content.additions;
      deletionLineNumber += content.deletions;
    }
  }

  return selection;
}

/** Whether a host range is shaped well enough to resolve at all. */
function isUsableRange(range: FoldedRange): boolean {
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start >= 1 &&
    range.end >= range.start
  );
}

/**
 * Resolve the host's `foldedRanges` against a parsed diff, dropping anything
 * that cannot fold cleanly instead of throwing: malformed or out-of-bounds
 * bounds, ranges that land in collapsed context rather than a hunk body, and
 * ranges whose rows overlap one already resolved.
 *
 * Ranges are returned in render order, which is why overlap rejection runs
 * after sorting: the earliest range in the file wins and later ones covering
 * the same rows are dropped, so the result is stable no matter what order the
 * host listed them in.
 */
export function resolveFoldedRanges({
  fileDiff,
  foldedRanges,
  expandedFolds,
}: ResolveFoldedRangesProps): ResolvedDiffFold[] {
  if (foldedRanges == null || foldedRanges.length === 0) {
    return [];
  }

  const resolved: ResolvedDiffFold[] = [];
  for (let index = 0; index < foldedRanges.length; index++) {
    const range = foldedRanges[index];
    if (range == null || !isUsableRange(range)) {
      continue;
    }

    for (let hunkIndex = 0; hunkIndex < fileDiff.hunks.length; hunkIndex++) {
      const hunk = fileDiff.hunks[hunkIndex];
      if (hunk == null) {
        continue;
      }
      const selection = selectFoldedBlocks(hunk, range);
      if (selection == null) {
        continue;
      }
      // A fold that hides every row of a hunk is dropped: the hunk's own
      // leading separator needs one of its rows to render on.
      if (selection.unifiedRows === hunk.unifiedLineCount) {
        break;
      }
      resolved.push({
        index,
        label: range.label,
        side: range.side,
        hunkIndex,
        blockStart: selection.blockStart,
        blockEnd: selection.blockEnd,
        start: selection.start,
        end: selection.end,
        lines: selection.lines,
        unifiedRows: selection.unifiedRows,
        splitRows: selection.splitRows,
        unifiedRowStart: selection.unifiedRowStart,
        splitRowStart: selection.splitRowStart,
        expanded: expandedFolds?.includes(index) ?? false,
      });
      break;
    }
  }

  // Rows, not line numbers: ranges on opposite sides of one change block
  // have different line numbers but hide the same rows.
  resolved.sort((a, b) => a.unifiedRowStart - b.unifiedRowStart);

  const accepted: ResolvedDiffFold[] = [];
  for (const fold of resolved) {
    const previous = accepted[accepted.length - 1];
    const overlapsPrevious =
      previous != null &&
      previous.unifiedRowStart + previous.unifiedRows > fold.unifiedRowStart;
    if (!overlapsPrevious) {
      accepted.push(fold);
    }
  }

  return accepted;
}

/** Folds that collapse rows inside one hunk, in render order. */
export function getHunkFolds(
  folds: ResolvedDiffFold[] | undefined,
  hunkIndex: number
): ResolvedDiffFold[] {
  return folds == null || folds.length === 0
    ? EMPTY_RESOLVED_FOLDS
    : folds.filter((fold) => fold.hunkIndex === hunkIndex);
}

/** Every fold that hides part or all of one `hunkContent` entry, in order. */
export function getBlockFolds(
  hunkFolds: ResolvedDiffFold[],
  blockIndex: number
): ResolvedDiffFold[] {
  return hunkFolds.filter(
    (fold) => blockIndex >= fold.blockStart && blockIndex <= fold.blockEnd
  );
}

/**
 * Where a fold cuts into an entry of `lines` rows, as a row offset and count
 * relative to the entry's own first row. Undefined when the fold and the
 * entry do not actually overlap on the fold's side.
 */
export function getFoldSegment(
  fold: ResolvedDiffFold,
  lines: number,
  additionLineNumber: number,
  deletionLineNumber: number
): { offset: number; count: number } | undefined {
  const start =
    fold.side === 'additions' ? additionLineNumber : deletionLineNumber;
  const foldStart = Math.max(start, fold.start);
  const foldEnd = Math.min(start + lines - 1, fold.end);
  if (foldEnd < foldStart) {
    return undefined;
  }
  return { offset: foldStart - start, count: foldEnd - foldStart + 1 };
}

/** Rows the given folds remove from one layout. */
export function getFoldedRowCount(
  folds: ResolvedDiffFold[],
  diffStyle: 'unified' | 'split'
): number {
  return folds.reduce(
    (total, fold) =>
      fold.expanded
        ? total
        : total + (diffStyle === 'split' ? fold.splitRows : fold.unifiedRows),
    0
  );
}

/** What a host renderer gets for one column's copy of a fold separator. */
export function getFoldData(
  fold: ResolvedDiffFold,
  type: CodeColumnType
): FoldData {
  const { index, side, start, end, lines, label, expanded } = fold;
  return {
    slotName: getFoldSeparatorSlotName(type, index),
    foldIndex: index,
    side,
    start,
    end,
    lines,
    label,
    type,
    expanded,
  };
}

/** Value equality for the host's fold ranges, which are rebuilt per render. */
export function areFoldedRangesEqual(
  previous: FoldedRange[] | undefined,
  next: FoldedRange[] | undefined
): boolean {
  if (previous === next) {
    return true;
  }
  const previousRanges = previous ?? [];
  const nextRanges = next ?? [];
  if (previousRanges.length !== nextRanges.length) {
    return false;
  }
  return previousRanges.every((range, index) => {
    const other = nextRanges[index];
    return (
      other != null &&
      range.side === other.side &&
      range.start === other.start &&
      range.end === other.end &&
      range.label === other.label
    );
  });
}

/** Value equality for a controlled `expandedFolds` list, order-insensitive. */
export function areExpandedFoldsEqual(
  previous: number[] | undefined,
  next: number[] | undefined
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous == null || next == null || previous.length !== next.length) {
    return false;
  }
  const previousSet = new Set(previous);
  return next.every((index) => previousSet.has(index));
}
