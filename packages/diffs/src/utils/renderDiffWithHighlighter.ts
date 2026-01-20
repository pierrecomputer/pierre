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
  // If we've received a diff with both files
  if (diff.newLines != null && diff.oldLines != null) {
    const {
      oldContent,
      newContent,
      oldInfo,
      newInfo,
      oldDecorations,
      newDecorations,
    } = processLines({
      hunks: diff.hunks,
      oldLines: diff.oldLines,
      newLines: diff.newLines,
      lineDiffType: options.lineDiffType,
    });
    const oldFile = {
      name: diff.prevName ?? diff.name,
      contents: oldContent,
    };
    const newFile = {
      name: diff.name,
      contents: newContent,
    };
    const code = renderTwoFiles({
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
    return { code, themeStyles, baseThemeType };
  }
  const hunks: RenderDiffFilesResult[] = [];
  let splitLineIndex = 0;
  let unifiedLineIndex = 0;
  for (const hunk of diff.hunks) {
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
      hunks: [hunk],
      splitLineIndex,
      unifiedLineIndex,
      lineDiffType: options.lineDiffType,
    });
    const oldFile = {
      name: diff.prevName ?? diff.name,
      contents: oldContent,
    };
    const newFile = {
      name: diff.name,
      contents: newContent,
    };
    hunks.push(
      renderTwoFiles({
        oldFile,
        oldInfo,
        oldDecorations,

        newFile,
        newInfo,
        newDecorations,

        highlighter,
        options,
        languageOverride: forcePlainText ? 'text' : diff.lang,
      })
    );
    splitLineIndex = newSplitLineIndex;
    unifiedLineIndex = newUnifiedLineIndex;
  }

  const code = (() => {
    if (hunks.length <= 1) {
      const hunk = hunks[0] ?? { oldLines: [], newLines: [] };
      if (hunk.newLines.length === 0 || hunk.oldLines.length === 0) {
        return hunk;
      }
    }
    return { hunks };
  })();

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
  oldLines?: string[];
  newLines?: string[];
  splitLineIndex?: number;
  unifiedLineIndex?: number;
  newLineIndex?: number;
  oldLineIndex?: number;
  lineDiffType: LineDiffTypes;
}

function processLines({
  hunks,
  oldLines,
  newLines,
  splitLineIndex = 0,
  unifiedLineIndex = 0,
  lineDiffType,
}: ProcessLinesProps) {
  const oldInfo: Record<number, LineInfo | undefined> = {};
  const newInfo: Record<number, LineInfo | undefined> = {};
  const oldDecorations: DecorationItem[] = [];
  const newDecorations: DecorationItem[] = [];
  let newLineIndex = 1;
  let oldLineIndex = 1;
  let newLineNumber = 1;
  let oldLineNumber = 1;
  let oldContent = '';
  let newContent = '';
  for (const hunk of hunks) {
    // If there's content prior to the hunk, lets fill it up
    while (
      oldLines != null &&
      newLines != null &&
      newLineIndex < hunk.additionStart &&
      oldLineIndex < hunk.deletionStart
    ) {
      oldInfo[oldLineIndex] = {
        type: 'context-expanded',
        lineNumber: oldLineNumber,
        altLineNumber: newLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      newInfo[newLineIndex] = {
        type: 'context-expanded',
        lineNumber: newLineNumber,
        altLineNumber: oldLineNumber,
        lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
      };
      oldContent += oldLines[oldLineIndex - 1];
      newContent += newLines[newLineIndex - 1];
      oldLineIndex++;
      newLineIndex++;
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
        for (const line of hunkContent.lines) {
          oldInfo[oldLineIndex] = {
            type: 'context',
            lineNumber: oldLineNumber,
            altLineNumber: newLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          newInfo[newLineIndex] = {
            type: 'context',
            lineNumber: newLineNumber,
            altLineNumber: oldLineNumber,
            lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
          };
          oldContent += line;
          newContent += line;
          oldLineIndex++;
          newLineIndex++;
          newLineNumber++;
          oldLineNumber++;
          splitLineIndex++;
          unifiedLineIndex++;
        }
      } else {
        const len = Math.max(
          hunkContent.additions.length,
          hunkContent.deletions.length
        );
        let i = 0;
        // NOTE(amadeus): Since we iterate through deletions and additions
        // simultaneously, we have to create a secondary iterator for
        // unifiedLineIndex, and then when we're done, add the combined lengths
        // of additions/deletions to the main variable
        let _unifiedLineIndex = unifiedLineIndex;
        while (i < len) {
          const oldLine = hunkContent.deletions[i];
          const newLine = hunkContent.additions[i];
          computeLineDiffDecorations({
            newLine,
            oldLine,
            oldLineIndex,
            newLineIndex,
            oldDecorations,
            newDecorations,
            lineDiffType,
          });
          if (oldLine != null) {
            oldInfo[oldLineIndex] = {
              type: 'change-deletion',
              lineNumber: oldLineNumber,
              lineIndex: `${_unifiedLineIndex},${splitLineIndex}`,
            };
            oldContent += oldLine;
            oldLineIndex++;
            oldLineNumber++;
          }
          if (newLine != null) {
            newInfo[newLineIndex] = {
              type: 'change-addition',
              lineNumber: newLineNumber,
              lineIndex: `${_unifiedLineIndex + hunkContent.deletions.length},${splitLineIndex}`,
            };
            newContent += newLine;
            newLineIndex++;
            newLineNumber++;
          }
          splitLineIndex++;
          _unifiedLineIndex++;
          i++;
        }
        unifiedLineIndex +=
          hunkContent.additions.length + hunkContent.deletions.length;
      }
    }

    if (
      oldLines == null ||
      newLines == null ||
      hunk !== hunks[hunks.length - 1]
    )
      continue;
    // If we are on the last hunk, we should fully iterate through the rest
    // of the lines
    while (oldLineIndex <= oldLines.length || newLineIndex <= oldLines.length) {
      const oldLine = oldLines[oldLineIndex - 1];
      const newLine = newLines[newLineIndex - 1];
      if (oldLine == null && newLine == null) {
        break;
      }
      if (oldLine != null) {
        oldInfo[oldLineIndex] = {
          type: 'context-expanded',
          lineNumber: oldLineNumber,
          altLineNumber: newLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        oldContent += oldLine;
        oldLineIndex++;
        oldLineNumber++;
      }
      if (newLine != null) {
        newInfo[newLineIndex] = {
          type: 'context-expanded',
          lineNumber: newLineNumber,
          altLineNumber: oldLineNumber,
          lineIndex: `${unifiedLineIndex},${splitLineIndex}`,
        };
        newContent += newLine;
        newLineIndex++;
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
}: RenderTwoFilesProps) {
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
          cssVariablePrefix: formatCSSVariablePrefix('token'),
        }
      : {
          ...options,
          // language will be overwritten for each highlight
          lang: 'text',
          themes: themeOrThemes,
          transformers,
          decorations: undefined,
          defaultColor: false,
          cssVariablePrefix: formatCSSVariablePrefix('token'),
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
