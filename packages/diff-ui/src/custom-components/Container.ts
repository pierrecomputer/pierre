import styles from '../style.css?raw';

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
  connectedCallback() {
    // Not sure what I need to do here... yet...
    // this.dataset.pjsContainer = '';
  }
}

customElements.define('pjs-container', PJSContainer);
