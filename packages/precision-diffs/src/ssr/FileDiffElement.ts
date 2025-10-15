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

export const FileDiffElementHasLoaded = true;

// IDK how many of these we need, but these two seem needed
// for everything in our setup. naturally it's not gonna do anything
// for solid or something.
declare module 'react/jsx-runtime' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'file-diff': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'file-diff': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
