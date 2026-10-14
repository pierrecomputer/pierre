import type {
  DiffsHighlighter,
  FileContents,
  ForceFilePlainTextOptions,
  RenderFileOptions,
  SharedRenderState,
  ThemedFileResult,
} from '../types';
import { appendItems } from './appendItems';
import { linesFromFileContents } from './computeFileOffsets';
import { forEachVisibleLine } from './forEachVisibleLine';
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
    hiddenLineRanges,
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
  let windowEndLine = startingLine;
  let renderedLineIndexes: number[] | undefined;
  let contents = file.contents;
  if (isWindowedHighlight) {
    const sourceLines = lines ?? linesFromFileContents(file.contents);
    windowEndLine = Math.min(startingLine + totalLines, sourceLines.length);
    if (hiddenLineRanges != null && hiddenLineRanges.length > 0) {
      const lineIndexes: number[] = [];
      const renderedLines: string[] = [];
      forEachVisibleLine(
        hiddenLineRanges,
        startingLine,
        windowEndLine,
        (lineIndex) => {
          lineIndexes.push(lineIndex);
          renderedLines.push(sourceLines[lineIndex] ?? '');
        }
      );
      renderedLineIndexes = lineIndexes;
      contents = renderedLines.join('');
    } else {
      contents = sourceLines.slice(startingLine, windowEndLine).join('');
    }
  }
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
  state.lineInfo = (shikiLineNumber: number) => {
    const lineIndex =
      renderedLineIndexes?.[shikiLineNumber - 1] ??
      (renderedLineIndexes == null
        ? shikiLineNumber - 1 + startingLine
        : windowEndLine);
    return {
      type: 'context',
      lineIndex,
      lineNumber: lineIndex + 1,
    };
  };
  const highlightedLines = renderTokenLines(
    highlighter.codeToTokens(
      normalizeHighlightLineEndings(contents),
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
    if (renderedLineIndexes == null) {
      appendItems(code, highlightedLines);
    } else {
      for (let index = 0; index < renderedLineIndexes.length; index++) {
        const line = highlightedLines[index];
        if (line != null) {
          code[renderedLineIndexes[index]] = line;
        }
      }
    }
  }

  return { code, themeStyles, baseThemeType };
}

// Shiki does not treat a lone carriage return as a line break. Normalize only
// the text sent to the highlighter so its output stays aligned with the file
// model while the original document retains its line endings.
function normalizeHighlightLineEndings(contents: string): string {
  return contents.replace(/\r(?!\n)/g, '\n');
}
