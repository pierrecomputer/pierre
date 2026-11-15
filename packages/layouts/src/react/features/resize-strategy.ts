// The resize strategies other than `live`, as an internal feature for the
// bench: `frame`, `preview`, `freeze`, and `settle`. They are not in the
// package exports (`DEC-layouts-experiments-internal`); the bench imports
// this module from `src`.
import { useState } from 'react';

import { createResizeWork, type ResizeStrategy } from '../../dom/resize-work';
import type { Feature, FeatureHooks, ViewContext } from '../contract';
import { cornersOf } from './corners';

/**
 * Apply the sizes of a pointer resize with a strategy of the bench, or with
 * the strategy that a function gives at each pointer move (the menus of the
 * demos).
 */
export function resizeStrategy(
  strategy: ResizeStrategy | (() => ResizeStrategy)
): Feature {
  const current = typeof strategy === 'function' ? strategy : () => strategy;
  function useResizeStrategy(context: ViewContext): FeatureHooks {
    const [work] = useState(() => createResizeWork(context.store));
    if (strategy === 'live') return {};
    return {
      applySizes(element, separators, sizes) {
        const active = current();
        if (active === 'live') {
          context.store.setSizes(sizes);
          return;
        }
        work.apply(
          element,
          active,
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
