import type { HElement as HtmlElement } from '../types';
import { createHtmlElement } from './html';

export function createEmptyRowBuffer(size: number): HtmlElement {
  return createHtmlElement({
    tagName: 'div',
    properties: {
      'data-content-buffer': '',
      'data-buffer-size': size,
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
  });
}
