import type {
  ElementContent,
  HElement as HtmlElement,
  SharedRenderState,
} from '../types';
import { createTextNode } from './html';

export function processLine(
  node: HtmlElement,
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
  node.tagName = 'div';
  node.properties['data-line'] = lineInfo.lineNumber;
  node.properties['data-alt-line'] = lineInfo.altLineNumber;
  node.properties['data-line-type'] = lineInfo.type;
  node.properties['data-line-index'] = lineInfo.lineIndex;

  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  if (node.children.length === 0) {
    node.children.push(createTextNode('\n'));
  }

  return node;
}
