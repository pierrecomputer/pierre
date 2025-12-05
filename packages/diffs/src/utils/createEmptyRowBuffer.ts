import type { Element as HASTElement } from 'hast';

import { createHastElement } from './hast_utils';

export function createEmptyRowBuffer(size: number): HASTElement {
  return createHastElement({
    tagName: 'div',
    properties: {
      'data-buffer': '',
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
  });
}
