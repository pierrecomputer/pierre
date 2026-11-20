import { describe, expect, test } from 'bun:test';

import {
  type LayoutNode,
  LayoutStore,
  naryTree,
  type StackNode,
  stackOf,
} from '../src/index';

const stack = (id: string, active: string, tabs: string[]): StackNode => ({
  type: 'stack',
  id,
  active,
  children: tabs.map((tab) => ({ type: 'pane', id: tab })),
});

const twoGroups: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1],
  children: [stack('left', 'a', ['a', 'b']), { type: 'pane', id: 'c' }],
};

describe('addTab with activate: false', () => {
  test('keeps the active tab, the focused pane, and the zoom', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.focusPane('a');
    store.toggleZoom('a');
    store.addTab('b', { type: 'pane', id: 'new' }, undefined, {
      activate: false,
    });
    const { root, focusedPane, zoomedPane } = store.getSnapshot();
    const left = stackOf(root, 'new');
    expect(left?.children.map((tab) => tab.id)).toEqual(['a', 'b', 'new']);
    expect(left?.active).toBe('a');
    expect(focusedPane).toBe('a');
    expect(zoomedPane).toBe('a');
  });

  test('makes a stack of a lone pane whose active tab stays the pane', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.focusPane('a');
    store.addTab('c', { type: 'pane', id: 'new' }, undefined, {
      activate: false,
    });
    const { root, focusedPane } = store.getSnapshot();
    const right = stackOf(root, 'c');
    expect(right?.children.map((tab) => tab.id)).toEqual(['c', 'new']);
    expect(right?.active).toBe('c');
    expect(focusedPane).toBe('a');
  });

  test('puts the tab at the index among the tabs of the group', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.addTab('a', { type: 'pane', id: 'new' }, 0, { activate: false });
    expect(
      stackOf(store.getSnapshot().root, 'a')?.children.map((tab) => tab.id)
    ).toEqual(['new', 'a', 'b']);
  });

  test('activates and focuses the new tab by default, as before', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.addTab('a', { type: 'pane', id: 'new' });
    const { root, focusedPane } = store.getSnapshot();
    expect(stackOf(root, 'new')?.active).toBe('new');
    expect(focusedPane).toBe('new');
  });
});

describe('moveToStack', () => {
  test('into a lone pane makes a stack of the two', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.moveToStack('b', 'c', undefined, { activate: false });
    const { root } = store.getSnapshot();
    expect(root.type).toBe('split');
    const right = stackOf(root, 'c');
    expect(right?.children.map((tab) => tab.id)).toEqual(['c', 'b']);
    expect(right?.active).toBe('c');
    expect(stackOf(root, 'a')).toBeNull();
  });

  test('of the two last lone panes makes one stack at the root', () => {
    const row: LayoutNode = {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [
        { type: 'pane', id: 'x' },
        { type: 'pane', id: 'y' },
      ],
    };
    const store = new LayoutStore(row, { model: naryTree });
    store.moveToStack('y', 'x', undefined, { activate: false });
    expect(store.getSnapshot().root).toEqual({
      type: 'stack',
      id: expect.any(String),
      active: 'x',
      children: [
        { type: 'pane', id: 'x' },
        { type: 'pane', id: 'y' },
      ],
    });
  });

  test('without activation moves the focus to the tab that shows in its place', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.activate('b');
    store.moveToStack('b', 'c', undefined, { activate: false });
    const { root, focusedPane } = store.getSnapshot();
    expect(stackOf(root, 'c')?.active).toBe('c');
    expect(focusedPane).toBe('a');
  });

  test('inside one stack without activation keeps the active tab', () => {
    const store = new LayoutStore(stack('s', 'a', ['a', 'b', 'c']), {
      model: naryTree,
    });
    store.moveToStack('c', 'a', 0, { activate: false });
    const moved = stackOf(store.getSnapshot().root, 'a');
    expect(moved?.children.map((tab) => tab.id)).toEqual(['c', 'a', 'b']);
    expect(moved?.active).toBe('a');
  });

  test('activates the moved tab by default, as before', () => {
    const store = new LayoutStore(twoGroups, { model: naryTree });
    store.moveToStack('b', 'c');
    const { root, focusedPane } = store.getSnapshot();
    expect(stackOf(root, 'c')?.active).toBe('b');
    expect(focusedPane).toBe('b');
  });
});
