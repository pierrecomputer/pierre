import type { ElementContent, Element as HASTElement } from 'hast';

import { createHastElement } from './hast_utils';

export function createContentColumn(
  children: ElementContent[],
  rowCount: number
): HASTElement {
  return createHastElement({
    tagName: 'div',
    children,
    properties: {
      'data-content': '',
      style: `grid-row: span ${rowCount}`,
    },
  });
}
