import styles from '../../../../packages/precision-diffs/dist/style.js';

export function ensureFileDiffElement() {
  if (typeof HTMLElement === 'undefined') {
    return;
  }
  if (customElements.get('file-diff') != null) {
    return;
  }

  class PJSContainer extends HTMLElement {
    constructor() {
      super();
      if (this.shadowRoot != null) return;
      const shadowRoot = this.attachShadow({ mode: 'open' });
      const styleElement = document.createElement('style');
      styleElement.textContent = styles;
      shadowRoot.appendChild(styleElement);
    }
  }

  customElements.define('file-diff', PJSContainer);
}
