// Zoom: one pane fills the layout, and the others wait under it. The store
// command, and the edge past which each pane leaves when another pane zooms.
import { activatePane, stackOf } from './model';
import type { StoreFeature } from './store';
import type { Edge, Rect } from './types';

export interface ZoomCommands {
  /**
   * Zoom a pane, the focused pane by default, or restore it. A pane of a stack
   * also becomes active.
   */
  toggleZoom(id?: string): void;
}

/** The zoom command of a store. */
export const zoom: StoreFeature<ZoomCommands> = {
  commands: ({ get, commit, requirePane }) => ({
    toggleZoom(id = get().focusedPane) {
      requirePane(id);
      const state = get();
      const restore = state.zoomedPane === id;
      commit({
        root:
          restore || stackOf(state.root, id) === null
            ? state.root
            : activatePane(state.root, id),
        focusedPane: id,
        zoomedPane: restore ? null : id,
      });
    },
  }),
};

/** Choose the direction of a zoom exit, preferring an edge the pane already touches. */
export function getExitEdge(
  rect: Rect,
  width: number,
  height: number
): 'left' | 'right' | 'top' | 'bottom' {
  const distances = [
    ['left', rect.x],
    ['right', width - rect.x - rect.width],
    ['top', rect.y],
    ['bottom', height - rect.y - rect.height],
  ] as const;
  return [...distances].sort((a, b) => a[1] - b[1])[0][0];
}
/**
 * The edge past which each pane leaves when another pane zooms, from the
 * boxes of the panes (keyed `pane:<id>`) and the size of the layout.
 */
export function getExitEdges(
  boxes: ReadonlyMap<string, Rect>,
  width: number,
  height: number
): Record<string, Edge> {
  const edges: Record<string, Edge> = {};
  for (const [key, box] of boxes) {
    if (key.startsWith('pane:'))
      edges[key.slice(5)] = getExitEdge(box, width, height);
  }
  return edges;
}
