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

/** The custom properties that one element's geometry uses, including the ones that those use. */
export type CSSVariables = Readonly<Record<string, string>>;

export interface CSSPane {
  pane: PaneNode;
  rect: CSSRect;
  variables: CSSVariables;
}

export interface CSSSeparator {
  split: SplitNode;
  rect: CSSRect;
  variables: CSSVariables;
}

export interface CSSCorner {
  id: string;
  splitIds: readonly string[];
  left: string;
  top: string;
  variables: CSSVariables;
}

export interface CSSLayout {
  variables: Record<string, string>;
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

/** Emit native CSS bounds once per tree change; container units resolve size without JS resize updates. */
export function computeCSSLayout(root: LayoutNode, gap = 8): CSSLayout {
  if (!Number.isFinite(gap) || gap < 0)
    throw new Error('Layout gap must be finite and non-negative');
  const variables: Record<string, string> = {};
  const panes: CSSPane[] = [];
  const separators: CSSSeparator[] = [];
  const corners: CSSCorner[] = [];
  let sequence = 0;
  // Each box gets four variables. Its scope holds them and the scope of the
  // boxes that its values refer to, so each element can carry its own geometry.
  function rect(
    values: CSSRect,
    scope: CSSVariables
  ): { rect: CSSRect; scope: CSSVariables } {
    const prefix = `--layout-box-${sequence++}`;
    const result = { left: '', top: '', width: '', height: '' };
    const own: Record<string, string> = { ...scope };
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      variables[`${prefix}-${key}`] = values[key];
      own[`${prefix}-${key}`] = values[key];
      result[key] = `var(${prefix}-${key})`;
    }
    return { rect: result, scope: own };
  }
  function visit(node: LayoutNode, bounds: CSSRect, scope: CSSVariables): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect: bounds, variables: scope });
      return;
    }
    const horizontal = node.direction === 'horizontal';
    const axis = horizontal ? 'width' : 'height';
    const position = horizontal ? 'left' : 'top';
    const actualGap = `min(${gap}px, ${bounds[axis]})`;
    const available = `max(0px, calc(${bounds[axis]} - ${actualGap}))`;
    const firstMin = getMinimumSize(node.first, gap)[axis];
    const secondMin = getMinimumSize(node.second, gap)[axis];
    const share =
      firstMin + secondMin === 0 ? 0.5 : firstMin / (firstMin + secondMin);
    const lower = `min(${firstMin}px, calc(${available} * ${share}))`;
    const upper = `max(${lower}, calc(${available} - ${secondMin}px))`;
    const first = rect(
      {
        ...bounds,
        [axis]: `clamp(${lower}, calc(${available} * ${node.ratio}), ${upper})`,
      },
      scope
    );
    const handle = rect(
      {
        ...bounds,
        [position]: `calc(${bounds[position]} + ${first.rect[axis]})`,
        [axis]: actualGap,
      },
      first.scope
    );
    const second = rect(
      {
        ...bounds,
        [position]: `calc(${handle.rect[position]} + ${actualGap})`,
        [axis]: `calc(${available} - ${first.rect[axis]})`,
      },
      handle.scope
    );
    separators.push({
      split: node,
      rect: handle.rect,
      variables: handle.scope,
    });
    visit(node.first, first.rect, first.scope);
    visit(node.second, second.rect, second.scope);
  }
  // Container units resolve to pixels when a registered `<length>` property
  // computes, so each pane host gets fixed sizes and stays a layout boundary.
  const whole = rect(
    { left: '0px', top: '0px', width: '100cqw', height: '100cqh' },
    {}
  );
  visit(root, whole.rect, whole.scope);
  pairCorners(
    separators,
    (h, v) => ({
      left: `calc(${h.rect.left} + ${h.rect.width} / 2 - 7px)`,
      top: `calc(${v.rect.top} + ${v.rect.height} / 2 - 7px)`,
      variables: { ...h.variables, ...v.variables },
    }),
    corners
  );
  return { variables, panes, separators, corners };
}

/** Find the corners where a horizontal and a vertical separator meet. */
function pairCorners<T extends { split: SplitNode }>(
  separators: readonly T[],
  make: (horizontal: T, vertical: T) => Omit<CSSCorner, 'id' | 'splitIds'>,
  corners: CSSCorner[]
): void {
  const byId = new Map(
    separators.map((separator) => [separator.split.id, separator])
  );
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
      corners.push({ id, splitIds: [h.split.id, v.split.id], ...make(h, v) });
    }
  }
}

interface PiecewiseBox {
  left: Piecewise;
  top: Piecewise;
  width: Piecewise;
  height: Piecewise;
}

/**
 * Compile the split tree to one CSS value for each property of each element,
 * with no custom properties. Each horizontal edge is a piecewise-linear
 * function of the container width, and each vertical edge of its height, so
 * `toCSS` writes it with container units and one hinge term for each point
 * where a minimum size or a gap starts to apply. `hinges: false` keeps only
 * the form for large containers, to measure the cost of the hinge terms.
 */
export function computePiecewiseCSSLayout(
  root: LayoutNode,
  gap = 8,
  hinges = true
): CSSLayout {
  if (!Number.isFinite(gap) || gap < 0)
    throw new Error('Layout gap must be finite and non-negative');
  const panes: CSSPane[] = [];
  const separators: (CSSSeparator & { box: PiecewiseBox })[] = [];
  const corners: CSSCorner[] = [];
  const none: CSSVariables = {};
  const css = (box: PiecewiseBox): CSSRect => ({
    left: toCSS(box.left, '100cqw', hinges),
    top: toCSS(box.top, '100cqh', hinges),
    width: toCSS(box.width, '100cqw', hinges),
    height: toCSS(box.height, '100cqh', hinges),
  });
  function visit(node: LayoutNode, box: PiecewiseBox): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect: css(box), variables: none });
      return;
    }
    const horizontal = node.direction === 'horizontal';
    const axis = horizontal ? 'width' : 'height';
    const position = horizontal ? 'left' : 'top';
    // The same steps as `computeCSSLayout`, on functions instead of strings.
    const actualGap = min(constant(gap), box[axis]);
    const available = max(constant(0), add(box[axis], scale(actualGap, -1)));
    const firstMin = getMinimumSize(node.first, gap)[axis];
    const secondMin = getMinimumSize(node.second, gap)[axis];
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
    separators.push({
      split: node,
      rect: css(handle),
      variables: none,
      box: handle,
    });
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
  pairCorners(
    separators,
    (h, v) => ({
      left: toCSS(
        add(add(h.box.left, scale(h.box.width, 0.5)), constant(-7)),
        '100cqw',
        hinges
      ),
      top: toCSS(
        add(add(v.box.top, scale(v.box.height, 0.5)), constant(-7)),
        '100cqh',
        hinges
      ),
      variables: none,
    }),
    corners
  );
  return {
    variables: {},
    panes,
    separators: separators.map(({ box: _box, ...separator }) => separator),
    corners,
  };
}
