import { describe, expect, test } from 'bun:test';

import { validateLayout } from '../src/model';
import {
  fromLayoutNodeView,
  type LayoutNodeView,
  toLayoutNodeView,
} from '../src/view';

const view: LayoutNodeView = {
  type: 'split',
  direction: 'column',
  sizes: [2, { px: 240 }],
  children: [
    {
      type: 'split',
      direction: 'row',
      sizes: [1, 1],
      children: [
        { type: 'group', tabs: ['info', 'diff'], active: 'diff' },
        { type: 'group', tabs: ['files'], active: 'files' },
      ],
    },
    { type: 'group', tabs: ['terminal'], active: 'terminal' },
  ],
};

describe('read form to tree', () => {
  test('generated IDs do not collide with consumer tab IDs', () => {
    const root = fromLayoutNodeView({
      type: 'split',
      direction: 'row',
      sizes: [1, 1],
      children: [
        { type: 'group', tabs: ['a', 'layout-stack:a'], active: 'a' },
        {
          type: 'group',
          tabs: ['layout-split:0:a'],
          active: 'layout-split:0:a',
        },
      ],
    });
    expect(() => validateLayout(root)).not.toThrow();
  });
  test('gives a valid tree that maps back to the same read form', () => {
    const root = fromLayoutNodeView(view);
    expect(() => validateLayout(root)).not.toThrow();
    expect(toLayoutNodeView(root)).toEqual(view);
  });

  test('gives the same node IDs for the same read form', () => {
    expect(fromLayoutNodeView(view)).toEqual(fromLayoutNodeView(view));
  });

  test('gives a group of one tab as a lone pane', () => {
    expect(
      fromLayoutNodeView({ type: 'group', tabs: ['only'], active: 'only' })
    ).toEqual({ type: 'pane', id: 'only' });
  });
});
