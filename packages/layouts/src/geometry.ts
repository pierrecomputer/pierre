import type {
  LayoutGeometry,
  LayoutNode,
  Rect,
  SeparatorGeometry,
} from './types';

const DEFAULT_MIN_WIDTH = 120;
const DEFAULT_MIN_HEIGHT = 80;

/** Compute subtree minimums so resizing an ancestor respects every nested pane. */
export function getMinimumSize(
  node: LayoutNode,
  gap: number
): { width: number; height: number } {
  if (node.type === 'pane')
    return {
      width: node.minWidth ?? DEFAULT_MIN_WIDTH,
      height: node.minHeight ?? DEFAULT_MIN_HEIGHT,
    };
  const first = getMinimumSize(node.first, gap);
  const second = getMinimumSize(node.second, gap);
  return node.direction === 'horizontal'
    ? {
        width: first.width + second.width + gap,
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: first.height + second.height + gap,
      };
}

/** Resolve preferred ratios without overwriting them when a viewport temporarily constrains space. */
export function computeLayout(
  root: LayoutNode,
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
  const panes: LayoutGeometry['panes'][number][] = [];
  const separators: SeparatorGeometry[] = [];
  function visit(node: LayoutNode, rect: Rect): void {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect });
      return;
    }
    const horizontal = node.direction === 'horizontal';
    const size = horizontal ? rect.width : rect.height;
    const actualGap = Math.min(gap, size);
    const available = size - actualGap;
    const firstMin = getMinimumSize(node.first, gap);
    const secondMin = getMinimumSize(node.second, gap);
    const a = horizontal ? firstMin.width : firstMin.height;
    const b = horizontal ? secondMin.width : secondMin.height;
    // When minimums cannot fit, share the shortage proportionally rather than overflow.
    const constrained = a + b > available;
    const minRatio =
      available === 0 ? 0.5 : constrained ? a / (a + b) : a / available;
    const maxRatio =
      available === 0 ? 0.5 : constrained ? minRatio : 1 - b / available;
    const ratio = Math.max(minRatio, Math.min(maxRatio, node.ratio));
    const firstSize = available * ratio;
    const secondSize = available - firstSize;
    const first = {
      ...rect,
      ...(horizontal ? { width: firstSize } : { height: firstSize }),
    };
    const handle = horizontal
      ? {
          x: rect.x + firstSize,
          y: rect.y,
          width: actualGap,
          height: rect.height,
        }
      : {
          x: rect.x,
          y: rect.y + firstSize,
          width: rect.width,
          height: actualGap,
        };
    const second = horizontal
      ? { ...rect, x: handle.x + actualGap, width: secondSize }
      : { ...rect, y: handle.y + actualGap, height: secondSize };
    separators.push({
      split: node,
      rect: handle,
      container: rect,
      ratio,
      minRatio,
      maxRatio,
    });
    visit(node.first, first);
    visit(node.second, second);
  }
  visit(root, { x: 0, y: 0, width, height });
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
            id: `${horizontal.split.id}:${vertical.split.id}`,
            x,
            y,
            separators: [horizontal, vertical],
          });
        } else {
          const index = corners.indexOf(existing);
          const touching = new Map(
            existing.separators.map((separator) => [
              separator.split.id,
              separator,
            ])
          );
          touching.set(horizontal.split.id, horizontal);
          touching.set(vertical.split.id, vertical);
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
