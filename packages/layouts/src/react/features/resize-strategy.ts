// The resize strategies other than `live`, as an internal feature for the
// bench: `frame`, `preview`, `freeze`, and `settle`. They are not in the
// package exports (`DEC-layouts-experiments-internal`); the bench imports
// this module from `src`.
import { useState } from 'react';

import { createResizeWork, type ResizeStrategy } from '../../dom/resize-work';
import type { Feature, FeatureHooks, ViewContext } from '../contract';
import { cornersOf } from './corners';

/** Apply the sizes of a pointer resize with a strategy of the bench. */
export function resizeStrategy(strategy: ResizeStrategy): Feature {
  function useResizeStrategy(context: ViewContext): FeatureHooks {
    const [work] = useState(() => createResizeWork(context.store));
    if (strategy === 'live') return {};
    return {
      applySizes(element, separators, sizes) {
        work.apply(
          element,
          strategy,
          separators,
          sizes,
          cornersOf(context.cssLayoutOf(context.store.getSnapshot().root))
        );
      },
      endResize(cancel) {
        work.end(cancel);
      },
    };
  }
  return { name: 'resize-strategy', use: useResizeStrategy };
}
