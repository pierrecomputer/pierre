import { getMinimumSize } from './geometry';
import {
  add,
  clamp,
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
}

export interface CSSSeparator {
  split: SplitNode;
  rect: CSSRect;
}

export interface CSSCorner {
  id: string;
  splitIds: readonly string[];
  left: string;
  top: string;
}

export interface CSSLayout {
  panes: CSSPane[];
  separators: CSSSeparator[];
  corners: CSSCorner[];
}

/** Find perpendicular dividers that meet a subtree boundary, independently of viewport size. */
function boundarySplits(
  node: LayoutNode,
  edge: 'left' | 'right' | 'top' | 'bottom'
): SplitNode[] {
  if (node.type === 'pane') return [];
  const horizontalEdge = edge === 'left' || edge === 'right';
  if ((node.direction === 'horizontal') === horizontalEdge) {
    return boundarySplits(
      edge === 'left' || edge === 'top' ? node.first : node.second,
      edge
    );
  }
  return [
    node,
    ...boundarySplits(node.first, edge),
    ...boundarySplits(node.second, edge),
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

/**
 * Compile the split tree to one CSS value for each property of each element,
 * once per tree change. Each horizontal edge is a piecewise-linear function of
 * the container width, and each vertical edge of its height, so `toCSS` writes
 * it with container units and one hinge term for each size at which a minimum
 * size or a gap starts to apply. The browser resolves container resizes with
 * no script, and a ratio change restyles only the elements whose values change.
 */
export function computeCSSLayout(root: LayoutNode, gap = 8): CSSLayout {
  if (!Number.isFinite(gap) || gap < 0)
    throw new Error('Layout gap must be finite and non-negative');
  const panes: CSSPane[] = [];
  const separators: { split: SplitNode; box: Box }[] = [];
  function visit(node: LayoutNode, box: Box): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect: toRect(box) });
      return;
    }
    const horizontal = node.direction === 'horizontal';
    const axis = horizontal ? 'width' : 'height';
    const position = horizontal ? 'left' : 'top';
    // The gap shrinks in a container smaller than the gap.
    const actualGap = min(constant(gap), box[axis]);
    const available = max(constant(0), add(box[axis], scale(actualGap, -1)));
    const firstMin = getMinimumSize(node.first, gap)[axis];
    const secondMin = getMinimumSize(node.second, gap)[axis];
    // When the minimums cannot fit, the sides share the space in proportion.
    const share =
      firstMin + secondMin === 0 ? 0.5 : firstMin / (firstMin + secondMin);
    const lower = min(constant(firstMin), scale(available, share));
    const upper = max(lower, add(available, constant(-secondMin)));
    const firstSize = clamp(lower, scale(available, node.ratio), upper);
    const handle = {
      ...box,
      [position]: add(box[position], firstSize),
      [axis]: actualGap,
    };
    separators.push({ split: node, box: handle });
    visit(node.first, { ...box, [axis]: firstSize });
    visit(node.second, {
      ...box,
      [position]: add(handle[position], actualGap),
      [axis]: add(available, scale(firstSize, -1)),
    });
  }
  visit(root, {
    left: constant(0),
    top: constant(0),
    width: size(),
    height: size(),
  });
  const byId = new Map(
    separators.map((separator) => [separator.split.id, separator])
  );
  const corners: CSSCorner[] = [];
  for (const separator of separators) {
    const horizontal = separator.split.direction === 'horizontal';
    const adjacent = [
      ...boundarySplits(separator.split.first, horizontal ? 'right' : 'bottom'),
      ...boundarySplits(separator.split.second, horizontal ? 'left' : 'top'),
    ];
    for (const other of adjacent) {
      const otherSeparator = byId.get(other.id);
      if (otherSeparator === undefined) continue;
      const h = horizontal ? separator : otherSeparator;
      const v = horizontal ? otherSeparator : separator;
      const id = `${h.split.id}:${v.split.id}`;
      if (corners.some((corner) => corner.id === id)) continue;
      corners.push({
        id,
        splitIds: [h.split.id, v.split.id],
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
    separators: separators.map(({ split, box }) => ({
      split,
      rect: toRect(box),
    })),
    corners,
  };
}
