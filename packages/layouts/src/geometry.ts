import { hasVisiblePane } from './model';
import type {
  ChildExtent,
  LayoutGeometry,
  LayoutNode,
  Rect,
  SeparatorGeometry,
  SplitNode,
} from './types';

const DEFAULT_MIN_WIDTH = 120;
const DEFAULT_MIN_HEIGHT = 80;

/**
 * Compute subtree minimums so resizing an ancestor respects every nested pane.
 * Hidden panes take no space, so a subtree of hidden panes has no minimum.
 */
export function getMinimumSize(
  node: LayoutNode,
  gap: number
): { width: number; height: number } {
  return minimumSize(node, gap) ?? { width: 0, height: 0 };
}

function minimumSize(
  node: LayoutNode,
  gap: number
): { width: number; height: number } | null {
  if (node.type === 'pane')
    return node.hidden === true
      ? null
      : {
          width: node.minWidth ?? DEFAULT_MIN_WIDTH,
          height: node.minHeight ?? DEFAULT_MIN_HEIGHT,
        };
  const sizes = node.children
    .map((child) => minimumSize(child, gap))
    .filter((size) => size !== null);
  if (sizes.length === 0) return null;
  const gaps = gap * (sizes.length - 1);
  const sum = (key: 'width' | 'height'): number =>
    sizes.reduce((total, size) => total + size[key], 0);
  const most = (key: 'width' | 'height'): number =>
    Math.max(...sizes.map((size) => size[key]));
  return node.direction === 'horizontal'
    ? { width: sum('width') + gaps, height: most('height') }
    : { width: most('width'), height: sum('height') + gaps };
}

/**
 * The ID of the separator before a child of a split: the ID of the split and
 * the index of the child. A split keeps the IDs of its separators when the
 * tree changes inside a child, for example when a new split wraps a pane, so
 * the view keeps each separator element and animates it from its old place.
 */
export const separatorId = (split: SplitNode, index: number): string =>
  `${split.id}:${index}`;

/** The indexes of the children of a split that take space. */
export function visibleChildren(split: SplitNode): number[] {
  return split.children.flatMap((child, index) =>
    hasVisiblePane(child) ? [index] : []
  );
}

/**
 * Divide `available` pixels among children with weights and minimum sizes.
 * Each child gets its share of the weights, unless that share is below its
 * minimum size: then it gets its minimum, and the other children share the
 * rest by weight. When the minimum sizes do not fit, each child gets a part in
 * proportion to its minimum size. The last child gets the rest, so that the
 * sizes add up to `available`.
 *
 * Child i gets max(min(mᵢ, A·mᵢ/M), sᵢ·λ), where A is the space, sᵢ the share
 * of the child's weight, mᵢ its minimum, and M the sum of the minimums. λ is
 * minₖ (A − Pₖ) / Sₖ: for each k, the k children with the lowest mᵢ/sᵢ share
 * by weight, Sₖ is the sum of their shares, and Pₖ is the sum of the minimums
 * of the others. `computeCSSLayout` builds the same function of the container
 * size.
 */
export function shareSpace(
  available: number,
  weights: readonly number[],
  mins: readonly number[]
): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) => weight / total);
  const minimum = mins.reduce((sum, value) => sum + value, 0);
  let lambda = available;
  let pinned = minimum;
  let free = 0;
  for (const index of byFreeOrder(shares, mins).slice(0, -1)) {
    pinned -= mins[index];
    free += shares[index];
    lambda = Math.min(lambda, (available - pinned) / free);
  }
  const sizes = shares.map((share, index) =>
    Math.max(
      minimum === 0
        ? 0
        : Math.min(mins[index], (available * mins[index]) / minimum),
      share * lambda
    )
  );
  sizes[sizes.length - 1] =
    available - sizes.slice(0, -1).reduce((sum, size) => sum + size, 0);
  return sizes;
}

/**
 * The children in the order in which they reach a size above their minimum as
 * the space grows: by minimum size over share, lowest first.
 */
export function byFreeOrder(
  shares: readonly number[],
  mins: readonly number[]
): number[] {
  return shares
    .map((_, index) => index)
    .sort((a, b) => mins[a] / shares[a] - mins[b] / shares[b]);
}

/**
 * Resolve preferred sizes without overwriting them when a viewport temporarily
 * constrains space. Hidden panes take no space and have no geometry.
 */
export function computeLayout(
  layout: LayoutNode,
  width: number,
  height: number,
  gap = 8
): LayoutGeometry {
  if (
    ![width, height, gap].every((value) => Number.isFinite(value) && value >= 0)
  ) {
    throw new Error(
      'Layout dimensions and gap must be finite and non-negative'
    );
  }
  if (!hasVisiblePane(layout))
    return { panes: [], separators: [], corners: [] };
  const panes: LayoutGeometry['panes'][number][] = [];
  const separators: SeparatorGeometry[] = [];
  function visit(node: LayoutNode, rect: Rect): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect });
      return;
    }
    const visible = visibleChildren(node);
    if (visible.length === 1) {
      visit(node.children[visible[0]], rect);
      return;
    }
    const horizontal = node.direction === 'horizontal';
    const size = horizontal ? rect.width : rect.height;
    const actualGap = Math.min(gap, size / (visible.length - 1));
    const available = Math.max(0, size - actualGap * (visible.length - 1));
    const mins = visible.map((index) => {
      const minimum = getMinimumSize(node.children[index], gap);
      return horizontal ? minimum.width : minimum.height;
    });
    const sizes = shareSpace(
      available,
      visible.map((index) => node.sizes[index]),
      mins
    );
    const children: ChildExtent[] = visible.map((index, order) => ({
      index,
      size: sizes[order],
      min: mins[order],
    }));
    // The start of each child along the axis of the split.
    const starts: number[] = [];
    let start = horizontal ? rect.x : rect.y;
    for (const size of sizes) {
      starts.push(start);
      start += size + actualGap;
    }
    // The separators of a split come before those of its children.
    visible.forEach((index, order) => {
      if (order === 0) return;
      const at = starts[order] - actualGap;
      separators.push({
        id: separatorId(node, index),
        split: node,
        index,
        rect: horizontal
          ? { x: at, y: rect.y, width: actualGap, height: rect.height }
          : { x: rect.x, y: at, width: rect.width, height: actualGap },
        container: rect,
        children,
      });
    });
    visible.forEach((index, order) =>
      visit(
        node.children[index],
        horizontal
          ? { ...rect, x: starts[order], width: sizes[order] }
          : { ...rect, y: starts[order], height: sizes[order] }
      )
    );
  }
  visit(layout, { x: 0, y: 0, width, height });
  const corners: LayoutGeometry['corners'][number][] = [];
  for (const horizontal of separators.filter(
    ({ split }) => split.direction === 'horizontal'
  )) {
    for (const vertical of separators.filter(
      ({ split }) => split.direction === 'vertical'
    )) {
      const x = horizontal.rect.x + horizontal.rect.width / 2;
      const y = vertical.rect.y + vertical.rect.height / 2;
      if (
        x >= vertical.rect.x - gap / 2 &&
        x <= vertical.rect.x + vertical.rect.width + gap / 2 &&
        y >= horizontal.rect.y - gap / 2 &&
        y <= horizontal.rect.y + horizontal.rect.height + gap / 2
      ) {
        const existing = corners.find(
          (corner) =>
            Math.abs(corner.x - x) < 0.01 && Math.abs(corner.y - y) < 0.01
        );
        if (existing === undefined) {
          corners.push({
            id: `${horizontal.id}:${vertical.id}`,
            x,
            y,
            separators: [horizontal, vertical],
          });
        } else {
          const index = corners.indexOf(existing);
          const touching = new Map(
            existing.separators.map((separator) => [separator.id, separator])
          );
          touching.set(horizontal.id, horizontal);
          touching.set(vertical.id, vertical);
          corners[index] = { ...existing, separators: [...touching.values()] };
        }
      }
    }
  }
  return { panes, separators, corners };
}

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
