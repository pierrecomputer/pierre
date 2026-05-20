export function isStyleNode(element: Element): element is HTMLStyleElement {
  if (
    typeof HTMLStyleElement !== 'undefined' &&
    element instanceof HTMLStyleElement
  ) {
    return true;
  }

  const tagName = element.tagName ?? element.nodeName;
  return typeof tagName === 'string' && tagName.toLowerCase() === 'style';
}
