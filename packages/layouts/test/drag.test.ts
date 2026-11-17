import { describe, expect, test } from 'bun:test';

import { computeLayout } from '../src/geometry';
import { dropTargetAt } from '../src/react/drag';
import type { LayoutNode } from '../src/types';

// A row of two panes of 500 by 400 pixels, with no gap.
const tree: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1],
  children: [
    { type: 'pane', id: 'a' },
    { type: 'pane', id: 'b' },
  ],
};
const geometry = computeLayout(tree, 1000, 400, 0);
const drop = () => {};

describe('dropTargetAt', () => {
  test('a source that drops beside a pane takes the nearest edge of the pane under the point', () => {
    const options = { source: { kind: 'pane', id: 'a' }, drop };
    expect(dropTargetAt(geometry, 980, 200, options)).toEqual({
      paneId: 'b',
      place: 'right',
      rect: { x: 750, y: 0, width: 250, height: 400 },
    });
    expect(dropTargetAt(geometry, 750, 10, options)?.place).toBe('top');
    // The center of a pane still gives an edge.
    expect(dropTargetAt(geometry, 750, 200, options)?.place).not.toBe('center');
  });

  test('a source that can drop into a stack takes the center of the pane', () => {
    const options = { source: { kind: 'tab', id: 'a' }, center: true, drop };
    expect(dropTargetAt(geometry, 750, 200, options)).toEqual({
      paneId: 'b',
      place: 'center',
      rect: { x: 500, y: 0, width: 500, height: 400 },
    });
  });

  test('the source itself gives no target', () => {
    expect(
      dropTargetAt(geometry, 250, 200, {
        source: { kind: 'pane', id: 'a' },
        drop,
      })
    ).toBeNull();
  });

  test('on its own stack, a source drops at an edge beside the stack, not at its center', () => {
    const options = {
      source: { kind: 'tab', id: 'a' },
      center: true,
      group: ['a', 'b'],
      drop,
    };
    expect(dropTargetAt(geometry, 250, 200, options)).toBeNull();
    // At an edge of its own tab, the target is the other tab of the stack.
    expect(dropTargetAt(geometry, 20, 200, options)).toEqual({
      paneId: 'b',
      place: 'left',
      rect: { x: 0, y: 0, width: 250, height: 400 },
    });
    expect(
      dropTargetAt(geometry, 20, 200, { ...options, group: ['a'] })
    ).toBeNull();
  });
});

// The cases of the drops of a tab outside the tab lists: a row of a stack of
// two tabs and a pane, 400 by 600 pixels each, with a gap of 8.
describe('dropTargetAt for a tab', () => {
  const groups: LayoutNode = {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      {
        type: 'stack',
        id: 'left',
        active: 'a',
        children: [
          { type: 'pane', id: 'a' },
          { type: 'pane', id: 'b' },
        ],
      },
      { type: 'pane', id: 'c' },
    ],
  };
  const pixels = computeLayout(groups, 808, 600, 8);
  const tab = (id: string, group: readonly string[], center = true) => ({
    source: { kind: 'tab', id },
    center,
    group,
    drop,
  });

  test('a tab drops into the center or on an edge of another group', () => {
    expect(dropTargetAt(pixels, 600, 300, tab('b', ['a', 'b']))).toMatchObject({
      paneId: 'c',
      place: 'center',
    });
    expect(dropTargetAt(pixels, 790, 300, tab('b', ['a', 'b']))).toMatchObject({
      paneId: 'c',
      place: 'right',
    });
  });

  test('a tab leaves its own group only by an edge, beside a sibling', () => {
    expect(dropTargetAt(pixels, 200, 300, tab('a', ['a', 'b']))).toBeNull();
    expect(dropTargetAt(pixels, 200, 590, tab('a', ['a', 'b']))).toMatchObject({
      paneId: 'b',
      place: 'bottom',
    });
    expect(dropTargetAt(pixels, 200, 590, tab('b', ['a', 'b']))).toMatchObject({
      paneId: 'a',
      place: 'bottom',
    });
  });

  test('a lone tab has no place in its own pane', () => {
    expect(dropTargetAt(pixels, 790, 300, tab('c', ['c']))).toBeNull();
    expect(dropTargetAt(pixels, 10, 300, tab('c', ['c']))).toMatchObject({
      paneId: 'a',
      place: 'left',
    });
  });

  test('a point outside every group has no target', () => {
    expect(dropTargetAt(pixels, 900, 300, tab('b', ['a', 'b']))).toBeNull();
  });
});
