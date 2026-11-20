import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  ContextContent,
  ExpandedHunksMap,
  FileDiffMetadata,
  Hunk,
  SemanticDiffFold,
} from '../types';
import { endsWithNewline } from './endsWithNewline';
import {
  createFoldCursor,
  type FoldCursor,
  takeHiddenRows,
} from './foldCursor';
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
  /**
   * The semantic folds the reader opened, by first old line. Every other
   * fold of the diff is closed: one row shows in place of its old lines, and
   * rows are counted that way. Leave it out to show every line.
   */
  openSemanticFolds?: ReadonlySet<number>;
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
const FOLD_PIECES = 5;
const TRAILING = 6;
const TRAILING_NEWLINE = 7;
const DONE = 8;

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
//
// Semantic folds cover old lines of a change that have no new line beside
// them. A run of such rows is yielded a piece at a time: the rows before a
// fold, then the one row of a closed fold, or the first line of an open fold
// and the rows after it. A closed fold's other lines get no row.
export class DiffRowCursor {
  private readonly diff: FileDiffMetadata;
  private readonly diffStyle: DiffRowCursorOptions['diffStyle'];
  private readonly expandedHunks: ExpandedHunksMap | true | undefined;
  private readonly collapsedContextThreshold: number;
  private readonly includeTrailingNewline: boolean;
  // The diff's semantic folds and the first of them the walk has not gone
  // past. Undefined when the diff has none, or when every line shows.
  private readonly foldCursor: FoldCursor | undefined;
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
  // The closed fold the current row stands in for, and how many rows after
  // the row it hides.
  private rowClosedFold: SemanticDiffFold | undefined = undefined;
  private rowHiddenRows = 0;
  // An open fold, and the row of the run that shows its first line.
  private rowOpenFold: SemanticDiffFold | undefined = undefined;
  private openFoldRow = -1;

  // Where the walk is: the hunk, the part of it, and the block inside it.
  private part = ENTER_HUNK;
  private walkHunkIndex = 0;
  private walkHunk: Hunk | undefined = undefined;
  private contentIndex = 0;
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
  // Whether a semantic fold starts in the current change block, and how many
  // of the block's rows closed folds hide.
  private changeHasFolds = false;
  private changeHiddenRows = 0;
  // A run that folds cut into pieces: its next row, its row count, the rows
  // it has shown so far, how many rows come before it in each view, and the
  // part the walk moves to after its last piece.
  private pieceRow = 0;
  private pieceEnd = 0;
  private piecesShown = 0;
  private piecesUnifiedStart = 0;
  private piecesSplitStart = 0;
  private partAfterPieces = CONTENT;

  // Sets the row window and finds the first hunk that can contain its rows.
  constructor({
    diff,
    diffStyle,
    startingLine = 0,
    totalLines = Infinity,
    expandedHunks,
    collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    includeTrailingNewline = false,
    openSemanticFolds,
  }: DiffRowCursorOptions) {
    this.diff = diff;
    this.diffStyle = diffStyle;
    this.startingLine = startingLine;
    this.windowEnd = startingLine + totalLines;
    this.expandedHunks = expandedHunks;
    this.collapsedContextThreshold = collapsedContextThreshold;
    this.includeTrailingNewline = includeTrailingNewline;
    this.foldCursor = createFoldCursor(diff, openSemanticFolds);
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
  // The closed semantic fold this row stands in for. The row sits on the
  // fold's first old line.
  get closedFold(): SemanticDiffFold | undefined {
    return this.rowClosedFold;
  }
  // The open semantic fold whose first old line this row shows.
  get openFold(): SemanticDiffFold | undefined {
    const { index, openFoldRow, rowOpenFold } = this;
    return index === openFoldRow ? rowOpenFold : undefined;
  }
  // The positions of the last line the row stands for. Only a closed fold's
  // row stands for more lines than its own.
  get lastUnifiedLineIndex(): number {
    const { unifiedLineIndex, rowHiddenRows } = this;
    return unifiedLineIndex + rowHiddenRows;
  }
  get lastSplitLineIndex(): number {
    const { splitStart, index, rowHiddenRows } = this;
    return splitStart + index + rowHiddenRows;
  }
  get collapsedBefore(): number {
    const { index, firstRowCollapsedBefore } = this;
    return index === 0 ? firstRowCollapsedBefore : 0;
  }
  get collapsedAfter(): number {
    const { index, collapsedAfterRow, collapsedAfterValue } = this;
    return index === collapsedAfterRow ? collapsedAfterValue : 0;
  }

  // Skips the hunks that end before the window starts, adding up their rows.
  private findStartingHunk(): void {
    const { diff, diffStyle, startingLine, foldCursor } = this;
    const lastHunkIndex = diff.hunks.length - 1;
    let hunkIndex = 0;
    for (const hunk of diff.hunks) {
      // The fold the hunk starts at, and the rows of it closed folds hide.
      const foldIndex = foldCursor?.index ?? 0;
      const hiddenRows =
        foldCursor != null ? takeHiddenRows(foldCursor, hunk) : 0;
      const leading = this.getLeadingRegion(hunk, hunkIndex);
      let contextRows = leading.fromStart + leading.fromEnd;
      if (hunkIndex === lastHunkIndex) {
        const trailing = this.getTrailingRegion();
        contextRows += (trailing?.fromStart ?? 0) + (trailing?.fromEnd ?? 0);
        if (this.hasTrailingNewlineRow(trailing?.collapsedLines ?? 0)) {
          contextRows++;
        }
      }
      const unifiedRows = contextRows + hunk.unifiedLineCount - hiddenRows;
      const splitRows = contextRows + hunk.splitLineCount - hiddenRows;
      const { unifiedCount, splitCount } = this;
      const afterHunk =
        diffStyle !== 'split'
          ? unifiedCount + unifiedRows
          : splitCount + splitRows;
      if (afterHunk > startingLine) {
        // The walk enters this hunk, so its folds are still to come.
        if (foldCursor != null) {
          foldCursor.index = foldIndex;
        }
        break;
      }
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
    while (true) {
      // A run being yielded in pieces checks each piece against the window
      // itself.
      if (
        this.part === DONE ||
        (this.part !== FOLD_PIECES && this.isPastWindow())
      ) {
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
          if (content.type === 'context') {
            this.contentIndex++;
            if (this.startContextRun(hunk, content, isLast)) return true;
            break;
          }
          if (this.foldCursor != null) {
            this.readChangeFolds(content.deletions);
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
          // The block's rows are counted without the ones closed folds hide.
          const { deletions, additions } = content;
          const { changeHiddenRows } = this;
          this.unifiedCount += deletions + additions - changeHiddenRows;
          this.splitCount += Math.max(deletions, additions) - changeHiddenRows;
          this.unifiedAt += deletions + additions;
          this.splitAt += Math.max(deletions, additions);
          this.deletionIndexAt += deletions;
          this.additionIndexAt += additions;
          this.deletionNumberAt += deletions;
          this.additionNumberAt += additions;
          if (started) return true;
          break;
        }
        case FOLD_PIECES: {
          if (this.startFoldPiece()) return true;
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
      // The rows of the block that closed folds hide.
      let hiddenRows = 0;
      if (content.type === 'change' && this.foldCursor != null) {
        this.readChangeFolds(deletions);
        hiddenRows = this.changeHiddenRows;
      }
      const { unifiedCount, splitCount } = this;
      const blockEnd =
        diffStyle === 'split'
          ? splitCount + splitRows - hiddenRows
          : unifiedCount + unifiedRows - hiddenRows;
      if (blockEnd > startingLine) break;
      this.unifiedCount += unifiedRows - hiddenRows;
      this.splitCount += splitRows - hiddenRows;
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
    this.collapsedAfterRow = -1;
    this.deletionNoEOFCRRow = -1;
    this.additionNoEOFCRRow = -1;
    this.unifiedCount += count;
    this.splitCount += count;
    return this.clipRun(count, unifiedCount, splitCount);
  }

  // Starts a run for a block of unchanged lines inside the hunk.
  private startContextRun(
    hunk: Hunk,
    content: ContextContent,
    isLast: boolean
  ): boolean {
    const { lines } = content;
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
      this.rowType = 'context';
      this.rowHunkIndex = walkHunkIndex;
      this.rowHunk = hunk;
      this.rowHasDeletion = true;
      this.rowHasAddition = true;
      this.deletionIndexStart = deletionIndexAt;
      this.deletionNumberStart = deletionNumberAt;
      this.deletionUnifiedStart = unifiedAt;
      this.additionIndexStart = additionIndexAt;
      this.additionNumberStart = additionNumberAt;
      this.additionUnifiedStart = unifiedAt;
      this.splitStart = splitAt;
      this.firstRowCollapsedBefore = this.takePendingCollapsed();
      this.setCollapsedAfterRow(diffStyle === 'unified' ? unifiedAt : splitAt);
      this.deletionNoEOFCRRow =
        isLast && hunk.noEOFCRDeletions ? lines - 1 : -1;
      this.additionNoEOFCRRow =
        isLast && hunk.noEOFCRAdditions ? lines - 1 : -1;
    }
    this.unifiedCount += lines;
    this.splitCount += lines;
    this.unifiedAt += lines;
    this.splitAt += lines;
    this.deletionIndexAt += lines;
    this.additionIndexAt += lines;
    this.deletionNumberAt += lines;
    this.additionNumberAt += lines;
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
    // Where this run's deletions and additions sit in the unified view. The
    // additions come after the block's deletions, less the rows closed folds
    // hide.
    const unifiedDeletionStart = unifiedCount + skipped;
    const unifiedAdditionStart =
      unifiedCount + deletions - this.changeHiddenRows + sideOffset;
    if (this.changeHasFolds && hasDeletion && !hasAddition) {
      this.pieceRow = 0;
      this.pieceEnd = count;
      this.piecesShown = 0;
      this.piecesUnifiedStart = unifiedDeletionStart;
      this.piecesSplitStart = splitCount + skipped;
      this.partAfterPieces = this.part;
      this.part = FOLD_PIECES;
      return this.startFoldPiece();
    }
    return this.clipRun(
      count,
      hasDeletion ? unifiedDeletionStart : unifiedAdditionStart,
      splitCount + skipped,
      hasDeletion && hasAddition ? unifiedAdditionStart : undefined
    );
  }

  // Finds what semantic folds do to the change block the walk is at: whether
  // one starts among its `deletions` old lines, and how many of its rows
  // closed folds hide. A closed fold shows one row for all of its lines.
  private readChangeFolds(deletions: number): void {
    const { foldCursor, deletionNumberAt } = this;
    if (foldCursor == null) {
      throw new Error('DiffRowCursor: missing semantic folds');
    }
    const { folds, openSemanticFolds } = foldCursor;
    let { index } = foldCursor;
    while (index < folds.length && folds[index].old.end < deletionNumberAt) {
      index++;
    }
    foldCursor.index = index;
    const lastOldLine = deletionNumberAt + deletions - 1;
    let hiddenRows = 0;
    let fold = folds[index];
    this.changeHasFolds = fold != null && fold.old.start <= lastOldLine;
    while (fold != null && fold.old.start <= lastOldLine) {
      if (!openSemanticFolds.has(fold.old.start)) {
        hiddenRows += fold.old.end - fold.old.start;
      }
      fold = folds[++index];
    }
    this.changeHiddenRows = hiddenRows;
  }

  // Starts the next piece of a run that folds cut up: the rows before a fold,
  // a closed fold's one row, or an open fold's first line with the rows after
  // it. A piece is rows of the same run, so the run's positions stand. False
  // when the window holds none of the run's remaining rows.
  private startFoldPiece(): boolean {
    const {
      foldCursor,
      deletionNumberStart,
      pieceEnd,
      piecesUnifiedStart,
      piecesSplitStart,
    } = this;
    if (foldCursor == null) {
      throw new Error('DiffRowCursor: missing semantic folds');
    }
    const { folds, openSemanticFolds } = foldCursor;
    while (this.pieceRow < pieceEnd) {
      const { pieceRow: row, piecesShown: shown } = this;
      const oldLine = deletionNumberStart + row;
      while (
        foldCursor.index < folds.length &&
        folds[foldCursor.index].old.end < oldLine
      ) {
        foldCursor.index++;
      }
      const fold = folds[foldCursor.index];
      // The row of the run the next fold starts on.
      const foldRow =
        fold != null ? fold.old.start - deletionNumberStart : pieceEnd;
      // How many rows the piece shows, and how many of the run it takes up.
      let count: number;
      let hiddenRows = 0;
      this.rowClosedFold = undefined;
      this.rowOpenFold = undefined;
      if (fold == null || foldRow > row) {
        count = Math.min(foldRow, pieceEnd) - row;
      } else if (!openSemanticFolds.has(fold.old.start)) {
        if (foldRow < row) {
          // The run starts inside a closed fold, whose lines get no row.
          this.pieceRow = fold.old.end - deletionNumberStart + 1;
          continue;
        }
        count = 1;
        hiddenRows = fold.old.end - fold.old.start;
        this.rowClosedFold = fold;
        // The row reports the hidden lines after the hunk when it hides the
        // hunk's last row, and shows no "no newline" marker.
        const { collapsedAfterRow } = this;
        if (collapsedAfterRow > row && collapsedAfterRow <= row + hiddenRows) {
          this.collapsedAfterRow = row;
        }
        if (this.deletionNoEOFCRRow === row) {
          this.deletionNoEOFCRRow = -1;
        }
      } else {
        // An open fold's lines show, up to the fold after it.
        const nextFold = folds[foldCursor.index + 1];
        const nextRow =
          nextFold != null
            ? nextFold.old.start - deletionNumberStart
            : pieceEnd;
        count = Math.min(nextRow, pieceEnd) - row;
        if (foldRow === row) {
          this.rowOpenFold = fold;
          this.openFoldRow = row;
        }
      }
      this.rowHiddenRows = hiddenRows;
      this.pieceRow = row + count + hiddenRows;
      this.piecesShown = shown + count;
      if (
        this.clipRun(
          count,
          piecesUnifiedStart + shown,
          piecesSplitStart + shown
        )
      ) {
        // The window was matched against the piece. Its rows are these rows
        // of the run.
        this.index += row;
        this.end += row;
        if (this.secondStretchFirst < this.secondStretchEnd) {
          this.secondStretchFirst += row;
          this.secondStretchEnd += row;
        }
        return true;
      }
    }
    // The rows that follow have nothing to do with a fold.
    this.rowClosedFold = undefined;
    this.rowHiddenRows = 0;
    this.rowOpenFold = undefined;
    this.part = this.partAfterPieces;
    return false;
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
    this.collapsedAfterRow = -1;
    this.deletionNoEOFCRRow = -1;
    this.additionNoEOFCRRow = -1;
    this.unifiedCount++;
    this.splitCount++;
    return this.clipRun(1, unifiedCount, splitCount);
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
