import 'react';

declare module 'react' {
  // oxlint-disable-next-line typescript/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'file-tree-container': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
