import { describe, expect, test } from 'bun:test';

import { coverOf } from '../src/overlays';

// A 2 by 2 grid of 100 px panes with an 8 px gap, from (0, 0) to (208, 208).
const grid = [
  { id: 'a', box: { left: 0, top: 0, right: 100, bottom: 100 } },
  { id: 'b', box: { left: 108, top: 0, right: 208, bottom: 100 } },
  { id: 'c', box: { left: 0, top: 108, right: 100, bottom: 208 } },
  { id: 'd', box: { left: 108, top: 108, right: 208, bottom: 208 } },
];

describe('coverOf', () => {
  test('a box over the whole grid covers every pane', () => {
    expect(coverOf(grid, { left: 0, top: 0, right: 208, bottom: 208 })).toEqual(
      { covered: ['a', 'b', 'c', 'd'], overlapped: [] }
    );
  });

  test('a drawer on the right edge covers the right column only when it is wide enough', () => {
    expect(
      coverOf(grid, { left: 140, top: 0, right: 208, bottom: 208 })
    ).toEqual({ covered: [], overlapped: ['b', 'd'] });
    expect(
      coverOf(grid, { left: 104, top: 0, right: 208, bottom: 208 })
    ).toEqual({ covered: ['b', 'd'], overlapped: [] });
  });

  test('a centered box crosses every pane and covers none', () => {
    expect(
      coverOf(grid, { left: 50, top: 50, right: 158, bottom: 158 })
    ).toEqual({ covered: [], overlapped: ['a', 'b', 'c', 'd'] });
  });

  test('a box in the gap touches no pane', () => {
    expect(
      coverOf(grid, { left: 100, top: 0, right: 108, bottom: 208 })
    ).toEqual({ covered: [], overlapped: [] });
  });

  test('fractional edges within half a pixel still count as covered', () => {
    expect(
      coverOf(grid, { left: 0.4, top: 0, right: 99.6, bottom: 100 })
    ).toEqual({ covered: ['a'], overlapped: [] });
  });
});
