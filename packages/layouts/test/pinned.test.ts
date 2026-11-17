import { describe, expect, test } from 'bun:test';

import {
  applyLayoutOperations,
  type LayoutNode,
  LayoutOperationError,
  type LayoutTreeOperation,
  type PaneNode,
  parseLayoutOperations,
  parseStoredLayoutTree,
  stackOf,
} from '../src/index';
import { findNode } from '../src/model';
import { testStore } from './helpers/store';

const pane = (id: string, flags: Partial<PaneNode> = {}): PaneNode => ({
  type: 'pane',
  id,
  ...flags,
});

// A stack of two pinned tabs and three others, a pane, and a stack of two.
const start: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [2, 1, 1],
  children: [
    {
      type: 'stack',
      id: 'editors',
      active: 'c',
      children: [
        pane('a', { pinned: true }),
        pane('b', { pinned: true }),
        pane('c'),
        pane('d'),
        pane('e', { closable: false }),
      ],
    },
    pane('f'),
    {
      type: 'stack',
      id: 'tools',
      active: 'g',
      children: [pane('g', { pinned: true }), pane('h')],
    },
  ],
};

const order = (root: LayoutNode, id: string): string[] =>
  stackOf(root, id)?.children.map((tab) => tab.id) ?? [];

// The code of the error that a command throws, or null.
function codeOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof LayoutOperationError ? error.code : String(error);
  }
}

describe('pinned tabs', () => {
  test('a tab that is not pinned moves only to the run or after it', () => {
    const store = testStore(start);
    store.moveTab('d', 0);
    expect(order(store.getSnapshot().root, 'a')).toEqual([
      'a',
      'b',
      'd',
      'c',
      'e',
    ]);
    const before = store.getSnapshot().root;
    store.moveTab('d', 1);
    expect(store.getSnapshot().root).toBe(before);
  });

  test('a pinned tab moves only inside the run', () => {
    const store = testStore(start);
    store.moveTab('a', 4);
    expect(order(store.getSnapshot().root, 'a')).toEqual([
      'b',
      'a',
      'c',
      'd',
      'e',
    ]);
    store.moveToStack('b', 'e', 4);
    expect(order(store.getSnapshot().root, 'a')).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  test('a pinned tab moves into another stack, stays pinned, and goes to the end of its pinned run', () => {
    const store = testStore(start);
    store.moveToStack('a', 'h');
    let root = store.getSnapshot().root;
    expect(order(root, 'h')).toEqual(['g', 'a', 'h']);
    expect(order(root, 'b')).toEqual(['b', 'c', 'd', 'e']);
    expect(findNode(root, 'a')).toEqual(pane('a', { pinned: true }));
    // A place inside the run stays; a place past it clamps to its end.
    store.moveToStack('b', 'g', 0);
    store.moveToStack('c', 'g', 0);
    root = store.getSnapshot().root;
    expect(order(root, 'g')).toEqual(['b', 'g', 'a', 'c', 'h']);
    // Into a pane outside a stack: a new stack, the pinned tab first.
    store.moveToStack('g', 'f');
    expect(order(store.getSnapshot().root, 'f')).toEqual(['g', 'f']);
  });

  test('a pinned tab moves beside a pane, and stays pinned', () => {
    const store = testStore(start);
    store.move('a', 'f', 'left');
    const root = store.getSnapshot().root;
    expect(stackOf(root, 'a')).toBeNull();
    expect(findNode(root, 'a')).toEqual(pane('a', { pinned: true }));
    expect(order(root, 'b')).toEqual(['b', 'c', 'd', 'e']);
    // A tab that joins it later goes after it.
    store.moveToStack('c', 'a', 0);
    expect(order(store.getSnapshot().root, 'a')).toEqual(['a', 'c']);
  });

  test('a swap that puts a pinned tab after another tab throws pane_pinned', () => {
    const store = testStore(start);
    const before = store.getSnapshot().root;
    expect(codeOf(() => store.swap('a', 'f'))).toBe('pane_pinned');
    expect(codeOf(() => store.swap('a', 'c'))).toBe('pane_pinned');
    expect(codeOf(() => store.swap('h', 'b'))).toBe(null);
    expect(store.getSnapshot().root).not.toBe(before);
    const swapped = testStore(start);
    swapped.swap('a', 'g');
    const root = swapped.getSnapshot().root;
    expect(order(root, 'a')).toEqual(['a', 'h']);
    expect(order(root, 'g')).toEqual(['g', 'b', 'c', 'd', 'e']);
    swapped.swap('g', 'b');
    expect(order(swapped.getSnapshot().root, 'g').slice(0, 2)).toEqual([
      'b',
      'g',
    ]);
  });

  test('a tab that joins a stack goes after its pinned run', () => {
    const store = testStore(start);
    store.moveToStack('f', 'g', 0);
    expect(order(store.getSnapshot().root, 'g')).toEqual(['g', 'f', 'h']);
    store.addTab('a', pane('new'), 0);
    expect(order(store.getSnapshot().root, 'a').slice(0, 3)).toEqual([
      'a',
      'b',
      'new',
    ]);
    // After its target, and at most at the end of the pinned run.
    store.addTab('a', pane('pin', { pinned: true }));
    store.addTab('new', pane('last', { pinned: true }));
    expect(order(store.getSnapshot().root, 'a').slice(0, 5)).toEqual([
      'a',
      'pin',
      'b',
      'last',
      'new',
    ]);
  });

  test('setPinned moves the tab to the end of the pinned run, and keeps the active tab', () => {
    const store = testStore(start);
    store.setPinned('d', true);
    let root = store.getSnapshot().root;
    expect(order(root, 'a')).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(stackOf(root, 'a')?.active).toBe('c');
    store.setPinned('a', false);
    root = store.getSnapshot().root;
    expect(order(root, 'a')).toEqual(['b', 'd', 'a', 'c', 'e']);
    const unpinned = stackOf(root, 'a')?.children.find((tab) => tab.id === 'a');
    expect(unpinned).toEqual(pane('a'));
    // The same pin changes nothing.
    store.setPinned('b', true);
    expect(store.getSnapshot().root).toBe(root);
    // A pane outside a stack keeps its place.
    store.setPinned('f', true);
    expect(order(store.getSnapshot().root, 'f')).toEqual([]);
  });

  test('the server folds the same rules and refuses the same moves', () => {
    const operations: LayoutTreeOperation[] = [
      { type: 'setPinned', pane: 'd', pinned: true },
      { type: 'moveTab', pane: 'c', index: 0 },
      { type: 'moveToStack', pane: 'h', target: 'a', index: 0, activate: true },
    ];
    const store = testStore(start);
    store.setPinned('d', true);
    store.moveTab('c', 0);
    store.moveToStack('h', 'a', 0);
    expect(applyLayoutOperations(start, operations)).toEqual(
      store.getSnapshot().root
    );
    const folded = applyLayoutOperations(start, [
      { type: 'move', pane: 'b', target: 'f', edge: 'top', id: 'column' },
      { type: 'moveToStack', pane: 'a', target: 'h', activate: true },
    ]);
    expect(stackOf(folded, 'b')).toBeNull();
    expect(findNode(folded, 'b')).toEqual(pane('b', { pinned: true }));
    expect(order(folded, 'h')).toEqual(['g', 'a', 'h']);
    expect(
      codeOf(() =>
        applyLayoutOperations(start, [{ type: 'swap', panes: ['a', 'c'] }])
      )
    ).toBe('pane_pinned');
  });

  test('a closable: false pane still closes from the code of the app', () => {
    const store = testStore(start);
    store.close('e');
    expect(order(store.getSnapshot().root, 'a')).not.toContain('e');
  });
});

describe('the saved form of the flags', () => {
  test('a stored tree keeps pinned: true and closable: false, and drops the defaults', () => {
    const stored = parseStoredLayoutTree({
      version: 3,
      root: {
        type: 'stack',
        id: 's',
        active: 'a',
        children: [
          { type: 'pane', id: 'a', pinned: true, closable: false },
          { type: 'pane', id: 'b', pinned: false, closable: true },
        ],
      },
    });
    expect(stored.root).toEqual({
      type: 'stack',
      id: 's',
      active: 'a',
      children: [pane('a', { pinned: true, closable: false }), pane('b')],
    });
  });

  test('a flag that is not a boolean is refused at its path', () => {
    expect(() =>
      parseStoredLayoutTree({
        version: 3,
        root: { type: 'pane', id: 'a', pinned: 'yes' },
      })
    ).toThrow('root.pinned: must be a boolean');
    expect(() =>
      parseLayoutOperations([{ type: 'setPinned', pane: 'a' }])
    ).toThrow('operations[0].pinned');
  });
});
