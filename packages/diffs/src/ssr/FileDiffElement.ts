if (typeof HTMLElement !== 'undefined') {
  class FileDiffElement extends HTMLElement {
    constructor() {
      super();
    }
  }

  if (customElements.get('file-diff') === undefined) {
    customElements.define('file-diff', FileDiffElement);
  }
}

export {};
