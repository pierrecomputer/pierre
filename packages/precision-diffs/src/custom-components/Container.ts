'use client';

import styles from '../style.css?raw';

// If HTMLElement is undefined it usually means we are in a server environment
// so best to just not do anything
if (typeof HTMLElement !== 'undefined') {
  let sheet: CSSStyleSheet | undefined;

  class PJSContainer extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      if (sheet == null) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(styles);
      }
      // TODO(amadeus): Figure out how to adapt user generated styles into here?
      if (this.shadowRoot?.adoptedStyleSheets != null) {
        this.shadowRoot.adoptedStyleSheets = [sheet];
      }
    }
    // Not sure if we need to do anything here yet...
    // connectedCallback() {
    //   this.dataset.pjsContainer = '';
    // }
  }

  customElements.define('pjs-container', PJSContainer);
}

// Generate a hash of the style injection
// import crypto from 'node:crypto';
// const hash = crypto
//   .createHash('sha256')
//   .update(Buffer.from(styles, 'utf8'))
//   .digest('base64');

// console.log(`sha256-${hash}`);
