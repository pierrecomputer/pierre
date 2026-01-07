import { FILE_TREE_TAG_NAME } from '../constants';
import styles from '../style.css';

if (
  typeof HTMLElement !== 'undefined' &&
  customElements.get(FILE_TREE_TAG_NAME) == null
) {
  let sheet: CSSStyleSheet | undefined;

  class FileTreeContainer extends HTMLElement {
    constructor() {
      super();

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
  }

  customElements.define(FILE_TREE_TAG_NAME, FileTreeContainer);
}

export const FileTreeContainerLoaded = true;
