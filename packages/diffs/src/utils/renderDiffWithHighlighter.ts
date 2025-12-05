import { diffChars, diffWordsWithSpace } from 'diff';

import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  FileContents,
  FileDiffMetadata,
  Hunk,
  LineDiffTypes,
  LineInfo,
  PJSHighlighter,
  PJSThemeNames,
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
  highlighter: PJSHighlighter,
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
  let lineIndex = 0;
  for (const hunk of diff.hunks) {
    const result = processLines({
      hunks: [hunk],
      lineIndex,
      lineDiffType: options.lineDiffType,
    });
    const {
      oldContent,
      newContent,
      oldInfo,
      newInfo,
      oldDecorations,
      newDecorations,
      lineIndex: newLineIndex,
    } = result;
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
    lineIndex = newLineIndex;
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
  lineIndex?: number;
  newLineIndex?: number;
  oldLineIndex?: number;
  lineDiffType: LineDiffTypes;
}

function processLines({
  hunks,
  oldLines,
  newLines,
  lineIndex = 0,
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
        lineIndex,
      };
      newInfo[newLineIndex] = {
        type: 'context-expanded',
        lineNumber: newLineNumber,
        lineIndex,
      };
      oldContent += oldLines[oldLineIndex - 1];
      newContent += newLines[newLineIndex - 1];
      oldLineIndex++;
      newLineIndex++;
      oldLineNumber++;
      newLineNumber++;
      lineIndex++;
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
            lineIndex,
          };
          newInfo[newLineIndex] = {
            type: 'context',
            lineNumber: newLineNumber,
            lineIndex,
          };
          oldContent += line;
          newContent += line;
          oldLineIndex++;
          newLineIndex++;
          newLineNumber++;
          oldLineNumber++;
          lineIndex++;
        }
      } else {
        const len = Math.max(
          hunkContent.additions.length,
          hunkContent.deletions.length
        );
        let i = 0;
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
              lineIndex,
            };
            oldContent += oldLine;
            oldLineIndex++;
            oldLineNumber++;
          }
          if (newLine != null) {
            newInfo[newLineIndex] = {
              type: 'change-addition',
              lineNumber: newLineNumber,
              lineIndex,
            };
            newContent += newLine;
            newLineIndex++;
            newLineNumber++;
          }
          lineIndex++;
          i++;
        }
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
          lineIndex,
        };
        oldContent += oldLine;
        oldLineIndex++;
        oldLineNumber++;
      }
      if (newLine != null) {
        newInfo[newLineIndex] = {
          type: 'context-expanded',
          lineNumber: newLineNumber,
          lineIndex,
        };
        newContent += newLine;
        newLineIndex++;
        newLineNumber++;
      }
      lineIndex++;
    }
  }
  return {
    oldContent: cleanLastNewline(oldContent),
    newContent: cleanLastNewline(newContent),
    oldInfo,
    newInfo,
    oldDecorations,
    newDecorations,
    lineIndex,
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
  highlighter: PJSHighlighter;
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
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
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
    return getLineNodes(highlighter.codeToHast(oldFile.contents, hastConfig));
  })();
  const newLines = (() => {
    if (newFile.contents === '') {
      return [];
    }
    hastConfig.lang = newLang;
    hastConfig.decorations = newDecorations;
    state.lineInfo = newInfo;
    return getLineNodes(highlighter.codeToHast(newFile.contents, hastConfig));
  })();

  return { oldLines, newLines };
}
