import {
  byFreeOrder,
  getMinimumSize,
  separatorId,
  visibleChildren,
} from './geometry';
import {
  add,
  constant,
  max,
  min,
  type Piecewise,
  scale,
  size,
  toCSS,
} from './piecewise';
import type { LayoutNode, PaneNode, SplitNode } from './types';

export interface CSSRect {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface CSSPane {
  pane: PaneNode;
  rect: CSSRect;
  /**
   * The pane, or a split above it, holds only hidden panes. Its rect is the
   * box that it would have if it were visible, so it shows again in place.
   */
  hidden: boolean;
}

export interface CSSSeparator {
  /** The ID of the separator (see `separatorId`). */
  id: string;
  split: SplitNode;
  /** The index in `split.children` of the child after the separator. */
  index: number;
  /** The visible child before the separator. */
  before: LayoutNode;
  /**
   * The preferred place of the separator in the split, from 0 to 1: the
   * weights of the visible children before it over those of all visible
   * children.
   */
  value: number;
  rect: CSSRect;
}

export interface CSSCorner {
  id: string;
  separatorIds: readonly string[];
  left: string;
  top: string;
}

export interface CSSLayout {
  panes: CSSPane[];
  separators: CSSSeparator[];
  corners: CSSCorner[];
}

/**
 * The IDs of the separators that meet one edge of a subtree at a right angle,
 * independently of the container size.
 */
function boundarySeparators(
  node: LayoutNode,
  edge: 'left' | 'right' | 'top' | 'bottom'
): string[] {
  if (node.type === 'pane') return [];
  const visible = visibleChildren(node);
  if (visible.length === 1)
    return boundarySeparators(node.children[visible[0]], edge);
  const start = edge === 'left' || edge === 'top';
  if (
    (node.direction === 'horizontal') ===
    (edge === 'left' || edge === 'right')
  )
    return boundarySeparators(
      node.children[start ? visible[0] : visible[visible.length - 1]],
      edge
    );
  return [
    ...visible.slice(1).map((index) => separatorId(node, index)),
    ...visible.flatMap((index) =>
      boundarySeparators(node.children[index], edge)
    ),
  ];
}

interface Box {
  left: Piecewise;
  top: Piecewise;
  width: Piecewise;
  height: Piecewise;
}

const toRect = (box: Box): CSSRect => ({
  left: toCSS(box.left, '100cqw'),
  top: toCSS(box.top, '100cqh'),
  width: toCSS(box.width, '100cqw'),
  height: toCSS(box.height, '100cqh'),
});

/** `shareSpace` of geometry.ts, as a function of the container size. */
function shareSpace(
  available: Piecewise,
  weights: readonly number[],
  mins: readonly number[]
): Piecewise[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) => weight / total);
  const minimum = mins.reduce((sum, value) => sum + value, 0);
  let lambda = available;
  let pinned = minimum;
  let free = 0;
  for (const index of byFreeOrder(shares, mins).slice(0, -1)) {
    pinned -= mins[index];
    free += shares[index];
    lambda = min(lambda, scale(add(available, constant(-pinned)), 1 / free));
  }
  const sizes = shares.map((share, index) =>
    max(
      minimum === 0
        ? constant(0)
        : min(constant(mins[index]), scale(available, mins[index] / minimum)),
      scale(lambda, share)
    )
  );
  sizes[sizes.length - 1] = sizes
    .slice(0, -1)
    .reduce((rest, size) => add(rest, scale(size, -1)), available);
  return sizes;
}

/**
 * Compile the split tree to one CSS value for each property of each element,
 * once per tree change. Each horizontal edge is a piecewise-linear function of
 * the container width, and each vertical edge of its height, so `toCSS` writes
 * it with container units and one hinge term for each size at which a minimum
 * size or a gap starts to apply. The browser resolves container resizes with
 * no script, and a size change restyles only the elements whose values change.
 */
export function computeCSSLayout(root: LayoutNode, gap = 8): CSSLayout {
  if (!Number.isFinite(gap) || gap < 0)
    throw new Error('Layout gap must be finite and non-negative');
  const panes: CSSPane[] = [];
  const separators: (Omit<CSSSeparator, 'rect'> & { box: Box })[] = [];
  function visit(node: LayoutNode, box: Box, hidden: boolean): void {
    if (node.type === 'pane') {
      panes.push({
        pane: node,
        rect: toRect(box),
        hidden: hidden || node.hidden === true,
      });
      return;
    }
    const all = node.children.map((_, index) => index);
    const visible = hidden ? all : visibleChildren(node);
    const shown = divide(node, visible, box);
    if (!hidden) {
      const weights = visible.map((index) => node.sizes[index]);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let before = 0;
      visible.forEach((index, order) => {
        if (order > 0)
          separators.push({
            id: separatorId(node, index),
            split: node,
            index,
            before: node.children[visible[order - 1]],
            value: before / total,
            box: shown.handles[order - 1],
          });
        before += weights[order];
      });
    }
    // A hidden child keeps the box that it would have if it were visible.
    const wouldHave =
      visible.length === all.length ? shown : divide(node, all, box);
    node.children.forEach((child, index) => {
      const order = visible.indexOf(index);
      visit(
        child,
        order === -1 ? wouldHave.boxes[index] : shown.boxes[order],
        hidden || order === -1
      );
    });
  }
  /**
   * The boxes of some children of a split, in order, and of the separators
   * between them. The children share the box of the split with `shareSpace`.
   */
  function divide(
    node: SplitNode,
    indexes: readonly number[],
    box: Box
  ): { boxes: Box[]; handles: Box[] } {
    if (indexes.length === 1) return { boxes: [box], handles: [] };
    const horizontal = node.direction === 'horizontal';
    const axis = horizontal ? 'width' : 'height';
    const position = horizontal ? 'left' : 'top';
    const separatorCount = indexes.length - 1;
    // The gaps shrink in a container smaller than the gaps.
    const actualGap = min(constant(gap), scale(box[axis], 1 / separatorCount));
    const available = max(
      constant(0),
      add(box[axis], scale(actualGap, -separatorCount))
    );
    const sizes = shareSpace(
      available,
      indexes.map((index) => node.sizes[index]),
      indexes.map((index) => getMinimumSize(node.children[index], gap)[axis])
    );
    const boxes: Box[] = [];
    const handles: Box[] = [];
    let start = box[position];
    sizes.forEach((childSize, order) => {
      if (order > 0) {
        handles.push({ ...box, [position]: start, [axis]: actualGap });
        start = add(start, actualGap);
      }
      boxes.push({ ...box, [position]: start, [axis]: childSize });
      start = add(start, childSize);
    });
    return { boxes, handles };
  }
  visit(
    root,
    {
      left: constant(0),
      top: constant(0),
      width: size(),
      height: size(),
    },
    false
  );
  const byId = new Map(
    separators.map((separator) => [separator.id, separator])
  );
  const corners: CSSCorner[] = [];
  for (const separator of separators) {
    const horizontal = separator.split.direction === 'horizontal';
    const adjacent = [
      ...boundarySeparators(separator.before, horizontal ? 'right' : 'bottom'),
      ...boundarySeparators(
        separator.split.children[separator.index],
        horizontal ? 'left' : 'top'
      ),
    ];
    for (const otherId of adjacent) {
      const other = byId.get(otherId);
      if (other === undefined) continue;
      const h = horizontal ? separator : other;
      const v = horizontal ? other : separator;
      const id = `${h.id}:${v.id}`;
      if (corners.some((corner) => corner.id === id)) continue;
      corners.push({
        id,
        separatorIds: [h.id, v.id],
        left: toCSS(
          add(add(h.box.left, scale(h.box.width, 0.5)), constant(-7)),
          '100cqw'
        ),
        top: toCSS(
          add(add(v.box.top, scale(v.box.height, 0.5)), constant(-7)),
          '100cqh'
        ),
      });
    }
  }
  return {
    panes,
    separators: separators.map(({ box, ...separator }) => ({
      ...separator,
      rect: toRect(box),
    })),
    corners,
  };
}
