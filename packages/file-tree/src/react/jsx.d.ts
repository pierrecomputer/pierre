import 'react';

import type { FILE_TREE_TAG_NAME } from '../constants';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [FILE_TREE_TAG_NAME]: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
