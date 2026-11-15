'use client';

// `Layout.useCover`: the cover of a layout by a dialog component of the app.
import { type RefObject, useLayoutEffect, useRef } from 'react';

import { coverLayout, type CoverOptions } from '../overlays/cover';
import type { ViewStore } from './contract';
import { layoutElementOf } from './layout-elements';

/**
 * Cover the panes of a layout with an overlay of the app while `open` is
 * true: a dialog, a popover, or a drawer of any library. The panes that the
 * overlay covers completely stop rendering, and they render again when
 * `open` becomes false, under the exit of the overlay. `layout` is the
 * layout object of `Layout.Root`, or a ref of the layout element.
 */
export function useCover(
  layout: ViewStore | RefObject<HTMLElement | null>,
  overlay: RefObject<HTMLElement | null>,
  open: boolean,
  options?: CoverOptions
): void {
  // The latest options, so that a new options object starts no new cover.
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  // A layout effect, so that a cover of every pane comes before the app's
  // own effects show the overlay.
  useLayoutEffect(() => {
    if (!open) return;
    const element =
      'current' in layout ? layout.current : layoutElementOf(layout);
    const target = overlay.current;
    if (element === null || target === null) return;
    return coverLayout(element, target, {
      area: latest.current?.area,
      onCover: (cover) => latest.current?.onCover?.(cover),
    });
  }, [open, layout, overlay]);
}
