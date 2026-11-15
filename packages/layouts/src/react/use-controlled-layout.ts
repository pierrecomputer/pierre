'use client';

// `Layout.useControlledLayout`: a layout object for a tree that the app owns.
import { useLayoutEffect, useRef, useState } from 'react';

import type { LayoutNode } from '../types';
import type { Feature } from './contract';
import { createLayout, type LayoutObject } from './create-layout';

/**
 * A layout object that follows a tree that the app owns:
 * `<Layout.Root layout={useControlledLayout(tree, features)} />`. It applies
 * each new tree before the browser paints. The features are read once, at
 * the first render. The app takes the sizes of a resize from the `onResize`
 * prop of `Root`, and keeps them in its tree.
 */
export function useControlledLayout<const F extends readonly Feature[] = []>(
  root: LayoutNode,
  features?: F
): LayoutObject<F> {
  const [layout] = useState(() => createLayout(root, features));
  const applied = useRef(root);
  useLayoutEffect(() => {
    if (root === applied.current) return;
    applied.current = root;
    layout.setRoot(root);
  }, [layout, root]);
  return layout;
}
