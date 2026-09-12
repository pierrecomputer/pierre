import type { Element as HASTElement } from 'hast';

import type { LineTypes } from '../types';
import { createHastElement, createTextNodeElement } from './hast_utils';

export function createNoNewlineElement(type: LineTypes): HASTElement {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'span',
        children: [createTextNodeElement('No newline at end of file')],
      }),
    ],
    properties: {
      'data-no-newline': '',
      'data-line-type': type,
      'data-column-content': '',
    },
  });
}
