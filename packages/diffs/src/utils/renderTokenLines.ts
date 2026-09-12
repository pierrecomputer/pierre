import type { ThemedToken } from '@pierre/highlights';

import type { HElement, SharedRenderState } from '../types';
import { getTokenStyle } from './getTokenStyle';
import { createHtmlElement, createTextNode } from './html';
import type { DiffDecoration } from './parseDiffDecorations';
import { processLine } from './processLine';
import { wrapTokenFragments } from './wrapTokenFragments';

// Split tokens at inline diff boundaries while retaining their original offsets.
export function renderTokenLines(
  lines: ThemedToken[][],
  lineInfo: SharedRenderState['lineInfo'],
  useTokenTransformer: boolean,
  decorations: DiffDecoration[] = []
): HElement[] {
  const rows: HElement[] = [];
  let decorationIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const row = createHtmlElement({ tagName: 'div' });
    let column = 0;
    let decorationNode: HElement | undefined;
    while (decorations[decorationIndex]?.line < lineIndex) {
      decorationIndex++;
    }
    for (const token of lines[lineIndex]) {
      const tokenStart = column;
      const tokenEnd = column + token.content.length;
      const style = getTokenStyle(token);
      while (column < tokenEnd) {
        let decoration = decorations[decorationIndex];
        while (decoration?.line === lineIndex && decoration.end <= column) {
          decoration = decorations[++decorationIndex];
          decorationNode = undefined;
        }
        const inDecoration =
          decoration?.line === lineIndex && decoration.start <= column;
        const end =
          decoration?.line === lineIndex
            ? Math.min(
                tokenEnd,
                inDecoration ? decoration.end : decoration.start
              )
            : tokenEnd;
        const span = createHtmlElement({
          tagName: 'span',
          properties: {
            ...token.htmlAttrs,
            ...(style === '' ? undefined : { style }),
            ...(useTokenTransformer ? { 'data-char': tokenStart } : undefined),
          },
          children: [
            createTextNode(
              token.content.slice(column - tokenStart, end - tokenStart)
            ),
          ],
        });
        if (inDecoration && decoration != null) {
          if (decorationNode == null) {
            decorationNode = createHtmlElement({
              tagName: 'span',
              properties: { 'data-diff-span': '' },
            });
            row.children.push(decorationNode);
          }
          decorationNode.children.push(span);
        } else {
          row.children.push(span);
        }
        column = end;
      }
    }
    if (useTokenTransformer) {
      wrapTokenFragments(row);
      if (row.children.length === 0) {
        row.children.push({
          type: 'element',
          tagName: 'br',
          properties: {},
          children: [],
        });
      }
    }
    processLine(row, lineIndex + 1, { lineInfo });
    rows.push(row);
  }
  return rows;
}
