import type { ThemedToken } from '../types';
import { tokenStyle } from './tokensToHtml';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  for (const [name, value] of Object.entries(token.htmlAttrs ?? {}))
    element.setAttribute(name, value);
  element.style.cssText = tokenStyle(token);
  element.textContent = token.content;
  return element;
}
