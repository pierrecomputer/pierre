import type { Element, ElementContent } from 'hast';

import type { DecorationItem, SharedRenderState, ThemedToken } from '../types';
import { processLine } from './processLine';
import { tokenStyle } from './tokenStyle';
import { wrapTokenFragments } from './wrapTokenFragments';

interface RenderTokenLinesOptions {
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

/** Render backend tokens with the same line metadata and edit offsets. */
export function renderTokenLines(
  lines: ThemedToken[][],
  {
    state,
    useTokenTransformer = false,
    mergeWhitespaces = 'always',
    decorations = [],
    lineOffsets = [],
  }: RenderTokenLinesOptions
): ElementContent[] {
  const decorationsByLine = new Map<number, LineDecoration[]>();
  for (const decoration of decorations) {
    const normalized: LineDecoration = {
      ...decoration,
      start: getDecorationPosition(decoration.start, lineOffsets),
      end: getDecorationPosition(decoration.end, lineOffsets),
    };
    for (
      let line = normalized.start.line;
      line <= Math.min(normalized.end.line, lines.length - 1);
      line++
    ) {
      let spans = decorationsByLine.get(line);
      if (spans == null) decorationsByLine.set(line, (spans = []));
      spans.push(normalized);
    }
  }
  return lines.map((tokens, lineIndex) => {
    // Keep whitespace separate for editor caret mapping; regular rendering
    // folds it into the following span to avoid unnecessary DOM nodes.
    const normalized: ThemedToken[] = [];
    let pendingWhitespace = '';
    let whitespaceOffset = 0;
    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i];
      if (useTokenTransformer) {
        const content = token.content.trim();
        if (content !== '' && content !== token.content) {
          const start = token.content.indexOf(content);
          if (start > 0)
            normalized.push({
              content: token.content.slice(0, start),
              offset: token.offset,
            });
          normalized.push({ ...token, content, offset: token.offset + start });
          const end = start + content.length;
          if (end < token.content.length)
            normalized.push({
              content: token.content.slice(end),
              offset: token.offset + end,
            });
          continue;
        }
      } else if (mergeWhitespaces !== 'never') {
        const decoratedWhitespace = ((token.fontStyle ?? 0) & 12) !== 0;
        if (
          !decoratedWhitespace &&
          /^\s+$/.test(token.content) &&
          i < tokens.length - 1
        ) {
          if (pendingWhitespace === '') whitespaceOffset = token.offset;
          pendingWhitespace += token.content;
          continue;
        }
        if (pendingWhitespace !== '') {
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
      normalized.push(token);
    }
    const line: Element = {
      type: 'element',
      tagName: state == null ? 'span' : 'div',
      properties: state == null ? { class: 'line' } : {},
      children: [],
    };
    const spans = decorationsByLine.get(lineIndex) ?? [];
    // Open outer ranges first, regardless of their order in the input.
    if (spans.length > 1)
      spans.sort((a, b) => {
        if (a.start.line !== b.start.line) return a.start.line - b.start.line;
        if (a.start.character !== b.start.character)
          return a.start.character - b.start.character;
        if (a.end.line !== b.end.line) return b.end.line - a.end.line;
        return b.end.character - a.end.character;
      });
    let column = 0;
    const decorationStack: { decoration: LineDecoration; node: Element }[] = [];
    const emptyPositions = new Set<number>();
    const lineLength =
      spans.length === 0
        ? 0
        : normalized.reduce(
            (length, token) => length + token.content.length,
            0
          );
    if (spans.length > 0) {
      for (const span of spans) {
        const from = span.start.line === lineIndex ? span.start.character : 0;
        const to =
          span.end.line === lineIndex ? span.end.character : lineLength;
        if (from === to && from >= 0 && from <= lineLength)
          emptyPositions.add(from);
      }
    }

    // Share the range stack for text and empty markers so both keep their
    // enclosing decorations without splitting an existing wrapper.
    const appendDecoratedNode = (
      node: Element | undefined,
      from: number,
      to: number
    ): void => {
      let parent = line;
      let depth = 0;
      for (const decoration of spans) {
        const rangeStart =
          decoration.start.line === lineIndex ? decoration.start.character : 0;
        const rangeEnd =
          decoration.end.line === lineIndex
            ? decoration.end.character
            : lineLength;
        if (
          rangeStart > from ||
          rangeEnd < to ||
          // Boundary markers join the following range, except at the line end.
          (from === to &&
            from < lineLength &&
            rangeStart < from &&
            rangeEnd === from)
        )
          continue;
        if (decorationStack[depth]?.decoration !== decoration) {
          decorationStack.length = depth;
          const wrapper: Element = {
            type: 'element',
            tagName: 'span',
            properties: { ...decoration.properties },
            children: [],
          };
          parent.children.push(wrapper);
          decorationStack.push({ decoration, node: wrapper });
        }
        parent = decorationStack[depth++].node;
      }
      decorationStack.length = depth;
      if (node != null) parent.children.push(node);
    };
    for (const token of normalized) {
      if (token.content === '') continue;
      const start = column;
      const end = start + token.content.length;
      const boundaries = [start, end];
      for (const span of spans) {
        if (
          span.start.line === lineIndex &&
          span.start.character > start &&
          span.start.character < end
        )
          boundaries.push(span.start.character);
        if (
          span.end.line === lineIndex &&
          span.end.character > start &&
          span.end.character < end
        )
          boundaries.push(span.end.character);
      }
      boundaries.sort((a, b) => a - b);
      const style = tokenStyle(token);
      for (let i = 1; i < boundaries.length; i++) {
        const from = boundaries[i - 1];
        const to = boundaries[i];
        if (from === to) continue;
        if (emptyPositions.delete(from))
          appendDecoratedNode(undefined, from, from);
        const node: Element = {
          type: 'element',
          tagName: 'span',
          properties: {
            ...token.htmlAttrs,
            ...(style !== '' ? { style } : {}),
            ...(useTokenTransformer ? { 'data-char': start } : {}),
          },
          children: [
            {
              type: 'text',
              value: token.content.slice(from - start, to - start),
            },
          ],
        };
        appendDecoratedNode(node, from, to);
      }
      column = end;
    }
    if (emptyPositions.delete(column))
      appendDecoratedNode(undefined, column, column);
    if (useTokenTransformer && column === 0) {
      line.children.push({
        type: 'element',
        tagName: 'br',
        properties: {},
        children: [],
      });
    }
    if (useTokenTransformer) wrapTokenFragments(line);
    return state == null ? line : processLine(line, lineIndex + 1, state);
  });
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
