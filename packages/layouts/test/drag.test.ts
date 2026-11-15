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

  test('the source itself and the excluded panes give no target', () => {
    expect(
      dropTargetAt(geometry, 250, 200, {
        source: { kind: 'pane', id: 'a' },
        drop,
      })
    ).toBeNull();
    expect(
      dropTargetAt(geometry, 750, 200, {
        source: { kind: 'pane', id: 'a' },
        exclude: ['b'],
        drop,
      })
    ).toBeNull();
  });
});
