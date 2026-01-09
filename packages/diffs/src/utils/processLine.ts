import type { ElementContent, Element as HASTElement } from 'hast';

import type { SharedRenderState } from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';

export function processLine(
  node: HASTElement,
  line: number,
  state: SharedRenderState
): ElementContent {
  const lineInfo =
    typeof state.lineInfo === 'function'
      ? state.lineInfo(line)
      : state.lineInfo[line - 1];
  if (lineInfo == null) {
    const errorMessage = `processLine: line ${line}, contains no state.lineInfo`;
    console.error(errorMessage, { node, line, state });
    throw new Error(errorMessage);
  }
  // We need to convert the current line to a div but keep all the decorations
  // that may be applied
  node.tagName = 'span';
  node.properties['data-column-content'] = '';

  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  if (node.children.length === 0) {
    node.children.push(createTextNodeElement('\n'));
  }
  const children = [
    createHastElement({
      tagName: 'span',
      children: [
        createHastElement({
          tagName: 'span',
          children: [{ type: 'text', value: `${lineInfo.lineNumber}` }],
          properties: { 'data-line-number-content': '' },
        }),
      ],
      properties: { 'data-column-number': '' },
    }),
    node,
  ];
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-line': lineInfo.lineNumber,
      'data-alt-line': lineInfo.altLineNumber,
      'data-line-type': lineInfo.type,
      'data-line-index': lineInfo.lineIndex,
    },
  });
}
