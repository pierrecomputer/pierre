import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pjs-container': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
