import { THEME_CSS_ATTRIBUTE } from '../constants';
import type { ThemeTypes } from '../types';
import { wrapThemeCSS } from './cssWrappers';

interface UpsertHostThemeStyleProps {
  shadowRoot: ShadowRoot;
  current: HTMLStyleElement | undefined;
  themeStyles: string;
  before?: ChildNode | null;
}

export function syncContainerThemeState(
  container: HTMLElement,
  themeType: ThemeTypes
): void {
  if (themeType === 'system') {
    if (!container.hasAttribute('data-theme')) {
      return;
    }
    container.removeAttribute('data-theme');
    return;
  }
  if (container.dataset.theme === themeType) {
    return;
  }
  container.dataset.theme = themeType;
}

// Keep the host theme style stable so renderers can migrate off inline theme
// styles without rebuilding the rest of the shadow DOM during the transition.
export function upsertHostThemeStyle({
  shadowRoot,
  current,
  themeStyles,
  before,
}: UpsertHostThemeStyleProps): HTMLStyleElement | undefined {
  if (themeStyles.trim() === '') {
    current?.remove();
    return undefined;
  }

  const element = current ?? createHostThemeStyleNode();
  const wrappedThemeCSS = wrapThemeCSS(themeStyles);
  const referenceNode =
    before != null && before.parentNode === shadowRoot ? before : null;

  if (
    element.parentNode !== shadowRoot ||
    element.nextSibling !== referenceNode
  ) {
    shadowRoot.insertBefore(element, referenceNode);
  }
  if (element.textContent !== wrappedThemeCSS) {
    element.textContent = wrappedThemeCSS;
  }
  return element;
}

export function createHostThemeStyleNode(): HTMLStyleElement {
  const node = document.createElement('style');
  node.setAttribute(THEME_CSS_ATTRIBUTE, '');
  return node;
}
