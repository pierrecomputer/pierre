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
    deletionLines: [],
    additionLines: [],
  };
  let splitLineIndex = 0;
  let unifiedLineIndex = 0;
  for (const hunkOrHunks of diff.isPartial ? diff.hunks : [diff.hunks]) {
    const hunk = !Array.isArray(hunkOrHunks) ? hunkOrHunks : undefined;
    splitLineIndex += hunk?.collapsedBefore ?? 0;
    unifiedLineIndex += hunk?.collapsedBefore ?? 0;
    const hunks = Array.isArray(hunkOrHunks) ? hunkOrHunks : [hunkOrHunks];
    const {
      deletionContent,
      additionContent,
      deletionInfo,
      additionInfo,
      deletionDecorations,
      additionDecorations,
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

    if (hunk != null) {
      code.deletionLines.push(...deletionLines);
      code.additionLines.push(...additionLines);
      splitLineIndex = newSplitLineIndex;
      unifiedLineIndex = newUnifiedLineIndex;
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
          // Decoration indexes start at 0
          line: deletionLineIndex - 1,
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
          // Decoration indexes start at 0
          line: additionLineIndex - 1,
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
  const deletionInfo: Record<number, LineInfo | undefined> = {};
  const additionInfo: Record<number, LineInfo | undefined> = {};
  const deletionDecorations: DecorationItem[] = [];
  const additionDecorations: DecorationItem[] = [];
  let deletionLineIndex = 1;
  let additionLineIndex = 1;
  let additionLineNumber = 1;
  let deletionLineNumber = 1;
  let deletionContent = '';
  let additionContent = '';
  for (const hunk of hunks) {
    // If there's content prior to the hunk in a non-partial diff,
    // lets fill it up
    while (
      !isPartial &&
      additionLineIndex - 1 < hunk.additionLineIndex &&
      deletionLineIndex - 1 < hunk.deletionLineIndex
    ) {
      deletionInfo[deletionLineIndex] = {
        type: 'context-expanded',
        lineNumber: deletionLineNumber,
        altLineNumber: additionLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      additionInfo[additionLineIndex] = {
        type: 'context-expanded',
        lineNumber: additionLineNumber,
        altLineNumber: deletionLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      deletionContent += deletionLines[deletionLineIndex - 1];
      additionContent += additionLines[additionLineIndex - 1];
      deletionLineIndex++;
      additionLineIndex++;
      deletionLineNumber++;
      additionLineNumber++;
      splitLineIndex++;
      unifiedLineIndex++;
    }
    deletionLineNumber = hunk.deletionStart;
    additionLineNumber = hunk.additionStart;

    // Lets process the actual hunk content
    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === 'context') {
        let index = 0;
        while (index < hunkContent.lines) {
          deletionInfo[deletionLineIndex] = {
            type: 'context',
            lineNumber: deletionLineNumber,
            altLineNumber: additionLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          additionInfo[additionLineIndex] = {
            type: 'context',
            lineNumber: additionLineNumber,
            altLineNumber: deletionLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          deletionContent += deletionLines[deletionLineIndex - 1];
          additionContent += additionLines[additionLineIndex - 1];
          deletionLineIndex++;
          additionLineIndex++;
          additionLineNumber++;
          deletionLineNumber++;
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
          const deletionLine =
            i < hunkContent.deletions
              ? deletionLines[deletionLineIndex - 1]
              : undefined;
          const additionLine =
            i < hunkContent.additions
              ? additionLines[additionLineIndex - 1]
              : undefined;
          computeLineDiffDecorations({
            additionLine,
            deletionLine,
            deletionLineIndex,
            additionLineIndex,
            deletionDecorations,
            additionDecorations,
            lineDiffType,
          });
          if (deletionLine != null) {
            deletionInfo[deletionLineIndex] = {
              type: 'change-deletion',
              lineNumber: deletionLineNumber,
              lineIndex: `${_unifiedLineIndex},${splitLineIndex}`,
            };
            deletionContent += deletionLine;
            deletionLineIndex++;
            deletionLineNumber++;
          }
          if (additionLine != null) {
            additionInfo[additionLineIndex] = {
              type: 'change-addition',
              lineNumber: additionLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions},${splitLineIndex}`,
            };
            additionContent += additionLine;
            additionLineIndex++;
            additionLineNumber++;
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
      const deletionLine = deletionLines[deletionLineIndex - 1];
      const additionLine = additionLines[additionLineIndex - 1];
      if (deletionLine == null && additionLine == null) {
        break;
      }
      if (deletionLine != null) {
        deletionInfo[deletionLineIndex] = {
          type: 'context-expanded',
          lineNumber: deletionLineNumber,
          altLineNumber: additionLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        deletionContent += deletionLine;
        deletionLineIndex++;
        deletionLineNumber++;
      }
      if (additionLine != null) {
        additionInfo[additionLineIndex] = {
          type: 'context-expanded',
          lineNumber: additionLineNumber,
          altLineNumber: deletionLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        additionContent += additionLine;
        additionLineIndex++;
        additionLineNumber++;
      }
      splitLineIndex++;
      unifiedLineIndex++;
    }
  }
  return {
    deletionContent: cleanLastNewline(deletionContent),
    additionContent: cleanLastNewline(additionContent),
    deletionInfo,
    additionInfo,
    deletionDecorations,
    additionDecorations,
    splitLineIndex,
    unifiedLineIndex,
  };
}

interface RenderTwoFilesProps {
  deletionFile: FileContents;
  additionFile: FileContents;
  deletionInfo: Record<number, LineInfo | undefined>;
  additionInfo: Record<number, LineInfo | undefined>;
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
      highlighter.codeToHast(deletionFile.contents, hastConfig)
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
      highlighter.codeToHast(additionFile.contents, hastConfig)
    );
  })();

  return { deletionLines, additionLines };
}
