// Corners: the points where a separator of a row meets a separator of a
// column. A corner resizes both separators at once. The layout passes
// (`computeCSSLayout` and `computeLayout`) leave corners out, so an app that
// does not show corners does not compute them. This module computes them from
// the result of a pass.
import type { CSSLayout, CSSSeparator } from './css-layout';
import { separatorId, visibleChildren } from './geometry';
import { add, constant, scale, toCSS } from './piecewise';
import type { LayoutGeometry, LayoutNode, SeparatorGeometry } from './types';

/** A corner of a pixel geometry: the point where two or more separators meet. */
export interface CornerGeometry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly separators: readonly SeparatorGeometry[];
}

/**
 * A corner of a CSS layout: one separator of a row and one of a column, and
 * the place of the corner's handle in container units.
 */
export interface CSSCorner {
  id: string;
  separatorIds: readonly string[];
  left: string;
  top: string;
}

/**
 * The IDs of the separators that meet one edge of a subtree at a right angle,
 * independently of the container size.
 */
function boundarySeparators(
  node: LayoutNode,
  edge: 'left' | 'right' | 'top' | 'bottom'
): string[] {
  if (node.type !== 'split') return [];
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

/**
 * The corners of a CSS layout from `computeCSSLayout`: one for each pair of a
 * row separator and a column separator that meet. Each corner's place is a
 * CSS value of the container size, from the boxes of its two separators.
 */
export function cssCorners(layout: CSSLayout): CSSCorner[] {
  const byId = new Map<string, CSSSeparator>(
    layout.separators.map((separator) => [separator.id, separator])
  );
  const corners: CSSCorner[] = [];
  for (const separator of layout.separators) {
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
  return corners;
}

/**
 * The corners of a pixel geometry from `computeLayout`. `gap` is the gap of
 * that call: a row separator and a column separator meet when the middle of
 * one is within half a gap of the other. Corners at the same point become one
 * corner that holds all of their separators.
 */
export function pixelCorners(
  { separators }: LayoutGeometry,
  gap = 8
): CornerGeometry[] {
  const corners: CornerGeometry[] = [];
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
  return corners;
}
