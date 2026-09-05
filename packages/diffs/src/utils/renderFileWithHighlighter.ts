import type { RenderersHighlighter } from '../highlighter/resolve_highlighter';
import type {
  CodeToHastOptions,
  DiffsThemeNames,
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  ThemedFileResult,
} from '../types';
import { appendItems } from './appendItems';
import { linesFromFileContents } from './computeFileOffsets';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceFilePlainTextOptions = {
  forcePlainText: false,
};

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: RenderersHighlighter,
  { theme, tokenizeMaxLineLength, useTokenTransformer }: RenderFileOptions,
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
  const { state, transformers } =
    createTransformerWithState(useTokenTransformer);
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
  const baseThemeType =
    typeof theme === 'string' ? highlighter.getTheme(theme).type : undefined;
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  state.lineInfo = (shikiLineNumber: number) => ({
    type: 'context',
    lineIndex: shikiLineNumber - 1 + startingLine,
    lineNumber: shikiLineNumber + startingLine,
  });
  // tokenizeTimeLimit: 0 disables shiki's silent 500ms-per-line tokenization
  // abort. When it trips (slow devices, cold JS-regex-engine compile), the
  // rest of the line collapses to the enclosing scope's color — and since
  // dual-theme rendering tokenizes per theme, the first (dark) pass can smear
  // while the warm second (light) pass stays correct. Pathological content is
  // already guarded by tokenizeMaxLineLength, which renders long lines plain.
  const hastConfig: CodeToHastOptions<DiffsThemeNames> = (() => {
    if (typeof theme === 'string') {
      return {
        lang,
        theme,
        transformers,
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength,
        tokenizeTimeLimit: 0,
      };
    }
    return {
      lang,
      themes: theme,
      transformers,
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix('token'),
      tokenizeMaxLineLength,
      tokenizeTimeLimit: 0,
    };
  })();
  const highlightedLines = getLineNodes(
    highlighter.codeToHast(
      normalizeHighlightLineEndings(
        isWindowedHighlight
          ? extractWindowedFileContent(
              lines ?? linesFromFileContents(file.contents),
              startingLine,
              totalLines
            )
          : file.contents
      ),
      hastConfig
    )
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
