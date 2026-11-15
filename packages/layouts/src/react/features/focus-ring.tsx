'use client';

// `focusRing()`: a ring around the pane that has the focus of the layout, or
// around the layout while a pane fills it. It moves with its pane in a FLIP
// animation, because it has the animation key of its pane.
import type { CSSProperties } from 'react';

import focusRingCss from '../../css/focus-ring.css?inline';
import { presentation } from '../../presentation';
import type { Feature } from '../contract';

const FULL_SIZE: CSSProperties = {
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
};

/** Show a ring around the pane that has the focus of the layout. */
export function focusRing(): Feature {
  return {
    name: 'focus-ring',
    use: (_context, { state, geometry }) => {
      const id = presentation(state).filled ?? state.focusedPane;
      const host = geometry.panes.find(({ pane }) => pane.id === id);
      return {
        layers: () =>
          host === undefined ? null : (
            // A focus change replaces the ring, so it never moves to another pane.
            <div
              key={id}
              className="pierre-layout-focus"
              data-layout-flip={`pane:${id}`}
              aria-hidden="true"
              style={
                presentation(state).filled === null ? host.rect : FULL_SIZE
              }
            />
          ),
      };
    },
    stylesheets: [['focus-ring', focusRingCss]],
  };
}
