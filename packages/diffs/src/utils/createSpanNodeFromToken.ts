import type { ThemedToken } from '@pierre/highlights';

import { getTokenStyle } from './getTokenStyle';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  element.style.cssText = getTokenStyle(token);
  element.textContent = token.content;
  return element;
}
