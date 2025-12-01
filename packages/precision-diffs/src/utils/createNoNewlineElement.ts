import type { Element as HASTElement } from 'hast';

import { createHastElement, createTextNodeElement } from './hast_utils';

export function createNoNewlineElement(
  type: 'context' | 'change-addition' | 'change-deletion'
): HASTElement {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'span',
        properties: { 'data-column-number': '' },
      }),
      createHastElement({
        tagName: 'span',
        children: [createTextNodeElement('No newline at end of file')],
        properties: { 'data-column-content': '' },
      }),
    ],
    properties: { 'data-no-newline': '', 'data-line-type': type },
  });
}
