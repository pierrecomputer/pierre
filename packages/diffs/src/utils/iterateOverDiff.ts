import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
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

export interface DiffLineCallbackBase {
  hunkIndex: number;
  hunk: Hunk | undefined; // undefined for trailing expansion region
  collapsedBefore: number; // > 0 means separator before this line, value = hidden lines
  collapsedAfter: number; // > 0 only on final line if trailing collapsed content
}

interface DiffLineCallbackContextChange extends DiffLineCallbackBase {
  type: 'change' | 'context' | 'context-expanded';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
}

interface DiffLineCallbackChangeDeletion extends DiffLineCallbackBase {
  type: 'change';
  deletionLine: DiffLineMetadata;
  additionLine?: undefined;
}

interface DiffLineCallbackChangeAddition extends DiffLineCallbackBase {
  type: 'change';
  deletionLine?: undefined;
  additionLine: DiffLineMetadata;
}

export type DiffLineCallbackProps =
  | DiffLineCallbackContextChange
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
}

interface HunkPrefixCounts {
  splitCount: number;
  unifiedCount: number;
}

interface IterationStartStateProps extends Omit<
  IterateOverDiffProps,
  'callback' | 'totalLines'
> {
  startingLine: number;
  collapsedContextThreshold: number;
}

interface HunkPrefixCountsProps extends Pick<
  IterationStartStateProps,
  'diff' | 'expandedHunks' | 'collapsedContextThreshold'
> {}

export type DiffLineCallback = (props: DiffLineCallbackProps) => boolean | void;

export interface IterateOverDiffProps {
  diff: FileDiffMetadata;
  diffStyle: DiffStyle;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
  callback: DiffLineCallback;
}

export function iterateOverDiff({
  diff,
  diffStyle,
  startingLine = 0,
  totalLines = Infinity,
  expandedHunks,
  collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  callback,
}: IterateOverDiffProps): void {
  const iterationStart = getIterationStartState({
    diff,
    diffStyle,
    startingLine,
    expandedHunks,
    collapsedContextThreshold,
  });
  const state: IterationState = {
    viewportStart: startingLine,
    viewportEnd: startingLine + totalLines,
    isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
    splitCount: iterationStart.splitCount,
    unifiedCount: iterationStart.unifiedCount,
    finalHunkIndex: diff.hunks.length - 1,
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
        const shouldSkipChange = state.shouldSkip(unifiedCount, splitCount);
        if (!shouldSkipChange) {
          const iterationRanges = getChangeIterationRanges(
            state,
            content,
            diffStyle
          );
          const firstRangeStart = iterationRanges[0]?.[0] ?? 0;
          if (firstRangeStart > 0) {
            // Change rows can be windowed from the middle of the block too. In
            // that case the leading separator belongs to skipped rows, not to
            // the first visible deletion/addition row.
            consumePendingCollapsed();
          }
          // Change ranges are already clipped to the active window. Counts move
          // once for the whole change block after the selected rows emit.
          for (const [rangeStart, rangeEnd] of iterationRanges) {
            for (let index = rangeStart; index < rangeEnd; index++) {
              const unifiedRowIndex = unifiedLineIndex + index;
              const splitRowIndex =
                diffStyle === 'unified'
                  ? splitLineIndex +
                    (index < content.deletions
                      ? index
                      : index - content.deletions)
                  : splitLineIndex + index;
              const collapsedAfter = getTrailingCollapsedAfter(
                unifiedRowIndex,
                splitRowIndex
              );
              if (
                state.emit(
                  getChangeLineData({
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
                  }),
                  true
                )
              ) {
                break hunkIterator;
              }
            }
          }
        }

        consumePendingCollapsed();
        state.incrementCounts(unifiedCount, splitCount);
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
  }
}

// Seek the iterator to the hunk that contains `startingLine` without changing
// the public meaning of `startingLine`: it is a dense rendered-row index, not
// a raw split/unified line index. We first build prefix counts for each hunk
// under the current expansion/collapse settings, binary-search those counts to
// find the first hunk whose rendered rows cross `startingLine`, then seed the
// running split/unified counters as if every prior hunk had already been
// walked.
function getIterationStartState({
  diff,
  diffStyle,
  startingLine,
  expandedHunks,
  collapsedContextThreshold,
}: IterationStartStateProps): IterationStartState {
  if (startingLine <= 0 || diffStyle === 'both') {
    return { hunkIndex: 0, splitCount: 0, unifiedCount: 0 };
  }

  const prefixCounts = getHunkPrefixCounts({
    diff,
    expandedHunks,
    collapsedContextThreshold,
  });

  let low = 0;
  let high = diff.hunks.length - 1;
  let result = diff.hunks.length;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const counts = prefixCounts[mid + 1];
    if (counts == null) {
      throw new Error('iterateOverDiff: invalid hunk prefix index');
    }
    const selectedCount =
      diffStyle === 'unified' ? counts.unifiedCount : counts.splitCount;

    if (selectedCount > startingLine) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (result >= diff.hunks.length) {
    const counts = prefixCounts[diff.hunks.length];
    if (counts == null) {
      throw new Error('iterateOverDiff: invalid terminal hunk prefix index');
    }
    return {
      hunkIndex: diff.hunks.length,
      splitCount: counts.splitCount,
      unifiedCount: counts.unifiedCount,
    };
  }

  const counts = prefixCounts[result];
  if (counts == null) {
    throw new Error('iterateOverDiff: invalid selected hunk prefix index');
  }
  return {
    hunkIndex: result,
    splitCount: counts.splitCount,
    unifiedCount: counts.unifiedCount,
  };
}

// Build cumulative rendered-row counts at every hunk boundary for the current
// expansion state. Entry 0 is always zero rows before the first hunk; entry N
// is the split/unified row count after hunks [0, N). These counts let
// getIterationStartState binary-search by dense rendered row without replaying
// every prior hunk.
function getHunkPrefixCounts({
  diff,
  expandedHunks,
  collapsedContextThreshold,
}: HunkPrefixCountsProps): HunkPrefixCounts[] {
  let splitCount = 0;
  let unifiedCount = 0;
  const finalHunkIndex = diff.hunks.length - 1;
  const prefixCounts: HunkPrefixCounts[] = [
    {
      splitCount: 0,
      unifiedCount: 0,
    },
  ];

  for (let index = 0; index < diff.hunks.length; index++) {
    const hunk = diff.hunks[index];
    if (hunk == null) {
      throw new Error('iterateOverDiff: invalid hunk summary index');
    }

    const leadingRegion = getExpandedRegion({
      isPartial: diff.isPartial,
      rangeSize: hunk.collapsedBefore,
      expandedHunks,
      hunkIndex: index,
      collapsedContextThreshold,
    });
    const leadingCount = leadingRegion.fromStart + leadingRegion.fromEnd;
    splitCount += leadingCount + hunk.splitLineCount;
    unifiedCount += leadingCount + hunk.unifiedLineCount;

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

    prefixCounts.push({ splitCount, unifiedCount });
  }

  return prefixCounts;
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
  };
}
