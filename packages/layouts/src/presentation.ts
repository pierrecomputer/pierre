import { shownPanes } from './model';
import type { LayoutState } from './types';

/**
 * What fills the layout: the pane that fills it, the panes under that pane,
 * and whether the panes can be rearranged.
 */
export interface Presentation {
  /** The pane that fills the layout (a zoom), or null. */
  readonly filled: string | null;
  /** The panes that show under the pane that fills the layout. */
  readonly covered: ReadonlySet<string>;
  /** True when no pane fills the layout, so a drag can rearrange the panes. */
  readonly rearrangeable: boolean;
}

const presentations = new WeakMap<LayoutState, Presentation>();

// The covered panes when no pane fills the layout: one set, so that its
// identity does not change from state to state.
const NONE: ReadonlySet<string> = new Set();

/**
 * What fills the layout in a state. Features and parts read it, not the zoom
 * of the state. It is computed once for each state.
 */
export function presentation(state: LayoutState): Presentation {
  let value = presentations.get(state);
  if (value === undefined) {
    const filled = state.zoomedPane;
    value = {
      filled,
      covered:
        filled === null
          ? NONE
          : new Set(
              shownPanes(state.root)
                .map((pane) => pane.id)
                .filter((id) => id !== filled)
            ),
      rearrangeable: filled === null,
    };
    presentations.set(state, value);
  }
  return value;
}
