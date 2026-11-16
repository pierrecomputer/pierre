// Spatial queries from the tree, with no pixel size (`DEC-layouts-pane-commands`):
// the order of the panes for pane focus, and the panes across an edge of a
// pane for directional focus and the move items. A server and a unit test can
// call them, as they read the tree only.
import { getPanes, isFixed, shownPane, shownPanes, slotOf } from './model';
import type { Edge, LayoutNode, PaneNode, SplitNode } from './types';

/**
 * The panes that show, in the order of the tree: depth first, the children of
 * a row from left to right and of a column from top to bottom. A column
 * finishes before the next column starts, and a resize does not change the
 * order. A stack gives the tab that shows; with `tabs: true`, each tab that is
 * not hidden, in tab order. Hidden panes are left out; a collapsed pane is in
 * the order, as its header shows.
 */
export function visualOrder(
  root: LayoutNode,
  options: { readonly tabs?: boolean } = {}
): readonly PaneNode[] {
  return options.tabs === true
    ? getPanes(root).filter((pane) => pane.hidden !== true)
    : shownPanes(root);
}

const shows = (node: LayoutNode): boolean => shownPanes(node).length > 0;

const alongRow = (edge: Edge): boolean => edge === 'left' || edge === 'right';

/** The splits from the root to a node, each with the index of the child on the path. */
function pathTo(
  node: LayoutNode,
  id: string
): (readonly [SplitNode, number])[] | null {
  if (node.id === id) return [];
  if (node.type !== 'split') return null;
  for (let index = 0; index < node.children.length; index++) {
    const rest = pathTo(node.children[index], id);
    if (rest !== null) return [[node, index], ...rest];
  }
  return null;
}

/**
 * The panes of a node on its side that faces a pane across an edge: a split
 * along the axis gives its child nearest that side, a split across it all its
 * children, and a stack its tab that shows.
 */
function facing(node: LayoutNode, row: boolean, forward: boolean): PaneNode[] {
  if (node.type === 'pane') return node.hidden === true ? [] : [node];
  if (node.type === 'stack') {
    const tab = shownPane(node);
    return tab === null ? [] : [tab];
  }
  if ((node.direction === 'horizontal') !== row)
    return node.children.flatMap((child) => facing(child, row, forward));
  const nearest = (forward ? node.children : [...node.children].reverse()).find(
    shows
  );
  return nearest === undefined ? [] : facing(nearest, row, forward);
}

/**
 * The panes that show and touch one edge of a pane, in tree order: top to
 * bottom for left and right, left to right for top and bottom. A pane of a
 * stack has the neighbors of its stack. None at an edge of the layout.
 */
export function neighbors(
  root: LayoutNode,
  id: string,
  edge: Edge
): readonly PaneNode[] {
  const row = alongRow(edge);
  const forward = edge === 'right' || edge === 'bottom';
  const path = pathTo(root, slotOf(root, id)) ?? [];
  // The nearest split along the axis of the edge with a child that shows on
  // that side of the pane.
  for (let at = path.length - 1; at >= 0; at--) {
    const [split, index] = path[at];
    if ((split.direction === 'horizontal') !== row) continue;
    const side = forward
      ? split.children.slice(index + 1)
      : split.children.slice(0, index).reverse();
    const child = side.find(shows);
    if (child !== undefined) return facing(child, row, forward);
  }
  return [];
}

interface Span {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/**
 * The box of each node, pane, and tab in a unit square, from the weights of
 * the splits. A child in pixels counts as the mean weight of its split, as the
 * tree has no container size; a child with no pane that shows takes no space.
 */
function spansOf(
  node: LayoutNode,
  box: Span,
  out: Map<string, Span>
): Map<string, Span> {
  out.set(node.id, box);
  if (node.type === 'stack')
    for (const tab of node.children) out.set(tab.id, box);
  if (node.type !== 'split') return out;
  const visible = node.children.map(shows);
  const weights = node.sizes.filter(
    (size, index) => visible[index] && !isFixed(size)
  ) as number[];
  const mean =
    weights.length === 0
      ? 1
      : weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
  const shares = node.sizes.map((size, index) =>
    visible[index] ? (isFixed(size) ? mean : size) : 0
  );
  const total = shares.reduce((sum, share) => sum + share, 0);
  const row = node.direction === 'horizontal';
  const start = row ? box.x0 : box.y0;
  const length = row ? box.x1 - box.x0 : box.y1 - box.y0;
  let at = start;
  node.children.forEach((child, index) => {
    const end = at + (total === 0 ? 0 : (shares[index] / total) * length);
    spansOf(
      child,
      row ? { ...box, x0: at, x1: end } : { ...box, y0: at, y1: end },
      out
    );
    at = end;
  });
  return out;
}

/**
 * One pane across an edge of a pane, or null at an edge of the layout. When
 * several panes touch the edge, it keeps the panes whose span across the axis
 * overlaps the span of the pane, then the first of them in `recent` (the most
 * recently focused panes, most recent first), else the first in tree order.
 */
export function neighbor(
  root: LayoutNode,
  id: string,
  edge: Edge,
  recent: readonly string[] = []
): PaneNode | null {
  const list = neighbors(root, id, edge);
  if (list.length < 2) return list[0] ?? null;
  const spans = spansOf(root, { x0: 0, x1: 1, y0: 0, y1: 1 }, new Map());
  const own = spans.get(slotOf(root, id));
  const row = alongRow(edge);
  const overlapping = list.filter((pane) => {
    const span = spans.get(pane.id);
    if (own === undefined || span === undefined) return false;
    return row
      ? Math.min(own.y1, span.y1) - Math.max(own.y0, span.y0) > 1e-9
      : Math.min(own.x1, span.x1) - Math.max(own.x0, span.x0) > 1e-9;
  });
  const candidates = overlapping.length > 0 ? overlapping : list;
  for (const pane of recent) {
    const hit = candidates.find(({ id: each }) => each === pane);
    if (hit !== undefined) return hit;
  }
  return candidates[0];
}
