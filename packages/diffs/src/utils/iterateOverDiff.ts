import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import type {
  ChangeContent,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';

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

interface DiffLineRangeCallbackBase extends DiffLineCallbackBase {
  lineCount: number;
}

interface DiffLineRangeCallbackContextChange extends DiffLineRangeCallbackBase {
  type: 'change' | 'context' | 'context-expanded';
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
}

interface DiffLineRangeCallbackChangeDeletion extends DiffLineRangeCallbackBase {
  type: 'change';
  deletionLine: DiffLineMetadata;
  additionLine?: undefined;
}

interface DiffLineRangeCallbackChangeAddition extends DiffLineRangeCallbackBase {
  type: 'change';
  deletionLine?: undefined;
  additionLine: DiffLineMetadata;
}

export type DiffLineRangeCallbackProps =
  | DiffLineRangeCallbackContextChange
  | DiffLineRangeCallbackChangeDeletion
  | DiffLineRangeCallbackChangeAddition;

interface MutableDiffLineCallbackProps extends DiffLineCallbackBase {
  type: DiffLineCallbackProps['type'];
  deletionLine: DiffLineMetadata | undefined;
  additionLine: DiffLineMetadata | undefined;
}

interface MutableDiffLineRangeCallbackProps extends DiffLineCallbackBase {
  type: DiffLineRangeCallbackProps['type'];
  lineCount: number;
  deletionLine: DiffLineMetadata | undefined;
  additionLine: DiffLineMetadata | undefined;
}

type DiffStyle = 'unified' | 'split' | 'both';

type EqualLineIterationRange = [startIndex: number, endIndex: number];

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

interface IterationStartState {
  hunkIndex: number;
  splitCount: number;
  unifiedCount: number;
}

interface HunkPrefixCounts {
  splitCount: number;
  unifiedCount: number;
}

interface ChangeIterationRanges {
  count: number;
  firstStart: number;
  firstEnd: number;
  secondStart: number;
  secondEnd: number;
  thirdStart: number;
  thirdEnd: number;
  fourthStart: number;
  fourthEnd: number;
}

interface IterationStartStateProps extends Omit<
  IterateOverDiffProps,
  'callback' | 'rangeCallback' | 'totalLines'
> {
  startingLine: number;
  collapsedContextThreshold: number;
}

interface HunkPrefixCountsProps extends Pick<
  IterationStartStateProps,
  'diff' | 'expandedHunks' | 'collapsedContextThreshold'
> {}

interface HunkPrefixCountsCacheEntry {
  collapsedContextThreshold: number;
  defaultCounts: HunkPrefixCounts[] | undefined;
  expandedCounts: HunkPrefixCounts[] | undefined;
}

// Callback props are borrowed for the lifetime of the callback. Consumers that
// retain row or line data after the callback returns must clone the fields they
// need.
export type DiffLineCallback = (props: DiffLineCallbackProps) => boolean | void;
export type DiffLineRangeCallback = (
  props: DiffLineRangeCallbackProps
) => boolean | void;

export interface IterateOverDiffProps {
  diff: FileDiffMetadata;
  diffStyle: DiffStyle;
  startingLine?: number;
  totalLines?: number;
  expandedHunks?: Map<number, HunkExpansionRegion> | true;
  collapsedContextThreshold?: number;
  callback: DiffLineCallback;
  rangeCallback?: DiffLineRangeCallback;
}

const hunkPrefixCountsCache = new WeakMap<
  FileDiffMetadata,
  HunkPrefixCountsCacheEntry
>();

export function iterateOverDiff({
  diff,
  diffStyle,
  startingLine = 0,
  totalLines = Infinity,
  expandedHunks,
  collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  callback,
  rangeCallback,
}: IterateOverDiffProps): void {
  const iterationStart = getIterationStartState({
    diff,
    diffStyle,
    startingLine,
    expandedHunks,
    collapsedContextThreshold,
  });
  const state: IterationState = {
    finalHunk: diff.hunks.at(-1),
    viewportStart: startingLine,
    viewportEnd: startingLine + totalLines,
    isWindowedHighlight: startingLine > 0 || totalLines < Infinity,
    splitCount: iterationStart.splitCount,
    unifiedCount: iterationStart.unifiedCount,
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
  const changeRanges: ChangeIterationRanges = {
    count: 0,
    firstStart: 0,
    firstEnd: 0,
    secondStart: 0,
    secondEnd: 0,
    thirdStart: 0,
    thirdEnd: 0,
    fourthStart: 0,
    fourthEnd: 0,
  };
  const reusableDeletionLine = createReusableLineMetadata();
  const reusableAdditionLine = createReusableLineMetadata();
  const reusableRangeDeletionLine = createReusableLineMetadata();
  const reusableRangeAdditionLine = createReusableLineMetadata();
  const reusableChangeProps: MutableDiffLineCallbackProps = {
    type: 'change',
    hunkIndex: 0,
    hunk: undefined,
    collapsedBefore: 0,
    collapsedAfter: 0,
    deletionLine: undefined,
    additionLine: undefined,
  };
  const reusableRangeProps: MutableDiffLineRangeCallbackProps = {
    type: 'change',
    lineCount: 0,
    hunkIndex: 0,
    hunk: undefined,
    collapsedBefore: 0,
    collapsedAfter: 0,
    deletionLine: undefined,
    additionLine: undefined,
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
    let pendingCollapsedLines = leadingRegion.collapsedLines;
    const trailingCollapsedLines =
      trailingRegion != null &&
      trailingRegion.collapsedLines > 0 &&
      trailingRegion.fromStart + trailingRegion.fromEnd === 0
        ? trailingRegion.collapsedLines
        : 0;
    const trailingCollapsedUnifiedLineIndex =
      hunk.unifiedLineStart + hunk.unifiedLineCount - 1;
    const trailingCollapsedSplitLineIndex =
      hunk.splitLineStart + hunk.splitLineCount - 1;

    function getTrailingCollapsedAfter(
      unifiedLineIndex: number,
      splitLineIndex: number
    ) {
      if (trailingCollapsedLines <= 0) {
        return 0;
      }
      if (diffStyle === 'unified') {
        return unifiedLineIndex === trailingCollapsedUnifiedLineIndex
          ? trailingCollapsedLines
          : 0;
      }
      return splitLineIndex === trailingCollapsedSplitLineIndex
        ? trailingCollapsedLines
        : 0;
    }
    function getPendingCollapsed() {
      if (pendingCollapsedLines === 0) {
        return 0;
      }
      const value = pendingCollapsedLines;
      pendingCollapsedLines = 0;
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

      const [startIndex, endIndex] = getEqualLineIterationRange(
        state,
        leadingRegion.fromStart,
        diffStyle
      );
      if (startIndex > 0) {
        state.incrementCounts(startIndex, startIndex);
      }
      let index = startIndex;
      while (index < leadingRegion.fromStart) {
        if (index >= endIndex) {
          state.incrementCounts(
            leadingRegion.fromStart - index,
            leadingRegion.fromStart - index
          );
          break;
        }
        if (state.isInWindow(0, 0)) {
          setBothLineData({
            target: reusableChangeProps,
            deletionLine: reusableDeletionLine,
            additionLine: reusableAdditionLine,
            type: 'context-expanded',
            hunkIndex,
            hunk,
            collapsedBefore: 0,
            collapsedAfter: 0,
            deletionLineNumber: deletionLineNumber + index,
            deletionLineIndex: deletionLineIndex + index,
            additionLineNumber: additionLineNumber + index,
            additionLineIndex: additionLineIndex + index,
            unifiedLineIndex: unifiedLineIndex + index,
            splitLineIndex: splitLineIndex + index,
            deletionNoEOF: false,
            additionNoEOF: false,
          });
          if (state.emit(reusableChangeProps as DiffLineCallbackProps)) {
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
      const [fromEndStartIndex, fromEndEndIndex] = getEqualLineIterationRange(
        state,
        leadingRegion.fromEnd,
        diffStyle
      );
      if (fromEndStartIndex > 0) {
        state.incrementCounts(fromEndStartIndex, fromEndStartIndex);
      }
      index = fromEndStartIndex;

      while (index < leadingRegion.fromEnd) {
        if (index >= fromEndEndIndex) {
          state.incrementCounts(
            leadingRegion.fromEnd - index,
            leadingRegion.fromEnd - index
          );
          break;
        }
        if (state.isInWindow(0, 0)) {
          setBothLineData({
            target: reusableChangeProps,
            deletionLine: reusableDeletionLine,
            additionLine: reusableAdditionLine,
            type: 'context-expanded',
            hunkIndex,
            hunk,
            collapsedBefore: getPendingCollapsed(),
            collapsedAfter: 0,
            deletionLineNumber: deletionLineNumber + index,
            deletionLineIndex: deletionLineIndex + index,
            additionLineNumber: additionLineNumber + index,
            additionLineIndex: additionLineIndex + index,
            unifiedLineIndex: unifiedLineIndex + index,
            splitLineIndex: splitLineIndex + index,
            deletionNoEOF: false,
            additionNoEOF: false,
          });
          if (state.emit(reusableChangeProps as DiffLineCallbackProps)) {
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
        if (
          !state.isWindowedHighlight &&
          pendingCollapsedLines === 0 &&
          trailingCollapsedLines <= 0 &&
          !(isLastContent && (hunk.noEOFCRAdditions || hunk.noEOFCRDeletions))
        ) {
          if (rangeCallback != null) {
            setRangeLineData({
              target: reusableRangeProps,
              deletionLine: reusableRangeDeletionLine,
              additionLine: reusableRangeAdditionLine,
              type: 'context',
              hunkIndex,
              hunk,
              lineCount: content.lines,
              deletionLineNumber,
              deletionLineIndex,
              additionLineNumber,
              additionLineIndex,
              deletionUnifiedLineIndex: unifiedLineIndex,
              deletionSplitLineIndex: splitLineIndex,
              additionUnifiedLineIndex: unifiedLineIndex,
              additionSplitLineIndex: splitLineIndex,
            });
            if (
              rangeCallback(
                reusableRangeProps as DiffLineRangeCallbackProps
              ) === true
            ) {
              break hunkIterator;
            }
          } else {
            reusableChangeProps.type = 'context';
            reusableChangeProps.hunkIndex = hunkIndex;
            reusableChangeProps.hunk = hunk;
            reusableChangeProps.collapsedBefore = 0;
            reusableChangeProps.collapsedAfter = 0;
            reusableChangeProps.deletionLine = reusableDeletionLine;
            reusableChangeProps.additionLine = reusableAdditionLine;
            reusableDeletionLine.noEOFCR = false;
            reusableAdditionLine.noEOFCR = false;
            for (let index = 0; index < content.lines; index++) {
              const rowUnifiedLineIndex = unifiedLineIndex + index;
              const rowSplitLineIndex = splitLineIndex + index;
              reusableDeletionLine.unifiedLineIndex = rowUnifiedLineIndex;
              reusableDeletionLine.splitLineIndex = rowSplitLineIndex;
              reusableDeletionLine.lineIndex = deletionLineIndex + index;
              reusableDeletionLine.lineNumber = deletionLineNumber + index;
              reusableAdditionLine.unifiedLineIndex = rowUnifiedLineIndex;
              reusableAdditionLine.splitLineIndex = rowSplitLineIndex;
              reusableAdditionLine.lineIndex = additionLineIndex + index;
              reusableAdditionLine.lineNumber = additionLineNumber + index;
              if (
                callback(reusableChangeProps as DiffLineCallbackProps) === true
              ) {
                break hunkIterator;
              }
            }
          }
        } else if (!state.shouldSkip(content.lines, content.lines)) {
          const [startIndex, endIndex] = getEqualLineIterationRange(
            state,
            content.lines,
            diffStyle
          );
          if (startIndex > 0) {
            state.incrementCounts(startIndex, startIndex);
          }
          let index = startIndex;
          while (index < content.lines) {
            if (index >= endIndex) {
              state.incrementCounts(
                content.lines - index,
                content.lines - index
              );
              break;
            }
            if (state.isInWindow(0, 0)) {
              const isLastLine = isLastContent && index === content.lines - 1;
              const unifiedRowIndex = unifiedLineIndex + index;
              const splitRowIndex = splitLineIndex + index;
              setBothLineData({
                target: reusableChangeProps,
                deletionLine: reusableDeletionLine,
                additionLine: reusableAdditionLine,
                type: 'context',
                hunkIndex,
                hunk,
                collapsedBefore: getPendingCollapsed(),
                collapsedAfter: getTrailingCollapsedAfter(
                  unifiedRowIndex,
                  splitRowIndex
                ),
                deletionLineNumber: deletionLineNumber + index,
                deletionLineIndex: deletionLineIndex + index,
                additionLineNumber: additionLineNumber + index,
                additionLineIndex: additionLineIndex + index,
                unifiedLineIndex: unifiedRowIndex,
                splitLineIndex: splitRowIndex,
                deletionNoEOF: isLastLine && hunk.noEOFCRDeletions,
                additionNoEOF: isLastLine && hunk.noEOFCRAdditions,
              });
              if (state.emit(reusableChangeProps as DiffLineCallbackProps)) {
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
          reusableChangeProps.type = 'change';
          reusableChangeProps.hunkIndex = hunkIndex;
          reusableChangeProps.hunk = hunk;

          if (
            !state.isWindowedHighlight &&
            content.deletions === 0 &&
            pendingCollapsedLines === 0 &&
            trailingCollapsedLines <= 0 &&
            !(isLastContent && hunk.noEOFCRAdditions)
          ) {
            if (rangeCallback != null) {
              setRangeLineData({
                target: reusableRangeProps,
                deletionLine: reusableRangeDeletionLine,
                additionLine: reusableRangeAdditionLine,
                type: 'change',
                hunkIndex,
                hunk,
                lineCount: content.additions,
                deletionLineNumber: undefined,
                deletionLineIndex: undefined,
                additionLineNumber,
                additionLineIndex,
                deletionUnifiedLineIndex: undefined,
                deletionSplitLineIndex: undefined,
                additionUnifiedLineIndex: unifiedLineIndex,
                additionSplitLineIndex: splitLineIndex,
              });
              if (
                rangeCallback(
                  reusableRangeProps as DiffLineRangeCallbackProps
                ) === true
              ) {
                break hunkIterator;
              }
            } else {
              reusableChangeProps.deletionLine = undefined;
              reusableChangeProps.additionLine = reusableAdditionLine;
              reusableChangeProps.collapsedBefore = 0;
              reusableChangeProps.collapsedAfter = 0;
              reusableAdditionLine.noEOFCR = false;
              for (let index = 0; index < content.additions; index++) {
                reusableAdditionLine.unifiedLineIndex =
                  unifiedLineIndex + index;
                reusableAdditionLine.splitLineIndex = splitLineIndex + index;
                reusableAdditionLine.lineIndex = additionLineIndex + index;
                reusableAdditionLine.lineNumber = additionLineNumber + index;
                if (
                  callback(reusableChangeProps as DiffLineCallbackProps) ===
                  true
                ) {
                  break hunkIterator;
                }
              }
            }
          } else if (
            !state.isWindowedHighlight &&
            content.additions === 0 &&
            pendingCollapsedLines === 0 &&
            trailingCollapsedLines <= 0 &&
            !(isLastContent && hunk.noEOFCRDeletions)
          ) {
            if (rangeCallback != null) {
              setRangeLineData({
                target: reusableRangeProps,
                deletionLine: reusableRangeDeletionLine,
                additionLine: reusableRangeAdditionLine,
                type: 'change',
                hunkIndex,
                hunk,
                lineCount: content.deletions,
                deletionLineNumber,
                deletionLineIndex,
                additionLineNumber: undefined,
                additionLineIndex: undefined,
                deletionUnifiedLineIndex: unifiedLineIndex,
                deletionSplitLineIndex: splitLineIndex,
                additionUnifiedLineIndex: undefined,
                additionSplitLineIndex: undefined,
              });
              if (
                rangeCallback(
                  reusableRangeProps as DiffLineRangeCallbackProps
                ) === true
              ) {
                break hunkIterator;
              }
            } else {
              reusableChangeProps.deletionLine = reusableDeletionLine;
              reusableChangeProps.additionLine = undefined;
              reusableChangeProps.collapsedBefore = 0;
              reusableChangeProps.collapsedAfter = 0;
              reusableDeletionLine.noEOFCR = false;
              for (let index = 0; index < content.deletions; index++) {
                reusableDeletionLine.unifiedLineIndex =
                  unifiedLineIndex + index;
                reusableDeletionLine.splitLineIndex = splitLineIndex + index;
                reusableDeletionLine.lineIndex = deletionLineIndex + index;
                reusableDeletionLine.lineNumber = deletionLineNumber + index;
                if (
                  callback(reusableChangeProps as DiffLineCallbackProps) ===
                  true
                ) {
                  break hunkIterator;
                }
              }
            }
          } else if (
            !state.isWindowedHighlight &&
            content.deletions > 0 &&
            content.additions > 0 &&
            pendingCollapsedLines === 0 &&
            trailingCollapsedLines <= 0 &&
            !(isLastContent && hunk.noEOFCRAdditions) &&
            !(isLastContent && hunk.noEOFCRDeletions)
          ) {
            if (rangeCallback != null) {
              if (diffStyle === 'unified') {
                setRangeLineData({
                  target: reusableRangeProps,
                  deletionLine: reusableRangeDeletionLine,
                  additionLine: reusableRangeAdditionLine,
                  type: 'change',
                  hunkIndex,
                  hunk,
                  lineCount: content.deletions,
                  deletionLineNumber,
                  deletionLineIndex,
                  additionLineNumber: undefined,
                  additionLineIndex: undefined,
                  deletionUnifiedLineIndex: unifiedLineIndex,
                  deletionSplitLineIndex: splitLineIndex,
                  additionUnifiedLineIndex: undefined,
                  additionSplitLineIndex: undefined,
                });
                if (
                  rangeCallback(
                    reusableRangeProps as DiffLineRangeCallbackProps
                  ) === true
                ) {
                  break hunkIterator;
                }

                setRangeLineData({
                  target: reusableRangeProps,
                  deletionLine: reusableRangeDeletionLine,
                  additionLine: reusableRangeAdditionLine,
                  type: 'change',
                  hunkIndex,
                  hunk,
                  lineCount: content.additions,
                  deletionLineNumber: undefined,
                  deletionLineIndex: undefined,
                  additionLineNumber,
                  additionLineIndex,
                  deletionUnifiedLineIndex: undefined,
                  deletionSplitLineIndex: undefined,
                  additionUnifiedLineIndex:
                    unifiedLineIndex + content.deletions,
                  additionSplitLineIndex: splitLineIndex,
                });
                if (
                  rangeCallback(
                    reusableRangeProps as DiffLineRangeCallbackProps
                  ) === true
                ) {
                  break hunkIterator;
                }
              } else {
                const pairedCount = Math.min(
                  content.deletions,
                  content.additions
                );
                if (pairedCount > 0) {
                  setRangeLineData({
                    target: reusableRangeProps,
                    deletionLine: reusableRangeDeletionLine,
                    additionLine: reusableRangeAdditionLine,
                    type: 'change',
                    hunkIndex,
                    hunk,
                    lineCount: pairedCount,
                    deletionLineNumber,
                    deletionLineIndex,
                    additionLineNumber,
                    additionLineIndex,
                    deletionUnifiedLineIndex: unifiedLineIndex,
                    deletionSplitLineIndex: splitLineIndex,
                    additionUnifiedLineIndex:
                      unifiedLineIndex + content.deletions,
                    additionSplitLineIndex: splitLineIndex,
                  });
                  if (
                    rangeCallback(
                      reusableRangeProps as DiffLineRangeCallbackProps
                    ) === true
                  ) {
                    break hunkIterator;
                  }
                }

                if (content.deletions > pairedCount) {
                  setRangeLineData({
                    target: reusableRangeProps,
                    deletionLine: reusableRangeDeletionLine,
                    additionLine: reusableRangeAdditionLine,
                    type: 'change',
                    hunkIndex,
                    hunk,
                    lineCount: content.deletions - pairedCount,
                    deletionLineNumber: deletionLineNumber + pairedCount,
                    deletionLineIndex: deletionLineIndex + pairedCount,
                    additionLineNumber: undefined,
                    additionLineIndex: undefined,
                    deletionUnifiedLineIndex: unifiedLineIndex + pairedCount,
                    deletionSplitLineIndex: splitLineIndex + pairedCount,
                    additionUnifiedLineIndex: undefined,
                    additionSplitLineIndex: undefined,
                  });
                  if (
                    rangeCallback(
                      reusableRangeProps as DiffLineRangeCallbackProps
                    ) === true
                  ) {
                    break hunkIterator;
                  }
                }

                if (content.additions > pairedCount) {
                  setRangeLineData({
                    target: reusableRangeProps,
                    deletionLine: reusableRangeDeletionLine,
                    additionLine: reusableRangeAdditionLine,
                    type: 'change',
                    hunkIndex,
                    hunk,
                    lineCount: content.additions - pairedCount,
                    deletionLineNumber: undefined,
                    deletionLineIndex: undefined,
                    additionLineNumber: additionLineNumber + pairedCount,
                    additionLineIndex: additionLineIndex + pairedCount,
                    deletionUnifiedLineIndex: undefined,
                    deletionSplitLineIndex: undefined,
                    additionUnifiedLineIndex:
                      unifiedLineIndex + content.deletions + pairedCount,
                    additionSplitLineIndex: splitLineIndex + pairedCount,
                  });
                  if (
                    rangeCallback(
                      reusableRangeProps as DiffLineRangeCallbackProps
                    ) === true
                  ) {
                    break hunkIterator;
                  }
                }
              }
            } else {
              reusableChangeProps.collapsedBefore = 0;
              reusableChangeProps.collapsedAfter = 0;
              reusableDeletionLine.noEOFCR = false;
              reusableAdditionLine.noEOFCR = false;

              if (diffStyle === 'unified') {
                reusableChangeProps.deletionLine = reusableDeletionLine;
                reusableChangeProps.additionLine = undefined;
                for (let index = 0; index < content.deletions; index++) {
                  reusableDeletionLine.unifiedLineIndex =
                    unifiedLineIndex + index;
                  reusableDeletionLine.splitLineIndex = splitLineIndex + index;
                  reusableDeletionLine.lineIndex = deletionLineIndex + index;
                  reusableDeletionLine.lineNumber = deletionLineNumber + index;
                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }

                reusableChangeProps.deletionLine = undefined;
                reusableChangeProps.additionLine = reusableAdditionLine;
                for (let index = 0; index < content.additions; index++) {
                  reusableAdditionLine.unifiedLineIndex =
                    unifiedLineIndex + content.deletions + index;
                  reusableAdditionLine.splitLineIndex = splitLineIndex + index;
                  reusableAdditionLine.lineIndex = additionLineIndex + index;
                  reusableAdditionLine.lineNumber = additionLineNumber + index;
                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }
              } else {
                const rowCount = splitCount;
                for (let index = 0; index < rowCount; index++) {
                  if (index < content.deletions) {
                    reusableDeletionLine.unifiedLineIndex =
                      unifiedLineIndex + index;
                    reusableDeletionLine.splitLineIndex =
                      splitLineIndex + index;
                    reusableDeletionLine.lineIndex = deletionLineIndex + index;
                    reusableDeletionLine.lineNumber =
                      deletionLineNumber + index;
                    reusableChangeProps.deletionLine = reusableDeletionLine;
                  } else {
                    reusableChangeProps.deletionLine = undefined;
                  }

                  if (index < content.additions) {
                    reusableAdditionLine.unifiedLineIndex =
                      unifiedLineIndex + content.deletions + index;
                    reusableAdditionLine.splitLineIndex =
                      splitLineIndex + index;
                    reusableAdditionLine.lineIndex = additionLineIndex + index;
                    reusableAdditionLine.lineNumber =
                      additionLineNumber + index;
                    reusableChangeProps.additionLine = reusableAdditionLine;
                  } else {
                    reusableChangeProps.additionLine = undefined;
                  }

                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }
              }
            }
          } else {
            setChangeIterationRanges(state, content, diffStyle, changeRanges);
            if (content.deletions === 0) {
              reusableChangeProps.deletionLine = undefined;
              reusableChangeProps.additionLine = reusableAdditionLine;
              for (
                let rangeOffset = 0;
                rangeOffset < changeRanges.count;
                rangeOffset++
              ) {
                const rangeStart =
                  rangeOffset === 0
                    ? changeRanges.firstStart
                    : rangeOffset === 1
                      ? changeRanges.secondStart
                      : rangeOffset === 2
                        ? changeRanges.thirdStart
                        : changeRanges.fourthStart;
                const rangeEnd =
                  rangeOffset === 0
                    ? changeRanges.firstEnd
                    : rangeOffset === 1
                      ? changeRanges.secondEnd
                      : rangeOffset === 2
                        ? changeRanges.thirdEnd
                        : changeRanges.fourthEnd;

                for (let index = rangeStart; index < rangeEnd; index++) {
                  const rowUnifiedLineIndex = unifiedLineIndex + index;
                  const rowSplitLineIndex = splitLineIndex + index;
                  reusableChangeProps.collapsedBefore = pendingCollapsedLines;
                  pendingCollapsedLines = 0;
                  reusableChangeProps.collapsedAfter =
                    trailingCollapsedLines <= 0
                      ? 0
                      : diffStyle === 'unified'
                        ? rowUnifiedLineIndex ===
                          trailingCollapsedUnifiedLineIndex
                          ? trailingCollapsedLines
                          : 0
                        : rowSplitLineIndex === trailingCollapsedSplitLineIndex
                          ? trailingCollapsedLines
                          : 0;
                  reusableAdditionLine.unifiedLineIndex = rowUnifiedLineIndex;
                  reusableAdditionLine.splitLineIndex = rowSplitLineIndex;
                  reusableAdditionLine.lineIndex = additionLineIndex + index;
                  reusableAdditionLine.lineNumber = additionLineNumber + index;
                  reusableAdditionLine.noEOFCR =
                    isLastContent &&
                    index === content.additions - 1 &&
                    hunk.noEOFCRAdditions;
                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }
              }
            } else if (content.additions === 0) {
              reusableChangeProps.deletionLine = reusableDeletionLine;
              reusableChangeProps.additionLine = undefined;
              for (
                let rangeOffset = 0;
                rangeOffset < changeRanges.count;
                rangeOffset++
              ) {
                const rangeStart =
                  rangeOffset === 0
                    ? changeRanges.firstStart
                    : rangeOffset === 1
                      ? changeRanges.secondStart
                      : rangeOffset === 2
                        ? changeRanges.thirdStart
                        : changeRanges.fourthStart;
                const rangeEnd =
                  rangeOffset === 0
                    ? changeRanges.firstEnd
                    : rangeOffset === 1
                      ? changeRanges.secondEnd
                      : rangeOffset === 2
                        ? changeRanges.thirdEnd
                        : changeRanges.fourthEnd;

                for (let index = rangeStart; index < rangeEnd; index++) {
                  const rowUnifiedLineIndex = unifiedLineIndex + index;
                  const rowSplitLineIndex = splitLineIndex + index;
                  reusableChangeProps.collapsedBefore = pendingCollapsedLines;
                  pendingCollapsedLines = 0;
                  reusableChangeProps.collapsedAfter =
                    trailingCollapsedLines <= 0
                      ? 0
                      : diffStyle === 'unified'
                        ? rowUnifiedLineIndex ===
                          trailingCollapsedUnifiedLineIndex
                          ? trailingCollapsedLines
                          : 0
                        : rowSplitLineIndex === trailingCollapsedSplitLineIndex
                          ? trailingCollapsedLines
                          : 0;
                  reusableDeletionLine.unifiedLineIndex = rowUnifiedLineIndex;
                  reusableDeletionLine.splitLineIndex = rowSplitLineIndex;
                  reusableDeletionLine.lineIndex = deletionLineIndex + index;
                  reusableDeletionLine.lineNumber = deletionLineNumber + index;
                  reusableDeletionLine.noEOFCR =
                    isLastContent &&
                    index === content.deletions - 1 &&
                    hunk.noEOFCRDeletions;
                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }
              }
            } else {
              for (
                let rangeOffset = 0;
                rangeOffset < changeRanges.count;
                rangeOffset++
              ) {
                const rangeStart =
                  rangeOffset === 0
                    ? changeRanges.firstStart
                    : rangeOffset === 1
                      ? changeRanges.secondStart
                      : rangeOffset === 2
                        ? changeRanges.thirdStart
                        : changeRanges.fourthStart;
                const rangeEnd =
                  rangeOffset === 0
                    ? changeRanges.firstEnd
                    : rangeOffset === 1
                      ? changeRanges.secondEnd
                      : rangeOffset === 2
                        ? changeRanges.thirdEnd
                        : changeRanges.fourthEnd;

                // No need for any skipping because the render ranges skip for us
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
                  setChangeLineData({
                    target: reusableChangeProps,
                    deletionLine: reusableDeletionLine,
                    additionLine: reusableAdditionLine,
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
                  });
                  if (
                    callback(reusableChangeProps as DiffLineCallbackProps) ===
                    true
                  ) {
                    break hunkIterator;
                  }
                }
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
      const [startIndex, endIndex] = getEqualLineIterationRange(
        state,
        len,
        diffStyle
      );
      if (startIndex > 0) {
        state.incrementCounts(startIndex, startIndex);
      }
      let index = startIndex;
      while (index < len) {
        if (state.shouldBreak()) {
          break hunkIterator;
        }
        if (index >= endIndex) {
          state.incrementCounts(len - index, len - index);
          break;
        }
        if (state.isInWindow(0, 0)) {
          const isLastLine = index === len - 1;
          setBothLineData({
            target: reusableChangeProps,
            deletionLine: reusableDeletionLine,
            additionLine: reusableAdditionLine,
            type: 'context-expanded',
            hunkIndex: diff.hunks.length,
            hunk: undefined,
            collapsedBefore: 0,
            collapsedAfter: isLastLine ? collapsedLines : 0,
            deletionLineNumber: deletionLineNumber + index,
            deletionLineIndex: deletionLineIndex + index,
            additionLineNumber: additionLineNumber + index,
            additionLineIndex: additionLineIndex + index,
            unifiedLineIndex: unifiedLineIndex + index,
            splitLineIndex: splitLineIndex + index,
            deletionNoEOF: false,
            additionNoEOF: false,
          });
          if (state.emit(reusableChangeProps as DiffLineCallbackProps)) {
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
  if (startingLine <= 0) {
    return { hunkIndex: 0, splitCount: 0, unifiedCount: 0 };
  }

  const prefixCounts = getCachedHunkPrefixCounts({
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
    const isPastStartingLine =
      diffStyle === 'unified'
        ? counts.unifiedCount > startingLine
        : diffStyle === 'split'
          ? counts.splitCount > startingLine
          : counts.unifiedCount > startingLine ||
            counts.splitCount > startingLine;

    if (isPastStartingLine) {
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

function getCachedHunkPrefixCounts(
  props: HunkPrefixCountsProps
): HunkPrefixCounts[] {
  const { diff, expandedHunks, collapsedContextThreshold } = props;
  if (expandedHunks !== undefined && expandedHunks !== true) {
    return getHunkPrefixCounts(props);
  }

  let cacheEntry = hunkPrefixCountsCache.get(diff);
  if (
    cacheEntry == null ||
    cacheEntry.collapsedContextThreshold !== collapsedContextThreshold
  ) {
    cacheEntry = {
      collapsedContextThreshold,
      defaultCounts: undefined,
      expandedCounts: undefined,
    };
    hunkPrefixCountsCache.set(diff, cacheEntry);
  }

  if (expandedHunks === true) {
    cacheEntry.expandedCounts ??= getHunkPrefixCounts(props);
    return cacheEntry.expandedCounts;
  }

  cacheEntry.defaultCounts ??= getHunkPrefixCounts(props);
  return cacheEntry.defaultCounts;
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

    const leadingRegion = getExpandedRegion(
      diff.isPartial,
      hunk.collapsedBefore,
      expandedHunks,
      index,
      collapsedContextThreshold
    );
    const leadingCount = leadingRegion.fromStart + leadingRegion.fromEnd;
    splitCount += leadingCount + hunk.splitLineCount;
    unifiedCount += leadingCount + hunk.unifiedLineCount;

    if (index === finalHunkIndex && hasFinalCollapsedHunk(diff)) {
      const trailingRangeSize = getTrailingRangeSize(diff, hunk);
      const trailingRegion = getExpandedRegion(
        diff.isPartial,
        trailingRangeSize,
        expandedHunks,
        diff.hunks.length,
        collapsedContextThreshold
      );
      const trailingCount = trailingRegion.fromStart + trailingRegion.fromEnd;
      splitCount += trailingCount;
      unifiedCount += trailingCount;
    }

    prefixCounts.push({ splitCount, unifiedCount });
  }

  return prefixCounts;
}

// Clip a run of unchanged rows to the active rendered window. Equal rows advance
// split and unified counters together, but `diffStyle: both` needs the union of
// the split and unified visible ranges because either view can make the row
// worth emitting.
function getEqualLineIterationRange(
  state: IterationState,
  count: number,
  diffStyle: DiffStyle
): EqualLineIterationRange {
  if (!state.isWindowedHighlight || count <= 0) {
    return [0, count];
  }

  let start = Infinity;
  let end = -Infinity;
  function mergeRange(currentCount: number): void {
    const rangeStart = Math.max(0, state.viewportStart - currentCount);
    const rangeEnd = Math.min(count, state.viewportEnd - currentCount);
    if (rangeEnd > rangeStart) {
      start = Math.min(start, rangeStart);
      end = Math.max(end, rangeEnd);
    }
  }

  if (diffStyle !== 'split') {
    mergeRange(state.unifiedCount);
  }
  if (diffStyle !== 'unified') {
    mergeRange(state.splitCount);
  }

  if (end < 0) {
    return [0, 0];
  }
  return [start, end];
}

// Measure the unchanged tail after the final hunk so it can be collapsed or
// expanded like leading hunk context. Both sides must have the same remaining
// length because trailing context represents paired unchanged lines.
function getTrailingRangeSize(diff: FileDiffMetadata, hunk: Hunk): number {
  const additionRemaining =
    diff.additionLines.length - (hunk.additionLineIndex + hunk.additionCount);
  const deletionRemaining =
    diff.deletionLines.length - (hunk.deletionLineIndex + hunk.deletionCount);

  if (additionRemaining !== deletionRemaining) {
    throw new Error(
      `iterateOverDiff: trailing context mismatch (additions=${additionRemaining}, deletions=${deletionRemaining}) for ${diff.name}`
    );
  }
  return Math.min(additionRemaining, deletionRemaining);
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

function pushChangeIterationRange(
  ranges: ChangeIterationRanges,
  start: number,
  end: number
): void {
  if (end <= start || ranges.count >= 4) {
    return;
  }

  if (ranges.count === 0) {
    ranges.firstStart = start;
    ranges.firstEnd = end;
  } else if (ranges.count === 1) {
    ranges.secondStart = start;
    ranges.secondEnd = end;
  } else if (ranges.count === 2) {
    ranges.thirdStart = start;
    ranges.thirdEnd = end;
  } else {
    ranges.fourthStart = start;
    ranges.fourthEnd = end;
  }
  ranges.count++;
}

function pushVisibleChangeIterationRange(
  state: IterationState,
  ranges: ChangeIterationRanges,
  baseStart: number,
  count: number,
  iterationOffset: number
): void {
  const baseEnd = baseStart + count;
  if (baseEnd <= state.viewportStart || baseStart >= state.viewportEnd) {
    return;
  }
  pushChangeIterationRange(
    ranges,
    Math.max(0, state.viewportStart - baseStart) + iterationOffset,
    Math.min(count, state.viewportEnd - baseStart) + iterationOffset
  );
}

function swapFirstSecondChangeRange(ranges: ChangeIterationRanges): void {
  const start = ranges.firstStart;
  const end = ranges.firstEnd;
  ranges.firstStart = ranges.secondStart;
  ranges.firstEnd = ranges.secondEnd;
  ranges.secondStart = start;
  ranges.secondEnd = end;
}

function swapSecondThirdChangeRange(ranges: ChangeIterationRanges): void {
  const start = ranges.secondStart;
  const end = ranges.secondEnd;
  ranges.secondStart = ranges.thirdStart;
  ranges.secondEnd = ranges.thirdEnd;
  ranges.thirdStart = start;
  ranges.thirdEnd = end;
}

function swapThirdFourthChangeRange(ranges: ChangeIterationRanges): void {
  const start = ranges.thirdStart;
  const end = ranges.thirdEnd;
  ranges.thirdStart = ranges.fourthStart;
  ranges.thirdEnd = ranges.fourthEnd;
  ranges.fourthStart = start;
  ranges.fourthEnd = end;
}

function sortChangeIterationRanges(ranges: ChangeIterationRanges): void {
  if (ranges.count > 1 && ranges.secondStart < ranges.firstStart) {
    swapFirstSecondChangeRange(ranges);
  }
  if (ranges.count > 2 && ranges.thirdStart < ranges.secondStart) {
    swapSecondThirdChangeRange(ranges);
  }
  if (ranges.count > 1 && ranges.secondStart < ranges.firstStart) {
    swapFirstSecondChangeRange(ranges);
  }
  if (ranges.count > 3 && ranges.fourthStart < ranges.thirdStart) {
    swapThirdFourthChangeRange(ranges);
  }
  if (ranges.count > 2 && ranges.thirdStart < ranges.secondStart) {
    swapSecondThirdChangeRange(ranges);
  }
  if (ranges.count > 1 && ranges.secondStart < ranges.firstStart) {
    swapFirstSecondChangeRange(ranges);
  }
}

function mergeFirstSecondChangeRange(ranges: ChangeIterationRanges): void {
  ranges.firstEnd = Math.max(ranges.firstEnd, ranges.secondEnd);
  ranges.secondStart = ranges.thirdStart;
  ranges.secondEnd = ranges.thirdEnd;
  ranges.thirdStart = ranges.fourthStart;
  ranges.thirdEnd = ranges.fourthEnd;
  ranges.count--;
}

function mergeSecondThirdChangeRange(ranges: ChangeIterationRanges): void {
  ranges.secondEnd = Math.max(ranges.secondEnd, ranges.thirdEnd);
  ranges.thirdStart = ranges.fourthStart;
  ranges.thirdEnd = ranges.fourthEnd;
  ranges.count--;
}

function mergeChangeIterationRanges(ranges: ChangeIterationRanges): void {
  if (ranges.count > 1 && ranges.secondStart <= ranges.firstEnd) {
    mergeFirstSecondChangeRange(ranges);
  }
  if (ranges.count > 1 && ranges.secondStart <= ranges.firstEnd) {
    mergeFirstSecondChangeRange(ranges);
  }
  if (ranges.count > 1 && ranges.secondStart <= ranges.firstEnd) {
    mergeFirstSecondChangeRange(ranges);
  }
  if (ranges.count > 2 && ranges.thirdStart <= ranges.secondEnd) {
    mergeSecondThirdChangeRange(ranges);
  }
  if (ranges.count > 2 && ranges.thirdStart <= ranges.secondEnd) {
    mergeSecondThirdChangeRange(ranges);
  }
  if (ranges.count > 3 && ranges.fourthStart <= ranges.thirdEnd) {
    ranges.thirdEnd = Math.max(ranges.thirdEnd, ranges.fourthEnd);
    ranges.count--;
  }
}

// Store the visible sub-ranges of a change block without allocating temporary
// range arrays. For `diffStyle: both` the iterator still emits rows in split
// row space, but it merges the split and unified visible windows so either view
// can make a row worth emitting.
function setChangeIterationRanges(
  state: IterationState,
  content: ChangeContent,
  diffStyle: DiffStyle,
  ranges: ChangeIterationRanges
): void {
  ranges.count = 0;

  // If not a window highlight, then we should just render the entire range
  if (!state.isWindowedHighlight) {
    pushChangeIterationRange(
      ranges,
      0,
      diffStyle === 'unified'
        ? content.deletions + content.additions
        : Math.max(content.deletions, content.additions)
    );
    return;
  }

  if (diffStyle !== 'split') {
    pushVisibleChangeIterationRange(
      state,
      ranges,
      state.unifiedCount,
      content.deletions,
      0
    );
    pushVisibleChangeIterationRange(
      state,
      ranges,
      state.unifiedCount + content.deletions,
      content.additions,
      diffStyle === 'unified' ? content.deletions : 0
    );
  }

  if (diffStyle !== 'unified') {
    pushVisibleChangeIterationRange(
      state,
      ranges,
      state.splitCount,
      content.deletions,
      0
    );
    pushVisibleChangeIterationRange(
      state,
      ranges,
      state.splitCount,
      content.additions,
      0
    );
  }

  sortChangeIterationRanges(ranges);
  mergeChangeIterationRanges(ranges);
}

interface GetChangeLineDataProps {
  target: MutableDiffLineCallbackProps;
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
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

interface SetBothLineDataProps {
  target: MutableDiffLineCallbackProps;
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
  type: DiffLineCallbackContextChange['type'];
  hunkIndex: number;
  hunk: Hunk | undefined;
  collapsedBefore: number;
  collapsedAfter: number;
  deletionLineNumber: number;
  deletionLineIndex: number;
  additionLineNumber: number;
  additionLineIndex: number;
  unifiedLineIndex: number;
  splitLineIndex: number;
  deletionNoEOF: boolean;
  additionNoEOF: boolean;
}

interface SetRangeLineDataProps {
  target: MutableDiffLineRangeCallbackProps;
  deletionLine: DiffLineMetadata;
  additionLine: DiffLineMetadata;
  type: DiffLineRangeCallbackProps['type'];
  hunkIndex: number;
  hunk: Hunk | undefined;
  lineCount: number;
  deletionLineNumber: number | undefined;
  deletionLineIndex: number | undefined;
  additionLineNumber: number | undefined;
  additionLineIndex: number | undefined;
  deletionUnifiedLineIndex: number | undefined;
  deletionSplitLineIndex: number | undefined;
  additionUnifiedLineIndex: number | undefined;
  additionSplitLineIndex: number | undefined;
}

// NOTE(amadeus): It's quite tedious to grab the appropriate line info and
// related props for change content regions, so I made it a specialized
// function to help make the main hunkIterator easy to reason about
function createReusableLineMetadata(): DiffLineMetadata {
  return {
    unifiedLineIndex: 0,
    splitLineIndex: 0,
    lineIndex: 0,
    lineNumber: 0,
    noEOFCR: false,
  };
}

function setLineMetadata(
  target: DiffLineMetadata,
  unifiedLineIndex: number,
  splitLineIndex: number,
  lineIndex: number,
  lineNumber: number,
  noEOFCR: boolean
): void {
  target.unifiedLineIndex = unifiedLineIndex;
  target.splitLineIndex = splitLineIndex;
  target.lineIndex = lineIndex;
  target.lineNumber = lineNumber;
  target.noEOFCR = noEOFCR;
}

function setBothLineData({
  target,
  deletionLine,
  additionLine,
  type,
  hunkIndex,
  hunk,
  collapsedBefore,
  collapsedAfter,
  deletionLineNumber,
  deletionLineIndex,
  additionLineNumber,
  additionLineIndex,
  unifiedLineIndex,
  splitLineIndex,
  deletionNoEOF,
  additionNoEOF,
}: SetBothLineDataProps): void {
  target.type = type;
  target.hunkIndex = hunkIndex;
  target.hunk = hunk;
  target.collapsedBefore = collapsedBefore;
  target.collapsedAfter = collapsedAfter;

  setLineMetadata(
    deletionLine,
    unifiedLineIndex,
    splitLineIndex,
    deletionLineIndex,
    deletionLineNumber,
    deletionNoEOF
  );
  setLineMetadata(
    additionLine,
    unifiedLineIndex,
    splitLineIndex,
    additionLineIndex,
    additionLineNumber,
    additionNoEOF
  );
  target.deletionLine = deletionLine;
  target.additionLine = additionLine;
}

function setRangeLineData({
  target,
  deletionLine,
  additionLine,
  type,
  hunkIndex,
  hunk,
  lineCount,
  deletionLineNumber,
  deletionLineIndex,
  additionLineNumber,
  additionLineIndex,
  deletionUnifiedLineIndex,
  deletionSplitLineIndex,
  additionUnifiedLineIndex,
  additionSplitLineIndex,
}: SetRangeLineDataProps): void {
  target.type = type;
  target.hunkIndex = hunkIndex;
  target.hunk = hunk;
  target.lineCount = lineCount;
  target.collapsedBefore = 0;
  target.collapsedAfter = 0;

  if (
    deletionLineNumber != null &&
    deletionLineIndex != null &&
    deletionUnifiedLineIndex != null &&
    deletionSplitLineIndex != null
  ) {
    setLineMetadata(
      deletionLine,
      deletionUnifiedLineIndex,
      deletionSplitLineIndex,
      deletionLineIndex,
      deletionLineNumber,
      false
    );
    target.deletionLine = deletionLine;
  } else {
    target.deletionLine = undefined;
  }

  if (
    additionLineNumber != null &&
    additionLineIndex != null &&
    additionUnifiedLineIndex != null &&
    additionSplitLineIndex != null
  ) {
    setLineMetadata(
      additionLine,
      additionUnifiedLineIndex,
      additionSplitLineIndex,
      additionLineIndex,
      additionLineNumber,
      false
    );
    target.additionLine = additionLine;
  } else {
    target.additionLine = undefined;
  }
}

function setChangeLineData({
  target,
  deletionLine,
  additionLine,
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
}: GetChangeLineDataProps): void {
  target.type = 'change';
  target.hunkIndex = hunkIndex;
  target.hunk = hunk;
  target.collapsedAfter = collapsedAfter;
  target.collapsedBefore = collapsedBefore;

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

  if (
    deletionLineIndexValue != null &&
    deletionLineNumberValue != null &&
    unifiedDeletionLineIndex != null
  ) {
    setLineMetadata(
      deletionLine,
      unifiedDeletionLineIndex,
      resolvedSplitLineIndex,
      deletionLineIndexValue,
      deletionLineNumberValue,
      noEOFCRDeletion
    );
    target.deletionLine = deletionLine;
  } else {
    target.deletionLine = undefined;
  }

  if (
    additionLineIndexValue != null &&
    additionLineNumberValue != null &&
    unifiedAdditionLineIndex != null
  ) {
    setLineMetadata(
      additionLine,
      unifiedAdditionLineIndex,
      resolvedSplitLineIndex,
      additionLineIndexValue,
      additionLineNumberValue,
      noEOFCRAddition
    );
    target.additionLine = additionLine;
  } else {
    target.additionLine = undefined;
  }

  if (target.deletionLine == null && target.additionLine == null) {
    throw new Error('iterateOverDiff: missing change line data');
  }
}
