import type { CodeToTokensOptions } from 'shiki/core';

import type { RenderersHighlighter } from '../highlighter/resolve_highlighter';
import type {
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  ThemedFileResult,
  ThemedToken,
} from '../types';
import { appendItems } from './appendItems';
import { linesFromFileContents } from './computeFileOffsets';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { updateTokenOffsets } from './updateTokenOffsets';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceFilePlainTextOptions = {
  forcePlainText: false,
};

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: RenderersHighlighter,
  { theme, tokenizeMaxLineLength }: RenderFileOptions,
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
    // Syntax highlighting needs the complete file to preserve parser state.
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  let content = file.contents;
  if (isWindowedHighlight) {
    lines ??= linesFromFileContents(file.contents);
    content = lines.slice(startingLine, startingLine + totalLines).join('');
  }
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
  const baseThemeType =
    typeof theme === 'string' ? highlighter.getTheme(theme).type : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  // tokenizeTimeLimit: 0 disables shiki's silent 500ms-per-line tokenization
  // abort. When it trips (slow devices, cold JS-regex-engine compile), the
  // rest of the line collapses to the enclosing scope's color — and since
  // dual-theme rendering tokenizes per theme, the first (dark) pass can smear
  // while the warm second (light) pass stays correct. Pathological content is
  // already guarded by tokenizeMaxLineLength, which renders long lines plain.
  const tokenConfig: CodeToTokensOptions<string, string> = {
    lang,
    ...(typeof theme === 'string' ? { theme } : { themes: theme }),
    defaultColor: false,
    cssVariablePrefix: formatCSSVariablePrefix('token'),
    tokenizeMaxLineLength,
    tokenizeTimeLimit: 0,
  };
  // Shiki does not treat lone carriage returns as line breaks. Normalize only
  // the highlighted text so token rows stay aligned with the original document.
  const highlightedLines = highlighter.codeToTokens(
    content.replace(/\r(?!\n)/g, '\n'),
    tokenConfig
  ).tokens;

  // Create sparse array for windowed rendering
  const code: ThemedToken[][] = isWindowedHighlight
    ? new Array(startingLine)
    : highlightedLines;
  if (isWindowedHighlight) {
    appendItems(code, highlightedLines);
  }

  if (isWindowedHighlight && lines != null) updateTokenOffsets(code, lines);
  return { code, themeStyles, baseThemeType };
}
