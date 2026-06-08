import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'file-tree-container': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
