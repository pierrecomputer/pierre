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
  const lastItem = lineDiff.at(-1);
  for (const item of lineDiff) {
    const isLastItem = item === lastItem;
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

interface FakeArrayType {
  push(value: string): void;
  value: string;
  length: number;
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
  // NOTE(amadeus): Using these fake array data structures for content as an
  // optmization to keep loop iterations to a minimum.  Basically if we use an
  // array, then we have to run a `.join('')` on return which adds _yet
  // another_ iteration which can be costly in large files. And since we
  // already have to loop through all the lines onces, lets combine all this
  // logic together
  const deletionContent: FakeArrayType = {
    push(value: string) {
      this.value += value;
      this.length++;
    },
    value: '',
    length: 0,
  };
  const additionContent: FakeArrayType = {
    push(value: string) {
      this.value += value;
      this.length++;
    },
    value: '',
    length: 0,
  };
  const deletionSegments: HighlightSegment[] = [];
  const additionSegments: HighlightSegment[] = [];
  function appendContent(
    lineContent: string,
    lineIndex: number,
    segments: HighlightSegment[],
    contentWrapper: FakeArrayType
  ) {
    if (isWindowedHighlight) {
      // Grab the last segment off the end and check if it's contiguous or not
      let segment = segments.at(-1);
      if (
        segment == null ||
        segment.targetIndex + segment.count !== lineIndex
      ) {
        segment = {
          targetIndex: lineIndex,
          originalOffset: contentWrapper.length,
          count: 0,
        };
        segments.push(segment);
      }
      segment.count++;
    }
    contentWrapper.push(lineContent);
  }

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
        const deletionLineIndex =
          hunk.deletionLineIndex - hunk.collapsedBefore + index;
        appendContent(
          deletionLines[deletionLineIndex],
          deletionLineIndex,
          deletionSegments,
          deletionContent
        );
        const additionLineIndex =
          hunk.additionLineIndex - hunk.collapsedBefore + index;
        appendContent(
          additionLines[additionLineIndex],
          additionLineIndex,
          additionSegments,
          additionContent
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

          const deletionLineIndex = hunkContent.deletionLineIndex + index;
          appendContent(
            deletionLines[deletionLineIndex],
            deletionLineIndex,
            deletionSegments,
            deletionContent
          );
          const additionLineIndex = hunkContent.additionLineIndex + index;
          appendContent(
            additionLines[additionLineIndex],
            additionLineIndex,
            additionSegments,
            additionContent
          );
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
          additionLineNumber++;
          deletionLineNumber++;
          splitLineIndex++;
          unifiedLineIndex++;
          state.incrementCounts(1, 1);
        }
      } else {
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
        let additionStartIdx: number | undefined;
        let additionEndIdx: number | undefined;

        const calculateRegionIndexes = (
          start: number,
          end: number,
          type: 'deletions' | 'additions'
        ) => {
          if (end > viewportStart && start < viewportEnd) {
            const visibleStart = Math.max(0, viewportStart - start);
            const visibleEnd = Math.min(
              type === 'deletions'
                ? hunkContent.deletions
                : hunkContent.additions,
              viewportEnd - start
            );
            if (type === 'deletions') {
              deletionStartIdx = Math.min(
                deletionStartIdx ?? Infinity,
                visibleStart
              );
              deletionEndIdx = Math.max(deletionEndIdx ?? 0, visibleEnd);
            } else {
              additionStartIdx = Math.min(
                additionStartIdx ?? Infinity,
                visibleStart
              );
              additionEndIdx = Math.max(additionEndIdx ?? 0, visibleEnd);
            }
          }
        };

        calculateRegionIndexes(
          state.unifiedCount,
          state.unifiedCount + hunkContent.deletions,
          'deletions'
        );
        calculateRegionIndexes(
          state.splitCount,
          state.splitCount + hunkContent.deletions,
          'deletions'
        );
        calculateRegionIndexes(
          state.unifiedCount + hunkContent.deletions,
          state.unifiedCount + hunkContent.deletions + hunkContent.additions,
          'additions'
        );
        calculateRegionIndexes(
          state.splitCount,
          state.splitCount + hunkContent.additions,
          'additions'
        );

        if (deletionStartIdx == null && additionStartIdx == null) {
          // Nothing visible, just advance counters
          splitLineIndex += splitCount;
          unifiedLineIndex += unifiedCount;
          state.incrementCounts(unifiedCount, splitCount);
          deletionLineNumber += hunkContent.deletions;
          additionLineNumber += hunkContent.additions;
          continue;
        }

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

        if (index === Infinity) {
          // Nothing visible at all, skip this hunk.  I don't think it should
          // ever be possible to to logically get in here, however just in case...
          deletionLineNumber += hunkContent.deletions;
          additionLineNumber += hunkContent.additions;
          unifiedLineIndex += unifiedCount;
          splitLineIndex += splitCount;
          state.incrementCounts(unifiedCount, splitCount);
          continue;
        }

        // If we can skip some lines of this current hunkContent, lets go ahead
        // and increment counters as necessary
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
            throw new Error(
              'processHunks: a serious windowing error has occured and we do not have a proper addition or deletion line to work with'
            );
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
            const deletionLineIndex = hunkContent.deletionLineIndex + index;
            appendContent(
              deletionLine,
              deletionLineIndex,
              deletionSegments,
              deletionContent
            );
            deletionInfo.push({
              type: 'change-deletion',
              lineNumber: deletionLineNumber,
              lineIndex: `${_unifiedLineIndex},${_splitLineIndex}`,
            });
            deletionLineNumber++;
          }

          // Process addition if visible
          if (additionLine != null) {
            const additionLineIndex = hunkContent.additionLineIndex + index;
            appendContent(
              additionLine,
              additionLineIndex,
              additionSegments,
              additionContent
            );
            additionInfo.push({
              type: 'change-addition',
              lineNumber: additionLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions},${_splitLineIndex}`,
            });
            additionLineNumber++;
          }

          _splitLineIndex++;
          _unifiedLineIndex++;
        }

        splitLineIndex += splitCount;
        unifiedLineIndex += unifiedCount;
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
      appendContent(
        deletionLines[deletionLineIndex],
        deletionLineIndex,
        deletionSegments,
        deletionContent
      );
      deletionLineIndex++;
      deletionInfo.push({
        type: 'context-expanded',
        lineNumber: deletionLineNumber,
        altLineNumber: additionLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      });
      deletionLineNumber++;

      appendContent(
        additionLines[additionLineIndex],
        additionLineIndex,
        additionSegments,
        additionContent
      );
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

  return {
    deletionContent: deletionContent.value,
    additionContent: additionContent.value,
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
