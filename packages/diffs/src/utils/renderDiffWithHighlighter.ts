import { diffChars, diffWordsWithSpace } from 'diff';

import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  DiffsHighlighter,
  DiffsThemeNames,
  FileContents,
  FileDiffMetadata,
  ForcePlainTextOptions,
  Hunk,
  LineDiffTypes,
  LineInfo,
  RenderDiffFilesResult,
  RenderDiffOptions,
  SupportedLanguages,
  ThemedDiffResult,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';
import {
  createDiffSpanDecoration,
  pushOrJoinSpan,
} from './parseDiffDecorations';

interface HighlightState {
  finalHunk: Hunk;
  splitCount: number;
  unifiedCount: number;
  shouldBreak(): boolean;
  shouldSkip(unifiedHeight: number, splitHeight: number): boolean;
  incrementCounts(unifiedCount: number, splitCount: number): void;
  isInWindow(unifiedHeight: number, splitHeight: number): boolean;
}

const DEFAULT_PLAIN_TEXT_OPTIONS: ForcePlainTextOptions = {
  forcePlainText: false,
};

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: DiffsHighlighter,
  options: RenderDiffOptions,
  {
    forcePlainText,
    startingLine,
    totalLines,
  }: ForcePlainTextOptions = DEFAULT_PLAIN_TEXT_OPTIONS
): ThemedDiffResult {
  if (forcePlainText) {
    startingLine ??= 0;
    totalLines ??= Infinity;
  } else {
    // If we aren't forcing plain text, then we intentionally do not support
    // ranges for highlighting as that could break the syntax highlighting, we
    // we override any values that may have been passed in.  Maybe one day we
    // warn about this?
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  const baseThemeType = (() => {
    const theme = options.theme ?? DEFAULT_THEMES;
    if (typeof theme === 'string') {
      return highlighter.getTheme(theme).type;
    }
    return undefined;
  })();
  const themeStyles = getHighlighterThemeStyles({
    theme: options.theme,
    highlighter,
  });

  // If we have a large file and we are rendering the WHOLE plain diff ast,
  // then we should remove the lineDiffType to make sure things render quickly.
  // For highlighted ASTs or windowed highlights, we should just inherit the
  // setting
  const lineDiffType =
    forcePlainText &&
    !isWindowedHighlight &&
    (diff.unifiedLineCount > 1000 || diff.splitLineCount > 1000)
      ? 'none'
      : options.lineDiffType;

  const code: RenderDiffFilesResult = {
    deletionLines: [],
    additionLines: [],
  };

  // If we are doing plainText or partial rendering, then we want to render
  // individual hunks separately, and not as a singular file
  // The reason we do it for plain text is because we also want to only
  // HAST-ify the actual lines we need to render and don't over do it (for
  // things like virtualization) since with plain text, grammar doesnt matter
  const hunks = diff.isPartial || forcePlainText ? diff.hunks : [diff.hunks];
  const state: HighlightState = {
    finalHunk: diff.hunks[diff.hunks.length - 1],
    splitCount: 0,
    unifiedCount: 0,
    shouldBreak() {
      return (
        isWindowedHighlight &&
        state.unifiedCount >= startingLine + totalLines &&
        state.splitCount >= startingLine + totalLines
      );
    },
    shouldSkip(unifiedHeight: number, splitHeight: number) {
      return (
        isWindowedHighlight &&
        state.unifiedCount + unifiedHeight < startingLine &&
        state.splitCount + splitHeight < startingLine
      );
    },
    incrementCounts(unifiedValue: number, splitValue: number) {
      state.unifiedCount += unifiedValue;
      state.splitCount += splitValue;
    },
    isInWindow(unifiedHeight: number, splitHeight: number) {
      if (!isWindowedHighlight) {
        return true;
      }
      const unifiedInWindow =
        state.unifiedCount >= startingLine - unifiedHeight &&
        state.unifiedCount < startingLine + totalLines;
      const splitInWindow =
        state.splitCount >= startingLine - splitHeight &&
        state.splitCount < startingLine + totalLines;
      return unifiedInWindow || splitInWindow;
    },
  };

  for (const hunkOrHunks of hunks) {
    // If we are rendering thins at an individual hunk level, lets grab a
    // reference to that hunk
    const hunk = !Array.isArray(hunkOrHunks) ? hunkOrHunks : undefined;
    const hunks = Array.isArray(hunkOrHunks) ? hunkOrHunks : [hunkOrHunks];
    // If we are partial highlighting and out of view, lets stop
    if (hunk != null && state.shouldBreak()) {
      break;
    }
    if (
      hunk != null &&
      state.shouldSkip(hunk.unifiedLineCount, hunk.splitLineCount)
    ) {
      state.incrementCounts(hunk.unifiedLineCount, hunk.splitLineCount);
      continue;
    }
    // FIXME(amadeus): Lets maybe just make this 2 objects instead of creating
    // so many confusing variables
    const {
      deletionContent,
      additionContent,
      deletionInfo,
      additionInfo,
      deletionDecorations,
      additionDecorations,
      deletionSegments,
      additionSegments,
    } = processHunks({
      hunks,
      lineDiffType,
      deletionLines: diff.deletionLines,
      additionLines: diff.additionLines,
      isPartial: diff.isPartial,
      startingLine,
      totalLines,
      state,
    });
    const deletionFile = {
      name: diff.prevName ?? diff.name,
      contents: deletionContent,
    };
    const additionFile = {
      name: diff.name,
      contents: additionContent,
    };
    const { deletionLines, additionLines } = renderTwoFiles({
      deletionFile,
      deletionInfo,
      deletionDecorations,

      additionFile,
      additionInfo,
      additionDecorations,

      highlighter,
      options,
      languageOverride: forcePlainText ? 'text' : diff.lang,
    });

    if (forcePlainText || hunk != null) {
      // FIXME(amadeus): Maybe there's an opportunity to clean up this AI slop?
      // Viewport highlighting, populate a sparse array of lines
      if (deletionSegments.length > 0) {
        for (const seg of deletionSegments) {
          // Lol we probably don't need to do this?
          const nodes = deletionLines.slice(
            seg.originalOffset,
            seg.originalOffset + seg.count
          );
          for (let i = 0; i < nodes.length; i++) {
            code.deletionLines[seg.targetIndex + i] = nodes[i];
          }
        }
      } else {
        code.deletionLines.push(...deletionLines);
      }
      // Viewport highlighting, populate a sparse array of lines
      if (additionSegments.length > 0) {
        for (const segment of additionSegments) {
          // Lol we probably don't need to do this?
          const nodes = additionLines.slice(
            segment.originalOffset,
            segment.originalOffset + segment.count
          );
          for (let i = 0; i < nodes.length; i++) {
            code.additionLines[segment.targetIndex + i] = nodes[i];
          }
        }
      } else {
        code.additionLines.push(...additionLines);
      }
    } else {
      code.deletionLines = deletionLines;
      code.additionLines = additionLines;
    }
  }

  return { code, themeStyles, baseThemeType };
}

interface ProcessLineDiffProps {
  deletionLine: string | undefined;
  additionLine: string | undefined;
  deletionLineIndex: number;
  additionLineIndex: number;
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  lineDiffType: LineDiffTypes;
}

function computeLineDiffDecorations({
  deletionLine,
  additionLine,
  deletionLineIndex,
  additionLineIndex,
  deletionDecorations,
  additionDecorations,
  lineDiffType,
}: ProcessLineDiffProps) {
  if (deletionLine == null || additionLine == null || lineDiffType === 'none') {
    return;
  }
  deletionLine = cleanLastNewline(deletionLine);
  additionLine = cleanLastNewline(additionLine);
  // NOTE(amadeus): Because we visually trim trailing newlines when rendering,
  // we also gotta make sure the diff parsing doesn't include the newline
  // character that could be there...
  const lineDiff =
    lineDiffType === 'char'
      ? diffChars(deletionLine, additionLine)
      : diffWordsWithSpace(deletionLine, additionLine);
  const deletionSpans: [0 | 1, string][] = [];
  const additionSpans: [0 | 1, string][] = [];
  const enableJoin = lineDiffType === 'word-alt';
  for (const item of lineDiff) {
    const isLastItem = item === lineDiff[lineDiff.length - 1];
    if (!item.added && !item.removed) {
      pushOrJoinSpan({
        item,
        arr: deletionSpans,
        enableJoin,
        isNeutral: true,
        isLastItem,
      });
      pushOrJoinSpan({
        item,
        arr: additionSpans,
        enableJoin,
        isNeutral: true,
        isLastItem,
      });
    } else if (item.removed) {
      pushOrJoinSpan({ item, arr: deletionSpans, enableJoin, isLastItem });
    } else {
      pushOrJoinSpan({ item, arr: additionSpans, enableJoin, isLastItem });
    }
  }
  let spanIndex = 0;
  for (const span of deletionSpans) {
    if (span[0] === 1) {
      deletionDecorations.push(
        createDiffSpanDecoration({
          line: deletionLineIndex,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
  spanIndex = 0;
  for (const span of additionSpans) {
    if (span[0] === 1) {
      additionDecorations.push(
        createDiffSpanDecoration({
          line: additionLineIndex,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
}

interface HighlightSegment {
  // The where the highlighted region starts
  originalOffset: number;
  // Where to place the highlighted line in RenderDiffFilesResult
  targetIndex: number;
  // Number of highlighted lines
  count: number;
}

interface ProcessHunksProps {
  hunks: Hunk[];
  deletionLines: string[];
  additionLines: string[];
  lineDiffType: LineDiffTypes;
  isPartial: boolean;
  startingLine: number;
  totalLines: number;
  state: HighlightState;
}

interface ProcessHunksReturn {
  deletionContent: string;
  additionContent: string;
  deletionInfo: (LineInfo | undefined)[];
  additionInfo: (LineInfo | undefined)[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  deletionSegments: HighlightSegment[];
  additionSegments: HighlightSegment[];
}

function processHunks({
  hunks,
  deletionLines,
  additionLines,
  lineDiffType,
  isPartial,
  startingLine,
  totalLines,
  state,
}: ProcessHunksProps): ProcessHunksReturn {
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  const deletionInfo: (LineInfo | undefined)[] = [];
  const additionInfo: (LineInfo | undefined)[] = [];
  const deletionDecorations: DecorationItem[] = [];
  const additionDecorations: DecorationItem[] = [];
  const deletionContent: string[] = [];
  const additionContent: string[] = [];
  const deletionSegments: HighlightSegment[] = [];
  const additionSegments: HighlightSegment[] = [];
  let currentDeletionSegment: HighlightSegment | undefined;
  let currentAdditionSegment: HighlightSegment | undefined;

  hunkIterator: for (const hunk of hunks) {
    // Check if we've rendered enough lines in
    // Yeet out of we are passed the required render range for partials
    if (state.shouldBreak()) {
      break hunkIterator;
    }

    // Skip hunks that are entirely before the viewport
    // NOTE(amadeus): Right now we do not support expanded regions in
    // partial rendering, something that I will need to think about how to pass
    // that data down to the highlighter
    if (
      state.shouldSkip(hunk.unifiedLineCount, hunk.splitLineCount) ||
      !state.isInWindow(hunk.unifiedLineCount, hunk.splitLineCount)
    ) {
      state.incrementCounts(hunk.unifiedLineCount, hunk.splitLineCount);
      continue;
    }

    // If there's content prior to the hunk in a non-partial diff,
    // lets fill it up
    if (!isPartial && !isWindowedHighlight) {
      let unifiedLineIndex = hunk.unifiedLineStart - hunk.collapsedBefore;
      let splitLineIndex = hunk.splitLineStart - hunk.collapsedBefore;
      let deletionLineNumber = hunk.deletionStart - hunk.collapsedBefore;
      let additionLineNumber = hunk.additionStart - hunk.collapsedBefore;
      let index = 0;
      // FIXME(amadeus): When supporting expansion, we'll also need to figure
      // out how to skip lines if appropriate
      for (; index < hunk.collapsedBefore; index++) {
        if (state.shouldBreak()) {
          break hunkIterator;
        }
        deletionInfo.push({
          type: 'context-expanded',
          lineNumber: deletionLineNumber,
          altLineNumber: additionLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        });
        additionInfo.push({
          type: 'context-expanded',
          lineNumber: additionLineNumber,
          altLineNumber: deletionLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        });
        deletionContent.push(
          deletionLines[hunk.deletionLineIndex - hunk.collapsedBefore + index]
        );
        additionContent.push(
          additionLines[hunk.additionLineIndex - hunk.collapsedBefore + index]
        );
        deletionLineNumber++;
        additionLineNumber++;
        splitLineIndex++;
        unifiedLineIndex++;
        // NOTE(amadeus): Expansion isn't supported with windowed rendering at
        // the moment... so we don't increment state
        // state.incrementCounts(1, 1);
      }
    }

    let {
      unifiedLineStart: unifiedLineIndex,
      splitLineStart: splitLineIndex,
      deletionStart: deletionLineNumber,
      additionStart: additionLineNumber,
    } = hunk;

    // Lets process the actual hunk content
    for (const hunkContent of hunk.hunkContent) {
      if (state.shouldBreak()) {
        break hunkIterator;
      }
      if (hunkContent.type === 'context') {
        let index = 0;
        // If we are not in a valid render window, lets go ahead and skip
        if (!state.isInWindow(hunkContent.lines, hunkContent.lines)) {
          additionLineNumber += hunkContent.lines;
          deletionLineNumber += hunkContent.lines;
          splitLineIndex += hunkContent.lines;
          unifiedLineIndex += hunkContent.lines;
          state.incrementCounts(hunkContent.lines, hunkContent.lines);
          continue;
        }
        // If we don't need to process the first line, lets start off at the
        // first required line to highlight. This can help prevent large
        // iteration costs over large hunkContent regions
        else {
          const linesToSkip = Math.min(
            hunkContent.lines,
            startingLine - unifiedLineIndex,
            startingLine - splitLineIndex
          );
          if (linesToSkip > 0) {
            additionLineNumber += linesToSkip;
            deletionLineNumber += linesToSkip;
            splitLineIndex += linesToSkip;
            unifiedLineIndex += linesToSkip;
            state.incrementCounts(linesToSkip, linesToSkip);
            index += linesToSkip;
          }
        }

        for (; index < hunkContent.lines; index++) {
          if (state.shouldBreak()) {
            break hunkIterator;
          }

          // FIXME(amadeus): Rework this absolute slop...
          // Build segments for viewport rendering
          const deletionLineIndex = hunkContent.deletionLineIndex + index;
          const additionLineIndex = hunkContent.additionLineIndex + index;

          // Check if contiguous with current segment
          const isDeletionContiguous =
            currentDeletionSegment != null &&
            deletionLineIndex ===
              currentDeletionSegment.targetIndex + currentDeletionSegment.count;
          const isAdditionContiguous =
            currentAdditionSegment != null &&
            additionLineIndex ===
              currentAdditionSegment.targetIndex + currentAdditionSegment.count;

          // Start new deletion segment if not contiguous
          if (isWindowedHighlight === true && isDeletionContiguous === false) {
            if (currentDeletionSegment != null) {
              deletionSegments.push(currentDeletionSegment);
            }
            currentDeletionSegment = {
              targetIndex: deletionLineIndex,
              originalOffset: deletionContent.length,
              count: 0,
            };
          }

          // FIXME(amadeus): Rework this absolute slop...
          // Start new addition segment if not contiguous
          if (isWindowedHighlight === true && isAdditionContiguous === false) {
            if (currentAdditionSegment != null) {
              additionSegments.push(currentAdditionSegment);
            }
            currentAdditionSegment = {
              targetIndex: additionLineIndex,
              originalOffset: additionContent.length,
              count: 0,
            };
          }

          // FIXME(amadeus): Rework this absolute slop...
          // Expand segments
          if (isWindowedHighlight === true) {
            // lol no -- fix the use of !
            currentDeletionSegment!.count++;
            currentAdditionSegment!.count++;
          }

          deletionInfo.push({
            type: 'context',
            lineNumber: deletionLineNumber,
            altLineNumber: additionLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          });
          additionInfo.push({
            type: 'context',
            lineNumber: additionLineNumber,
            altLineNumber: deletionLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          });
          deletionContent.push(
            deletionLines[hunkContent.deletionLineIndex + index]
          );
          additionContent.push(
            additionLines[hunkContent.additionLineIndex + index]
          );
          additionLineNumber++;
          deletionLineNumber++;
          splitLineIndex++;
          unifiedLineIndex++;
          state.incrementCounts(1, 1);
        }
      } else if (startingLine > 0 || totalLines < Infinity) {
        const splitCount = Math.max(
          hunkContent.additions,
          hunkContent.deletions
        );
        const unifiedCount = hunkContent.deletions + hunkContent.additions;
        if (!state.isInWindow(unifiedCount, splitCount)) {
          deletionLineNumber += hunkContent.deletions;
          additionLineNumber += hunkContent.additions;
          splitLineIndex += splitCount;
          unifiedLineIndex += unifiedCount;
          state.incrementCounts(unifiedCount, splitCount);
          continue;
        }

        // === PHASE 1: Calculate visible ranges ===
        const viewportStart = startingLine;
        const viewportEnd = startingLine + totalLines;

        // Calculate visible deletion indices
        let deletionStartIdx: number | undefined;
        let deletionEndIdx: number | undefined;

        // Check unified view deletions
        const unifiedDeletionStart = state.unifiedCount;
        const unifiedDeletionEnd = state.unifiedCount + hunkContent.deletions;
        if (
          unifiedDeletionEnd > viewportStart &&
          unifiedDeletionStart < viewportEnd
        ) {
          const visibleStart = Math.max(
            0,
            viewportStart - unifiedDeletionStart
          );

          const visibleEnd = Math.min(
            hunkContent.deletions,
            viewportEnd - unifiedDeletionStart
          );
          deletionStartIdx = visibleStart;
          deletionEndIdx = visibleEnd;
        }

        // Check split view deletions
        const splitDeletionStart = state.splitCount;
        const splitDeletionEnd = state.splitCount + hunkContent.deletions;
        if (
          splitDeletionEnd > viewportStart &&
          splitDeletionStart < viewportEnd
        ) {
          const visibleStart = Math.max(0, viewportStart - splitDeletionStart);
          const visibleEnd = Math.min(
            hunkContent.deletions,
            viewportEnd - splitDeletionStart
          );

          // Merge with unified range (union)
          if (deletionStartIdx == null || deletionEndIdx == null) {
            deletionStartIdx = visibleStart;
            deletionEndIdx = visibleEnd;
          } else {
            deletionStartIdx = Math.min(deletionStartIdx, visibleStart);
            deletionEndIdx = Math.max(deletionEndIdx, visibleEnd);
          }
        }

        // Calculate visible addition indices
        let additionStartIdx: number | undefined;
        let additionEndIdx: number | undefined;

        // Check unified view additions
        const unifiedAdditionStart = state.unifiedCount + hunkContent.deletions;
        const unifiedAdditionEnd =
          state.unifiedCount + hunkContent.deletions + hunkContent.additions;
        if (
          unifiedAdditionEnd > viewportStart &&
          unifiedAdditionStart < viewportEnd
        ) {
          const visibleStart = Math.max(
            0,
            viewportStart - unifiedAdditionStart
          );
          const visibleEnd = Math.min(
            hunkContent.additions,
            viewportEnd - unifiedAdditionStart
          );
          additionStartIdx = visibleStart;
          additionEndIdx = visibleEnd;
        }

        // Check split view additions
        const splitAdditionStart = state.splitCount;
        const splitAdditionEnd = state.splitCount + hunkContent.additions;
        if (
          splitAdditionEnd > viewportStart &&
          splitAdditionStart < viewportEnd
        ) {
          const visibleStart = Math.max(0, viewportStart - splitAdditionStart);
          const visibleEnd = Math.min(
            hunkContent.additions,
            viewportEnd - splitAdditionStart
          );

          // Merge with unified range (union)
          if (additionStartIdx == null) {
            additionStartIdx = visibleStart;
            additionEndIdx = visibleEnd;
          } else {
            additionStartIdx = Math.min(additionStartIdx, visibleStart);
            additionEndIdx = Math.max(additionEndIdx!, visibleEnd);
          }
        }

        // FIXME(amadeus): Theoretically this shouldn't be possible since we
        // did region visibility checks higher up. Might be worth throwing an
        // error in here to see if we ever hit it
        // === PHASE 2: Early exit if nothing visible ===
        if (deletionStartIdx == null && additionStartIdx == null) {
          // Nothing visible, just advance counters
          splitLineIndex += splitCount;
          unifiedLineIndex += unifiedCount;
          state.incrementCounts(unifiedCount, splitCount);
          deletionLineNumber += hunkContent.deletions;
          additionLineNumber += hunkContent.additions;
          continue;
        }

        // FIXME(amadeus): Also unclear of we still need any of this...
        // Set ranges to end if undefined (means not visible)
        deletionStartIdx ??= hunkContent.deletions;
        deletionEndIdx ??= hunkContent.deletions;
        additionStartIdx ??= hunkContent.additions;
        additionEndIdx ??= hunkContent.additions;

        // === PHASE 3: Iterate through visible lines ===
        const len = Math.max(deletionEndIdx, additionEndIdx);
        let _unifiedLineIndex = unifiedLineIndex;
        let _splitLineIndex = splitLineIndex;

        // Optimization: skip to first visible index
        // Only use indices that have actual content (not sentinel values)
        let index = Math.min(
          deletionStartIdx < hunkContent.deletions
            ? deletionStartIdx
            : Infinity,
          additionStartIdx < hunkContent.additions ? additionStartIdx : Infinity
        );
        // FIXME(amadeus): Also probably not needed due to windowing checks
        // above...
        if (index === Infinity) {
          deletionLineNumber += hunkContent.deletions;
          additionLineNumber += hunkContent.additions;
          // Nothing visible at all, skip this hunk
          unifiedLineIndex += unifiedCount;
          splitLineIndex += splitCount;
          state.incrementCounts(unifiedCount, splitCount);
          continue;
        }
        if (index > 0) {
          const skippedDeletions = Math.min(index, hunkContent.deletions);
          const skippedAdditions = Math.min(index, hunkContent.additions);

          deletionLineNumber += skippedDeletions;
          additionLineNumber += skippedAdditions;
          _splitLineIndex += index;
          _unifiedLineIndex += index;
        }

        for (; index < len; index++) {
          // Get lines only if they exist and are visible
          const deletionLine =
            index < hunkContent.deletions
              ? deletionLines[hunkContent.deletionLineIndex + index]
              : undefined;
          const additionLine =
            index < hunkContent.additions
              ? additionLines[hunkContent.additionLineIndex + index]
              : undefined;

          // Only compute diff decorations if BOTH lines are visible
          if (deletionLine == null && additionLine == null) {
            // FIXME(amadeus): Lets make this a proper error message
            throw new Error('We should never be in here');
          }

          computeLineDiffDecorations({
            additionLine,
            deletionLine,
            deletionLineIndex: deletionContent.length,
            additionLineIndex: additionContent.length,
            deletionDecorations,
            additionDecorations,
            lineDiffType,
          });

          // Process deletion if visible
          if (deletionLine != null) {
            // FIXME(amadeus): Fix this absolutely horrendous slop
            // Build segment for deletion
            const deletionLineIndex = hunkContent.deletionLineIndex + index;
            const isDeletionContiguous =
              currentDeletionSegment != null &&
              deletionLineIndex ===
                currentDeletionSegment.targetIndex +
                  currentDeletionSegment.count;

            if (
              isWindowedHighlight === true &&
              isDeletionContiguous === false
            ) {
              if (currentDeletionSegment != null) {
                deletionSegments.push(currentDeletionSegment);
              }
              currentDeletionSegment = {
                targetIndex: deletionLineIndex,
                originalOffset: deletionContent.length,
                count: 0,
              };
            }
            if (isWindowedHighlight === true) currentDeletionSegment!.count++;

            deletionInfo.push({
              type: 'change-deletion',
              lineNumber: deletionLineNumber,
              lineIndex: `${_unifiedLineIndex},${_splitLineIndex}`,
            });
            deletionLineNumber++;
            deletionContent.push(deletionLine);
          }

          // Process addition if visible
          if (additionLine != null) {
            // FIXME(amadeus): Fix this absolutely horrendous slop
            // Build segment for addition
            const additionLineIndex = hunkContent.additionLineIndex + index;
            const isAdditionContiguous =
              currentAdditionSegment != null &&
              additionLineIndex ===
                currentAdditionSegment.targetIndex +
                  currentAdditionSegment.count;

            if (
              isWindowedHighlight === true &&
              isAdditionContiguous === false
            ) {
              if (currentAdditionSegment != null) {
                additionSegments.push(currentAdditionSegment);
              }
              currentAdditionSegment = {
                targetIndex: additionLineIndex,
                originalOffset: additionContent.length,
                count: 0,
              };
            }
            if (isWindowedHighlight === true) currentAdditionSegment!.count++;

            additionInfo.push({
              type: 'change-addition',
              lineNumber: additionLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions},${_splitLineIndex}`,
            });
            additionLineNumber++;
            additionContent.push(additionLine);
          }

          _splitLineIndex++;
          _unifiedLineIndex++;
        }

        splitLineIndex += splitCount;
        unifiedLineIndex += unifiedCount;
        state.incrementCounts(unifiedCount, splitCount);
      }
      // FIXME(amadeus): Ideally this actually goes away completely, and we can
      // make sure to support window and non-windowed with the above else
      // statement. I just need to spend time cleaning up the slop before doing
      // so
      else {
        const len = Math.max(hunkContent.additions, hunkContent.deletions);
        let index = 0;
        // NOTE(amadeus): Since we iterate through deletions and additions
        // simultaneously, we have to create a secondary iterator for
        // unifiedLineIndex, and then when we're done, add the combined lengths
        // of additions/deletions to the main variable
        //
        // NOTE(amadeus): Can i remove this variable completely and just depend
        // on unifiedLineIndex and i and hunkContent.deletions?
        let _unifiedLineIndex = unifiedLineIndex;
        let _splitLineIndex = splitLineIndex;
        for (; index < len; index++) {
          if (state.shouldBreak()) {
            break hunkIterator;
          }
          const deletionLine =
            index < hunkContent.deletions
              ? deletionLines[hunkContent.deletionLineIndex + index]
              : undefined;
          const additionLine =
            index < hunkContent.additions
              ? additionLines[hunkContent.additionLineIndex + index]
              : undefined;
          computeLineDiffDecorations({
            additionLine,
            deletionLine,
            deletionLineIndex: deletionContent.length,
            additionLineIndex: additionContent.length,
            deletionDecorations,
            additionDecorations,
            lineDiffType,
          });
          if (deletionLine != null) {
            deletionInfo.push({
              type: 'change-deletion',
              lineNumber: deletionLineNumber,
              lineIndex: `${_unifiedLineIndex},${_splitLineIndex}`,
            });
            deletionContent.push(deletionLine);
            deletionLineNumber++;
          }
          if (additionLine != null) {
            additionInfo.push({
              type: 'change-addition',
              lineNumber: additionLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions},${_splitLineIndex}`,
            });
            additionContent.push(additionLine);
            additionLineNumber++;
          }

          _splitLineIndex++;
          _unifiedLineIndex++;
        }
        const unifiedCount = hunkContent.additions + hunkContent.deletions;
        const splitCount = Math.max(
          hunkContent.deletions,
          hunkContent.additions
        );
        unifiedLineIndex += unifiedCount;
        splitLineIndex += splitCount;
        state.incrementCounts(unifiedCount, splitCount);
      }
    }

    // FIXME(amadeus): Right now we do not support expanded regions in
    // windowed highlighting, something that I will need to think about more
    if (isPartial || isWindowedHighlight || hunk !== state.finalHunk) continue;

    // If we are on the last hunk, we should fully iterate through the rest
    // of the lines
    let additionLineIndex = hunk.additionLineIndex + hunk.additionCount;
    let deletionLineIndex = hunk.deletionLineIndex + hunk.deletionCount;
    while (
      additionLineIndex < additionLines.length &&
      deletionLineIndex < deletionLines.length
    ) {
      if (state.shouldBreak()) {
        break;
      }
      deletionContent.push(deletionLines[deletionLineIndex]);
      deletionLineIndex++;
      deletionInfo.push({
        type: 'context-expanded',
        lineNumber: deletionLineNumber,
        altLineNumber: additionLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      });
      deletionLineNumber++;

      additionContent.push(additionLines[additionLineIndex]);
      additionLineIndex++;
      additionInfo.push({
        type: 'context-expanded',
        lineNumber: additionLineNumber,
        altLineNumber: deletionLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      });
      additionLineNumber++;

      // FIXME(amadeus): Expansion isn't supported with windowed rendering at the moment
      state.incrementCounts(1, 1);
      splitLineIndex++;
      unifiedLineIndex++;
    }
  }

  // This is absolute AI slop... so we should negate the need for this
  // Close any remaining segments
  if (isWindowedHighlight === true && currentDeletionSegment != null) {
    deletionSegments.push(currentDeletionSegment);
    currentDeletionSegment = undefined;
  }
  if (isWindowedHighlight === true && currentAdditionSegment != null) {
    additionSegments.push(currentAdditionSegment);
    currentAdditionSegment = undefined;
  }

  return {
    // FIXME(amadeus): As a performance improvement, i should probably make
    // functions that we use to append content that can also locally track line
    // indexes instead of requiring a second iteration for join
    deletionContent: deletionContent.join(''),
    additionContent: additionContent.join(''),
    deletionInfo,
    additionInfo,
    deletionDecorations,
    additionDecorations,
    deletionSegments,
    additionSegments,
  };
}

interface RenderTwoFilesProps {
  deletionFile: FileContents;
  additionFile: FileContents;
  deletionInfo: (LineInfo | undefined)[];
  additionInfo: (LineInfo | undefined)[];
  deletionDecorations: DecorationItem[];
  additionDecorations: DecorationItem[];
  options: RenderDiffOptions;
  highlighter: DiffsHighlighter;
  languageOverride: SupportedLanguages | undefined;
}

function renderTwoFiles({
  deletionFile,
  additionFile,
  deletionInfo,
  additionInfo,
  highlighter,
  deletionDecorations,
  additionDecorations,
  languageOverride,
  options: { theme: themeOrThemes = DEFAULT_THEMES, ...options },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const deletionLang =
    languageOverride ?? getFiletypeFromFileName(deletionFile.name);
  const additionLang =
    languageOverride ?? getFiletypeFromFileName(additionFile.name);
  const { state, transformers } = createTransformerWithState();
  const hastConfig: CodeToHastOptions<DiffsThemeNames> = (() => {
    return typeof themeOrThemes === 'string'
      ? {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          theme: themeOrThemes,
          transformers,
          decorations: undefined,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix(),
        }
      : {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          themes: themeOrThemes,
          transformers,
          decorations: undefined,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix(),
        };
  })();

  const deletionLines = (() => {
    if (deletionFile.contents === '') {
      return [];
    }
    hastConfig.lang = deletionLang;
    state.lineInfo = deletionInfo;
    hastConfig.decorations = deletionDecorations;
    return getLineNodes(
      highlighter.codeToHast(
        cleanLastNewline(deletionFile.contents),
        hastConfig
      )
    );
  })();
  const additionLines = (() => {
    if (additionFile.contents === '') {
      return [];
    }
    hastConfig.lang = additionLang;
    hastConfig.decorations = additionDecorations;
    state.lineInfo = additionInfo;
    return getLineNodes(
      highlighter.codeToHast(
        cleanLastNewline(additionFile.contents),
        hastConfig
      )
    );
  })();

  return { deletionLines, additionLines };
}
