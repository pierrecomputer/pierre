import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'file-diff': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
