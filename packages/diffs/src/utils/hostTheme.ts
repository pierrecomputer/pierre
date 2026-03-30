import { THEME_CSS_ATTRIBUTE } from '../constants';

interface UpsertHostThemeStyleProps {
  shadowRoot: ShadowRoot;
  currentNode: HTMLStyleElement | undefined;
  themeCSS: string;
}

// Keep the host theme style stable so renderers can update the host-scoped theme
// CSS without rebuilding the rest of the shadow DOM.
export function upsertHostThemeStyle({
  shadowRoot,
  currentNode,
  themeCSS,
}: UpsertHostThemeStyleProps): HTMLStyleElement | undefined {
  if (themeCSS.trim() === '') {
    currentNode?.remove();
    return undefined;
  }

  currentNode ??= createHostThemeStyleNode();
  currentNode.textContent = themeCSS;
  if (currentNode.parentNode !== shadowRoot) {
    shadowRoot.appendChild(currentNode);
  }
  return currentNode;
}

export function createHostThemeStyleNode(): HTMLStyleElement {
  const node = document.createElement('style');
  node.setAttribute(THEME_CSS_ATTRIBUTE, '');
  return node;
}
