import { DIFFS_TAG_NAME } from '../constants';
import styles from '../style.css';

// If HTMLElement is undefined it usually means we are in a server environment
// so best to just not do anything
if (
  typeof HTMLElement !== 'undefined' &&
  customElements.get(DIFFS_TAG_NAME) == null
) {
  let sheet: CSSStyleSheet | undefined;

  class FileDiffContainer extends HTMLElement {
    constructor() {
      super();
      // If shadow root is already open, we can sorta assume the
      // CSS is already in place
      if (this.shadowRoot != null) {
        return;
      }
      const shadowRoot = this.attachShadow({ mode: 'open' });
      if (sheet == null) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(styles);
      }
      shadowRoot.adoptedStyleSheets = [sheet];
    }
    // Not sure if we need to do anything here yet...
    // connectedCallback() {
    //   this.dataset.diffsContainer = '';
    // }
  }

  customElements.define(DIFFS_TAG_NAME, FileDiffContainer);
}

export const DiffsContainerLoaded = true;
