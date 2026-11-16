import { describe, expect, test } from 'bun:test';

import { applyLayoutOperations } from '../src/apply-operations';
import type { LayoutNode, PaneNode } from '../src/types';
import { testStore } from './helpers/store';

const pane = (id: string): PaneNode => ({ type: 'pane', id });

/** The tree as nested lists of pane IDs, with the direction of each split. */
function shape(node: LayoutNode): unknown {
  if (node.type === 'pane') return node.id;
  if (node.type === 'stack') return { tabs: node.children.map(({ id }) => id) };
  return { [node.direction]: node.children.map(shape) };
}

const row: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 2, 3],
  children: [pane('a'), pane('b'), pane('c')],
};

describe('a move or a split beside a split or a stack', () => {
  test('a split of the direction of the edge takes the pane as its first or last child, with the mean weight', () => {
    const store = testStore(row);
    store.move('c', 'row', 'left');
    const root = store.getSnapshot().root;
    expect(shape(root)).toEqual({ horizontal: ['c', 'a', 'b'] });
    // When c leaves, b takes its weight (2 + 3); c then takes the mean
    // weight of a and b.
    expect(root.type === 'split' && root.sizes).toEqual([3, 1, 5]);
    store.split('row', pane('d'), 'right');
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: ['c', 'a', 'b', 'd'],
    });
  });

  test('a split across the edge is wrapped: a new row at the top of the layout', () => {
    const store = testStore(row);
    store.move('b', 'row', 'top');
    expect(shape(store.getSnapshot().root)).toEqual({
      vertical: ['b', { horizontal: ['a', 'c'] }],
    });
  });

  test('a split that a move takes apart gives its place to what remains of it', () => {
    // a | (b over c): b leaves the column, so c takes its place.
    const store = testStore({
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        pane('a'),
        {
          type: 'split',
          id: 'column',
          direction: 'vertical',
          sizes: [1, 1],
          children: [pane('b'), pane('c')],
        },
      ],
    });
    store.move('b', 'column', 'right');
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: ['a', 'c', 'b'],
    });
  });

  test('a tab moves beside its own stack, and the stack of one tab gives way to it', () => {
    const store = testStore({
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        {
          type: 'stack',
          id: 'tabs',
          active: 'a',
          children: [pane('a'), pane('b')],
        },
        pane('c'),
      ],
    });
    store.move('a', 'tabs', 'left');
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: ['a', 'b', 'c'],
    });
  });

  test('a server folds a move beside the root as the store does', () => {
    const store = testStore(row);
    const operations: unknown[] = [];
    store.subscribe((change) => operations.push(...change.operations));
    store.move('a', 'row', 'bottom');
    const server = applyLayoutOperations(
      row,
      operations as Parameters<typeof applyLayoutOperations>[1]
    );
    expect(shape(server)).toEqual(shape(store.getSnapshot().root));
  });

  test('a move beside a node that holds only the pane changes nothing', () => {
    const store = testStore(row);
    const before = store.getSnapshot().root;
    store.move('a', 'a', 'left');
    expect(store.getSnapshot().root).toBe(before);
  });
});

// Files | a stack of Diff and Chat | Notes.
const tabs: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [
    pane('files'),
    {
      type: 'stack',
      id: 'tabs',
      active: 'chat',
      children: [pane('diff'), pane('chat')],
    },
    pane('notes'),
  ],
};

describe('mergeStack', () => {
  test('moves every tab of a stack into the previous pane in one change, in order', () => {
    const store = testStore(tabs);
    const changes: unknown[][] = [];
    store.subscribe((change) => changes.push([...change.operations]));
    store.focusPane('notes');
    store.mergeStack('diff');
    const root = store.getSnapshot().root;
    expect(shape(root)).toEqual({
      horizontal: [{ tabs: ['files', 'diff', 'chat'] }, 'notes'],
    });
    // The target keeps its active tab, as the focus was elsewhere.
    expect(root.type === 'split' && root.children[0]).toMatchObject({
      active: 'files',
    });
    expect(store.getSnapshot().focusedPane).toBe('notes');
    expect(
      changes.at(-1)?.map((operation) => (operation as { type: string }).type)
    ).toEqual(['moveToStack', 'moveToStack']);
    // A server folds the same operations.
    const server = applyLayoutOperations(
      tabs,
      changes.at(-1) as Parameters<typeof applyLayoutOperations>[1]
    );
    expect(shape(server)).toEqual(shape(root));
  });

  test('the tab that showed keeps the focus when the merged stack had it', () => {
    const store = testStore(tabs);
    store.focusPane('chat');
    store.mergeStack('chat', 'notes');
    const root = store.getSnapshot().root;
    expect(shape(root)).toEqual({
      horizontal: ['files', { tabs: ['notes', 'diff', 'chat'] }],
    });
    expect(root.type === 'split' && root.children[1]).toMatchObject({
      active: 'chat',
    });
    expect(store.getSnapshot().focusedPane).toBe('chat');
  });

  test('takes the next pane when no pane comes before it, and leaves a pinned tab', () => {
    const store = testStore({
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        {
          type: 'stack',
          id: 'tabs',
          active: 'a',
          children: [{ ...pane('a'), pinned: true }, pane('b'), pane('c')],
        },
        pane('d'),
      ],
    });
    store.mergeStack('b');
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: ['a', { tabs: ['d', 'b', 'c'] }],
    });
  });
});
