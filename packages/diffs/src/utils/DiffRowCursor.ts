import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  ContextContent,
  ExpandedHunksMap,
  FileDiffMetadata,
  Hunk,
  ResolvedDiffFold,
} from '../types';
import { endsWithNewline } from './endsWithNewline';
import {
  foldsAtAnyLine,
  getBlockFolds,
  getFoldedRowCount,
  getFoldSegment,
  getHunkFolds,
} from './foldedDiffRanges';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import {
  getExpandedRegion,
  getTrailingExpandedRegion,
} from './virtualDiffLayout';

export interface DiffRowCursorOptions {
  diff: FileDiffMetadata;
  diffStyle: 'unified' | 'split' | 'both';
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: ExpandedHunksMap | true;
  collapsedContextThreshold?: number;
  /**
   * Also emit a row for the empty line after the new file's final line
   * break, right after the last hunk. The parsed diff has no line for it;
   * an edit session shows it so the caret has a row there.
   */
  includeTrailingNewline?: boolean;
  /** Collapsed host folds, already resolved against `diff`. */
  folds?: ResolvedDiffFold[];
}

// One stretch of a block that folds at any line: rows that render, or rows a
// fold hides.
interface BlockSegment {
  offset: number;
  count: number;
  fold: ResolvedDiffFold | undefined;
}

interface HiddenBlockRows {
  unified: number;
  split: number;
  trailingFold: ResolvedDiffFold | undefined;
}

const NO_HIDDEN_ROWS: HiddenBlockRows = Object.freeze({
  unified: 0,
  split: 0,
  trailingFold: undefined,
});

// Lines a block shows on its side, for a block that folds at any line.
function getBlockLines(content: ContextContent | ChangeContent): number {
  return content.type === 'context'
    ? content.lines
    : content.deletions + content.additions;
}

// Fails a read of a side the current row does not have.
function throwMissingSide(side: 'deletion' | 'addition'): never {
  throw new Error(`DiffRowCursor: row has no ${side} line`);
}

// The parts of a hunk, in the order their rows come.
const ENTER_HUNK = 0;
const LEADING_START = 1;
const LEADING_END = 2;
const CONTENT = 3;
const CHANGE_REST = 4;
const TRAILING = 5;
const TRAILING_NEWLINE = 6;
const DONE = 7;

// Walks the rows of a diff in the order they render. The caller pulls rows:
//
//   const rows = new DiffRowCursor({ diff, diffStyle });
//   while (rows.next()) {
//     rows.additionLineNumber;
//   }
//
// After `next()` returns true, the getters describe the current row. A row
// has a deletion line, an addition line, or both: check `hasDeletion` and
// `hasAddition` before reading a side.
//
// Inside, rows are handled a run at a time. A run is a series of rows that all
// have the same type and the same sides, so a row's positions are the run's
// first positions plus the row's place in the run.
export class DiffRowCursor {
  private readonly diff: FileDiffMetadata;
  private readonly diffStyle: DiffRowCursorOptions['diffStyle'];
  private readonly expandedHunks: ExpandedHunksMap | true | undefined;
  private readonly collapsedContextThreshold: number;
  private readonly includeTrailingNewline: boolean;
  private readonly folds: ResolvedDiffFold[] | undefined;
  // The row window: rows from `startingLine` up to `windowEnd` are yielded.
  private readonly startingLine: number;
  private readonly windowEnd: number;
  // Rows passed so far in the unified view and in the split view.
  private unifiedCount = 0;
  private splitCount = 0;

  // What every row of the current run shares.
  private rowType: 'context' | 'context-expanded' | 'change' = 'context';
  private rowHunkIndex = 0;
  private rowHunk: Hunk | undefined = undefined;
  private rowHasDeletion = false;
  private rowHasAddition = false;
  // The current row's place in the run, and the place where yielding stops.
  private index = -1;
  private end = 0;
  // The second stretch's first row and end. It is empty when the first row is
  // at or past the end.
  private secondStretchFirst = 0;
  private secondStretchEnd = 0;
  // Each position at the run's first row.
  private deletionIndexStart = 0;
  private deletionNumberStart = 0;
  private deletionUnifiedStart = 0;
  private additionIndexStart = 0;
  private additionNumberStart = 0;
  private additionUnifiedStart = 0;
  private splitStart = 0;
  // Values only one row of the run carries, and that row's place in the run.
  private firstRowCollapsedBefore = 0;
  private collapsedAfterValue = 0;
  private collapsedAfterRow = -1;
  private deletionNoEOFCRRow = -1;
  private additionNoEOFCRRow = -1;
  private firstRowFoldSeparators: ResolvedDiffFold[] | undefined = undefined;

  // Where the walk is: the hunk, the part of it, and the block inside it.
  private part = ENTER_HUNK;
  private walkHunkIndex = 0;
  private walkHunk: Hunk | undefined = undefined;
  private contentIndex = 0;
  // The walked hunk's folds, and the current block's stretches when a fold
  // cuts into it.
  private hunkFolds: ResolvedDiffFold[] = [];
  private blockSegments: BlockSegment[] | undefined = undefined;
  private segmentIndex = 0;
  // Folds hidden since the last row, whose separators the next row reports.
  private pendingFolds: ResolvedDiffFold[] | undefined = undefined;
  // Folds that end the diff, and the row before them that reports them.
  private trailingFolds: ResolvedDiffFold[] | undefined = undefined;
  private trailingFoldsAt = -1;
  // Hidden lines above the hunk that the next row has to report.
  private pendingCollapsed = 0;
  // Lines revealed above the hunk, from the top and from the bottom of the
  // hidden lines there, and how many lines that gap has in all.
  private leadingStartRows = 0;
  private leadingEndRows = 0;
  private leadingRangeSize = 0;
  // Lines revealed below the last hunk, and the lines still hidden there.
  private trailingRows = -1;
  private trailingCollapsed = 0;
  // Positions of the next block's first row.
  private unifiedAt = 0;
  private splitAt = 0;
  private deletionIndexAt = 0;
  private additionIndexAt = 0;
  private deletionNumberAt = 0;
  private additionNumberAt = 0;
  // Where the hunk's last row sits when hidden lines follow it, else -1.
  private collapsedAfterAt = -1;

  // Sets the row window and finds the first hunk that can contain its rows.
  constructor({
    diff,
    diffStyle,
    startingLine = 0,
    totalLines = Infinity,
    expandedHunks,
    collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    includeTrailingNewline = false,
    folds,
  }: DiffRowCursorOptions) {
    this.diff = diff;
    this.diffStyle = diffStyle;
    this.startingLine = startingLine;
    this.windowEnd = startingLine + totalLines;
    this.expandedHunks = expandedHunks;
    this.collapsedContextThreshold = collapsedContextThreshold;
    this.includeTrailingNewline = includeTrailingNewline;
    this.folds = folds != null && folds.length > 0 ? folds : undefined;
    if (totalLines === 0) {
      this.part = DONE;
    } else if (startingLine > 0) {
      this.findStartingHunk();
    }
  }

  // Moves to the next row. False when there are no more.
  next(): boolean {
    const { index, end } = this;
    const next = index + 1;
    if (next < end) {
      this.index = next;
      return true;
    }
    return this.nextRun();
  }

  get type(): 'context' | 'context-expanded' | 'change' {
    return this.rowType;
  }
  get hunkIndex(): number {
    return this.rowHunkIndex;
  }
  get hunk(): Hunk | undefined {
    return this.rowHunk;
  }
  get hasDeletion(): boolean {
    return this.rowHasDeletion;
  }
  get hasAddition(): boolean {
    return this.rowHasAddition;
  }

  get deletionLineIndex(): number {
    const { rowHasDeletion, deletionIndexStart, index } = this;
    if (!rowHasDeletion) throwMissingSide('deletion');
    return deletionIndexStart + index;
  }
  get deletionLineNumber(): number {
    const { rowHasDeletion, deletionNumberStart, index } = this;
    if (!rowHasDeletion) throwMissingSide('deletion');
    return deletionNumberStart + index;
  }
  get deletionUnifiedLineIndex(): number {
    const { rowHasDeletion, deletionUnifiedStart, index } = this;
    if (!rowHasDeletion) throwMissingSide('deletion');
    return deletionUnifiedStart + index;
  }
  get deletionNoEOFCR(): boolean {
    const { rowHasDeletion, deletionNoEOFCRRow, index } = this;
    if (!rowHasDeletion) throwMissingSide('deletion');
    return index === deletionNoEOFCRRow;
  }
  get additionLineIndex(): number {
    const { rowHasAddition, additionIndexStart, index } = this;
    if (!rowHasAddition) throwMissingSide('addition');
    return additionIndexStart + index;
  }
  get additionLineNumber(): number {
    const { rowHasAddition, additionNumberStart, index } = this;
    if (!rowHasAddition) throwMissingSide('addition');
    return additionNumberStart + index;
  }
  get additionUnifiedLineIndex(): number {
    const { rowHasAddition, additionUnifiedStart, index } = this;
    if (!rowHasAddition) throwMissingSide('addition');
    return additionUnifiedStart + index;
  }
  get additionNoEOFCR(): boolean {
    const { rowHasAddition, additionNoEOFCRRow, index } = this;
    if (!rowHasAddition) throwMissingSide('addition');
    return index === additionNoEOFCRRow;
  }
  // The row's position in unified view, using its addition when it has one.
  get unifiedLineIndex(): number {
    const {
      rowHasAddition,
      additionUnifiedStart,
      deletionUnifiedStart,
      index,
    } = this;
    return (
      (rowHasAddition ? additionUnifiedStart : deletionUnifiedStart) + index
    );
  }
  get splitLineIndex(): number {
    const { splitStart, index } = this;
    return splitStart + index;
  }
  get collapsedBefore(): number {
    const { index, firstRowCollapsedBefore } = this;
    return index === 0 ? firstRowCollapsedBefore : 0;
  }
  // Separators that render above this row, in render order: folds hidden
  // just above it, then an open fold that starts on it.
  get foldSeparators(): ResolvedDiffFold[] | undefined {
    const { index, firstRowFoldSeparators } = this;
    return index === 0 ? firstRowFoldSeparators : undefined;
  }
  // Separators for folds that end the diff, which render below this row.
  get foldSeparatorsAfter(): ResolvedDiffFold[] | undefined {
    const { trailingFolds, trailingFoldsAt, diffStyle } = this;
    if (trailingFolds == null) {
      return undefined;
    }
    const at =
      diffStyle === 'split' ? this.splitLineIndex : this.unifiedLineIndex;
    return at === trailingFoldsAt ? trailingFolds : undefined;
  }
  get collapsedAfter(): number {
    const { index, collapsedAfterRow, collapsedAfterValue } = this;
    return index === collapsedAfterRow ? collapsedAfterValue : 0;
  }

  // Skips the hunks that end before the window starts, adding up their rows.
  private findStartingHunk(): void {
    const { diff, diffStyle, startingLine } = this;
    const lastHunkIndex = diff.hunks.length - 1;
    let hunkIndex = 0;
    for (const hunk of diff.hunks) {
      const leading = this.getLeadingRegion(hunk, hunkIndex);
      let contextRows = leading.fromStart + leading.fromEnd;
      if (hunkIndex === lastHunkIndex) {
        const trailing = this.getTrailingRegion();
        contextRows += (trailing?.fromStart ?? 0) + (trailing?.fromEnd ?? 0);
        if (this.hasTrailingNewlineRow(trailing?.collapsedLines ?? 0)) {
          contextRows++;
        }
      }
      const hunkFolds = getHunkFolds(this.folds, hunkIndex);
      const hasFolds = hunkFolds.length > 0;
      const unifiedRows =
        contextRows +
        hunk.unifiedLineCount -
        (hasFolds ? getFoldedRowCount(hunkFolds, 'unified') : 0);
      const splitRows =
        contextRows +
        hunk.splitLineCount -
        (hasFolds ? getFoldedRowCount(hunkFolds, 'split') : 0);
      const { unifiedCount, splitCount } = this;
      const afterHunk =
        diffStyle !== 'split'
          ? unifiedCount + unifiedRows
          : splitCount + splitRows;
      if (afterHunk > startingLine) break;
      this.unifiedCount += unifiedRows;
      this.splitCount += splitRows;
      hunkIndex++;
    }
    this.walkHunkIndex = hunkIndex;
  }

  // The lines revealed in the hidden gap above a hunk.
  private getLeadingRegion(hunk: Hunk, hunkIndex: number) {
    const { diff, expandedHunks, collapsedContextThreshold } = this;
    return getExpandedRegion({
      isPartial: diff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex,
      collapsedContextThreshold,
    });
  }

  // The lines revealed below the last hunk. Undefined when the file ends
  // with the hunk.
  private getTrailingRegion() {
    const { diff, expandedHunks, collapsedContextThreshold } = this;
    return getTrailingExpandedRegion({
      fileDiff: diff,
      hunkIndex: diff.hunks.length - 1,
      expandedHunks,
      collapsedContextThreshold,
      errorPrefix: 'DiffRowCursor',
    });
  }

  // Whether the walk ends with a row for the empty line after the new file's
  // final line break. `trailingCollapsed` is the lines still hidden below the
  // last hunk.
  private hasTrailingNewlineRow(trailingCollapsed: number): boolean {
    const { diff, includeTrailingNewline } = this;
    return (
      includeTrailingNewline &&
      trailingCollapsed === 0 &&
      endsWithNewline(diff, 'additions')
    );
  }

  // Narrows a run of `count` rows to the rows inside the window and puts the
  // cursor on the first of them. False when the window holds none of them.
  // `unifiedStart` and `splitStart` are how many rows come before the run in
  // each view. A run with a line on both sides of a change sits in two places
  // in the unified view; `unifiedAdditionStart` is where its additions sit.
  private clipRun(
    count: number,
    unifiedStart: number,
    splitStart: number,
    unifiedAdditionStart?: number
  ): boolean {
    const { diffStyle, startingLine, windowEnd } = this;
    if (startingLine === 0 && windowEnd === Infinity) {
      this.index = 0;
      this.end = count;
      return count > 0;
    }
    if (diffStyle !== 'both') {
      const start = diffStyle === 'unified' ? unifiedStart : splitStart;
      this.index = Math.max(0, startingLine - start);
      this.end = Math.min(count, windowEnd - start);
      return this.index < this.end;
    }

    // `both` yields every row either view shows in the window. The views count
    // rows differently, so that can be two separate parts of one run. Along
    // the run, the rows the unified view shows come at or before the rows the
    // split view shows, and the rows it shows for the run's additions come
    // before both.
    let first = Math.max(0, startingLine - unifiedStart);
    let end = Math.min(count, windowEnd - unifiedStart);
    const splitFirst = Math.max(0, startingLine - splitStart);
    const splitEnd = Math.min(count, windowEnd - splitStart);
    let secondFirst = 0;
    let secondEnd = 0;
    if (splitFirst < splitEnd) {
      if (first < end) {
        if (splitFirst <= end) {
          end = Math.max(end, splitEnd);
        } else {
          secondFirst = splitFirst;
          secondEnd = splitEnd;
        }
      } else {
        first = splitFirst;
        end = splitEnd;
      }
    }
    if (unifiedAdditionStart != null) {
      const additionFirst = Math.max(0, startingLine - unifiedAdditionStart);
      const additionEnd = Math.min(count, windowEnd - unifiedAdditionStart);
      if (additionFirst < additionEnd) {
        if (first < end) {
          if (additionEnd >= first) {
            first = additionFirst;
          } else {
            secondFirst = first;
            secondEnd = end;
            first = additionFirst;
            end = additionEnd;
          }
        } else {
          first = additionFirst;
          end = additionEnd;
        }
      }
    }
    if (first >= end) {
      return false;
    }
    this.index = first;
    this.end = end;
    if (secondFirst < secondEnd) {
      this.secondStretchFirst = secondFirst;
      this.secondStretchEnd = secondEnd;
    }
    return true;
  }

  // Whether every row still to come is after the window.
  private isPastWindow(): boolean {
    const { diffStyle, unifiedCount, splitCount, windowEnd } = this;
    return diffStyle === 'unified'
      ? unifiedCount >= windowEnd
      : diffStyle === 'split'
        ? splitCount >= windowEnd
        : unifiedCount >= windowEnd && splitCount >= windowEnd;
  }

  // Moves to the next rows to yield: the rest of the current run, or the
  // next run with rows inside the window. False when the walk is over.
  private nextRun(): boolean {
    const { diff, secondStretchFirst, secondStretchEnd } = this;
    if (secondStretchFirst < secondStretchEnd) {
      this.index = secondStretchFirst;
      this.end = secondStretchEnd;
      this.secondStretchFirst = 0;
      this.secondStretchEnd = 0;
      return true;
    }
    for (;;) {
      if (this.part === DONE || this.isPastWindow()) {
        this.part = DONE;
        return false;
      }
      switch (this.part) {
        case ENTER_HUNK: {
          const hunk = diff.hunks[this.walkHunkIndex];
          if (hunk == null) {
            this.part = DONE;
            return false;
          }
          this.enterHunk(hunk);
          this.part = LEADING_START;
          break;
        }
        case LEADING_START: {
          this.part = LEADING_END;
          if (
            this.leadingStartRows > 0 &&
            this.startExpandedRun(
              this.leadingStartRows,
              this.leadingRangeSize,
              0
            )
          ) {
            return true;
          }
          break;
        }
        case LEADING_END: {
          this.part = CONTENT;
          const started =
            this.leadingEndRows > 0 &&
            this.startExpandedRun(
              this.leadingEndRows,
              this.leadingEndRows,
              this.takePendingCollapsed()
            );
          if (started) {
            return true;
          }
          if (this.startingLine > 0) {
            this.skipBlocksBeforeWindow();
          }
          break;
        }
        case CONTENT: {
          const { walkHunk: hunk } = this;
          if (hunk == null) {
            throw new Error('DiffRowCursor: missing hunk');
          }
          const content = hunk.hunkContent[this.contentIndex];
          if (content == null) {
            this.part = TRAILING;
            break;
          }
          const isLast = this.contentIndex === hunk.hunkContent.length - 1;
          if (content.type === 'context' && this.hunkFolds.length === 0) {
            this.contentIndex++;
            if (this.startBlockRun(hunk, content, isLast, 0, content.lines))
              return true;
            break;
          }
          if (
            content.type === 'context' ||
            (this.hunkFolds.length > 0 && foldsAtAnyLine(content))
          ) {
            this.blockSegments ??= this.getBlockSegments(content);
            const segment = this.blockSegments[this.segmentIndex++];
            if (segment == null) {
              this.blockSegments = undefined;
              this.segmentIndex = 0;
              this.contentIndex++;
              break;
            }
            const { fold, offset, count } = segment;
            if (fold?.expanded === false) {
              this.hideSegment(content, count);
              this.addPendingFold(fold);
              break;
            }
            if (fold != null) {
              this.addOpenFold(fold);
            }
            if (this.startBlockRun(hunk, content, isLast, offset, count))
              return true;
            break;
          }
          const changeFold =
            this.hunkFolds.length > 0
              ? getBlockFolds(this.hunkFolds, this.contentIndex)[0]
              : undefined;
          if (changeFold?.expanded === true) {
            this.addOpenFold(changeFold);
          } else if (changeFold != null) {
            // A change with both sides folds whole, both sides together.
            const { deletions, additions } = content;
            this.hideRows(
              deletions + additions,
              Math.max(deletions, additions),
              deletions,
              additions
            );
            this.addPendingFold(changeFold);
            this.contentIndex++;
            break;
          }
          this.part = CHANGE_REST;
          if (this.startChangeRun(hunk, content, isLast, false)) return true;
          break;
        }
        case CHANGE_REST: {
          const { walkHunk: hunk } = this;
          if (hunk == null) {
            throw new Error('DiffRowCursor: missing hunk');
          }
          const content = hunk.hunkContent[this.contentIndex];
          if (content == null || content.type !== 'change') {
            throw new Error('DiffRowCursor: missing change content');
          }
          const isLast = this.contentIndex === hunk.hunkContent.length - 1;
          this.part = CONTENT;
          this.contentIndex++;
          const started = this.startChangeRun(hunk, content, isLast, true);
          const { deletions, additions } = content;
          this.unifiedCount += deletions + additions;
          this.splitCount += Math.max(deletions, additions);
          this.unifiedAt += deletions + additions;
          this.splitAt += Math.max(deletions, additions);
          this.deletionIndexAt += deletions;
          this.additionIndexAt += additions;
          this.deletionNumberAt += deletions;
          this.additionNumberAt += additions;
          if (started) return true;
          break;
        }
        case TRAILING: {
          this.part = TRAILING_NEWLINE;
          if (this.trailingRows > 0 && this.startTrailingRun()) return true;
          break;
        }
        case TRAILING_NEWLINE: {
          const isLastHunk = this.walkHunkIndex === diff.hunks.length - 1;
          this.walkHunkIndex++;
          this.part = ENTER_HUNK;
          if (
            isLastHunk &&
            this.hasTrailingNewlineRow(this.trailingCollapsed) &&
            this.startTrailingNewlineRun()
          ) {
            return true;
          }
          break;
        }
      }
    }
  }

  // Passes over whole blocks before the window and advances the hunk's positions.
  private skipBlocksBeforeWindow(): void {
    const { walkHunk, diffStyle, startingLine, unifiedCount } = this;
    if (walkHunk == null) {
      throw new Error('DiffRowCursor: missing hunk');
    }
    while (this.contentIndex < walkHunk.hunkContent.length) {
      const content = walkHunk.hunkContent[this.contentIndex];
      const deletions =
        content.type === 'context' ? content.lines : content.deletions;
      const additions =
        content.type === 'context' ? content.lines : content.additions;
      const unifiedRows =
        content.type === 'context' ? content.lines : deletions + additions;
      const splitRows = Math.max(deletions, additions);
      const hidden = this.getHiddenBlockRows(content);
      const { unifiedCount, splitCount } = this;
      const blockEnd =
        diffStyle === 'split'
          ? splitCount + splitRows - hidden.split
          : unifiedCount + unifiedRows - hidden.unified;
      if (blockEnd > startingLine) break;
      this.unifiedCount += unifiedRows - hidden.unified;
      this.splitCount += splitRows - hidden.split;
      if (hidden.unified < unifiedRows) this.pendingFolds = undefined;
      if (hidden.trailingFold != null) this.addPendingFold(hidden.trailingFold);
      this.unifiedAt += unifiedRows;
      this.splitAt += splitRows;
      this.deletionIndexAt += deletions;
      this.additionIndexAt += additions;
      this.deletionNumberAt += deletions;
      this.additionNumberAt += additions;
      this.contentIndex++;
    }
    if (this.unifiedCount > unifiedCount) this.pendingCollapsed = 0;
  }

  // Works out what is revealed around a hunk and where its first row sits.
  private enterHunk(hunk: Hunk): void {
    const { diff, diffStyle, walkHunkIndex } = this;
    const deletionBoundary = getHunkSideStartBoundary(
      hunk.deletionStart,
      hunk.deletionCount
    );
    const additionBoundary = getHunkSideStartBoundary(
      hunk.additionStart,
      hunk.additionCount
    );
    const leading = this.getLeadingRegion(hunk, walkHunkIndex);
    const trailing =
      walkHunkIndex === diff.hunks.length - 1
        ? this.getTrailingRegion()
        : undefined;
    this.walkHunk = hunk;
    this.contentIndex = 0;
    this.hunkFolds = getHunkFolds(this.folds, walkHunkIndex);
    this.blockSegments = undefined;
    this.segmentIndex = 0;
    this.leadingStartRows = leading.fromStart;
    this.leadingEndRows = leading.fromEnd;
    this.leadingRangeSize = leading.rangeSize;
    this.pendingCollapsed = leading.collapsedLines;
    this.trailingRows =
      trailing != null ? trailing.fromStart + trailing.fromEnd : -1;
    this.trailingCollapsed = trailing?.collapsedLines ?? 0;
    this.unifiedAt = hunk.unifiedLineStart;
    this.splitAt = hunk.splitLineStart;
    this.deletionIndexAt =
      !diff.isPartial && hunk.deletionCount === 0
        ? deletionBoundary
        : hunk.deletionLineIndex;
    this.additionIndexAt =
      !diff.isPartial && hunk.additionCount === 0
        ? additionBoundary
        : hunk.additionLineIndex;
    this.deletionNumberAt = deletionBoundary + 1;
    this.additionNumberAt = additionBoundary + 1;
    // With lines hidden after the last hunk and none of them revealed, the
    // hunk's last row reports them.
    this.collapsedAfterAt =
      trailing != null &&
      trailing.collapsedLines > 0 &&
      trailing.fromStart + trailing.fromEnd === 0
        ? diffStyle === 'unified'
          ? hunk.unifiedLineStart + hunk.unifiedLineCount - 1
          : hunk.splitLineStart + hunk.splitLineCount - 1
        : -1;
    this.setTrailingFolds(hunk);
  }

  // Finds the collapsed folds that hide the last rows of the diff. No row
  // follows them, so the row above them reports them, along with any hidden
  // lines after the hunk.
  // `both` walks are for highlighting, which renders no separators.
  private setTrailingFolds(hunk: Hunk): void {
    const { diff, diffStyle, hunkFolds, walkHunkIndex, trailingRows } = this;
    this.trailingFolds = undefined;
    this.trailingFoldsAt = -1;
    if (
      walkHunkIndex !== diff.hunks.length - 1 ||
      diffStyle === 'both' ||
      trailingRows > 0 ||
      this.hasTrailingNewlineRow(this.trailingCollapsed)
    ) {
      return;
    }
    const split = diffStyle === 'split';
    let end = split
      ? hunk.splitLineStart + hunk.splitLineCount
      : hunk.unifiedLineStart + hunk.unifiedLineCount;
    const folds: ResolvedDiffFold[] = [];
    for (let index = hunkFolds.length - 1; index >= 0; index--) {
      const fold = hunkFolds[index];
      const start = split ? fold.splitRowStart : fold.unifiedRowStart;
      const rows = split ? fold.splitRows : fold.unifiedRows;
      if (fold.expanded || start + rows !== end) break;
      folds.unshift(fold);
      end = start;
    }
    if (folds.length === 0) {
      return;
    }
    this.trailingFolds = folds;
    this.trailingFoldsAt = end - 1;
    if (this.collapsedAfterAt !== -1) {
      this.collapsedAfterAt = end - 1;
    }
  }

  // Hands the hidden lines above the hunk to the run whose first row reports
  // them. Later runs get none.
  private takePendingCollapsed(): number {
    const { pendingCollapsed } = this;
    this.pendingCollapsed = 0;
    return pendingCollapsed;
  }

  // Starts a run of unchanged lines revealed above the hunk. `back` is how
  // many lines above the hunk the run begins.
  private startExpandedRun(
    count: number,
    back: number,
    collapsedBefore: number
  ): boolean {
    const {
      unifiedCount,
      splitCount,
      walkHunkIndex,
      walkHunk,
      deletionIndexAt,
      deletionNumberAt,
      additionIndexAt,
      additionNumberAt,
      unifiedAt,
      splitAt,
    } = this;
    this.rowType = 'context-expanded';
    this.rowHunkIndex = walkHunkIndex;
    this.rowHunk = walkHunk;
    this.rowHasDeletion = true;
    this.rowHasAddition = true;
    this.deletionIndexStart = deletionIndexAt - back;
    this.deletionNumberStart = deletionNumberAt - back;
    this.deletionUnifiedStart = unifiedAt - back;
    this.additionIndexStart = additionIndexAt - back;
    this.additionNumberStart = additionNumberAt - back;
    this.additionUnifiedStart = unifiedAt - back;
    this.splitStart = splitAt - back;
    this.firstRowCollapsedBefore = collapsedBefore;
    this.firstRowFoldSeparators = this.takePendingFolds();
    this.collapsedAfterRow = -1;
    this.deletionNoEOFCRRow = -1;
    this.additionNoEOFCRRow = -1;
    this.unifiedCount += count;
    this.splitCount += count;
    return this.clipRun(count, unifiedCount, splitCount);
  }

  // Starts a run for a stretch of a block that folds at any line: unchanged
  // lines, or a change with lines on one side only. `offset` and `lines` pick
  // the stretch; a fold can hide the rest.
  private startBlockRun(
    hunk: Hunk,
    content: ContextContent | ChangeContent,
    isLast: boolean,
    offset: number,
    lines: number
  ): boolean {
    const context = content.type === 'context';
    const hasDeletion = context || content.deletions > 0;
    const hasAddition = context || content.additions > 0;
    const endsBlock = isLast && offset + lines === getBlockLines(content);
    const {
      diffStyle,
      unifiedCount,
      splitCount,
      walkHunkIndex,
      deletionIndexAt,
      deletionNumberAt,
      additionIndexAt,
      additionNumberAt,
      unifiedAt,
      splitAt,
    } = this;
    const started = lines > 0;
    if (started) {
      this.rowType = context ? 'context' : 'change';
      this.rowHunkIndex = walkHunkIndex;
      this.rowHunk = hunk;
      this.rowHasDeletion = hasDeletion;
      this.rowHasAddition = hasAddition;
      this.deletionIndexStart = deletionIndexAt;
      this.deletionNumberStart = deletionNumberAt;
      this.deletionUnifiedStart = unifiedAt;
      this.additionIndexStart = additionIndexAt;
      this.additionNumberStart = additionNumberAt;
      this.additionUnifiedStart = unifiedAt;
      this.splitStart = splitAt;
      this.firstRowCollapsedBefore = this.takePendingCollapsed();
      this.firstRowFoldSeparators = this.takePendingFolds();
      this.setCollapsedAfterRow(diffStyle === 'unified' ? unifiedAt : splitAt);
      this.deletionNoEOFCRRow =
        endsBlock && hasDeletion && hunk.noEOFCRDeletions ? lines - 1 : -1;
      this.additionNoEOFCRRow =
        endsBlock && hasAddition && hunk.noEOFCRAdditions ? lines - 1 : -1;
    }
    this.unifiedCount += lines;
    this.splitCount += lines;
    this.unifiedAt += lines;
    this.splitAt += lines;
    if (hasDeletion) {
      this.deletionIndexAt += lines;
      this.deletionNumberAt += lines;
    }
    if (hasAddition) {
      this.additionIndexAt += lines;
      this.additionNumberAt += lines;
    }
    return started && this.clipRun(lines, unifiedCount, splitCount);
  }

  // Starts one of a change block's two runs. In unified the first is the
  // block's deletions and the rest is its additions. In split and `both` the
  // first is the rows with a line on both sides, and the rest is the rows
  // where only the longer side has one.
  private startChangeRun(
    hunk: Hunk,
    content: ChangeContent,
    isLast: boolean,
    rest: boolean
  ): boolean {
    const { deletions, additions } = content;
    const {
      diffStyle,
      unifiedCount,
      splitCount,
      walkHunkIndex,
      deletionIndexAt,
      deletionNumberAt,
      additionIndexAt,
      additionNumberAt,
      unifiedAt,
      splitAt,
    } = this;
    const unified = diffStyle === 'unified';
    const paired = Math.min(deletions, additions);
    // Rows of the block that come before this run.
    const skipped = unified ? (rest ? deletions : 0) : rest ? paired : 0;
    const count = unified
      ? rest
        ? additions
        : deletions
      : rest
        ? Math.max(deletions, additions) - paired
        : paired;
    if (count <= 0) return false;
    const hasDeletion = unified ? !rest : !rest || deletions > additions;
    const hasAddition = unified ? rest : !rest || additions > deletions;
    this.rowType = 'change';
    this.rowHunkIndex = walkHunkIndex;
    this.rowHunk = hunk;
    this.rowHasDeletion = hasDeletion;
    this.rowHasAddition = hasAddition;
    // A unified run starts at the first line of its side. A split run of
    // one-sided rows starts after the lines its paired rows used.
    const sideOffset = unified ? 0 : skipped;
    this.deletionIndexStart = deletionIndexAt + sideOffset;
    this.deletionNumberStart = deletionNumberAt + sideOffset;
    this.deletionUnifiedStart = unifiedAt + sideOffset;
    this.additionIndexStart = additionIndexAt + sideOffset;
    this.additionNumberStart = additionNumberAt + sideOffset;
    this.additionUnifiedStart = unifiedAt + deletions + sideOffset;
    this.splitStart = splitAt + sideOffset;
    this.firstRowCollapsedBefore = this.takePendingCollapsed();
    this.firstRowFoldSeparators = this.takePendingFolds();
    this.setCollapsedAfterRow(
      unified ? unifiedAt + skipped : splitAt + skipped
    );
    // Only the row that ends the block can carry a "no newline" marker.
    const endsBlock = unified || rest || deletions === additions;
    this.deletionNoEOFCRRow =
      isLast && hasDeletion && endsBlock && hunk.noEOFCRDeletions
        ? count - 1
        : -1;
    this.additionNoEOFCRRow =
      isLast && hasAddition && endsBlock && hunk.noEOFCRAdditions
        ? count - 1
        : -1;
    // Where this run's deletions and additions sit in the unified view.
    const unifiedDeletionStart = unifiedCount + skipped;
    const unifiedAdditionStart = unifiedCount + deletions + sideOffset;
    return this.clipRun(
      count,
      hasDeletion ? unifiedDeletionStart : unifiedAdditionStart,
      splitCount + skipped,
      hasDeletion && hasAddition ? unifiedAdditionStart : undefined
    );
  }

  // Starts a run of unchanged lines revealed below the last hunk.
  private startTrailingRun(): boolean {
    const {
      diff,
      trailingRows: count,
      trailingCollapsed,
      unifiedCount,
      splitCount,
      deletionIndexAt,
      deletionNumberAt,
      additionIndexAt,
      additionNumberAt,
      unifiedAt,
      splitAt,
    } = this;
    this.rowType = 'context-expanded';
    this.rowHunkIndex = diff.hunks.length;
    this.rowHunk = undefined;
    this.rowHasDeletion = true;
    this.rowHasAddition = true;
    this.deletionIndexStart = deletionIndexAt;
    this.deletionNumberStart = deletionNumberAt;
    this.deletionUnifiedStart = unifiedAt;
    this.additionIndexStart = additionIndexAt;
    this.additionNumberStart = additionNumberAt;
    this.additionUnifiedStart = unifiedAt;
    this.splitStart = splitAt;
    this.firstRowCollapsedBefore = 0;
    this.firstRowFoldSeparators = this.takePendingFolds();
    this.collapsedAfterValue = trailingCollapsed;
    this.collapsedAfterRow = count - 1;
    this.deletionNoEOFCRRow = -1;
    this.additionNoEOFCRRow = -1;
    this.unifiedCount += count;
    this.splitCount += count;
    return this.clipRun(count, unifiedCount, splitCount);
  }

  // Starts the one-row run for the empty line after the new file's final
  // line break.
  private startTrailingNewlineRun(): boolean {
    const {
      diff,
      trailingRows,
      unifiedCount,
      splitCount,
      deletionIndexAt,
      deletionNumberAt,
      additionIndexAt,
      additionNumberAt,
      unifiedAt,
      splitAt,
    } = this;
    const offset = Math.max(trailingRows, 0);
    const context = endsWithNewline(diff, 'deletions');
    const additionLineIndex = additionIndexAt + offset;
    const deletionLineIndex = deletionIndexAt + offset;
    this.rowType = context ? 'context' : 'change';
    this.rowHunkIndex = diff.hunks.length;
    this.rowHunk = undefined;
    this.rowHasDeletion = context;
    this.rowHasAddition = true;
    this.deletionIndexStart = deletionLineIndex;
    this.deletionNumberStart = deletionNumberAt + offset;
    this.deletionUnifiedStart = unifiedAt + offset;
    this.additionIndexStart = additionLineIndex;
    this.additionNumberStart = additionNumberAt + offset;
    this.additionUnifiedStart = unifiedAt + offset;
    this.splitStart = splitAt + offset;
    this.firstRowCollapsedBefore = 0;
    this.firstRowFoldSeparators = this.takePendingFolds();
    this.collapsedAfterRow = -1;
    this.deletionNoEOFCRRow = -1;
    this.additionNoEOFCRRow = -1;
    this.unifiedCount++;
    this.splitCount++;
    return this.clipRun(1, unifiedCount, splitCount);
  }

  // Hands the separators of the folds hidden so far to the run whose first
  // row reports them.
  private takePendingFolds(): ResolvedDiffFold[] | undefined {
    const { pendingFolds } = this;
    this.pendingFolds = undefined;
    return pendingFolds;
  }

  // Queues a fold's separator for the next row. A fold spanning several
  // blocks is queued once.
  private addPendingFold(fold: ResolvedDiffFold): void {
    const pendingFolds = (this.pendingFolds ??= []);
    if (pendingFolds.at(-1) !== fold) {
      pendingFolds.push(fold);
    }
  }

  // Queues an open fold's separator for its first row, once.
  private addOpenFold(fold: ResolvedDiffFold): void {
    if (fold.blockStart === this.contentIndex) {
      this.addPendingFold(fold);
    }
  }

  // Passes over rows a fold hides: their lines advance, but no row renders.
  private hideRows(
    unifiedRows: number,
    splitRows: number,
    deletions: number,
    additions = deletions
  ): void {
    this.unifiedAt += unifiedRows;
    this.splitAt += splitRows;
    this.deletionIndexAt += deletions;
    this.additionIndexAt += additions;
    this.deletionNumberAt += deletions;
    this.additionNumberAt += additions;
  }

  // Splits a block that folds at any line at the folds that cut into it, in
  // render order.
  private getBlockSegments(
    content: ContextContent | ChangeContent
  ): BlockSegment[] {
    const { additionNumberAt, deletionNumberAt } = this;
    const lines = getBlockLines(content);
    const segments: BlockSegment[] = [];
    let offset = 0;
    for (const fold of getBlockFolds(this.hunkFolds, this.contentIndex)) {
      const cut = getFoldSegment(
        fold,
        lines,
        additionNumberAt,
        deletionNumberAt
      );
      if (cut == null) continue;
      if (cut.offset > offset) {
        segments.push({ offset, count: cut.offset - offset, fold: undefined });
      }
      segments.push({ offset: cut.offset, count: cut.count, fold });
      offset = cut.offset + cut.count;
    }
    if (offset < lines) {
      segments.push({ offset, count: lines - offset, fold: undefined });
    }
    return segments;
  }

  // Passes over a stretch of a block that folds at any line. A one-sided
  // change has lines on its own side only.
  private hideSegment(
    content: ContextContent | ChangeContent,
    count: number
  ): void {
    const context = content.type === 'context';
    this.hideRows(
      count,
      count,
      context || content.deletions > 0 ? count : 0,
      context || content.additions > 0 ? count : 0
    );
  }

  // Rows the hunk's folds hide in one block, and the fold that ends the
  // block, if any, whose separator the next block's first row reports.
  private getHiddenBlockRows(
    content: ContextContent | ChangeContent
  ): HiddenBlockRows {
    if (this.hunkFolds.length === 0) {
      return NO_HIDDEN_ROWS;
    }
    if (content.type === 'change' && !foldsAtAnyLine(content)) {
      const fold = getBlockFolds(this.hunkFolds, this.contentIndex)[0];
      return fold == null || fold.expanded
        ? NO_HIDDEN_ROWS
        : {
            unified: content.deletions + content.additions,
            split: Math.max(content.deletions, content.additions),
            trailingFold: fold,
          };
    }
    let hidden = 0;
    let trailingFold: ResolvedDiffFold | undefined;
    for (const { fold, count } of this.getBlockSegments(content)) {
      const hides = fold?.expanded === false;
      if (hides) hidden += count;
      trailingFold = hides ? fold : undefined;
    }
    return { unified: hidden, split: hidden, trailingFold };
  }

  // Finds which row of a run, if any, reports the lines hidden after the
  // last hunk. `runStart` is where the run's first row sits.
  private setCollapsedAfterRow(runStart: number): void {
    const { collapsedAfterAt, trailingCollapsed } = this;
    if (collapsedAfterAt === -1) {
      this.collapsedAfterRow = -1;
      return;
    }
    this.collapsedAfterValue = trailingCollapsed;
    this.collapsedAfterRow = collapsedAfterAt - runStart;
  }
}
