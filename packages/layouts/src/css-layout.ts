import { getMinimumSize } from './geometry';
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
  // Each value uses one axis, so 100% of the containing block, the layout
  // root, gives the root size without container units.
  const whole = rect(
    { left: '0px', top: '0px', width: '100%', height: '100%' },
    {}
  );
  visit(root, whole.rect, whole.scope);
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
      corners.push({
        id,
        splitIds: [h.split.id, v.split.id],
        left: `calc(${h.rect.left} + ${h.rect.width} / 2 - 7px)`,
        top: `calc(${v.rect.top} + ${v.rect.height} / 2 - 7px)`,
        variables: { ...h.variables, ...v.variables },
      });
    }
  }
  return { variables, panes, separators, corners };
}
