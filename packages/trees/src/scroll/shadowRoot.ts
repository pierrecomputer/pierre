import { adoptDeclarativeShadowDom } from '../components/web-components';
import { FILE_TREE_STYLE_ATTRIBUTE } from '../constants';
import { wrapCoreCSS } from '../utils/cssWrappers';
import { ensureMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import scrollStyles from './style.css';

let sheet: CSSStyleSheet | undefined;
const wrappedScrollStyles = wrapCoreCSS(scrollStyles);

function ensureScrollFileTreeStyles(shadowRoot: ShadowRoot): void {
  const hasReplaceSync =
    typeof CSSStyleSheet !== 'undefined' &&
    typeof (CSSStyleSheet.prototype as { replaceSync?: unknown })
      .replaceSync === 'function';

  const canAdopt = hasReplaceSync && 'adoptedStyleSheets' in shadowRoot;

  if (canAdopt) {
    if (sheet == null) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(wrappedScrollStyles);
    }
    let adopted = false;
    try {
      shadowRoot.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch {
      // Some environments expose adoptedStyleSheets but disallow assignment.
    }

    if (adopted) {
      shadowRoot.querySelector(`style[${FILE_TREE_STYLE_ATTRIBUTE}]`)?.remove();
      return;
    }
  }

  let styleEl = shadowRoot.querySelector(`style[${FILE_TREE_STYLE_ATTRIBUTE}]`);
  if (!(styleEl instanceof HTMLStyleElement)) {
    styleEl = document.createElement('style');
    styleEl.setAttribute(FILE_TREE_STYLE_ATTRIBUTE, '');
    shadowRoot.prepend(styleEl);
  }
  if (styleEl.textContent !== wrappedScrollStyles) {
    styleEl.textContent = wrappedScrollStyles;
  }
}

export function prepareScrollFileTreeShadowRoot(
  host: HTMLElement,
  shadowRoot: ShadowRoot
): void {
  adoptDeclarativeShadowDom(host, shadowRoot);
  ensureScrollFileTreeStyles(shadowRoot);
  ensureMeasuredScrollbarGutter(host, shadowRoot);
}
