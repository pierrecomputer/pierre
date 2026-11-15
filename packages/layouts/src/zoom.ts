// Zoom: one pane fills the layout, and the others wait under it. The store
// command, and the edge past which each pane leaves when another pane zooms.
import { activatePane, stackOf } from './model';
import type { StoreFeature } from './store';
import type { Edge, Rect } from './types';

export interface ZoomCommands {
  /**
   * Zoom a pane, the focused pane by default, or restore it. A pane of a stack
   * also becomes active. The pane takes the focus.
   */
  toggleZoom(id?: string): void;
  /**
   * Zoom a pane, or restore the layout with `null`. A pane of a stack also
   * becomes active, and the pane takes the focus. The focus stays at a
   * restore.
   */
  setZoom(id: string | null): void;
}

/** The zoom commands of a store. */
export const zoom: StoreFeature<ZoomCommands> = {
  commands: ({ get, commit, requirePane }) => {
    const zoomTo = (id: string, restore: boolean): void => {
      const state = get();
      commit({
        root:
          restore || stackOf(state.root, id) === null
            ? state.root
            : activatePane(state.root, id),
        focusedPane: id,
        zoomedPane: restore ? null : id,
      });
    };
    return {
      toggleZoom(id = get().focusedPane) {
        requirePane(id);
        zoomTo(id, get().zoomedPane === id);
      },
      setZoom(id) {
        const state = get();
        if (id === state.zoomedPane) return;
        if (id === null) commit({ ...state, zoomedPane: null });
        else {
          requirePane(id);
          zoomTo(id, false);
        }
      },
    };
  },
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
