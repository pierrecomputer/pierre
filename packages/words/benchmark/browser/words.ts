import dark from '@pierre/highlights/themes/pierre-dark';
import light from '@pierre/highlights/themes/pierre-light';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';
import { createElement } from 'react';

import { mount } from './app.ts';

// Same configuration as the /words demo.
const plugins = {
  code: createHighlightsPlugin({
    themes: { light, dark },
    defaultColor: 'light-dark()',
  }),
};

mount(({ value, active, highlight, animated }) =>
  createElement(
    Markdown,
    {
      mode: 'streaming',
      isAnimating: active,
      animated: animated ? { animation: 'fadeIn', duration: 180 } : false,
      plugins: highlight ? plugins : undefined,
      controls: false,
      lineNumbers: false,
    },
    value
  )
);
