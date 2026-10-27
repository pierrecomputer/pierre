import type {
  DiffsHighlighter,
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  SharedRenderState,
  ThemedFileResult,
} from '../types';
import { appendItems } from './appendItems';
import { cleanLastNewline } from './cleanLastNewline';
import { linesFromFileContents } from './computeFileOffsets';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getTokenOptions } from './getTokenOptions';
import { renderTokenLines } from './renderTokenLines';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceFilePlainTextOptions = {
  forcePlainText: false,
};

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: DiffsHighlighter,
  { theme, tokenizeMaxLineLength, useTokenTransformer }: RenderFileOptions,
  {
    forcePlainText,
    lazyLineAST = false,
    startingLine,
    totalLines,
    lines,
  }: ForceFilePlainTextOptions = DEFAULT_PLAIN_TEXT_OPTIONS
): ThemedFileResult {
  if (forcePlainText) {
    startingLine ??= 0;
    totalLines ??= Infinity;
  } else {
    // Tokenization must include preceding lines to preserve lexical state.
    startingLine = 0;
    totalLines = Infinity;
  }
  const isWindowedHighlight = startingLine > 0 || totalLines < Infinity;
  const fileLines = isWindowedHighlight
    ? (lines ?? linesFromFileContents(file.contents))
    : undefined;
  const state: SharedRenderState = { lineInfo: [] };
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
  const baseThemeType =
    typeof theme === 'string' ? highlighter.getTheme(theme).type : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  // A window with no lines has no rows. The highlighter would give its empty
  // text one empty line.
  if (
    fileLines != null &&
    Math.min(startingLine + totalLines, fileLines.length) <= startingLine
  ) {
    return { code: new Array(startingLine), themeStyles, baseThemeType };
  }
  state.lineInfo = (shikiLineNumber: number) => ({
    type: 'context',
    lineIndex: shikiLineNumber - 1 + startingLine,
    lineNumber: shikiLineNumber + startingLine,
  });
  const highlightedLines = renderTokenLines(
    highlighter.codeToTokens(
      normalizeHighlightLineEndings(
        fileLines != null
          ? extractWindowedFileContent(fileLines, startingLine, totalLines)
          : file.contents
      ),
      getTokenOptions(lang, theme, tokenizeMaxLineLength)
    ).tokens,
    {
      state,
      useTokenTransformer,
      lazyLineAST: lazyLineAST && !forcePlainText && !useTokenTransformer,
      cacheHtmlStyles: highlighter.name === 'highlights',
    }
  );

  // Create sparse array for windowed rendering
  const code = isWindowedHighlight ? new Array(startingLine) : highlightedLines;
  if (isWindowedHighlight) {
    appendItems(code, highlightedLines);
  }

  return { code, themeStyles, baseThemeType };
}

// Shiki does not treat a lone carriage return as a line break. Normalize only
// the text sent to the highlighter so its output stays aligned with the file
// model while the original document retains its line endings.
function normalizeHighlightLineEndings(contents: string): string {
  return contents.replace(/\r(?!\n)/g, '\n');
}

// The text of the window's lines. A window that stops before the end of the
// file leaves out its last line break, so the highlighter does not emit a
// line after the window.
function extractWindowedFileContent(
  lines: readonly string[],
  startingLine: number,
  totalLines: number
): string {
  if (lines.length === 0) {
    return '';
  }
  const endLine = Math.min(startingLine + totalLines, lines.length);
  const contents = lines.slice(startingLine, endLine).join('');
  return endLine < lines.length ? cleanLastNewline(contents) : contents;
}
