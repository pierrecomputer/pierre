import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  ContextContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
  SemanticDiffFold,
} from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import {
  getExpandedRegion,
  getTrailingExpandedRegion,
} from './virtualDiffLayout';

export interface DiffLineMetadata {
  unifiedLineIndex: number;
  splitLineIndex: number;
  lineIndex: number;
  lineNumber: number;
  noEOFCR: boolean;
}

/**
 * The one row shown in place of a closed semantic fold's old lines. It sits
 * on the row of the fold's first old line.
 */
export interface FoldRow {
  fold: SemanticDiffFold;
  /** The split row of the fold's last old line. */
  lastSplitLineIndex: number;
  /** The unified row of the fold's last old line. */
  lastUnifiedLineIndex: number;
}

export interface DiffLineCallbackBase {
  hunkIndex: number;
  hunk: Hunk | undefined; // undefined for trailing expansion region
  collapsedBefore: number; // > 0 means separator before this line, value = hidden lines
  collapsedAfter: number; // > 0 only on final line if trailing collapsed content
  /**
   * Set when this row stands in for a closed semantic fold. `deletionLine`
   * is the fold's first old line; its other lines get no row.
   */
  foldRow?: FoldRow;
  /** Set on the first old line of a semantic fold the reader opened. */
  openFold?: SemanticDiffFold;
}

interface DiffLineCallbackContext extends DiffLineCallbackBase {
  type: 'context';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
  hunkContent: ContextContent;
}

// Unchanged lines revealed between hunks are not part of any block.
interface DiffLineCallbackExpandedContext extends DiffLineCallbackBase {
  type: 'context-expanded';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
  hunkContent?: undefined;
}

interface DiffLineCallbackChangePair extends DiffLineCallbackBase {
  type: 'change';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
  hunkContent: ChangeContent;
}

interface DiffLineCallbackChangeDeletion extends DiffLineCallbackBase {
  type: 'change';
  deletionLine: DiffLineMetadata;
  additionLine?: undefined;
  hunkContent: ChangeContent;
}

interface DiffLineCallbackChangeAddition extends DiffLineCallbackBase {
  type: 'change';
  deletionLine?: undefined;
  additionLine: DiffLineMetadata;
  hunkContent: ChangeContent;
}

export type DiffLineCallbackProps =
  | DiffLineCallbackContext
  | DiffLineCallbackExpandedContext
  | DiffLineCallbackChangePair
  | DiffLineCallbackChangeDeletion
  | DiffLineCallbackChangeAddition;

type DiffStyle = 'unified' | 'split' | 'both';

type LineIterationBounds = [startIndex: number, endIndex: number];

type ChangeContentSide = 'deletions' | 'additions';

type ContextLineCallback = (index: number) => boolean | void;

interface IterationState {
  isWindowedHighlight: boolean;
  viewportStart: number;
  viewportEnd: number;
  splitCount: number;
  unifiedCount: number;
  finalHunkIndex: number;
  /**
   * The diff's semantic folds, in old-line order, when the walk folds. Folds
   * only cover removed lines that have no new line beside them.
   */
  folds: readonly SemanticDiffFold[] | undefined;
  /** Index of the next fold in `folds` the walk has not gone past. */
  foldIndex: number;
  /** Moves `foldIndex` past the folds that end before old line `line`. */
  skipFoldsBefore(line: number): void;
  /**
   * Counts the rows that closed folds hide among old lines `firstLine`
   * through `lastLine`. A closed fold shows one row for all of its lines, so
   * every line after its first is hidden.
   */
  countHiddenRows(firstLine: number, lastLine: number): number;
  shouldBreak(): boolean;
  shouldSkip(unifiedHeight: number, splitHeight: number): boolean;
  incrementCounts(unifiedValue: number, splitValue: number): void;
  isInWindow(unifiedHeight: number, splitHeight: number): boolean;
  isInUnifiedWindow(height: number): boolean;
  isInSplitWindow(height: number): boolean;
  emit(props: DiffLineCallbackProps, silent?: boolean): boolean;
}

interface IterationStartState {
  hunkIndex: number;
  splitCount: number;
  unifiedCount: number;
  /** Index of the first semantic fold at or after the hunk. */
  foldIndex: number;
}

interface IterationStartStateProps extends Omit<
  IterateOverDiffProps,
  'callback' | 'totalLines'
> {
  startingLine: number;
  collapsedContextThreshold: number;
}

export type DiffLineCallback = (props: DiffLineCallbackProps) => boolean | void;

export interface IterateOverDiffProps {
  diff: FileDiffMetadata;
  diffStyle: DiffStyle;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
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
  callback: DiffLineCallback;
}

export function iterateOverDiff({
  diff,
  diffStyle,
  startingLine = 0,
  totalLines = Infinity,
  expandedHunks,
  collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  includeTrailingNewline = false,
  openSemanticFolds,
  callback,
}: IterateOverDiffProps): void {
  const iterationStart = getIterationStartState({
    diff,
    diffStyle,
    startingLine,
    expandedHunks,
    collapsedContextThreshold,
    includeTrailingNewline,
    openSemanticFolds,
  });
  const state: IterationState = {
    viewportStart: startingLine,
    viewportEnd: startingLine + totalLines,
    isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
    splitCount: iterationStart.splitCount,
    unifiedCount: iterationStart.unifiedCount,
    finalHunkIndex: diff.hunks.length - 1,
    folds: openSemanticFolds != null ? diff.semanticFolds : undefined,
    foldIndex: iterationStart.foldIndex,
    skipFoldsBefore(line: number) {
      const { folds } = state;
      while (
        folds != null &&
        state.foldIndex < folds.length &&
        folds[state.foldIndex].old.end < line
      ) {
        state.foldIndex++;
      }
    },
    countHiddenRows(firstLine: number, lastLine: number) {
      const { folds } = state;
      if (folds == null) {
        return 0;
      }
      state.skipFoldsBefore(firstLine);
      let count = 0;
      for (
        let index = state.foldIndex, fold = folds[index];
        fold != null && fold.old.start <= lastLine;
        fold = folds[++index]
      ) {
        if (openSemanticFolds?.has(fold.old.start) !== true) {
          count += fold.old.end - fold.old.start;
        }
      }
      return count;
    },
    shouldBreak() {
      if (!state.isWindowedHighlight) {
        return false;
      }

      const breakUnified = state.unifiedCount >= startingLine + totalLines;
      const breakSplit = state.splitCount >= startingLine + totalLines;

      if (diffStyle === 'unified') {
        return breakUnified;
      } else if (diffStyle === 'split') {
        return breakSplit;
      } else {
        return breakUnified && breakSplit;
      }
    },
    shouldSkip(unifiedCount: number, splitCount: number) {
      if (!state.isWindowedHighlight) {
        return false;
      }

      const skipUnified =
        unifiedCount > 0 && state.unifiedCount + unifiedCount <= startingLine;
      const skipSplit =
        splitCount > 0 && state.splitCount + splitCount <= startingLine;

      if (diffStyle === 'unified') {
        return skipUnified;
      } else if (diffStyle === 'split') {
        return skipSplit;
      } else {
        return skipUnified && skipSplit;
      }
    },
    incrementCounts(unifiedValue: number, splitValue: number) {
      if (diffStyle === 'unified' || diffStyle === 'both') {
        state.unifiedCount += unifiedValue;
      }
      if (diffStyle === 'split' || diffStyle === 'both') {
        state.splitCount += splitValue;
      }
    },
    isInWindow(unifiedHeight: number, splitHeight: number) {
      if (!state.isWindowedHighlight) {
        return true;
      }

      const unifiedInWindow = state.isInUnifiedWindow(unifiedHeight);
      const splitInWindow = state.isInSplitWindow(splitHeight);

      if (diffStyle === 'unified') {
        return unifiedInWindow;
      } else if (diffStyle === 'split') {
        return splitInWindow;
      } else {
        return unifiedInWindow || splitInWindow;
      }
    },
    isInUnifiedWindow(unifiedHeight: number) {
      return (
        !state.isWindowedHighlight ||
        (state.unifiedCount >= startingLine - unifiedHeight &&
          state.unifiedCount < startingLine + totalLines)
      );
    },
    isInSplitWindow(splitHeight: number) {
      return (
        !state.isWindowedHighlight ||
        (state.splitCount >= startingLine - splitHeight &&
          state.splitCount < startingLine + totalLines)
      );
    },
    emit(props: DiffLineCallbackProps, silent = false): boolean {
      if (!silent) {
        if (diffStyle === 'unified') {
          state.incrementCounts(1, 0);
        } else if (diffStyle === 'split') {
          state.incrementCounts(0, 1);
        } else {
          state.incrementCounts(1, 1);
        }
      }
      return callback(props) ?? false;
    },
  };

  hunkIterator: for (
    let hunkIndex = iterationStart.hunkIndex;
    hunkIndex < diff.hunks.length;
    hunkIndex++
  ) {
    const hunk = diff.hunks[hunkIndex];
    if (hunk == null) {
      throw new Error('iterateOverDiff: invalid hunk index');
    }
    if (state.shouldBreak()) {
      break;
    }

    const deletionBoundary = getHunkSideStartBoundary(
      hunk.deletionStart,
      hunk.deletionCount
    );
    const additionBoundary = getHunkSideStartBoundary(
      hunk.additionStart,
      hunk.additionCount
    );
    const deletionStartIndex =
      !diff.isPartial && hunk.deletionCount === 0
        ? deletionBoundary
        : hunk.deletionLineIndex;
    const additionStartIndex =
      !diff.isPartial && hunk.additionCount === 0
        ? additionBoundary
        : hunk.additionLineIndex;

    const leadingRegion = getExpandedRegion({
      isPartial: diff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex,
      collapsedContextThreshold,
    });
    const trailingRegion =
      hunkIndex === state.finalHunkIndex
        ? getTrailingExpandedRegion({
            fileDiff: diff,
            hunkIndex,
            expandedHunks,
            collapsedContextThreshold,
            errorPrefix: 'iterateOverDiff',
          })
        : undefined;
    const expandedLineCount = leadingRegion.fromStart + leadingRegion.fromEnd;

    function getTrailingCollapsedAfter(
      unifiedLineIndex: number,
      splitLineIndex: number
    ) {
      if (
        trailingRegion == null ||
        trailingRegion.collapsedLines <= 0 ||
        trailingRegion.fromStart + trailingRegion.fromEnd > 0
      ) {
        return 0;
      }
      if (diffStyle === 'unified') {
        return unifiedLineIndex ===
          hunk.unifiedLineStart + hunk.unifiedLineCount - 1
          ? trailingRegion.collapsedLines
          : 0;
      }
      return splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1
        ? trailingRegion.collapsedLines
        : 0;
    }

    let consumedCollapsed = leadingRegion.collapsedLines === 0;
    function consumePendingCollapsed() {
      if (consumedCollapsed) {
        return 0;
      }
      consumedCollapsed = true;
      return leadingRegion.collapsedLines;
    }

    // Emit for expanded lines
    if (!state.shouldSkip(expandedLineCount, expandedLineCount)) {
      let unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.rangeSize;
      let splitLineIndex = hunk.splitLineStart - leadingRegion.rangeSize;

      let deletionLineIndex = deletionStartIndex - leadingRegion.rangeSize;
      let additionLineIndex = additionStartIndex - leadingRegion.rangeSize;
      let deletionLineNumber = deletionBoundary + 1 - leadingRegion.rangeSize;
      let additionLineNumber = additionBoundary + 1 - leadingRegion.rangeSize;

      if (
        walkContextLines(state, leadingRegion.fromStart, diffStyle, (index) => {
          return state.emit({
            hunkIndex,
            hunk: hunk,
            collapsedBefore: 0,
            collapsedAfter: 0,
            type: 'context-expanded',
            deletionLine: {
              lineNumber: deletionLineNumber + index,
              lineIndex: deletionLineIndex + index,
              noEOFCR: false,
              unifiedLineIndex: unifiedLineIndex + index,
              splitLineIndex: splitLineIndex + index,
            },
            additionLine: {
              unifiedLineIndex: unifiedLineIndex + index,
              splitLineIndex: splitLineIndex + index,
              lineIndex: additionLineIndex + index,
              lineNumber: additionLineNumber + index,
              noEOFCR: false,
            },
          });
        })
      ) {
        break hunkIterator;
      }

      unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.fromEnd;
      splitLineIndex = hunk.splitLineStart - leadingRegion.fromEnd;

      deletionLineIndex = deletionStartIndex - leadingRegion.fromEnd;
      additionLineIndex = additionStartIndex - leadingRegion.fromEnd;
      deletionLineNumber = deletionBoundary + 1 - leadingRegion.fromEnd;
      additionLineNumber = additionBoundary + 1 - leadingRegion.fromEnd;
      if (
        walkContextLines(
          state,
          leadingRegion.fromEnd,
          diffStyle,
          (index) => {
            return state.emit({
              hunkIndex,
              hunk,
              collapsedBefore: consumePendingCollapsed(),
              collapsedAfter: 0,
              type: 'context-expanded',
              deletionLine: {
                lineNumber: deletionLineNumber + index,
                lineIndex: deletionLineIndex + index,
                noEOFCR: false,
                unifiedLineIndex: unifiedLineIndex + index,
                splitLineIndex: splitLineIndex + index,
              },
              additionLine: {
                unifiedLineIndex: unifiedLineIndex + index,
                splitLineIndex: splitLineIndex + index,
                lineIndex: additionLineIndex + index,
                lineNumber: additionLineNumber + index,
                noEOFCR: false,
              },
            });
          },
          () => {
            // The collapsed separator belongs before this fromEnd slice. If the
            // render window starts inside the slice, consume it with the skipped
            // rows so it is not attached to the first emitted row.
            consumePendingCollapsed();
          }
        )
      ) {
        break hunkIterator;
      }
    } else {
      state.incrementCounts(expandedLineCount, expandedLineCount);
      consumePendingCollapsed();
    }

    let unifiedLineIndex = hunk.unifiedLineStart;
    let splitLineIndex = hunk.splitLineStart;

    let deletionLineIndex = deletionStartIndex;
    let additionLineIndex = additionStartIndex;
    let deletionLineNumber = deletionBoundary + 1;
    let additionLineNumber = additionBoundary + 1;
    const lastContent = hunk.hunkContent.at(-1);

    for (const content of hunk.hunkContent) {
      if (state.shouldBreak()) {
        break hunkIterator;
      }

      const isLastContent = content === lastContent;

      // Hunk Context Content
      if (content.type === 'context') {
        if (!state.shouldSkip(content.lines, content.lines)) {
          if (
            walkContextLines(
              state,
              content.lines,
              diffStyle,
              (index) => {
                const isLastLine = isLastContent && index === content.lines - 1;
                const unifiedRowIndex = unifiedLineIndex + index;
                const splitRowIndex = splitLineIndex + index;
                return state.emit({
                  hunkIndex,
                  hunk,
                  collapsedBefore: consumePendingCollapsed(),
                  collapsedAfter: getTrailingCollapsedAfter(
                    unifiedRowIndex,
                    splitRowIndex
                  ),
                  type: 'context',
                  hunkContent: content,
                  deletionLine: {
                    lineNumber: deletionLineNumber + index,
                    lineIndex: deletionLineIndex + index,
                    noEOFCR: isLastLine && hunk.noEOFCRDeletions,
                    unifiedLineIndex: unifiedRowIndex,
                    splitLineIndex: splitRowIndex,
                  },
                  additionLine: {
                    unifiedLineIndex: unifiedRowIndex,
                    splitLineIndex: splitRowIndex,
                    lineIndex: additionLineIndex + index,
                    lineNumber: additionLineNumber + index,
                    noEOFCR: isLastLine && hunk.noEOFCRAdditions,
                  },
                });
              },
              () => {
                // When windowing starts inside context content, the leading
                // separator was above the visible range and should not be
                // emitted on the first rendered context line.
                consumePendingCollapsed();
              }
            )
          ) {
            break hunkIterator;
          }
        } else {
          state.incrementCounts(content.lines, content.lines);
          consumePendingCollapsed();
        }
        unifiedLineIndex += content.lines;
        splitLineIndex += content.lines;

        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
      }
      // Hunk Change Content
      else {
        const splitCount = Math.max(content.deletions, content.additions);
        const unifiedCount = content.deletions + content.additions;
        const lastOldLine = deletionLineNumber + content.deletions - 1;
        // The rows of the block that closed folds hide. Each view loses the
        // same rows.
        const hiddenCount = state.countHiddenRows(
          deletionLineNumber,
          lastOldLine
        );
        const nextFold = state.folds?.[state.foldIndex];
        const hasFolds = nextFold != null && nextFold.old.start <= lastOldLine;
        const shownUnifiedCount = unifiedCount - hiddenCount;
        const shownSplitCount = splitCount - hiddenCount;
        const shouldSkipChange = state.shouldSkip(
          shownUnifiedCount,
          shownSplitCount
        );
        if (!shouldSkipChange) {
          // The window's rows in the block are found by arithmetic. Hidden
          // rows throw that off, so a block that has them is walked from its
          // first row, counting the rows it shows.
          const iterationRanges: LineIterationBounds[] =
            hiddenCount > 0
              ? [[0, diffStyle === 'unified' ? unifiedCount : splitCount]]
              : getChangeIterationRanges(state, content, diffStyle);
          const firstRangeStart = iterationRanges[0]?.[0] ?? 0;
          if (firstRangeStart > 0) {
            // Change rows can be windowed from the middle of the block too. In
            // that case the leading separator belongs to skipped rows, not to
            // the first visible deletion/addition row.
            consumePendingCollapsed();
          }
          // The rows of the block hidden before the current row.
          let hiddenBefore = 0;
          // Change ranges are already clipped to the active window. Counts move
          // once for the whole change block after the selected rows emit.
          rangeIterator: for (const [rangeStart, rangeEnd] of iterationRanges) {
            rowIterator: for (
              let index = rangeStart;
              index < rangeEnd;
              index++
            ) {
              // The fold that starts on this row, and whether it is closed.
              let fold: SemanticDiffFold | undefined;
              let isClosed = false;
              if (hasFolds && index < content.deletions) {
                const oldLine = deletionLineNumber + index;
                state.skipFoldsBefore(oldLine);
                fold = state.folds?.[state.foldIndex];
                if (fold != null && fold.old.start <= oldLine) {
                  isClosed = openSemanticFolds?.has(fold.old.start) !== true;
                  if (fold.old.start !== oldLine) {
                    // A closed fold's lines after its first get no row.
                    if (isClosed) {
                      hiddenBefore++;
                      continue rowIterator;
                    }
                    fold = undefined;
                  }
                } else {
                  fold = undefined;
                }
              }
              if (hiddenCount > 0 && state.isWindowedHighlight) {
                const shownIndex = index - hiddenBefore;
                if (
                  !isFoldedChangeRowInWindow(
                    state,
                    content,
                    diffStyle,
                    index,
                    shownIndex,
                    hiddenCount
                  )
                ) {
                  // Past the window's last row, nothing more of the block
                  // shows.
                  const row =
                    (diffStyle === 'unified'
                      ? state.unifiedCount
                      : state.splitCount) + shownIndex;
                  if (diffStyle !== 'both' && row >= state.viewportEnd) {
                    break rangeIterator;
                  }
                  // The leading separator belongs to the rows skipped before
                  // the window.
                  consumePendingCollapsed();
                  continue rowIterator;
                }
              }
              const unifiedRowIndex = unifiedLineIndex + index;
              const splitRowIndex =
                diffStyle === 'unified'
                  ? splitLineIndex +
                    (index < content.deletions
                      ? index
                      : index - content.deletions)
                  : splitLineIndex + index;
              // A closed fold's row stands in for its hidden rows too, so
              // what follows the last of them follows it.
              const hiddenRows =
                fold != null && isClosed ? fold.old.end - fold.old.start : 0;
              const lastUnifiedRowIndex = unifiedRowIndex + hiddenRows;
              const lastSplitRowIndex = splitRowIndex + hiddenRows;
              const collapsedAfter = getTrailingCollapsedAfter(
                lastUnifiedRowIndex,
                lastSplitRowIndex
              );
              const emitProps = getChangeLineData({
                hunkIndex,
                hunk,
                collapsedBefore: consumePendingCollapsed(),
                collapsedAfter,
                diffStyle,
                index,
                unifiedLineIndex,
                splitLineIndex,
                additionLineIndex,
                deletionLineIndex,
                additionLineNumber,
                deletionLineNumber,
                content,
                isLastContent,
                unifiedCount,
                splitCount,
              });
              if (fold != null && isClosed) {
                emitProps.foldRow = {
                  fold,
                  lastSplitLineIndex: lastSplitRowIndex,
                  lastUnifiedLineIndex: lastUnifiedRowIndex,
                };
              } else if (fold != null) {
                emitProps.openFold = fold;
              }
              if (state.emit(emitProps, true)) {
                break hunkIterator;
              }
            }
          }
        }

        consumePendingCollapsed();
        state.incrementCounts(shownUnifiedCount, shownSplitCount);
        unifiedLineIndex += unifiedCount;
        splitLineIndex += splitCount;
        deletionLineIndex += content.deletions;
        additionLineIndex += content.additions;
        deletionLineNumber += content.deletions;
        additionLineNumber += content.additions;
      }
    }

    if (trailingRegion != null) {
      const { collapsedLines, fromStart, fromEnd } = trailingRegion;
      const len = fromStart + fromEnd;
      if (
        walkContextLines(
          state,
          len,
          diffStyle,
          (index) => {
            const isLastLine = index === len - 1;
            return state.emit({
              hunkIndex: diff.hunks.length,
              hunk: undefined,
              collapsedBefore: 0,
              collapsedAfter: isLastLine ? collapsedLines : 0,
              type: 'context-expanded',
              deletionLine: {
                lineNumber: deletionLineNumber + index,
                lineIndex: deletionLineIndex + index,
                noEOFCR: false,
                unifiedLineIndex: unifiedLineIndex + index,
                splitLineIndex: splitLineIndex + index,
              },
              additionLine: {
                unifiedLineIndex: unifiedLineIndex + index,
                splitLineIndex: splitLineIndex + index,
                lineIndex: additionLineIndex + index,
                lineNumber: additionLineNumber + index,
                noEOFCR: false,
              },
            });
          },
          undefined,
          () => state.shouldBreak()
        )
      ) {
        break hunkIterator;
      }
    }

    if (
      includeTrailingNewline &&
      hunkIndex === state.finalHunkIndex &&
      (trailingRegion?.collapsedLines ?? 0) === 0 &&
      endsWithNewline(diff, 'additions')
    ) {
      // The row sits right after the last hunk and its trailing context.
      const offset =
        trailingRegion != null
          ? trailingRegion.fromStart + trailingRegion.fromEnd
          : 0;
      const additionLine: DiffLineMetadata = {
        unifiedLineIndex: unifiedLineIndex + offset,
        splitLineIndex: splitLineIndex + offset,
        lineIndex: additionLineIndex + offset,
        lineNumber: additionLineNumber + offset,
        noEOFCR: false,
      };
      const deletionLine: DiffLineMetadata = {
        unifiedLineIndex: unifiedLineIndex + offset,
        splitLineIndex: splitLineIndex + offset,
        lineIndex: deletionLineIndex + offset,
        lineNumber: deletionLineNumber + offset,
        noEOFCR: false,
      };
      const rowBase = {
        hunkIndex: diff.hunks.length,
        hunk: undefined,
        collapsedBefore: 0,
        collapsedAfter: 0,
      };
      // The row is unchanged context when the old file ends with a newline
      // too, else an added line; its block describes just that row.
      if (
        walkContextLines(state, 1, diffStyle, () =>
          state.emit(
            endsWithNewline(diff, 'deletions')
              ? {
                  ...rowBase,
                  type: 'context',
                  deletionLine,
                  additionLine,
                  hunkContent: {
                    type: 'context',
                    lines: 1,
                    additionLineIndex: additionLine.lineIndex,
                    deletionLineIndex: deletionLine.lineIndex,
                  },
                }
              : {
                  ...rowBase,
                  type: 'change',
                  additionLine,
                  hunkContent: {
                    type: 'change',
                    additions: 1,
                    deletions: 0,
                    additionLineIndex: additionLine.lineIndex,
                    deletionLineIndex: deletionLine.lineIndex,
                  },
                }
          )
        )
      ) {
        break hunkIterator;
      }
    }
  }
}

// Whether one side's last line ends with a newline, so an empty line follows
// it. A partial diff only knows that from its patch's "\ No newline at end of
// file" marker on the last hunk; a full diff has the file's real last line.
export function endsWithNewline(
  diff: FileDiffMetadata,
  side: 'additions' | 'deletions'
): boolean {
  const lines = side === 'additions' ? diff.additionLines : diff.deletionLines;
  if (lines.length === 0) {
    return false;
  }
  if (diff.isPartial) {
    const lastHunk = diff.hunks.at(-1);
    return (
      lastHunk != null &&
      !(side === 'additions'
        ? lastHunk.noEOFCRAdditions
        : lastHunk.noEOFCRDeletions)
    );
  }
  return lines.at(-1)?.endsWith('\n') === true;
}

// Finds the hunk a window starts in. `startingLine` is a dense rendered-row
// index, so this adds up the rows of each hunk from the top, under the
// current expansion and fold state, and stops at the first hunk that reaches
// `startingLine`. The walk then starts at that hunk with the row counts and
// the fold index as they stand before it. Hunks after it are never looked at.
function getIterationStartState({
  diff,
  diffStyle,
  startingLine,
  expandedHunks,
  collapsedContextThreshold,
  includeTrailingNewline = false,
  openSemanticFolds,
}: IterationStartStateProps): IterationStartState {
  const start: IterationStartState = {
    hunkIndex: 0,
    splitCount: 0,
    unifiedCount: 0,
    foldIndex: 0,
  };
  if (startingLine <= 0 || diffStyle === 'both') {
    return start;
  }

  const folds = openSemanticFolds != null ? diff.semanticFolds : undefined;
  const finalHunkIndex = diff.hunks.length - 1;
  // The row counts and the fold index after the hunks passed so far.
  let splitCount = 0;
  let unifiedCount = 0;
  let foldIndex = 0;

  for (let index = 0; index < diff.hunks.length; index++) {
    const hunk = diff.hunks[index];
    if (hunk == null) {
      throw new Error('iterateOverDiff: invalid hunk summary index');
    }
    start.hunkIndex = index;
    start.splitCount = splitCount;
    start.unifiedCount = unifiedCount;
    start.foldIndex = foldIndex;

    const leadingRegion = getExpandedRegion({
      isPartial: diff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex: index,
      collapsedContextThreshold,
    });
    const leadingCount = leadingRegion.fromStart + leadingRegion.fromEnd;
    // The rows the hunk's closed folds hide. A closed fold shows one row
    // for all of its old lines, so every line after its first is hidden.
    let foldedCount = 0;
    if (folds != null && foldIndex < folds.length) {
      const lastOldLine =
        getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) +
        hunk.deletionCount;
      for (
        let fold = folds[foldIndex];
        fold != null && fold.old.start <= lastOldLine;
        fold = folds[++foldIndex]
      ) {
        if (openSemanticFolds?.has(fold.old.start) !== true) {
          foldedCount += fold.old.end - fold.old.start;
        }
      }
    }
    splitCount += leadingCount + hunk.splitLineCount - foldedCount;
    unifiedCount += leadingCount + hunk.unifiedLineCount - foldedCount;

    const trailingRegion =
      index === finalHunkIndex
        ? getTrailingExpandedRegion({
            fileDiff: diff,
            hunkIndex: index,
            expandedHunks,
            collapsedContextThreshold,
            errorPrefix: 'iterateOverDiff',
          })
        : undefined;
    if (trailingRegion != null) {
      const trailingCount = trailingRegion.fromStart + trailingRegion.fromEnd;
      splitCount += trailingCount;
      unifiedCount += trailingCount;
    }

    if ((diffStyle === 'unified' ? unifiedCount : splitCount) > startingLine) {
      return start;
    }
  }

  // A window past every hunk's rows still starts at the final hunk when it
  // can include the trailing newline row: that iteration skips the hunk's
  // rows and emits the row after them.
  if (includeTrailingNewline && diff.hunks.length > 0) {
    return start;
  }
  return { hunkIndex: diff.hunks.length, splitCount, unifiedCount, foldIndex };
}

function isRowInWindow(state: IterationState, row: number): boolean {
  return row >= state.viewportStart && row < state.viewportEnd;
}

// Whether a row of a change block with hidden rows is inside the window.
// `index` is the row's place in the block and `shownIndex` its place among
// the rows the block shows.
function isFoldedChangeRowInWindow(
  state: IterationState,
  content: ChangeContent,
  diffStyle: DiffStyle,
  index: number,
  shownIndex: number,
  hiddenCount: number
): boolean {
  if (diffStyle === 'unified') {
    return isRowInWindow(state, state.unifiedCount + shownIndex);
  }
  if (isRowInWindow(state, state.splitCount + shownIndex)) {
    return true;
  }
  if (diffStyle === 'split') {
    return false;
  }
  // 'both' walks split rows, which can hold an old and a new line. The
  // unified view shows the old line among the block's removed lines and the
  // new line after all of them.
  return (
    (index < content.deletions &&
      isRowInWindow(state, state.unifiedCount + shownIndex)) ||
    (index < content.additions &&
      isRowInWindow(
        state,
        state.unifiedCount + content.deletions - hiddenCount + index
      ))
  );
}

// Clip a run of context rows to a single bounded hull around the active rendered
// window. `diffStyle: both` can make split and unified rows visible in disjoint
// ranges, so these bounds may include interior gaps that still need per-row
// filtering before emitting.
function getContextLineIterationBounds(
  state: IterationState,
  count: number,
  diffStyle: DiffStyle
): LineIterationBounds {
  if (!state.isWindowedHighlight || count <= 0) {
    return [0, count];
  }

  const ranges: LineIterationBounds[] = [];
  function pushRange(currentCount: number): void {
    const start = Math.max(0, state.viewportStart - currentCount);
    const end = Math.min(count, state.viewportEnd - currentCount);
    if (end > start) {
      ranges.push([start, end]);
    }
  }

  if (diffStyle !== 'split') {
    pushRange(state.unifiedCount);
  }
  if (diffStyle !== 'unified') {
    pushRange(state.splitCount);
  }

  if (ranges.length === 0) {
    return [0, 0];
  }

  let start = ranges[0][0];
  let end = ranges[0][1];
  for (let index = 1; index < ranges.length; index++) {
    const range = ranges[index];
    start = Math.min(start, range[0]);
    end = Math.max(end, range[1]);
  }
  return [start, end];
}

// Walk context rows through the active window while keeping split and
// unified counters aligned. The callback only runs after the final per-row
// window check, which keeps `diffStyle: both` gap rows from being emitted.
function walkContextLines(
  state: IterationState,
  count: number,
  diffStyle: DiffStyle,
  callback: ContextLineCallback,
  onSkippedStart?: () => void,
  shouldBreak?: () => boolean
): boolean {
  const [startIndex, endIndex] = getContextLineIterationBounds(
    state,
    count,
    diffStyle
  );
  if (startIndex > 0) {
    state.incrementCounts(startIndex, startIndex);
    onSkippedStart?.();
  }

  let index = startIndex;
  while (index < count) {
    if (shouldBreak?.() === true) {
      return true;
    }
    if (index >= endIndex) {
      state.incrementCounts(count - index, count - index);
      break;
    }
    if (state.isInWindow(0, 0)) {
      if (callback(index) === true) {
        return true;
      }
    } else {
      state.incrementCounts(1, 1);
    }
    index++;
  }

  return false;
}

// Clip a change block to the rows that can be visible in the active coordinate
// space. `diffStyle: both` iterates in split row space, but includes the unified
// ranges too so either view can render the visible change rows it needs.
function getChangeIterationRanges(
  state: IterationState,
  content: ChangeContent,
  diffStyle: DiffStyle
): LineIterationBounds[] {
  // If not a window highlight, then we should just render the entire range
  if (!state.isWindowedHighlight) {
    return [
      [
        0,
        diffStyle === 'unified'
          ? content.deletions + content.additions
          : Math.max(content.deletions, content.additions),
      ],
    ];
  }
  const useUnified = diffStyle !== 'split';
  const useSplit = diffStyle !== 'unified';
  const iterationSpace = diffStyle === 'unified' ? 'unified' : 'split';
  const iterationRanges: LineIterationBounds[] = [];
  function getVisibleRange(
    start: number,
    count: number
  ): LineIterationBounds | undefined {
    const end = start + count;
    if (end <= state.viewportStart || start >= state.viewportEnd) {
      return undefined;
    }
    const visibleStart = Math.max(0, state.viewportStart - start);
    const visibleEnd = Math.min(count, state.viewportEnd - start);
    return visibleEnd > visibleStart ? [visibleStart, visibleEnd] : undefined;
  }
  function mapRangeToIteration(
    range: LineIterationBounds,
    kind: ChangeContentSide
  ): LineIterationBounds {
    if (iterationSpace === 'split') {
      // For split iteration, additions/deletions are already in split row space.
      return range;
    }
    return kind === 'additions'
      ? [range[0] + content.deletions, range[1] + content.deletions]
      : range;
  }
  function pushRange(
    range: LineIterationBounds | undefined,
    kind: ChangeContentSide
  ) {
    if (range == null) {
      return;
    }
    const [start, end] = mapRangeToIteration(range, kind);
    if (end > start) {
      iterationRanges.push([start, end]);
    }
  }

  if (useUnified) {
    pushRange(
      getVisibleRange(state.unifiedCount, content.deletions),
      'deletions'
    );
    pushRange(
      getVisibleRange(
        state.unifiedCount + content.deletions,
        content.additions
      ),
      'additions'
    );
  }

  if (useSplit) {
    pushRange(
      getVisibleRange(state.splitCount, content.deletions),
      'deletions'
    );
    pushRange(
      getVisibleRange(state.splitCount, content.additions),
      'additions'
    );
  }

  if (iterationRanges.length === 0) {
    return iterationRanges;
  }

  iterationRanges.sort((a, b) => a[0] - b[0]);
  const merged: LineIterationBounds[] = [iterationRanges[0]];
  for (const [start, end] of iterationRanges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

interface GetChangeLineDataProps {
  hunkIndex: number;
  hunk: Hunk;
  collapsedBefore: number;
  collapsedAfter: number;
  diffStyle: DiffStyle;
  index: number;
  unifiedLineIndex: number;
  splitLineIndex: number;
  additionLineIndex: number;
  additionLineNumber: number;
  deletionLineNumber: number;
  deletionLineIndex: number;
  content: ChangeContent;
  isLastContent: boolean;
  unifiedCount: number;
  splitCount: number;
}

// Build the callback payload for one change row, mapping the selected row index
// into split/unified coordinates and addition/deletion line metadata.
function getChangeLineData({
  hunkIndex,
  hunk,
  collapsedAfter,
  collapsedBefore,
  diffStyle,
  index,
  unifiedLineIndex,
  splitLineIndex,
  additionLineIndex,
  deletionLineIndex,
  additionLineNumber,
  deletionLineNumber,
  content,
  isLastContent,
  unifiedCount,
  splitCount,
}: GetChangeLineDataProps): DiffLineCallbackProps {
  const unifiedDeletionLineIndex =
    index < content.deletions ? unifiedLineIndex + index : undefined;
  const unifiedAdditionLineIndex =
    diffStyle === 'unified'
      ? index >= content.deletions
        ? unifiedLineIndex + index
        : undefined
      : index < content.additions
        ? unifiedLineIndex + content.deletions + index
        : undefined;

  const resolvedSplitLineIndex =
    diffStyle === 'unified'
      ? splitLineIndex +
        (index < content.deletions ? index : index - content.deletions)
      : splitLineIndex + index;

  const deletionLineIndexValue =
    index < content.deletions ? deletionLineIndex + index : undefined;
  const deletionLineNumberValue =
    index < content.deletions ? deletionLineNumber + index : undefined;
  const additionLineIndexValue =
    diffStyle === 'unified'
      ? index >= content.deletions
        ? additionLineIndex + (index - content.deletions)
        : undefined
      : index < content.additions
        ? additionLineIndex + index
        : undefined;
  const additionLineNumberValue =
    diffStyle === 'unified'
      ? index >= content.deletions
        ? additionLineNumber + (index - content.deletions)
        : undefined
      : index < content.additions
        ? additionLineNumber + index
        : undefined;

  const noEOFCRDeletion =
    diffStyle === 'unified'
      ? isLastContent &&
        index === content.deletions - 1 &&
        hunk.noEOFCRDeletions
      : isLastContent && index === splitCount - 1 && hunk.noEOFCRDeletions;
  const noEOFCRAddition =
    diffStyle === 'unified'
      ? isLastContent && index === unifiedCount - 1 && hunk.noEOFCRAdditions
      : isLastContent && index === splitCount - 1 && hunk.noEOFCRAdditions;

  const deletionLine: DiffLineMetadata | undefined =
    deletionLineIndexValue != null &&
    deletionLineNumberValue != null &&
    unifiedDeletionLineIndex != null
      ? {
          lineNumber: deletionLineNumberValue,
          lineIndex: deletionLineIndexValue,
          noEOFCR: noEOFCRDeletion,
          unifiedLineIndex: unifiedDeletionLineIndex,
          splitLineIndex: resolvedSplitLineIndex,
        }
      : undefined;
  const additionLine: DiffLineMetadata | undefined =
    additionLineIndexValue != null &&
    additionLineNumberValue != null &&
    unifiedAdditionLineIndex != null
      ? {
          unifiedLineIndex: unifiedAdditionLineIndex,
          splitLineIndex: resolvedSplitLineIndex,
          lineIndex: additionLineIndexValue,
          lineNumber: additionLineNumberValue,
          noEOFCR: noEOFCRAddition,
        }
      : undefined;

  if (deletionLine == null && additionLine != null) {
    return {
      type: 'change',
      hunkIndex,
      hunk,
      collapsedAfter,
      collapsedBefore,
      deletionLine: undefined,
      additionLine,
      hunkContent: content,
    };
  } else if (deletionLine != null && additionLine == null) {
    return {
      type: 'change',
      hunkIndex,
      hunk,
      collapsedAfter,
      collapsedBefore,
      deletionLine,
      additionLine: undefined,
      hunkContent: content,
    };
  }

  if (deletionLine == null || additionLine == null) {
    throw new Error('iterateOverDiff: missing change line data');
  }

  return {
    type: 'change',
    hunkIndex,
    hunk,
    collapsedAfter,
    collapsedBefore,
    deletionLine,
    additionLine,
    hunkContent: content,
  };
}
