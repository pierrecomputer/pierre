import { describe, expect, test } from 'bun:test';

import { getMaximumSize, getMinimumSize, type LayoutNode } from '../src';

// The size queries of the root entry, with the rules of the engine: an app
// reads them, for example, for the minimum width of the panel that holds a
// layout.

const panel: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [
    { type: 'pane', id: 'files', minWidth: 200, maxWidth: 400 },
    {
      type: 'stack',
      id: 'tabs',
      active: 'editor',
      children: [
        { type: 'pane', id: 'editor', minWidth: 300 },
        { type: 'pane', id: 'preview', minWidth: 250, minHeight: 100 },
      ],
    },
    {
      type: 'pane',
      id: 'chat',
      minWidth: 240,
      collapsed: true,
      collapsedSize: 32,
    },
  ],
};

describe('getMinimumSize and getMaximumSize', () => {
  test('a split sums its children and its gaps along its axis, and takes the largest across it', () => {
    // 200 + the stack's largest minimum (300) + the collapsed chat (32) + 2 gaps.
    expect(getMinimumSize(panel, 4)).toEqual({ width: 540, height: 100 });
    expect(getMaximumSize(panel, 4)).toEqual({
      width: Infinity,
      height: Infinity,
    });
  });

  test('hidden panes take no space, and a pane gives its own limits', () => {
    const files: LayoutNode = {
      type: 'pane',
      id: 'files',
      minWidth: 200,
      maxWidth: 400,
    };
    expect(getMinimumSize(files, 4)).toEqual({ width: 200, height: 80 });
    expect(getMaximumSize(files, 4)).toEqual({ width: 400, height: Infinity });
    expect(getMinimumSize({ ...files, hidden: true }, 4)).toEqual({
      width: 0,
      height: 0,
    });
  });
});
