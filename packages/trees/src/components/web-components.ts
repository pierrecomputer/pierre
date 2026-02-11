import { FILE_TREE_TAG_NAME } from '../constants';
import styles from '../style.css';

const STYLE_MARKER_ATTR = 'data-file-tree-style';

let sheet: CSSStyleSheet | undefined;

export function ensureFileTreeStyles(shadowRoot: ShadowRoot): void {
  const hasReplaceSync =
    typeof CSSStyleSheet !== 'undefined' &&
    typeof (CSSStyleSheet.prototype as { replaceSync?: unknown })
      .replaceSync === 'function';

  const canAdopt = hasReplaceSync && 'adoptedStyleSheets' in shadowRoot;

  if (canAdopt) {
    if (sheet == null) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
    }
    let adopted = false;
    try {
      shadowRoot.adoptedStyleSheets = [sheet];
      adopted = true;
    } catch {
      // Some environments expose adoptedStyleSheets but disallow assignment.
    }

    if (adopted) {
      // If this markup came from SSR declarative shadow DOM, it likely already
      // includes an inline <style>. Remove it so SSR and CSR converge on the
      // adoptedStyleSheets path when supported.
      shadowRoot.querySelector(`style[${STYLE_MARKER_ATTR}]`)?.remove();
      return;
    }
  }

  // Fallback path for environments without adoptedStyleSheets.
  // Ensure an inline style exists in the shadow root.
  if (shadowRoot.querySelector(`style[${STYLE_MARKER_ATTR}]`) == null) {
    const styleEl = document.createElement('style');
    styleEl.setAttribute(STYLE_MARKER_ATTR, '');
    styleEl.textContent = styles;
    shadowRoot.prepend(styleEl);
  }
}

export function adoptDeclarativeShadowDom(
  host: HTMLElement,
  shadowRoot: ShadowRoot
): void {
  // Some runtimes (and client-side navigations) may create the template element
  // via DOM APIs rather than the HTML parser, which means the browser won't
  // automatically parse declarative Shadow DOM.
  //
  // If we detect a declarative template in light DOM, manually adopt it.
  const template = host.querySelector(
    'template[shadowrootmode="open"], template[data-file-tree-shadowrootmode="open"]'
  );
  if (!(template instanceof HTMLTemplateElement)) return;
  if (shadowRoot.childNodes.length > 0) return;

  // Stamp the template contents, but do not mutate/remove the template when it
  // may still be needed for React hydration stability (docs usage).
  shadowRoot.appendChild(template.content.cloneNode(true));

  // For the actual declarative-shadow-dom template attribute (typically
  // created via DOM APIs during client navigations), clean up to save memory.
  if (template.hasAttribute('shadowrootmode')) {
    template.remove();
  }
}

if (
  typeof HTMLElement !== 'undefined' &&
  customElements.get(FILE_TREE_TAG_NAME) == null
) {
  class FileTreeContainer extends HTMLElement {
    constructor() {
      super();
    }

    connectedCallback() {
      const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      adoptDeclarativeShadowDom(this, shadowRoot);
      ensureFileTreeStyles(shadowRoot);
    }
  }

  customElements.define(FILE_TREE_TAG_NAME, FileTreeContainer);

  // Make adoption synchronous for already-parsed SSR markup so React hydration
  // doesn't observe a leftover <template shadowrootmode="open"> in non-DSD
  // browsers (or DOM-inserted templates during dev refresh workflows).
  //
  // This is a best-effort pass; connectedCallback still handles future nodes.
  if (typeof document !== 'undefined') {
    for (const el of Array.from(
      document.querySelectorAll(FILE_TREE_TAG_NAME)
    )) {
      if (!(el instanceof HTMLElement)) continue;
      const shadowRoot = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
      adoptDeclarativeShadowDom(el, shadowRoot);
      ensureFileTreeStyles(shadowRoot);
    }
  }
}

export const FileTreeContainerLoaded = true;
