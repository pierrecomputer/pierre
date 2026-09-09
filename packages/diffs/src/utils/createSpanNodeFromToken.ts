import type { ThemedToken } from '../types';
import { tokenAttributes } from './tokensToHtml';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  for (const [name, value] of Object.entries(tokenAttributes(token)))
    element.setAttribute(name, value);
  element.textContent = token.content;
  return element;
}
