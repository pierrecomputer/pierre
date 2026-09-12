import { isSupportedLanguage } from '@pierre/highlights';

import { DEFAULT_THEMES } from '../constants';
import { getHighlightsTheme } from '../highlighter/getHighlightsTheme';
import type {
  DiffsHighlighter,
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  ThemedFileResult,
} from '../types';
import { appendItems } from './appendItems';
import { linesFromFileContents } from './computeFileOffsets';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { renderTokenLines } from './renderTokenLines';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceFilePlainTextOptions = {
  forcePlainText: false,
};

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: DiffsHighlighter,
  {
    theme = DEFAULT_THEMES,
    tokenizeMaxLineLength,
    useTokenTransformer,
  }: RenderFileOptions,
  {
    forcePlainText,
    startingLine,
    totalLines,
    lines,
  }: ForceFilePlainTextOptions = DEFAULT_PLAIN_TEXT_OPTIONS
): ThemedFileResult {
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
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
  const appearance =
    typeof theme === 'string'
      ? getHighlightsTheme(highlighter.getTheme(theme)).appearance
      : undefined;
  const baseThemeType =
    appearance === 'light'
      ? 'light'
      : appearance === 'dark'
        ? 'dark'
        : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  // Normalize lone carriage returns so highlighted rows match document lines.
  const highlightedLines = renderTokenLines(
    highlighter.codeToTokens(
      (isWindowedHighlight
        ? extractWindowedFileContent(
            lines ?? linesFromFileContents(file.contents),
            startingLine,
            totalLines
          )
        : file.contents
      ).replace(/\r(?!\n)/g, '\n'),
      {
        lang: isSupportedLanguage(lang) ? lang : 'text',
        theme:
          typeof theme === 'string'
            ? highlighter.getTheme(theme)
            : {
                dark: highlighter.getTheme(theme.dark),
                light: highlighter.getTheme(theme.light),
              },
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength,
      }
    ).tokens,
    (line) => ({
      type: 'context',
      lineIndex: line - 1 + startingLine,
      lineNumber: line + startingLine,
    }),
    useTokenTransformer ?? false
  );

  // Create sparse array for windowed rendering
  const code = isWindowedHighlight ? new Array(startingLine) : highlightedLines;
  if (isWindowedHighlight) {
    appendItems(code, highlightedLines);
  }

  return { code, themeStyles, baseThemeType };
}

function extractWindowedFileContent(
  lines: string[],
  startingLine: number,
  totalLines: number
): string {
  if (lines.length === 0) {
    return '';
  }
  const endLine = Math.min(startingLine + totalLines, lines.length);
  return lines.slice(startingLine, endLine).join('');
}
