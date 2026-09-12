import type { HElement as HtmlElement } from '../types';
import { createHtmlElement, createIconElement } from './html';

export function createGutterUtilityElement(): HtmlElement {
  return createHtmlElement({
    tagName: 'button',
    properties: { 'data-utility-button': '', type: 'button' },
    children: [
      createIconElement({
        name: 'diffs-icon-plus',
        properties: { 'data-icon': '' },
      }),
    ],
  });
}
