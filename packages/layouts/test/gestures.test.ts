import { describe, expect, test } from 'bun:test';

import { computeLayout } from '../src/geometry';
import {
  dragSizes,
  dropTarget,
  getExitEdges,
  keySizes,
  moveSeparator,
  paneAt,
  separatorOffset,
} from '../src/gestures';
import type { ChildSize, LayoutNode } from '../src/types';

const root: LayoutNode = {
  type: 'split',
  id: 'outer',
  direction: 'horizontal',
  sizes: [0.5, 0.5],
  children: [
    { type: 'pane', id: 'files', minWidth: 100, minHeight: 50 },
    {
      type: 'split',
      id: 'inner',
      direction: 'vertical',
      sizes: [0.5, 0.5],
      children: [
        { type: 'pane', id: 'editor', minWidth: 100, minHeight: 50 },
        { type: 'pane', id: 'terminal', minWidth: 100, minHeight: 50 },
      ],
    },
  ],
};

// 1008 px wide with an 8 px gap leaves 1000 px to divide.
const geometry = computeLayout(root, 1008, 608, 8);
const outer = geometry.separators.filter(({ split }) => split.id === 'outer');

// A row of four panes of 250 px, each with a minimum of 100 px.
const row: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1, 1],
  children: ['a', 'b', 'c', 'd'].map((id) => ({
    type: 'pane' as const,
    id,
    minWidth: 100,
  })),
};
const rowSeparators = computeLayout(row, 1024, 600, 8).separators;
const beforeC = rowSeparators.filter(({ id }) => id === 'row:2');

/**
 * Expect sizes close to the expected ones, one by one. A size in pixels is
 * written `{ px }` in both lists.
 */
function near(
  actual: readonly ChildSize[] | undefined,
  expected: readonly ChildSize[]
): void {
  expect(actual).toHaveLength(expected.length);
  const value = (size: ChildSize): number =>
    typeof size === 'number' ? size : size.px;
  actual?.forEach((size, index) => {
    expect(typeof size).toBe(typeof expected[index]);
    expect(value(size)).toBeCloseTo(value(expected[index]), 9);
  });
}

describe('gestures', () => {
  test('a drag moves the separator by the pointer distance', () => {
    near(dragSizes(outer, 100, 0).outer, [0.6, 0.4]);
    // A vertical move does not change a horizontal split.
    near(dragSizes(outer, 0, 100).outer, [0.5, 0.5]);
    // The separator stops at the minimum sizes of both sides.
    near(dragSizes(outer, 5000, 0).outer, [0.9, 0.1]);
    near(dragSizes(outer, -5000, 0).outer, [0.1, 0.9]);
  });

  test('a drag changes the two children beside the separator, then the next ones', () => {
    // b gives 150 px down to its minimum, then a gives the other 50 px.
    near(dragSizes(beforeC, -200, 0).row, [0.8, 0.4, 1.8, 1]);
    near(dragSizes(beforeC, 100, 0).row, [1, 1.4, 0.6, 1]);
    // c and d stop at their minimum sizes.
    near(moveSeparator(beforeC[0].children, 2, 1000), [250, 550, 100, 100]);
  });

  test('keys step, jump to the limits, balance, or do nothing', () => {
    near(keySizes(outer, 'ArrowRight', false)?.outer, [0.52, 0.48]);
    near(keySizes(outer, 'ArrowLeft', true)?.outer, [0.4, 0.6]);
    near(keySizes(outer, 'Home', false)?.outer, [0.1, 0.9]);
    near(keySizes(outer, 'End', false)?.outer, [0.9, 0.1]);
    near(keySizes(outer, 'Enter', false)?.outer, [0.5, 0.5]);
    // Up and down do not move a horizontal split.
    expect(keySizes(outer, 'ArrowDown', false)).toBeNull();
    expect(keySizes(outer, 'a', false)).toBeNull();
    // Home and End change only the two children beside the separator.
    near(keySizes(beforeC, 'Home', false)?.row, [1, 0.4, 1.6, 1]);
  });

  test('the offset of a separator follows the new sizes of its split', () => {
    expect(separatorOffset(beforeC[0], [1, 1, 1, 1])).toBeCloseTo(0, 9);
    expect(separatorOffset(beforeC[0], [0.8, 0.4, 1.8, 1])).toBeCloseTo(
      -200,
      9
    );
  });

  test('the drop target is the edge of the pane nearest to the pointer', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 };
    expect(dropTarget('editor', rect, 190, 50).edge).toBe('right');
    expect(dropTarget('editor', rect, 100, 5).edge).toBe('top');
    expect(dropTarget('editor', rect, 10, 50).rect).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test('the pane under a point leaves out the pane that moves', () => {
    expect(paneAt(geometry, 10, 10, 'editor')?.pane.id).toBe('files');
    expect(paneAt(geometry, 10, 10, 'files')).toBeUndefined();
  });

  test('exit edges are keyed by pane', () => {
    const boxes = new Map([
      ['pane:files', { x: 0, y: 0, width: 500, height: 608 }],
      ['separator:outer', { x: 500, y: 0, width: 8, height: 608 }],
    ]);
    expect(getExitEdges(boxes, 1008, 608)).toEqual({ files: 'left' });
  });
});

describe('gestures with sizes in pixels and maximums', () => {
  const tree: LayoutNode = {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [{ px: 240 }, 2, 1],
    children: [
      { type: 'pane', id: 'sidebar', minWidth: 100 },
      { type: 'pane', id: 'editor', minWidth: 200 },
      { type: 'pane', id: 'preview', minWidth: 100, maxWidth: 300 },
    ],
  };
  const separators = computeLayout(tree, 1200, 400, 0).separators;
  const first = separators.filter(({ id }) => id === 'row:1');
  const second = separators.filter(({ id }) => id === 'row:2');

  test('a drag beside a child in pixels gives it a new size in pixels', () => {
    // The editor and the preview keep their pixel sizes: 600 and 300.
    near(dragSizes(first, 60, 0).row, [{ px: 300 }, 2, 1]);
    // The editor grows to 720 px; the weighted children share their weight
    // of 3 by their pixel sizes.
    near(dragSizes(first, -60, 0).row, [
      { px: 180 },
      (720 / 1020) * 3,
      (300 / 1020) * 3,
    ]);
  });

  test('a drag stops where the child that grows reaches its maximum', () => {
    // The preview has 300 px, its maximum, so the separator cannot move left.
    expect(moveSeparator(second[0].children, 2, -100)).toEqual([240, 660, 300]);
    const narrow = computeLayout(tree, 1000, 400, 0).separators.filter(
      ({ id }) => id === 'row:2'
    )[0];
    // At 1000 px the preview has 253.33 px; it can grow by 46.67 px.
    const moved = moveSeparator(narrow.children, 2, -100);
    expect(moved[2]).toBeCloseTo(300, 9);
    expect(moved[1]).toBeCloseTo(460, 6);
  });

  test('the offset of a separator follows sizes in pixels', () => {
    expect(separatorOffset(first[0], [{ px: 300 }, 2, 1])).toBeCloseTo(60, 9);
  });
});
