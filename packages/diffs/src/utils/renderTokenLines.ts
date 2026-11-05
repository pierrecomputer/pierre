import type { Element, ElementContent, Properties } from 'hast';

import type { DecorationItem, SharedRenderState, ThemedToken } from '../types';
import {
  DecoratedLineBuilder,
  type LineDecoration,
} from './DecoratedLineBuilder';
import { processLine } from './processLine';
import { setDeferredArrayItem } from './setDeferredArrayItem';
import { tokenStyle } from './tokenStyle';
import { wrapTokenFragments } from './wrapTokenFragments';

export interface RenderTokenLinesOptions {
  lazyLineAST?: boolean;
  cacheHtmlStyles?: boolean;
  state?: SharedRenderState;
  useTokenTransformer?: boolean;
  mergeWhitespaces?: 'never' | 'always';
  decorations?: DecorationItem[];
  /** UTF-16 line start offsets, required for numeric decoration positions. */
  lineOffsets?: number[];
}

/**
 * Converts highlighted tokens to one HAST element per line for custom renderers.
 * Callers provide any line separators and enclosing pre/code elements.
 */
export function renderTokenLines(
  lines: ThemedToken[][],
  {
    state,
    lazyLineAST = false,
    cacheHtmlStyles = false,
    useTokenTransformer = false,
    mergeWhitespaces = 'always',
    decorations = [],
    lineOffsets = [],
  }: RenderTokenLinesOptions
): ElementContent[] {
  let decorationsByLine: Map<number, LineDecoration[]> | undefined;
  for (const decoration of decorations) {
    const byLine = (decorationsByLine ??= new Map());
    const normalized: LineDecoration = {
      ...decoration,
      start: getDecorationPosition(decoration.start, lineOffsets),
      end: getDecorationPosition(decoration.end, lineOffsets),
    };
    const lastLine = Math.min(normalized.end.line, lines.length - 1);
    for (let line = normalized.start.line; line <= lastLine; line++) {
      let spans = byLine.get(line);
      if (spans == null) byLine.set(line, (spans = []));
      spans.push(normalized);
    }
  }
  const renderLine = (tokens: ThemedToken[], lineIndex: number) => {
    let normalized: ThemedToken[] | undefined;
    if (useTokenTransformer || mergeWhitespaces !== 'never') {
      let pendingWhitespace = '';
      let whitespaceOffset = 0;
      for (let i = 0; i < tokens.length; i++) {
        let token = tokens[i];
        if (useTokenTransformer) {
          const content = token.content.trim();
          if (content !== '' && content !== token.content) {
            normalized ??= tokens.slice(0, i);
            const start = token.content.indexOf(content);
            if (start > 0)
              normalized.push({
                content: token.content.slice(0, start),
                offset: token.offset,
              });
            normalized.push({
              ...token,
              content,
              offset: token.offset + start,
            });
            const end = start + content.length;
            if (end < token.content.length)
              normalized.push({
                content: token.content.slice(end),
                offset: token.offset + end,
              });
            continue;
          }
        } else {
          const decoratedWhitespace = ((token.fontStyle ?? 0) & 12) !== 0;
          if (
            !decoratedWhitespace &&
            /^\s+$/.test(token.content) &&
            i < tokens.length - 1
          ) {
            normalized ??= tokens.slice(0, i);
            if (pendingWhitespace === '') whitespaceOffset = token.offset;
            pendingWhitespace += token.content;
            continue;
          }
          if (pendingWhitespace !== '' && normalized != null) {
            if (decoratedWhitespace)
              normalized.push({
                content: pendingWhitespace,
                offset: whitespaceOffset,
              });
            else
              token = {
                ...token,
                content: pendingWhitespace + token.content,
                offset: whitespaceOffset,
              };
            pendingWhitespace = '';
          }
        }
        normalized?.push(token);
      }
    }
    normalized ??= tokens;
    const line: Element = {
      type: 'element',
      tagName: state == null ? 'span' : 'div',
      properties: state == null ? { class: 'line' } : {},
      children: [],
    };
    const spans = decorationsByLine?.get(lineIndex);
    const column =
      spans == null
        ? appendTokens(line, normalized, useTokenTransformer, cacheHtmlStyles)
        : appendDecoratedTokens(
            line,
            normalized,
            spans,
            lineIndex,
            useTokenTransformer,
            cacheHtmlStyles
          );
    if (useTokenTransformer && column === 0) {
      line.children.push({
        type: 'element',
        tagName: 'br',
        properties: {},
        children: [],
      });
    }
    // Undecorated tokens already have one span per editor position.
    if (useTokenTransformer && spans != null) wrapTokenFragments(line);
    return state == null ? line : processLine(line, lineIndex + 1, state);
  };
  if (!lazyLineAST) return lines.map(renderLine);
  const rows: ElementContent[] = new Array(lines.length);
  for (let index = 0; index < lines.length; index++) {
    // Warning: capture one line, not `lines`; unbuilt rows would keep every
    // line's tokens alive.
    const tokens = lines[index];
    setDeferredArrayItem(rows, index, () => renderLine(tokens, index));
  }
  return rows;
}

// Returns the line length in UTF-16 code units.
function appendTokens(
  line: Element,
  tokens: ThemedToken[],
  useTokenTransformer: boolean,
  cacheHtmlStyles: boolean
): number {
  let column = 0;
  for (const token of tokens) {
    if (token.content === '') continue;
    line.children.push(
      createTokenSpan(
        token,
        tokenStyle(token, cacheHtmlStyles),
        token.content,
        column,
        useTokenTransformer
      )
    );
    column += token.content.length;
  }
  return column;
}

// Adds a line's tokens to `line` with decorations applied. When a decoration
// splits a token, each piece keeps the column where the token starts, which
// the editor needs.
function appendDecoratedTokens(
  line: Element,
  tokens: ThemedToken[],
  spans: LineDecoration[],
  lineIndex: number,
  useTokenTransformer: boolean,
  cacheHtmlStyles: boolean
): number {
  let lineLength = 0;
  for (const token of tokens) lineLength += token.content.length;
  const builder = new DecoratedLineBuilder(line, spans, lineIndex, lineLength);
  let column = 0;
  for (const token of tokens) {
    const { content } = token;
    if (content === '') continue;
    const start = column;
    const end = start + content.length;
    const style = tokenStyle(token, cacheHtmlStyles);
    while (column < end) {
      builder.moveTo(column);
      const to = Math.min(end, builder.nextEdge);
      builder.parent.children.push(
        createTokenSpan(
          token,
          style,
          column === start && to === end
            ? content
            : content.slice(column - start, to - start),
          start,
          useTokenTransformer
        )
      );
      column = to;
    }
  }
  builder.moveTo(column);
  return column;
}

// data-char must retain the original token column when decorations split it.
function createTokenSpan(
  token: ThemedToken,
  style: string,
  text: string,
  start: number,
  useTokenTransformer: boolean
): Element {
  const properties: Properties =
    token.htmlAttrs != null ? { ...token.htmlAttrs } : {};
  if (style !== '') properties.style = style;
  if (useTokenTransformer) properties['data-char'] = start;
  return {
    type: 'element',
    tagName: 'span',
    properties,
    children: [{ type: 'text', value: text }],
  };
}

// Convert absolute UTF-16 offsets to the line coordinates used by decorations.
function getDecorationPosition(
  position: DecorationItem['start'],
  lineOffsets: number[]
): { line: number; character: number } {
  if (typeof position !== 'number') return position;
  let low = 0;
  let high = lineOffsets.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (lineOffsets[middle] <= position) low = middle;
    else high = middle;
  }
  return { line: low, character: position - (lineOffsets[low] ?? 0) };
}
