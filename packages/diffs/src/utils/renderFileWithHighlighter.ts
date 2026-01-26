import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DiffsHighlighter,
  DiffsThemeNames,
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  ThemedFileResult,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';
import { iterateOverFile } from './iterateOverFile';
import { splitFileContents } from './splitFileContents';

const DEFAULT_PLAIN_TEXT_OPTIONS: ForceFilePlainTextOptions = {
  forcePlainText: false,
};

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: DiffsHighlighter,
  { theme = DEFAULT_THEMES, tokenizeMaxLineLength }: RenderFileOptions,
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
  const { state, transformers } = createTransformerWithState();
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
  const baseThemeType = (() => {
    if (typeof theme === 'string') {
      return highlighter.getTheme(theme).type;
    }
    return undefined;
  })();
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  state.lineInfo = (shikiLineNumber: number) => ({
    type: 'context',
    lineIndex: shikiLineNumber - 1 + startingLine,
    lineNumber: shikiLineNumber + startingLine,
  });
  const hastConfig: CodeToHastOptions<DiffsThemeNames> = (() => {
    if (typeof theme === 'string') {
      return {
        lang,
        theme,
        transformers,
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength,
      };
    }
    return {
      lang,
      themes: theme,
      transformers,
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix('token'),
      tokenizeMaxLineLength,
    };
  })();
  const highlightedLines = getLineNodes(
    highlighter.codeToHast(
      isWindowedHighlight
        ? extractWindowedFileContent(
            lines ?? splitFileContents(file.contents),
            startingLine,
            totalLines
          )
        : cleanLastNewline(file.contents),
      hastConfig
    )
  );

  // Create sparse array for windowed rendering
  const code = isWindowedHighlight ? new Array(startingLine) : highlightedLines;
  if (isWindowedHighlight) {
    code.push(...highlightedLines);
  }

  return { code, themeStyles, baseThemeType };
}

function extractWindowedFileContent(
  lines: string[],
  startingLine: number,
  totalLines: number
): string {
  let windowContent: string = '';
  iterateOverFile({
    lines,
    startingLine,
    totalLines,
    callback({ content }) {
      windowContent += content;
    },
  });
  return windowContent;
}
