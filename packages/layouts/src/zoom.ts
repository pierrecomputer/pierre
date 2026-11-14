// Zoom: the edge past which each pane leaves when another pane fills the
// layout.
import type { Edge, Rect } from './types';

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
