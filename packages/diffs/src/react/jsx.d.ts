import 'react';
import type { DIFFS_TAG_NAME } from '../constants';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [DIFFS_TAG_NAME]: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
