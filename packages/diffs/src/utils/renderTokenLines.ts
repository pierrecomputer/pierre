import type { Element, ElementContent, Properties } from 'hast';

import type { DecorationItem, SharedRenderState, ThemedToken } from '../types';
import { processLine } from './processLine';
import { setDeferredArrayItem } from './setDeferredArrayItem';
import { tokenStyle } from './tokenStyle';
import { wrapTokenFragments } from './wrapTokenFragments';

interface RenderTokenLinesOptions {
  lazyLineAST?: boolean;
  state?: SharedRenderState;
  useTokenTransformer?: boolean;
  mergeWhitespaces?: 'never' | 'always';
  decorations?: DecorationItem[];
  lineOffsets?: number[];
}

interface LineDecoration extends Omit<DecorationItem, 'start' | 'end'> {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

// from/to are columns within this line; order preserves outer-to-inner nesting.
interface LineDecorationRange {
  decoration: LineDecoration;
  order: number;
  from: number;
  to: number;
}

interface DecorationBoundary {
  position: number;
  range: LineDecorationRange;
  start: boolean;
}

export function renderTokenLines(
  lines: ThemedToken[][],
  {
    state,
    lazyLineAST = false,
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
        ? appendTokens(line, normalized, useTokenTransformer)
        : appendDecoratedTokens(
            line,
            normalized,
            spans,
            lineIndex,
            useTokenTransformer
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
    setDeferredArrayItem(rows, index, () => renderLine(lines[index], index));
  }
  return rows;
}

// Returns the line length in UTF-16 code units.
function appendTokens(
  line: Element,
  tokens: ThemedToken[],
  useTokenTransformer: boolean
): number {
  let column = 0;
  for (const token of tokens) {
    if (token.content === '') continue;
    line.children.push(
      createTokenSpan(
        token,
        tokenStyle(token),
        token.content,
        column,
        useTokenTransformer
      )
    );
    column += token.content.length;
  }
  return column;
}

// Visit sorted boundaries once to avoid scanning every decoration per token.
// Emit empty ranges before text at the same position.
function appendDecoratedTokens(
  line: Element,
  tokens: ThemedToken[],
  spans: LineDecoration[],
  lineIndex: number,
  useTokenTransformer: boolean
): number {
  // Open outer ranges first, regardless of their order in the input.
  if (spans.length > 1)
    spans.sort((a, b) => {
      if (a.start.line !== b.start.line) return a.start.line - b.start.line;
      if (a.start.character !== b.start.character)
        return a.start.character - b.start.character;
      if (a.end.line !== b.end.line) return b.end.line - a.end.line;
      return b.end.character - a.end.character;
    });
  const lineLength = tokens.reduce(
    (length, token) => length + token.content.length,
    0
  );
  const boundaries: DecorationBoundary[] = [];
  for (let order = 0; order < spans.length; order++) {
    const decoration = spans[order];
    const range: LineDecorationRange = {
      decoration,
      order,
      from:
        decoration.start.line === lineIndex ? decoration.start.character : 0,
      to:
        decoration.end.line === lineIndex
          ? decoration.end.character
          : lineLength,
    };
    boundaries.push(
      {
        position: Math.max(0, Math.min(range.from, lineLength)),
        range,
        start: true,
      },
      {
        position: Math.max(0, Math.min(range.to, lineLength)),
        range,
        start: false,
      }
    );
  }
  boundaries.sort((a, b) => a.position - b.position);
  const active: LineDecorationRange[] = [];
  const decorationStack: { range: LineDecorationRange; node: Element }[] = [];
  let boundaryIndex = 0;

  // Keep the same outer-to-inner order even when decorations cross each other.
  const updateActive = (range: LineDecorationRange, add: boolean): void => {
    let low = 0;
    let high = active.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (active[middle].order < range.order) low = middle + 1;
      else high = middle;
    }
    if (add) active.splice(low, 0, range);
    else if (active[low] === range) active.splice(low, 1);
  };

  // Reuse wrappers across tokens so a continuous range stays in one element.
  const getParent = (): Element => {
    let parent = line;
    let depth = 0;
    for (const range of active) {
      if (decorationStack[depth]?.range !== range) {
        decorationStack.length = depth;
        const wrapper: Element = {
          type: 'element',
          tagName: 'span',
          properties: { ...range.decoration.properties },
          children: [],
        };
        parent.children.push(wrapper);
        decorationStack.push({ range, node: wrapper });
      }
      parent = decorationStack[depth++].node;
    }
    decorationStack.length = depth;
    return parent;
  };

  let parent = line;

  // Markers belong inside ranges starting here, except at the line end,
  // where they belong inside ranges ending here.
  const advanceBoundary = (position: number): void => {
    const first = boundaryIndex;
    while (boundaries[boundaryIndex]?.position === position) boundaryIndex++;
    let hasMarker = false;
    for (let i = first; i < boundaryIndex; i++) {
      const { range, start } = boundaries[i];
      if (!start && range.from !== range.to && position < lineLength)
        updateActive(range, false);
    }
    for (let i = first; i < boundaryIndex; i++) {
      const { range, start } = boundaries[i];
      if (
        start &&
        range.from <= position &&
        range.to >= position &&
        (range.to > position ||
          range.from === position ||
          position === lineLength)
      ) {
        updateActive(range, true);
        if (range.from === range.to) hasMarker = true;
      }
    }
    if (hasMarker) {
      getParent();
      for (let i = first; i < boundaryIndex; i++) {
        const { range, start } = boundaries[i];
        if (start && range.from === range.to) updateActive(range, false);
      }
    }
    if (position < lineLength) parent = getParent();
  };

  let column = 0;
  for (const token of tokens) {
    if (token.content === '') continue;
    const start = column;
    const end = start + token.content.length;
    const style = tokenStyle(token);
    while (column < end) {
      if (boundaries[boundaryIndex]?.position === column)
        advanceBoundary(column);
      const to = Math.min(end, boundaries[boundaryIndex]?.position ?? end);
      parent.children.push(
        createTokenSpan(
          token,
          style,
          column === start && to === end
            ? token.content
            : token.content.slice(column - start, to - start),
          start,
          useTokenTransformer
        )
      );
      column = to;
    }
  }
  if (boundaries[boundaryIndex]?.position === column) advanceBoundary(column);
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
