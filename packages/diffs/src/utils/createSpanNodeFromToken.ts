import type { ThemedToken } from '../types';
import { getTokenStyle } from './getTokenStyle';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  element.style.cssText = getTokenStyle(token);
  element.textContent = token.content;
  return element;
}
