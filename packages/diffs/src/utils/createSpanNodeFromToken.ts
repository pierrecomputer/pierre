import type { ThemedToken } from '../types';
import { tokenStyle } from './tokenStyle';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  // Set the attribute rather than `style.cssText`: Blink shares parsed style
  // attributes between elements with the same text, while each CSSOM write
  // builds a private declaration block. For a streamed 10k-line file that
  // made style recalculation about 2.5 times slower.
  element.setAttribute('style', tokenStyle(token));
  // Stream tokenizers emit a carriage return as its own token so token text
  // round-trips the source. CSS draws U+000D like a space under
  // `white-space: pre`, so the span stays empty; it still takes a child slot
  // so a recall removes the right number of nodes.
  element.textContent = token.content === '\r' ? '' : token.content;
  return element;
}
