import { getMinimumSize } from './geometry';
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
  function rect(values: CSSRect): CSSRect {
    const prefix = `--layout-box-${sequence++}`;
    const result = { left: '', top: '', width: '', height: '' };
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      variables[`${prefix}-${key}`] = values[key];
      result[key] = `var(${prefix}-${key})`;
    }
    return result;
  }
  function visit(node: LayoutNode, bounds: CSSRect): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect: bounds });
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
    const first = rect({
      ...bounds,
      [axis]: `clamp(${lower}, calc(${available} * ${node.ratio}), ${upper})`,
    });
    const handle = rect({
      ...bounds,
      [position]: `calc(${bounds[position]} + ${first[axis]})`,
      [axis]: actualGap,
    });
    const second = rect({
      ...bounds,
      [position]: `calc(${handle[position]} + ${actualGap})`,
      [axis]: `calc(${available} - ${first[axis]})`,
    });
    separators.push({ split: node, rect: handle });
    visit(node.first, first);
    visit(node.second, second);
  }
  visit(
    root,
    rect({ left: '0px', top: '0px', width: '100cqw', height: '100cqh' })
  );
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
      });
    }
  }
  return { variables, panes, separators, corners };
}
