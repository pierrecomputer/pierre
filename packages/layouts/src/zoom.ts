// Zoom: one pane fills the layout, and the others wait under it. The store
// command, and the edge past which each pane leaves when another pane zooms.
import type { LayoutOperation } from './layout-operation';
import { foldActivate } from './model';
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

/**
 * The zoom commands of a store. The zoom of a tab that does not show gives
 * two operations: `activate`, which a server folds, and `zoom`.
 */
export const zoom: StoreFeature<ZoomCommands> = {
  folds: { activate: foldActivate },
  commands: ({ get, fold, commit, requirePane }) => {
    const zoomTo = (id: string, restore: boolean): void => {
      const state = get();
      const activate = { type: 'activate', pane: id } as const;
      const operations: LayoutOperation[] = [
        { type: 'zoom', pane: restore ? null : id },
      ];
      if (!restore) operations.unshift(activate);
      commit(
        {
          root: restore ? state.root : fold(activate),
          focusedPane: id,
          zoomedPane: restore ? null : id,
        },
        operations
      );
    };
    return {
      toggleZoom(id = get().focusedPane) {
        requirePane(id);
        zoomTo(id, get().zoomedPane === id);
      },
      setZoom(id) {
        const state = get();
        if (id === state.zoomedPane) return;
        if (id === null)
          commit({ ...state, zoomedPane: null }, [
            { type: 'zoom', pane: null },
          ]);
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
