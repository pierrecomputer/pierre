// Resize gestures: the sizes of the children of a split after a separator
// moves by a pointer drag or a key.
import { divideSpace } from './divide';
import { isFixed } from './model';
import type { ChildExtent, ChildSize, SeparatorGeometry } from './types';

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** The place of the separator among the visible children of its split. */
const orderOf = (separator: SeparatorGeometry): number =>
  separator.children.findIndex(({ index }) => index === separator.index);

/**
 * The pixel sizes of the visible children of a split after a separator moved
 * by `delta` pixels. The children on the side that the separator moves into
 * shrink, the nearest first, each down to its minimum size. The children on
 * the other side grow by the same amount, the nearest first, each up to its
 * maximum size. So a move changes only the two children beside the
 * separator, until one reaches its minimum or its maximum size.
 */
export function moveSeparator(
  children: readonly ChildExtent[],
  order: number,
  delta: number
): number[] {
  const sizes = children.map(({ size }) => size);
  const before = sizes
    .map((_, index) => order - 1 - index)
    .filter((index) => index >= 0);
  const after = sizes
    .map((_, index) => order + index)
    .filter((index) => index < sizes.length);
  const [shrinking, growing] = delta < 0 ? [before, after] : [after, before];
  const room = (indexes: number[], limit: (index: number) => number): number =>
    indexes.reduce((total, index) => total + Math.max(0, limit(index)), 0);
  const distance = Math.min(
    Math.abs(delta),
    room(shrinking, (index) => sizes[index] - children[index].min),
    room(growing, (index) => children[index].max - sizes[index])
  );
  let shrink = distance;
  for (const index of shrinking) {
    const taken = Math.min(
      shrink,
      Math.max(0, sizes[index] - children[index].min)
    );
    sizes[index] -= taken;
    shrink -= taken;
  }
  let grow = distance;
  for (const index of growing) {
    const given = Math.min(
      grow,
      Math.max(0, children[index].max - sizes[index])
    );
    sizes[index] += given;
    grow -= given;
  }
  return sizes;
}

/**
 * The sizes of a split from the pixel sizes of its visible children. A child
 * with a size in pixels takes its new size. The weighted visible children
 * keep the sum of their weights and share it by their pixel sizes. Hidden
 * children keep their sizes.
 */
function toWeights(
  separator: SeparatorGeometry,
  pixels: readonly number[]
): ChildSize[] {
  const { split, children } = separator;
  const sizes = [...split.sizes];
  const weighted = children
    .map(({ index }, order) => ({ index, order }))
    .filter(({ index }) => !isFixed(split.sizes[index]));
  const space = sum(weighted.map(({ order }) => pixels[order]));
  const weight = sum(weighted.map(({ index }) => split.sizes[index] as number));
  children.forEach(({ index }, order) => {
    const size = split.sizes[index];
    if (isFixed(size)) sizes[index] = { px: pixels[order] };
    else if (space > 0)
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
): Record<string, ChildSize[]> {
  const sizes: Record<string, ChildSize[]> = {};
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
 * The sizes after a key press on a separator: arrow keys move the
 * separator by 2% of the split (10% with Shift), and Home and End move it
 * until the child before or after it has its minimum size. Null when the key
 * does not resize.
 */
export function keySizes(
  separators: readonly SeparatorGeometry[],
  key: string,
  shift: boolean
): Record<string, ChildSize[]> | null {
  const sizes: Record<string, ChildSize[]> = {};
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
 * A step of one child of a split, for Grow and Shrink: the separator after
 * the child, or before it when it is the last child that shows, moves by
 * `fraction` of the space of the split, so that the child grows (a positive
 * fraction) or shrinks. It gives the sizes of the split and the new share of
 * the child in percent, or null when the child is at a limit.
 */
export function stepChild(
  separators: readonly SeparatorGeometry[],
  splitId: string,
  index: number,
  fraction: number
): { sizes: ChildSize[]; percent: number } | null {
  const list = separators.filter(({ split }) => split.id === splitId);
  const after = list.find(
    (each) => each.children[orderOf(each) - 1]?.index === index
  );
  const separator =
    after ?? list.find((each) => each.children[orderOf(each)]?.index === index);
  if (separator === undefined) return null;
  const { children } = separator;
  const order = orderOf(separator);
  const at = after === undefined ? order : order - 1;
  const space = sum(children.map(({ size }) => size));
  const pixels = moveSeparator(
    children,
    order,
    (after === undefined ? -fraction : fraction) * space
  );
  if (Math.abs(pixels[at] - children[at].size) < 0.5) return null;
  return {
    sizes: toWeights(separator, pixels),
    percent: Math.round((pixels[at] / space) * 100),
  };
}

/**
 * The place of a separator in its split, in percent of the space of its
 * children: `now`, and `min` and `max`, the places where the children before
 * it, then the children after it, have their minimum sizes, as a drag that
 * pushes the nearest child first reaches them.
 */
export function separatorPlaces(separator: SeparatorGeometry): {
  now: number;
  min: number;
  max: number;
} {
  const order = orderOf(separator);
  const { children } = separator;
  const space = Math.max(1, sum(children.map(({ size }) => size)));
  const percent = (value: number): number => Math.round((value / space) * 100);
  const before = children.slice(0, order);
  const after = children.slice(order);
  return {
    now: percent(sum(before.map(({ size }) => size))),
    min: percent(sum(before.map(({ min }) => min))),
    max: percent(space - sum(after.map(({ min }) => min))),
  };
}

/**
 * How far a separator moves along its split, in pixels, when the split takes
 * new sizes.
 */
export function separatorOffset(
  separator: SeparatorGeometry,
  sizes: readonly ChildSize[]
): number {
  const order = orderOf(separator);
  const { children } = separator;
  const space = sum(children.map(({ size }) => size));
  const next = divideSpace(
    space,
    children.map(({ index, min, max }) => {
      const size = sizes[index];
      return {
        px: isFixed(size) ? size.px : undefined,
        weight: isFixed(size) ? 1 : size,
        min,
        max,
      };
    })
  );
  return (
    sum(next.slice(0, order)) -
    sum(children.slice(0, order).map(({ size }) => size))
  );
}
