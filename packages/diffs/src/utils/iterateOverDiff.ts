import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';

export interface DiffLineCallbackProps {
  hunkIndex: number;
  hunk: Hunk | undefined; // undefined for trailing expansion region
  collapsedBefore: number; // > 0 means separator before this line, value = hidden lines
  collapsedAfter: number; // > 0 only on final line if trailing collapsed content
  unifiedDeletionLineIndex: number | undefined;
  unifiedAdditionLineIndex: number | undefined;
  splitLineIndex: number;
  additionLineIndex: number | undefined;
  deletionLineIndex: number | undefined;
  additionLineNumber: number | undefined; // 1-based file line number
  deletionLineNumber: number | undefined;
  type: 'context' | 'context-expanded' | 'change';
  // noEOFCR metadata - true if this is the last line and has no trailing newline
  noEOFCRAddition: boolean;
  noEOFCRDeletion: boolean;
}

interface IterationState {
  finalHunk: Hunk | undefined;
  isWindowedHighlight: boolean;
  viewportStart: number;
  viewportEnd: number;
  splitCount: number;
  unifiedCount: number;
  shouldBreak(): boolean;
  shouldSkip(unifiedHeight: number, splitHeight: number): boolean;
  incrementCounts(unifiedValue: number, splitValue: number): void;
  isInWindow(unifiedHeight: number, splitHeight: number): boolean;
  isInUnifiedWindow(height: number): boolean;
  isInSplitWindow(height: number): boolean;
  emit(props: DiffLineCallbackProps, silent?: boolean): boolean;
}

export type DiffLineCallback = (props: DiffLineCallbackProps) => boolean | void;

export interface IterateOverDiffProps {
  diff: FileDiffMetadata;
  diffStyle: 'unified' | 'split' | 'both';
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
  const state: IterationState = {
    finalHunk: diff.hunks.at(-1),
    viewportStart: startingLine,
    viewportEnd: startingLine + totalLines,
    isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
    splitCount: 0,
    unifiedCount: 0,
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
    shouldSkip(unifiedHeight: number, splitHeight: number) {
      if (!state.isWindowedHighlight) {
        return false;
      }

      const skipUnified = state.unifiedCount + unifiedHeight < startingLine;
      const skipSplit = state.splitCount + splitHeight < startingLine;

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
          // FIXME MAYBE
          // state.incrementCounts(
          //   state.isInUnifiedWindow(0) ? 1 : 0,
          //   state.isInSplitWindow(0) ? 1 : 0
          // );
        }
      }
      return callback(props) ?? false;
    },
  };

  hunkIterator: for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    if (state.shouldBreak()) {
      break;
    }

    const leadingRegion = getExpandedRegion(
      diff.isPartial,
      hunk.collapsedBefore,
      expandedHunks,
      hunkIndex,
      collapsedContextThreshold
    );
    // We only create a trailing region if it's the last hunk
    const trailingRegion = (() => {
      if (hunk !== state.finalHunk || !hasFinalCollapsedHunk(diff)) {
        return undefined;
      }
      const additionRemaining =
        diff.additionLines.length -
        (hunk.additionLineIndex + hunk.additionCount);
      const deletionRemaining =
        diff.deletionLines.length -
        (hunk.deletionLineIndex + hunk.deletionCount);

      if (additionRemaining !== deletionRemaining) {
        throw new Error(
          `iterateOverDiff: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${diff.name}`
        );
      }
      const trailingRangeSize = Math.min(additionRemaining, deletionRemaining);
      return getExpandedRegion(
        diff.isPartial,
        trailingRangeSize,
        expandedHunks,
        // hunkIndex for trailing region
        diff.hunks.length,
        collapsedContextThreshold
      );
    })();
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
    function getPendingCollapsed() {
      if (leadingRegion.collapsedLines === 0) {
        return 0;
      }
      const value = leadingRegion.collapsedLines;
      leadingRegion.collapsedLines = 0;
      return value;
    }

    // Emit for expanded lines
    if (!state.shouldSkip(expandedLineCount, expandedLineCount)) {
      let unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.rangeSize;
      let splitLineIndex = hunk.splitLineStart - leadingRegion.rangeSize;

      let deletionLineIndex = hunk.deletionLineIndex - leadingRegion.rangeSize;
      let additionLineIndex = hunk.additionLineIndex - leadingRegion.rangeSize;
      let deletionLineNumber = hunk.deletionStart - leadingRegion.rangeSize;
      let additionLineNumber = hunk.additionStart - leadingRegion.rangeSize;

      let index = 0;
      // FIXME: add skip
      while (index < leadingRegion.fromStart) {
        if (state.isInWindow(0, 0)) {
          if (
            state.emit({
              hunkIndex,
              hunk: hunk,
              collapsedBefore: 0,
              collapsedAfter: 0,
              // NOTE(amadeus): Pretty sure this is would never return a value,
              // so lets not call it, but if i notice a bug, i may need to
              // bring this back.
              // collapsedAfter: getTrailingCollapsedAfter(
              //   unifiedRowIndex,
              //   splitRowIndex
              // ),
              unifiedDeletionLineIndex: unifiedLineIndex + index,
              unifiedAdditionLineIndex: unifiedLineIndex + index,
              splitLineIndex: splitLineIndex + index,
              deletionLineIndex: deletionLineIndex + index,
              additionLineIndex: additionLineIndex + index,
              deletionLineNumber: deletionLineNumber + index,
              additionLineNumber: additionLineNumber + index,
              type: 'context-expanded',
              noEOFCRAddition: false,
              noEOFCRDeletion: false,
            })
          ) {
            break hunkIterator;
          }
        } else {
          state.incrementCounts(1, 1);
        }
        index++;
      }

      unifiedLineIndex = hunk.unifiedLineStart - leadingRegion.fromEnd;
      splitLineIndex = hunk.splitLineStart - leadingRegion.fromEnd;

      deletionLineIndex = hunk.deletionLineIndex - leadingRegion.fromEnd;
      additionLineIndex = hunk.additionLineIndex - leadingRegion.fromEnd;
      deletionLineNumber = hunk.deletionStart - leadingRegion.fromEnd;
      additionLineNumber = hunk.additionStart - leadingRegion.fromEnd;
      index = 0;

      // FIXME(amadeus): Implement a skip if needed
      while (index < leadingRegion.fromEnd) {
        if (state.isInWindow(0, 0)) {
          if (
            state.emit({
              hunkIndex,
              hunk,
              collapsedBefore: getPendingCollapsed(),
              collapsedAfter: 0,
              // NOTE(amadeus): Pretty sure this is would never return a value,
              // so lets not call it, but if i notice a bug, i may need to
              // bring this back.
              // collapsedAfter: getTrailingCollapsedAfter(
              //   unifiedRowIndex,
              //   splitRowIndex
              // ),
              unifiedDeletionLineIndex: unifiedLineIndex + index,
              unifiedAdditionLineIndex: unifiedLineIndex + index,
              splitLineIndex: splitLineIndex + index,
              deletionLineIndex: deletionLineIndex + index,
              additionLineIndex: additionLineIndex + index,
              deletionLineNumber: deletionLineNumber + index,
              additionLineNumber: additionLineNumber + index,
              type: 'context-expanded',
              noEOFCRAddition: false,
              noEOFCRDeletion: false,
            })
          ) {
            break hunkIterator;
          }
        } else {
          state.incrementCounts(1, 1);
        }
        index++;
      }
    } else {
      state.incrementCounts(expandedLineCount, expandedLineCount);
      getPendingCollapsed();
    }

    let unifiedLineIndex = hunk.unifiedLineStart;
    let splitLineIndex = hunk.splitLineStart;

    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;
    const lastContent = hunk.hunkContent.at(-1);

    for (const content of hunk.hunkContent) {
      if (state.shouldBreak()) {
        break hunkIterator;
      }

      const isLastContent = content === lastContent;

      // Hunk Context Content
      if (content.type === 'context') {
        if (!state.shouldSkip(content.lines, content.lines)) {
          let index = 0;
          // FIXME: add a skip if we aren't rendering all the lines
          while (index < content.lines) {
            if (state.isInWindow(0, 0)) {
              const isLastLine = isLastContent && index === content.lines - 1;
              const unifiedRowIndex = unifiedLineIndex + index;
              const splitRowIndex = splitLineIndex + index;
              if (
                state.emit({
                  hunkIndex,
                  hunk,
                  collapsedBefore: getPendingCollapsed(),
                  collapsedAfter: getTrailingCollapsedAfter(
                    unifiedRowIndex,
                    splitRowIndex
                  ),
                  unifiedDeletionLineIndex: unifiedRowIndex,
                  unifiedAdditionLineIndex: unifiedRowIndex,
                  splitLineIndex: splitRowIndex,
                  deletionLineIndex: deletionLineIndex + index,
                  additionLineIndex: additionLineIndex + index,
                  deletionLineNumber: deletionLineNumber + index,
                  additionLineNumber: additionLineNumber + index,
                  type: 'context',
                  noEOFCRAddition: isLastLine && hunk.noEOFCRAdditions,
                  noEOFCRDeletion: isLastLine && hunk.noEOFCRDeletions,
                })
              ) {
                break hunkIterator;
              }
            } else {
              state.incrementCounts(1, 1);
            }
            index++;
          }
        } else {
          state.incrementCounts(content.lines, content.lines);
          getPendingCollapsed();
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

          // No need for any skipping because the render ranges skip for us
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
                    collapsedBefore: getPendingCollapsed(),
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

        getPendingCollapsed();
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
      let index = 0;
      // FIXME: add a skip
      while (index < len) {
        if (state.shouldBreak()) {
          break hunkIterator;
        }
        if (state.isInWindow(0, 0)) {
          const isLastLine = index === len - 1;
          if (
            state.emit({
              hunkIndex: diff.hunks.length,
              hunk: undefined,
              collapsedBefore: 0,
              collapsedAfter: isLastLine ? collapsedLines : 0,
              unifiedDeletionLineIndex: unifiedLineIndex + index,
              unifiedAdditionLineIndex: unifiedLineIndex + index,
              splitLineIndex: splitLineIndex + index,
              additionLineIndex: additionLineIndex + index,
              deletionLineIndex: deletionLineIndex + index,
              additionLineNumber: additionLineNumber + index,
              deletionLineNumber: deletionLineNumber + index,
              type: 'context-expanded',
              noEOFCRAddition: false,
              noEOFCRDeletion: false,
            })
          ) {
            break hunkIterator;
          }
        } else {
          state.incrementCounts(1, 1);
        }
        index++;
      }
    }
  }
}

interface ExpandedRegionResult {
  fromStart: number;
  fromEnd: number;
  rangeSize: number;
  collapsedLines: number;
}

function getExpandedRegion(
  isPartial: boolean,
  rangeSize: number,
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined,
  hunkIndex: number,
  collapsedContextThreshold: number
): ExpandedRegionResult {
  rangeSize = Math.max(rangeSize, 0);
  if (rangeSize === 0 || isPartial) {
    return {
      fromStart: 0,
      fromEnd: 0,
      rangeSize,
      collapsedLines: Math.max(rangeSize, 0),
    };
  }
  if (expandedHunks === true || rangeSize <= collapsedContextThreshold) {
    return {
      fromStart: rangeSize,
      fromEnd: 0,
      rangeSize,
      collapsedLines: 0,
    };
  }
  const region = expandedHunks?.get(hunkIndex);
  const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), rangeSize);
  const fromEnd = Math.min(Math.max(region?.fromEnd ?? 0, 0), rangeSize);
  const expandedCount = fromStart + fromEnd;
  const renderAll = expandedCount >= rangeSize;
  return {
    fromStart: renderAll ? rangeSize : fromStart,
    fromEnd: renderAll ? 0 : fromEnd,
    rangeSize,
    collapsedLines: Math.max(rangeSize - expandedCount, 0),
  };
}

function hasFinalCollapsedHunk(diff: FileDiffMetadata): boolean {
  const lastHunk = diff.hunks.at(-1);
  if (
    lastHunk == null ||
    diff.isPartial ||
    diff.additionLines.length === 0 ||
    diff.deletionLines.length === 0
  ) {
    return false;
  }
  return (
    lastHunk.additionLineIndex + lastHunk.additionCount <
      diff.additionLines.length ||
    lastHunk.deletionLineIndex + lastHunk.deletionCount <
      diff.deletionLines.length
  );
}

// The intention of this function is to grab the appropriate windowed ranges of
// the change content.  If diffStyle is both, we will iterate AS split, however
// we will encompass all needed lines to allow us to render split or unified
function getChangeIterationRanges(
  state: IterationState,
  content: ChangeContent,
  diffStyle: 'split' | 'unified' | 'both'
): [number, number][] {
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
  const iterationRanges: [number, number][] = [];
  function getVisibleRange(
    start: number,
    count: number
  ): [number, number] | undefined {
    const end = start + count;
    if (end <= state.viewportStart || start >= state.viewportEnd) {
      return undefined;
    }
    const visibleStart = Math.max(0, state.viewportStart - start);
    const visibleEnd = Math.min(count, state.viewportEnd - start);
    return visibleEnd > visibleStart ? [visibleStart, visibleEnd] : undefined;
  }
  function mapRangeToIteration(
    range: [number, number],
    kind: 'deletions' | 'additions'
  ): [number, number] {
    if (iterationSpace === 'split') {
      // For split iteration, additions/deletions are already in split row space.
      return range;
    }
    return kind === 'additions'
      ? [range[0] + content.deletions, range[1] + content.deletions]
      : range;
  }
  function pushRange(
    range: [number, number] | undefined,
    kind: 'deletions' | 'additions'
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
  const merged: [number, number][] = [iterationRanges[0]];
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
  diffStyle: 'split' | 'unified' | 'both';
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

// NOTE(amadeus): It's quite tedious to grab the appropriate line info and
// related props for change content regions, so I made it a specialized
// function to help make the main hunkIterator easy to reason about
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
  if (diffStyle === 'unified') {
    return {
      type: 'change',
      hunkIndex,
      hunk,
      collapsedAfter,
      collapsedBefore,
      unifiedDeletionLineIndex:
        index < content.deletions ? unifiedLineIndex + index : undefined,
      unifiedAdditionLineIndex:
        index >= content.deletions ? unifiedLineIndex + index : undefined,
      splitLineIndex:
        splitLineIndex +
        (index < content.deletions ? index : index - content.deletions),
      additionLineIndex:
        index >= content.deletions
          ? additionLineIndex + (index - content.deletions)
          : undefined,
      additionLineNumber:
        index >= content.deletions
          ? additionLineNumber + (index - content.deletions)
          : undefined,
      deletionLineIndex:
        index < content.deletions ? deletionLineIndex + index : undefined,
      deletionLineNumber:
        index < content.deletions ? deletionLineNumber + index : undefined,
      noEOFCRDeletion:
        isLastContent &&
        index === content.deletions - 1 &&
        hunk.noEOFCRDeletions,
      noEOFCRAddition:
        isLastContent && index === unifiedCount - 1 && hunk.noEOFCRAdditions,
    };
  }
  return {
    type: 'change',
    hunkIndex,
    hunk,
    collapsedAfter,
    collapsedBefore,
    unifiedDeletionLineIndex:
      index < content.deletions ? unifiedLineIndex + index : undefined,
    unifiedAdditionLineIndex:
      index < content.additions
        ? unifiedLineIndex + content.deletions + index
        : undefined,
    splitLineIndex: splitLineIndex + index,
    additionLineIndex:
      index < content.additions ? additionLineIndex + index : undefined,
    additionLineNumber:
      index < content.additions ? additionLineNumber + index : undefined,
    deletionLineIndex:
      index < content.deletions ? deletionLineIndex + index : undefined,
    deletionLineNumber:
      index < content.deletions ? deletionLineNumber + index : undefined,
    noEOFCRDeletion:
      isLastContent && index === splitCount - 1 && hunk.noEOFCRDeletions,
    noEOFCRAddition:
      isLastContent && index === splitCount - 1 && hunk.noEOFCRAdditions,
  };
}
