import { describe, expect, test } from 'bun:test';

import {
  createLayoutStore,
  edits,
  getPanes,
  hiddenPanes,
  type LayoutNode,
  naryTree,
  parseStoredLayoutTree,
  persistence,
  stacks,
  type StoreFeature,
  zoom,
} from '../src';

const pane = (id: string) => ({ type: 'pane', id }) as const;

const row: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [pane('a'), pane('b'), pane('c')],
};

const ids = (root: LayoutNode): string[] => getPanes(root).map(({ id }) => id);

describe('createLayoutStore', () => {
  test('a store without features has the core commands only', () => {
    const store = createLayoutStore(row);
    expect(Object.keys(store).sort()).toEqual([
      'focusPane',
      'getSnapshot',
      'revert',
      'setCollapsed',
      'setRoot',
      'setSizes',
      'subscribe',
      'transient',
    ]);
    // @ts-expect-error: `split` comes with `edits`.
    expect(store.split).toBeUndefined();
  });

  test('a store without a tree model keeps the shape of the tree', () => {
    const store = createLayoutStore(row);
    expect(store.getSnapshot().root).toEqual(row);
    expect(Object.isFrozen(store.getSnapshot().root)).toBe(true);
    expect(store.getSnapshot().focusedPane).toBe('a');
    expect(() => store.setRoot({ ...row, sizes: [1, 1] })).toThrow();
  });

  test('the core commands change sizes, collapse, and focus, and notify each change', () => {
    const store = createLayoutStore(row);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.setSizes({ row: [2, 1, 1] });
    store.setCollapsed('b', true);
    store.focusPane('c');
    store.focusPane('c');
    unsubscribe();
    store.focusPane('a');
    const { root, focusedPane } = store.getSnapshot();
    expect(root.type === 'split' && root.sizes).toEqual([2, 1, 1]);
    expect(getPanes(root).find(({ id }) => id === 'b')?.collapsed).toBe(true);
    expect(focusedPane).toBe('a');
    expect(calls).toBe(3);
  });

  test('edits gives the store the tree model and the edit commands', () => {
    const store = createLayoutStore(row, [edits(naryTree)]);
    const root = store.getSnapshot().root;
    expect(root.type === 'split' && root.children.length).toBe(3);
    store.split('a', pane('d'), 'bottom');
    expect(ids(store.getSnapshot().root)).toEqual(['a', 'd', 'b', 'c']);
    expect(store.getSnapshot().focusedPane).toBe('d');
    store.move('d', 'c', 'right');
    expect(ids(store.getSnapshot().root)).toEqual(['a', 'b', 'c', 'd']);
    store.swap('a', 'd');
    expect(ids(store.getSnapshot().root)).toEqual(['d', 'b', 'c', 'a']);
    store.close('b');
    expect(ids(store.getSnapshot().root)).toEqual(['d', 'c', 'a']);
  });

  test('each store makes its new IDs from a random prefix of its own and a count', () => {
    const first = createLayoutStore(pane('a'), [edits(naryTree)]);
    const second = createLayoutStore(pane('a'), [edits(naryTree)]);
    first.split('a', pane('b'));
    second.split('a', pane('b'));
    const id = first.getSnapshot().root.id;
    expect(id).toMatch(/^split-[0-9a-z]{8}-1$/);
    expect(second.getSnapshot().root.id).toMatch(/^split-[0-9a-z]{8}-1$/);
    expect(second.getSnapshot().root.id).not.toBe(id);
  });

  test('a store takes the maker of its new IDs from its options', () => {
    let count = 0;
    const store = createLayoutStore(pane('a'), [edits(naryTree)], {
      newId: (kind) => `${kind}-test-${++count}`,
    });
    store.split('a', pane('b'));
    expect(store.getSnapshot().root.id).toBe('split-test-1');
  });

  test('a feature gets the context of the store for its commands', () => {
    const counter: StoreFeature<{ focusNext(): void }> = {
      commands: ({ get, commit }) => ({
        focusNext() {
          const state = get();
          const panes = ids(state.root);
          const next =
            panes[(panes.indexOf(state.focusedPane) + 1) % panes.length];
          commit({ ...state, focusedPane: next }, []);
        },
      }),
    };
    const store = createLayoutStore(row, [edits(naryTree), counter]);
    store.focusNext();
    expect(store.getSnapshot().focusedPane).toBe('b');
    store.close('b');
    expect(ids(store.getSnapshot().root)).toEqual(['a', 'c']);
  });

  test('an app wraps a command with its own object', () => {
    const base = createLayoutStore(row, [edits(naryTree)]);
    const closed: string[] = [];
    const store = {
      ...base,
      close(id: string): void {
        closed.push(id);
        base.close(id);
      },
    };
    store.close('a');
    expect(closed).toEqual(['a']);
    expect(ids(store.getSnapshot().root)).toEqual(['b', 'c']);
  });
});

describe('store features', () => {
  const tabs: LayoutNode = {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      {
        type: 'stack',
        id: 's',
        active: 'a',
        children: [pane('a'), pane('b')],
      },
      pane('c'),
    ],
  };

  test('zoom zooms the focused pane and restores it', () => {
    const store = createLayoutStore(row, [zoom()]);
    store.toggleZoom();
    expect(store.getSnapshot().zoomedPane).toBe('a');
    store.toggleZoom('a');
    expect(store.getSnapshot().zoomedPane).toBe(null);
  });

  test('stacks shows and orders tabs without a tree model', () => {
    const store = createLayoutStore(tabs, [stacks()]);
    store.activate('b');
    store.moveTab('b', 0);
    const { root, focusedPane } = store.getSnapshot();
    expect(focusedPane).toBe('b');
    expect(ids(root)).toEqual(['b', 'a', 'c']);
    // A move into another stack takes the pane out with the tree model.
    expect(() => store.moveToStack('c', 'a')).toThrow('needs a tree model');
  });

  test('stacks moves a pane into another stack with the tree model of edits', () => {
    const store = createLayoutStore(tabs, [edits(naryTree), stacks()]);
    store.moveToStack('c', 'a', 0);
    const { root, focusedPane } = store.getSnapshot();
    expect(root.type).toBe('stack');
    expect(ids(root)).toEqual(['c', 'a', 'b']);
    expect(focusedPane).toBe('c');
  });

  test('hiddenPanes hides a pane, and the hide of the last visible pane throws last_pane', () => {
    const store = createLayoutStore(row, [hiddenPanes()]);
    store.setHidden('a', true);
    store.setHidden('b', true);
    expect(() => store.setHidden('c', true)).toThrow(
      expect.objectContaining({ code: 'last_pane' })
    );
    const hidden = getPanes(store.getSnapshot().root).map(
      ({ hidden }) => hidden === true
    );
    expect(hidden).toEqual([true, true, false]);
    expect(store.getSnapshot().focusedPane).toBe('c');
  });

  test('persistence gives the saved form and sets a tree from it in one change', () => {
    const source = createLayoutStore(tabs, [stacks(), persistence()]);
    source.activate('b');
    const saved = parseStoredLayoutTree(
      JSON.parse(JSON.stringify(source.toStoredTree()))
    );
    const store = createLayoutStore(row, [persistence()]);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setStoredTree(saved);
    expect(calls).toBe(1);
    expect(store.getSnapshot().root).toEqual(source.getSnapshot().root);
    expect(Object.isFrozen(store.getSnapshot().root)).toBe(true);
    expect(store.toStoredTree()).toEqual({
      version: 3,
      root: source.getSnapshot().root,
    });
  });
});

describe('the store features of the root entry', () => {
  test('are functions, as the features of the React entry are', () => {
    for (const feature of [stacks, zoom, hiddenPanes, persistence]) {
      expect(typeof feature).toBe('function');
      expect(typeof feature().commands).toBe('function');
    }
  });
});
