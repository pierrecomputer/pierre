import type { ElementContent } from 'hast';

import type {
  ExternalHighlightedFile,
  ExternalHighlightedLine,
  FileContents,
  LineInfo,
  RenderRange,
  ThemedFileResult,
} from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';
import { processLine } from './processLine';

const validatedHighlightedFiles = new WeakMap<
  ExternalHighlightedFile,
  readonly string[]
>();

/** Renders caller-provided highlighted tokens after validating the source text. */
export function renderFileWithHighlightedTokens(
  file: FileContents,
  sourceLines: readonly string[],
  highlighted: ExternalHighlightedFile,
  useTokenTransformer: boolean,
  renderRange?: RenderRange
): ThemedFileResult {
  if (validatedHighlightedFiles.get(highlighted) !== sourceLines) {
    validateHighlightedLines(file.name, sourceLines, highlighted.lines);
    validatedHighlightedFiles.set(highlighted, sourceLines);
  }
  const startingLine = renderRange?.startingLine ?? 0;
  const endLine = Math.min(
    sourceLines.length,
    startingLine + (renderRange?.totalLines ?? Infinity)
  );
  const code: ElementContent[] = new Array(startingLine);
  for (let lineIndex = startingLine; lineIndex < endLine; lineIndex++) {
    code[lineIndex] = renderHighlightedLine(
      highlighted.lines[lineIndex] ?? [],
      {
        type: 'context',
        lineIndex,
        lineNumber: lineIndex + 1,
      },
      useTokenTransformer
    );
  }
  return {
    code,
    themeStyles: highlighted.themeStyles ?? '',
    baseThemeType: highlighted.baseThemeType,
  };
}

export function renderHighlightedLine(
  highlightedLine: ExternalHighlightedLine,
  lineInfo: LineInfo,
  useTokenTransformer: boolean
): ElementContent {
  let offset = 0;
  const children = highlightedLine.flatMap((token) => {
    const tokenStart = offset;
    offset += token.content.length;
    return token.content === ''
      ? []
      : [
          createHastElement({
            tagName: 'span',
            properties: {
              className: getSafeClassNames(token.className),
              'data-char': useTokenTransformer ? tokenStart : undefined,
            },
            children: [createTextNodeElement(token.content)],
          }),
        ];
  });
  if (useTokenTransformer && children.length === 0) {
    children.push({
      type: 'element',
      tagName: 'br',
      properties: {},
      children: [],
    });
  }
  const line = createHastElement({ tagName: 'span', children });
  return processLine(line, 1, { lineInfo: [lineInfo] });
}

function getSafeClassNames(
  className: string | undefined
): string[] | undefined {
  if (className == null || className.trim() === '') {
    return undefined;
  }
  return className.trim().split(/\s+/);
}

export function validateHighlightedLines(
  name: string,
  sourceLines: readonly string[],
  highlightedLines: readonly ExternalHighlightedLine[]
): void {
  const sourceLineCount =
    sourceLines.at(-1) === '' ? sourceLines.length - 1 : sourceLines.length;
  if (sourceLineCount !== highlightedLines.length) {
    throw new Error(
      `highlighted input: expected ${sourceLineCount} highlighted lines for ${name}, received ${highlightedLines.length}`
    );
  }
  for (let index = 0; index < sourceLineCount; index++) {
    const sourceLine = sourceLines[index];
    const highlightedLine = highlightedLines[index];
    if (sourceLine == null || highlightedLine == null) {
      throw new Error(`highlighted input: missing ${name} line ${index + 1}`);
    }
    let highlightedContent = '';
    for (const token of highlightedLine) {
      highlightedContent += token.content;
    }
    let sourceEnd = sourceLine.length;
    const lastCharacter = sourceLine.charCodeAt(sourceEnd - 1);
    if (lastCharacter === /* \n */ 10) {
      sourceEnd--;
      if (sourceLine.charCodeAt(sourceEnd - 1) === /* \r */ 13) {
        sourceEnd--;
      }
    } else if (lastCharacter === /* \r */ 13) {
      sourceEnd--;
    }
    if (highlightedContent !== sourceLine.slice(0, sourceEnd)) {
      throw new Error(
        `highlighted input: token content does not match ${name} line ${index + 1}`
      );
    }
  }
}
