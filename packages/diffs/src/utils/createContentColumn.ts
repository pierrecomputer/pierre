import type { ElementContent, HElement } from '../types';
import { createHtmlElement } from './html';

export function createContentColumn(
  children: ElementContent[],
  rowCount: number
): HElement {
  return createHtmlElement({
    tagName: 'div',
    children,
    properties: {
      'data-content': '',
      style: `grid-row: span ${rowCount}`,
    },
  });
}
