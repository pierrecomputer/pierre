// The resize strategies other than `live`, as an internal feature for the
// bench: `frame`, `preview`, `freeze`, and `settle`. They are not in the
// package exports (`DEC-layouts-experiments-internal`); the bench imports
// this module from `src`.
import { useState } from 'react';

import { createResizeWork, type ResizeStrategy } from '../../dom/resize-work';
import type {
  Feature,
  FeatureHooks,
  FeatureModule,
  Sizes,
  ViewContext,
} from '../contract';
import { cornersOf } from './corners';

/**
 * Apply the sizes of a pointer resize with a strategy of the bench, or with
 * the strategy that a function gives at each pointer move (the menus of the
 * demos).
 */
export function resizeStrategy(
  strategy: ResizeStrategy | (() => ResizeStrategy)
): Feature<object, 'resize-strategy', never> {
  const current = typeof strategy === 'function' ? strategy : () => strategy;
  function useResizeStrategy(context: ViewContext): FeatureHooks {
    const { store } = context;
    // The sizes of a frame are transient; the end of the gesture in `Root`
    // gives one operation.
    const transient = (sizes: Sizes): void =>
      store.transient(() => store.setSizes(sizes));
    const [work] = useState(() => createResizeWork(transient));
    if (strategy === 'live') return {};
    return {
      applySizes(element, separators, sizes) {
        const active = current();
        if (active === 'live') {
          transient(sizes);
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
  const feature: FeatureModule = {
    name: 'resize-strategy',
    use: useResizeStrategy,
  };
  return feature;
}
