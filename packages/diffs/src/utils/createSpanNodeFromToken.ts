import type { ThemedToken } from '../types';
import { tokenStyle } from './tokenStyle';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  // setAttribute lets Blink share parsed styles; style.cssText prevents reuse.
  element.setAttribute('style', tokenStyle(token));
  // CR renders as a space under white-space: pre. Keep its span empty but
  // retain the node so token recalls remove the correct number of children.
  element.textContent = token.content === '\r' ? '' : token.content;
  return element;
}
