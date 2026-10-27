import { getExitEdge } from './geometry';
import type {
  ChildExtent,
  Edge,
  LayoutGeometry,
  Rect,
  SeparatorGeometry,
} from './types';

/** Where a dragged pane goes: beside a pane, at one of its edges, and the box that shows it. */
export interface DropTarget {
  paneId: string;
  edge: Edge;
  rect: Rect;
}

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** The place of the separator among the visible children of its split. */
const orderOf = (separator: SeparatorGeometry): number =>
  separator.children.findIndex(({ index }) => index === separator.index);

/**
 * The pixel sizes of the visible children of a split after a separator moved
 * by `delta` pixels. The children on the side that the separator moves into
 * shrink, the nearest first, each down to its minimum size. The child on the
 * other side of the separator grows by the same amount. So a move changes only
 * the two children beside the separator, until one reaches its minimum size.
 */
export function moveSeparator(
  children: readonly ChildExtent[],
  order: number,
  delta: number
): number[] {
  const sizes = children.map(({ size }) => size);
  const shrinking =
    delta < 0
      ? sizes.map((_, index) => order - 1 - index).filter((index) => index >= 0)
      : sizes
          .map((_, index) => order + index)
          .filter((index) => index < sizes.length);
  let remaining = Math.abs(delta);
  for (const index of shrinking) {
    const taken = Math.min(
      remaining,
      Math.max(0, sizes[index] - children[index].min)
    );
    sizes[index] -= taken;
    remaining -= taken;
  }
  sizes[delta < 0 ? order : order - 1] += Math.abs(delta) - remaining;
  return sizes;
}

/**
 * The sizes of a split, as weights, from the pixel sizes of its visible
 * children. The visible children keep the sum of their weights, and hidden
 * children keep theirs.
 */
function toWeights(
  separator: SeparatorGeometry,
  pixels: readonly number[]
): number[] {
  const { split, children } = separator;
  const sizes = [...split.sizes];
  const space = sum(pixels);
  if (space <= 0) return sizes;
  const weight = sum(children.map(({ index }) => split.sizes[index]));
  children.forEach(({ index }, order) => {
    // A weight stays positive when a child has no minimum size.
    sizes[index] = (Math.max(pixels[order], space * 0.001) / space) * weight;
  });
  return sizes;
}

/**
 * The sizes of the dragged splits after the pointer moved by `dx` and `dy`
 * pixels from where the drag started (see `moveSeparator`).
 */
export function dragSizes(
  separators: readonly SeparatorGeometry[],
  dx: number,
  dy: number
): Record<string, number[]> {
  const sizes: Record<string, number[]> = {};
  for (const separator of separators) {
    const delta = separator.split.direction === 'horizontal' ? dx : dy;
    sizes[separator.split.id] = toWeights(
      separator,
      moveSeparator(separator.children, orderOf(separator), delta)
    );
  }
  return sizes;
}

/**
 * The sizes after a key press on a separator or a corner: arrow keys move the
 * separator by 2% of the split (10% with Shift), Home and End move it until
 * the child before or after it has its minimum size, and Enter gives the two
 * children beside it the same size. Null when the key does not resize.
 */
export function keySizes(
  separators: readonly SeparatorGeometry[],
  key: string,
  shift: boolean
): Record<string, number[]> | null {
  const sizes: Record<string, number[]> = {};
  for (const separator of separators) {
    const horizontal = separator.split.direction === 'horizontal';
    const order = orderOf(separator);
    const before = separator.children[order - 1];
    const after = separator.children[order];
    const step =
      (shift ? 0.1 : 0.02) * sum(separator.children.map(({ size }) => size));
    const delta =
      key === (horizontal ? 'ArrowLeft' : 'ArrowUp')
        ? -step
        : key === (horizontal ? 'ArrowRight' : 'ArrowDown')
          ? step
          : key === 'Home'
            ? -Math.max(0, before.size - before.min)
            : key === 'End'
              ? Math.max(0, after.size - after.min)
              : key === 'Enter'
                ? (after.size - before.size) / 2
                : null;
    if (delta !== null)
      sizes[separator.split.id] = toWeights(
        separator,
        moveSeparator(separator.children, order, delta)
      );
  }
  return Object.keys(sizes).length > 0 ? sizes : null;
}

/**
 * How far a separator moves along its split, in pixels, when the split takes
 * new sizes.
 */
export function separatorOffset(
  separator: SeparatorGeometry,
  sizes: readonly number[]
): number {
  const order = orderOf(separator);
  const weights = separator.children.map(({ index }) => sizes[index]);
  const space = sum(separator.children.map(({ size }) => size));
  const before = sum(
    separator.children.slice(0, order).map(({ size }) => size)
  );
  const total = sum(weights);
  return total > 0
    ? (sum(weights.slice(0, order)) / total) * space - before
    : 0;
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
