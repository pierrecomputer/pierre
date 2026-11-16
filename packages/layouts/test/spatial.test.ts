import { describe, expect, test } from 'bun:test';

import {
  type LayoutNode,
  neighbor,
  neighbors,
  type PaneNode,
  visualOrder,
} from '../src';

const pane = (id: string, extra: Partial<PaneNode> = {}): PaneNode => ({
  type: 'pane',
  id,
  ...extra,
});

const ids = (panes: readonly PaneNode[]): string[] => panes.map(({ id }) => id);

// Files | (Editor over Terminal) | Chat, with Diff as a tab of Editor's stack.
const workspace: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [{ px: 240 }, 2, 1],
  children: [
    pane('files'),
    {
      type: 'split',
      id: 'middle',
      direction: 'vertical',
      sizes: [0.7, 0.3],
      children: [
        {
          type: 'stack',
          id: 'editors',
          active: 'editor',
          children: [pane('editor'), pane('diff')],
        },
        pane('terminal', { collapsed: true, collapsedSize: 36 }),
      ],
    },
    pane('chat'),
  ],
};

describe('visualOrder', () => {
  test('lists the panes that show in tree order, with no container size', () => {
    // A column finishes before the next column starts.
    expect(ids(visualOrder(workspace))).toEqual([
      'files',
      'editor',
      'terminal',
      'chat',
    ]);
  });

  test('gives each tab of a stack with tabs: true', () => {
    expect(ids(visualOrder(workspace, { tabs: true }))).toEqual([
      'files',
      'editor',
      'diff',
      'terminal',
      'chat',
    ]);
  });

  test('leaves out hidden panes and hidden tabs, and keeps a collapsed pane', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1, 1],
      children: [
        pane('a', { hidden: true }),
        {
          type: 'stack',
          id: 's',
          active: 'b',
          children: [pane('b'), pane('c', { hidden: true })],
        },
        pane('d', { collapsed: true }),
      ],
    };
    expect(ids(visualOrder(tree))).toEqual(['b', 'd']);
    expect(ids(visualOrder(tree, { tabs: true }))).toEqual(['b', 'd']);
  });
});

describe('neighbors and neighbor', () => {
  test('give the panes across an edge, or none at an edge of the layout', () => {
    expect(ids(neighbors(workspace, 'files', 'right'))).toEqual([
      'editor',
      'terminal',
    ]);
    expect(ids(neighbors(workspace, 'chat', 'left'))).toEqual([
      'editor',
      'terminal',
    ]);
    expect(ids(neighbors(workspace, 'terminal', 'top'))).toEqual(['editor']);
    // A tab of a stack has the neighbors of its stack.
    expect(ids(neighbors(workspace, 'diff', 'bottom'))).toEqual(['terminal']);
    expect(ids(neighbors(workspace, 'editor', 'left'))).toEqual(['files']);
    expect(neighbors(workspace, 'files', 'left')).toEqual([]);
    expect(neighbors(workspace, 'editor', 'top')).toEqual([]);
    expect(neighbor(workspace, 'chat', 'right')).toBeNull();
  });

  test('skip a hidden pane on the way to the next one', () => {
    const tree: LayoutNode = {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1, 1],
      children: [pane('a'), pane('b', { hidden: true }), pane('c')],
    };
    expect(ids(neighbors(tree, 'a', 'right'))).toEqual(['c']);
  });

  test('keep the pane that overlaps the source, then the most recent, then the first', () => {
    // A row over a row: the top row has a and b, the bottom row c, d, and e.
    const tree: LayoutNode = {
      type: 'split',
      id: 'column',
      direction: 'vertical',
      sizes: [1, 1],
      children: [
        {
          type: 'split',
          id: 'top',
          direction: 'horizontal',
          sizes: [1, 1],
          children: [pane('a'), pane('b')],
        },
        {
          type: 'split',
          id: 'bottom',
          direction: 'horizontal',
          sizes: [1, 1, 1],
          children: [pane('c'), pane('d'), pane('e')],
        },
      ],
    };
    expect(ids(neighbors(tree, 'b', 'bottom'))).toEqual(['c', 'd', 'e']);
    // b spans 0.5 to 1; d (1/3 to 2/3) and e (2/3 to 1) overlap it, c does not.
    expect(neighbor(tree, 'b', 'bottom')?.id).toBe('d');
    expect(neighbor(tree, 'b', 'bottom', ['c', 'e'])?.id).toBe('e');
    // A recent pane that does not overlap does not win.
    expect(neighbor(tree, 'b', 'bottom', ['c'])?.id).toBe('d');
    // d (1/3 to 2/3) overlaps both a and b; the first wins with no recent pane.
    expect(neighbor(tree, 'd', 'top')?.id).toBe('a');
    expect(neighbor(tree, 'd', 'top', ['b'])?.id).toBe('b');
  });

  test('count a child in pixels as the mean weight of its split', () => {
    // a is 600 px wide on the screen, but the tree has no container size: it
    // counts as the mean weight (1), so the top spans split at 0.5.
    const tree: LayoutNode = {
      type: 'split',
      id: 'column',
      direction: 'vertical',
      sizes: [1, 1],
      children: [
        {
          type: 'split',
          id: 'top',
          direction: 'horizontal',
          sizes: [{ px: 600 }, 1],
          children: [pane('a'), pane('b')],
        },
        {
          type: 'split',
          id: 'bottom',
          direction: 'horizontal',
          sizes: [3, 1],
          children: [pane('c'), pane('d')],
        },
      ],
    };
    // c spans 0 to 0.75 and overlaps a (0 to 0.5) and b (0.5 to 1).
    expect(ids(neighbors(tree, 'c', 'top'))).toEqual(['a', 'b']);
    expect(neighbor(tree, 'd', 'top')?.id).toBe('b');
  });
});
