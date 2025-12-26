import { diffChars, diffWordsWithSpace } from 'diff';

import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  DiffsHighlighter,
  DiffsThemeNames,
  FileContents,
  FileDiffMetadata,
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

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: DiffsHighlighter,
  options: RenderDiffOptions,
  forcePlainText = false
): ThemedDiffResult {
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
  // If we have a large file and we are rendering the plain diff ast, then we
  // should remove the lineDiffType to make sure things render quickly
  const lineDiffType =
    forcePlainText &&
    // Think about this max line count thing... is 1000 right?
    (diff.unifiedLineCount > 1000 || diff.splitLineCount > 1000)
      ? 'none'
      : options.lineDiffType;

  const code: RenderDiffFilesResult = {
    oldLines: [],
    newLines: [],
  };
  let splitLineIndex = 0;
  let unifiedLineIndex = 0;
  for (const hunkOrHunks of diff.isPartial ? diff.hunks : [diff.hunks]) {
    const hunk = !Array.isArray(hunkOrHunks) ? hunkOrHunks : undefined;
    splitLineIndex += hunk?.collapsedBefore ?? 0;
    unifiedLineIndex += hunk?.collapsedBefore ?? 0;
    const hunks = Array.isArray(hunkOrHunks) ? hunkOrHunks : [hunkOrHunks];
    const {
      oldContent,
      newContent,
      oldInfo,
      newInfo,
      oldDecorations,
      newDecorations,
      splitLineIndex: newSplitLineIndex,
      unifiedLineIndex: newUnifiedLineIndex,
    } = processLines({
      hunks,
      splitLineIndex,
      unifiedLineIndex,
      lineDiffType,
      // If we are dealing with a partial diff, highlight each hunk
      // individually, it's not safe to do them all as 1 long highlight due to
      // impartial code snippets bumping into each other
      deletionLines:
        hunk != null
          ? diff.deletionLines.slice(
              hunk.deletionLineIndex,
              hunk.deletionLineIndex + hunk.deletionCount
            )
          : diff.deletionLines,
      additionLines:
        hunk != null
          ? diff.additionLines.slice(
              hunk.additionLineIndex,
              hunk.additionLineIndex + hunk.additionCount
            )
          : diff.additionLines,
      isPartial: hunk != null,
    });
    const oldFile = {
      name: diff.prevName ?? diff.name,
      contents: oldContent,
    };
    const newFile = {
      name: diff.name,
      contents: newContent,
    };
    const { oldLines, newLines } = renderTwoFiles({
      oldFile,
      oldInfo,
      oldDecorations,

      newFile,
      newInfo,
      newDecorations,

      highlighter,
      options,
      languageOverride: forcePlainText ? 'text' : diff.lang,
    });

    if (hunk != null) {
      code.oldLines.push(...oldLines);
      code.newLines.push(...newLines);
      splitLineIndex = newSplitLineIndex;
      unifiedLineIndex = newUnifiedLineIndex;
    } else {
      code.oldLines = oldLines;
      code.newLines = newLines;
    }
  }

  return { code, themeStyles, baseThemeType };
}

interface ProcessLineDiffProps {
  oldLine: string | undefined;
  newLine: string | undefined;
  oldLineIndex: number;
  newLineIndex: number;
  oldDecorations: DecorationItem[];
  newDecorations: DecorationItem[];
  lineDiffType: LineDiffTypes;
}

function computeLineDiffDecorations({
  oldLine,
  newLine,
  oldLineIndex,
  newLineIndex,
  oldDecorations,
  newDecorations,
  lineDiffType,
}: ProcessLineDiffProps) {
  if (oldLine == null || newLine == null || lineDiffType === 'none') {
    return;
  }
  oldLine = cleanLastNewline(oldLine);
  newLine = cleanLastNewline(newLine);
  // NOTE(amadeus): Because we visually trim trailing newlines when rendering,
  // we also gotta make sure the diff parsing doesn't include the newline
  // character that could be there...
  const lineDiff =
    lineDiffType === 'char'
      ? diffChars(oldLine, newLine)
      : diffWordsWithSpace(oldLine, newLine);
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
      oldDecorations.push(
        createDiffSpanDecoration({
          // Decoration indexes start at 0
          line: oldLineIndex - 1,
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
      newDecorations.push(
        createDiffSpanDecoration({
          // Decoration indexes start at 0
          line: newLineIndex - 1,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
}

interface ProcessLinesProps {
  hunks: Hunk[];
  deletionLines: string[];
  additionLines: string[];
  splitLineIndex: number;
  unifiedLineIndex: number;
  lineDiffType: LineDiffTypes;
  isPartial: boolean;
}

function processLines({
  hunks,
  deletionLines,
  additionLines,
  splitLineIndex = 0,
  unifiedLineIndex = 0,
  lineDiffType,
  isPartial,
}: ProcessLinesProps) {
  const oldInfo: Record<number, LineInfo | undefined> = {};
  const newInfo: Record<number, LineInfo | undefined> = {};
  const oldDecorations: DecorationItem[] = [];
  const newDecorations: DecorationItem[] = [];
  let deletionLineIndex = 1;
  let additionLineIndex = 1;
  let newLineNumber = 1;
  let oldLineNumber = 1;
  let oldContent = '';
  let newContent = '';
  for (const hunk of hunks) {
    // If there's content prior to the hunk in a non-partial diff,
    // lets fill it up
    while (
      !isPartial &&
      additionLineIndex - 1 < hunk.additionLineIndex &&
      deletionLineIndex - 1 < hunk.deletionLineIndex
    ) {
      oldInfo[deletionLineIndex] = {
        type: 'context-expanded',
        lineNumber: oldLineNumber,
        altLineNumber: newLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      newInfo[additionLineIndex] = {
        type: 'context-expanded',
        lineNumber: newLineNumber,
        altLineNumber: oldLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      oldContent += deletionLines[deletionLineIndex - 1];
      newContent += additionLines[additionLineIndex - 1];
      deletionLineIndex++;
      additionLineIndex++;
      oldLineNumber++;
      newLineNumber++;
      splitLineIndex++;
      unifiedLineIndex++;
    }
    oldLineNumber = hunk.deletionStart;
    newLineNumber = hunk.additionStart;

    // Lets process the actual hunk content
    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === 'context') {
        let index = 0;
        while (index < hunkContent.lines) {
          oldInfo[deletionLineIndex] = {
            type: 'context',
            lineNumber: oldLineNumber,
            altLineNumber: newLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          newInfo[additionLineIndex] = {
            type: 'context',
            lineNumber: newLineNumber,
            altLineNumber: oldLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          oldContent += deletionLines[deletionLineIndex - 1];
          newContent += additionLines[additionLineIndex - 1];
          deletionLineIndex++;
          additionLineIndex++;
          newLineNumber++;
          oldLineNumber++;
          splitLineIndex++;
          unifiedLineIndex++;
          index++;
        }
      } else {
        const len = Math.max(hunkContent.additions, hunkContent.deletions);
        let i = 0;
        // NOTE(amadeus): Since we iterate through deletions and additions
        // simultaneously, we have to create a secondary iterator for
        // unifiedLineIndex, and then when we're done, add the combined lengths
        // of additions/deletions to the main variable
        let _unifiedLineIndex = unifiedLineIndex;
        while (i < len) {
          const oldLine =
            i < hunkContent.deletions
              ? deletionLines[deletionLineIndex - 1]
              : undefined;
          const newLine =
            i < hunkContent.additions
              ? additionLines[additionLineIndex - 1]
              : undefined;
          computeLineDiffDecorations({
            newLine,
            oldLine,
            oldLineIndex: deletionLineIndex,
            newLineIndex: additionLineIndex,
            oldDecorations,
            newDecorations,
            lineDiffType,
          });
          if (oldLine != null) {
            oldInfo[deletionLineIndex] = {
              type: 'change-deletion',
              lineNumber: oldLineNumber,
              lineIndex: `${_unifiedLineIndex},${splitLineIndex}`,
            };
            oldContent += oldLine;
            deletionLineIndex++;
            oldLineNumber++;
          }
          if (newLine != null) {
            newInfo[additionLineIndex] = {
              type: 'change-addition',
              lineNumber: newLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions},${splitLineIndex}`,
            };
            newContent += newLine;
            additionLineIndex++;
            newLineNumber++;
          }
          splitLineIndex++;
          _unifiedLineIndex++;
          i++;
        }
        unifiedLineIndex += hunkContent.additions + hunkContent.deletions;
      }
    }

    if (isPartial || hunk !== hunks[hunks.length - 1]) continue;
    // If we are on the last hunk, we should fully iterate through the rest
    // of the lines
    while (
      deletionLineIndex <= deletionLines.length ||
      additionLineIndex <= additionLines.length
    ) {
      const oldLine = deletionLines[deletionLineIndex - 1];
      const newLine = additionLines[additionLineIndex - 1];
      if (oldLine == null && newLine == null) {
        break;
      }
      if (oldLine != null) {
        oldInfo[deletionLineIndex] = {
          type: 'context-expanded',
          lineNumber: oldLineNumber,
          altLineNumber: newLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        oldContent += oldLine;
        deletionLineIndex++;
        oldLineNumber++;
      }
      if (newLine != null) {
        newInfo[additionLineIndex] = {
          type: 'context-expanded',
          lineNumber: newLineNumber,
          altLineNumber: oldLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        newContent += newLine;
        additionLineIndex++;
        newLineNumber++;
      }
      splitLineIndex++;
      unifiedLineIndex++;
    }
  }
  return {
    oldContent,
    newContent,
    oldInfo,
    newInfo,
    oldDecorations,
    newDecorations,
    splitLineIndex,
    unifiedLineIndex,
  };
}

interface RenderTwoFilesProps {
  oldFile: FileContents;
  newFile: FileContents;
  oldInfo: Record<number, LineInfo | undefined>;
  newInfo: Record<number, LineInfo | undefined>;
  oldDecorations: DecorationItem[];
  newDecorations: DecorationItem[];
  options: RenderDiffOptions;
  highlighter: DiffsHighlighter;
  languageOverride: SupportedLanguages | undefined;
}

function renderTwoFiles({
  oldFile,
  newFile,
  oldInfo,
  newInfo,
  highlighter,
  oldDecorations,
  newDecorations,
  languageOverride,
  options: { theme: themeOrThemes = DEFAULT_THEMES, ...options },
}: RenderTwoFilesProps): RenderDiffFilesResult {
  const oldLang = languageOverride ?? getFiletypeFromFileName(oldFile.name);
  const newLang = languageOverride ?? getFiletypeFromFileName(newFile.name);
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

  const oldLines = (() => {
    if (oldFile.contents === '') {
      return [];
    }
    hastConfig.lang = oldLang;
    state.lineInfo = oldInfo;
    hastConfig.decorations = oldDecorations;
    return getLineNodes(
      highlighter.codeToHast(cleanLastNewline(oldFile.contents), hastConfig)
    );
  })();
  const newLines = (() => {
    if (newFile.contents === '') {
      return [];
    }
    hastConfig.lang = newLang;
    hastConfig.decorations = newDecorations;
    state.lineInfo = newInfo;
    return getLineNodes(
      highlighter.codeToHast(cleanLastNewline(newFile.contents), hastConfig)
    );
  })();

  return { oldLines, newLines };
}
