import { UNSAFE_CSS_ATTRIBUTE } from '../constants';

export function createUnsafeCSSStyleNode(): HTMLStyleElement {
  const node = document.createElement('style');
  node.setAttribute(UNSAFE_CSS_ATTRIBUTE, '');
  return node;
}
