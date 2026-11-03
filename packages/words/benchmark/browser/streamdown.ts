import { code } from '@streamdown/code';
import { createElement } from 'react';
import { Streamdown } from 'streamdown';
import 'streamdown/styles.css';

import { mount } from './app.ts';

// Count async Shiki results so the replay settles only after every fence is highlighted.
let pending = 0;
const plugins = {
  code: {
    ...code,
    highlight(...[options, callback]: Parameters<typeof code.highlight>) {
      pending++;
      const result = code.highlight(options, (value) => {
        pending--;
        callback?.(value);
      });
      if (result !== null) pending--;
      return result;
    },
  },
};

mount(
  ({ value, active, highlight, animated }) =>
    createElement(
      Streamdown,
      {
        mode: 'streaming',
        dir: 'ltr',
        isAnimating: active,
        animated: animated
          ? {
              animation: 'fadeIn',
              duration: 180,
              easing: 'ease-out',
              sep: 'word',
              stagger: 0,
            }
          : false,
        plugins: highlight ? plugins : undefined,
        controls: false,
        lineNumbers: false,
        codeBlockMaxHeight: 0,
      },
      value
    ),
  () => pending
);
