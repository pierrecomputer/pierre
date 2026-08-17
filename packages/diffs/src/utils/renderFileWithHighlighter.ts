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
    hiddenLineRanges,
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
  let windowEndLine = startingLine;
  let renderedLineIndexes: number[] | undefined;
  let contents = file.contents;
  if (isWindowedHighlight) {
    const sourceLines = lines ?? linesFromFileContents(file.contents);
    windowEndLine = Math.min(startingLine + totalLines, sourceLines.length);
    if (hiddenLineRanges != null && hiddenLineRanges.length > 0) {
      renderedLineIndexes = [];
      const renderedLines: string[] = [];
      let low = 0;
      let high = hiddenLineRanges.length;
      while (low < high) {
        const middle = low + ((high - low) >> 1);
        if (hiddenLineRanges[middle].endLine < startingLine) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      let foldedRangeIndex = low;
      for (let lineIndex = startingLine; lineIndex < windowEndLine; ) {
        while (hiddenLineRanges[foldedRangeIndex]?.endLine < lineIndex) {
          foldedRangeIndex++;
        }
        const foldedRange = hiddenLineRanges[foldedRangeIndex];
        if (foldedRange != null && lineIndex >= foldedRange.startLine) {
          lineIndex = foldedRange.endLine + 1;
          foldedRangeIndex++;
          continue;
        }
        renderedLineIndexes.push(lineIndex);
        renderedLines.push(sourceLines[lineIndex] ?? '');
        lineIndex++;
      }
      contents = renderedLines.join('');
    } else {
      contents = sourceLines.slice(startingLine, windowEndLine).join('');
    }
  }
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
    highlighter.codeToHast(contents, hastConfig)
  );

  // Create sparse array for windowed rendering
  const code = isWindowedHighlight ? new Array(startingLine) : highlightedLines;
  if (isWindowedHighlight) {
    if (renderedLineIndexes == null) {
      code.push(...highlightedLines);
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
