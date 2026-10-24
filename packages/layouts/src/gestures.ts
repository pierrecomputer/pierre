import { getExitEdge } from './geometry';
import type { Edge, LayoutGeometry, Rect, SeparatorGeometry } from './types';

/** Where a dragged pane goes: beside a pane, at one of its edges, and the box that shows it. */
export interface DropTarget {
  paneId: string;
  edge: Edge;
  rect: Rect;
}

const clampRatio = (separator: SeparatorGeometry, ratio: number): number =>
  Math.max(separator.minRatio, Math.min(separator.maxRatio, ratio));

/** The space that a split divides along its axis, without the separator. */
function available(separator: SeparatorGeometry): number {
  return separator.split.direction === 'horizontal'
    ? separator.container.width - separator.rect.width
    : separator.container.height - separator.rect.height;
}

/**
 * The ratios of the dragged splits after the pointer moved by `dx` and `dy`
 * pixels from where the drag started. Each ratio stays within the limits of
 * its split.
 */
export function dragRatios(
  separators: readonly SeparatorGeometry[],
  dx: number,
  dy: number
): Record<string, number> {
  const ratios: Record<string, number> = {};
  for (const separator of separators) {
    const space = available(separator);
    if (space <= 0) continue;
    const delta = separator.split.direction === 'horizontal' ? dx : dy;
    ratios[separator.split.id] = clampRatio(
      separator,
      separator.ratio + delta / space
    );
  }
  return ratios;
}

/**
 * The ratios after a key press on a separator or a corner: arrow keys step by
 * 2% (10% with Shift), Home and End go to the limits, and Enter balances.
 * Null when the key does not resize.
 */
export function keyRatios(
  separators: readonly SeparatorGeometry[],
  key: string,
  shift: boolean
): Record<string, number> | null {
  const ratios: Record<string, number> = {};
  for (const separator of separators) {
    const horizontal = separator.split.direction === 'horizontal';
    const step = shift ? 0.1 : 0.02;
    const value =
      key === (horizontal ? 'ArrowLeft' : 'ArrowUp')
        ? separator.ratio - step
        : key === (horizontal ? 'ArrowRight' : 'ArrowDown')
          ? separator.ratio + step
          : key === 'Home'
            ? separator.minRatio
            : key === 'End'
              ? separator.maxRatio
              : key === 'Enter'
                ? 0.5
                : null;
    if (value !== null)
      ratios[separator.split.id] = clampRatio(separator, value);
  }
  return Object.keys(ratios).length > 0 ? ratios : null;
}

/** The pane under a point of the layout, other than the pane that moves. */
export function paneAt(
  geometry: LayoutGeometry,
  x: number,
  y: number,
  except: string
): LayoutGeometry['panes'][number] | undefined {
  return geometry.panes.find(
    ({ pane, rect }) =>
      pane.id !== except &&
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
  );
}

/** Pick the closest side of a pane and show exactly where a dragged pane will be inserted. */
export function dropTarget(
  paneId: string,
  rect: Rect,
  x: number,
  y: number
): DropTarget {
  const sides: [Edge, number][] = [
    ['left', (x - rect.x) / rect.width],
    ['right', (rect.x + rect.width - x) / rect.width],
    ['top', (y - rect.y) / rect.height],
    ['bottom', (rect.y + rect.height - y) / rect.height],
  ];
  const edge = sides.sort((a, b) => a[1] - b[1])[0][0];
  return {
    paneId,
    edge,
    rect: {
      x: rect.x + (edge === 'right' ? rect.width / 2 : 0),
      y: rect.y + (edge === 'bottom' ? rect.height / 2 : 0),
      width: edge === 'left' || edge === 'right' ? rect.width / 2 : rect.width,
      height:
        edge === 'top' || edge === 'bottom' ? rect.height / 2 : rect.height,
    },
  };
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
