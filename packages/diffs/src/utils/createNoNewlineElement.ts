import type { HElement as HtmlElement, LineTypes } from '../types';
import { createHtmlElement, createTextNode } from './html';

export function createNoNewlineElement(type: LineTypes): HtmlElement {
  return createHtmlElement({
    tagName: 'div',
    children: [
      createHtmlElement({
        tagName: 'span',
        children: [createTextNode('No newline at end of file')],
      }),
    ],
    properties: {
      'data-no-newline': '',
      'data-line-type': type,
      'data-column-content': '',
    },
  });
}
