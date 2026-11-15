import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  createLayoutStore,
  edits,
  hiddenPanes,
  type LayoutNode,
  naryTree,
  stacks,
  zoom,
} from '../src';
import { presentation } from '../src/presentation';

// A row of a pane, a stack of two tabs, and a pane.
const tree: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [
    { type: 'pane', id: 'a' },
    {
      type: 'stack',
      id: 's',
      active: 'b',
      children: [
        { type: 'pane', id: 'b' },
        { type: 'pane', id: 'c' },
      ],
    },
    { type: 'pane', id: 'd' },
  ],
};

const storeOf = () =>
  createLayoutStore(tree, [edits(naryTree), stacks, zoom, hiddenPanes]);

const zoomed = (store: ReturnType<typeof storeOf>) =>
  store.getSnapshot().zoomedPane;

describe('the zoom rules of the store commit', () => {
  test('a split ends the zoom', () => {
    const store = storeOf();
    store.setZoom('a');
    store.split('d', { type: 'pane', id: 'e' });
    expect(zoomed(store)).toBeNull();
  });

  test('a move ends the zoom, also a move of the zoomed pane', () => {
    const store = storeOf();
    store.setZoom('a');
    store.move('d', 'a', 'left');
    expect(zoomed(store)).toBeNull();
    store.setZoom('a');
    store.move('a', 'd', 'bottom');
    expect(zoomed(store)).toBeNull();
  });

  test('a close or a swap of other panes keeps the zoom', () => {
    const store = storeOf();
    store.setZoom('a');
    store.close('d');
    expect(zoomed(store)).toBe('a');
    store.swap('b', 'a');
    expect(zoomed(store)).toBe('a');
  });

  test('a zoomed stack follows its shown tab', () => {
    const store = storeOf();
    store.setZoom('b');
    store.activate('c');
    expect(zoomed(store)).toBe('c');
    store.moveTab('b', 0);
    expect(zoomed(store)).toBe('b');
  });

  test('a new tab takes the zoom of its stack or of its target, and ends a zoom elsewhere', () => {
    const store = storeOf();
    store.setZoom('b');
    store.addTab('b', { type: 'pane', id: 'e' });
    expect(zoomed(store)).toBe('e');
    store.setZoom('a');
    store.addTab('a', { type: 'pane', id: 'f' });
    expect(zoomed(store)).toBe('f');
    store.addTab('d', { type: 'pane', id: 'g' });
    expect(zoomed(store)).toBeNull();
  });

  test('a new tab that does not show keeps the zoom', () => {
    const store = storeOf();
    store.setZoom('a');
    store.addTab('d', { type: 'pane', id: 'e' }, undefined, {
      activate: false,
    });
    expect(zoomed(store)).toBe('a');
  });

  test('a tab that moves into the zoomed stack takes the zoom, and a tab that moves elsewhere ends it', () => {
    const store = storeOf();
    store.setZoom('b');
    store.moveToStack('d', 'b');
    expect(zoomed(store)).toBe('d');
    expect(store.getSnapshot().focusedPane).toBe('d');
    store.moveToStack('c', 'a');
    expect(zoomed(store)).toBeNull();
  });

  test('a hidden zoomed pane ends the zoom', () => {
    const store = storeOf();
    store.setZoom('a');
    store.setHidden('a', true);
    expect(zoomed(store)).toBeNull();
  });
});

describe('setZoom', () => {
  test('zooms a pane, shows its tab, and gives it the focus', () => {
    const store = storeOf();
    store.setZoom('c');
    const state = store.getSnapshot();
    expect(state.zoomedPane).toBe('c');
    expect(state.focusedPane).toBe('c');
  });

  test('null restores the layout and keeps the focus; the same zoom commits nothing', () => {
    const store = storeOf();
    store.setZoom('a');
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.setZoom('a');
    expect(calls).toBe(0);
    store.focusPane('d');
    store.setZoom(null);
    expect(zoomed(store)).toBeNull();
    expect(store.getSnapshot().focusedPane).toBe('d');
    expect(() => store.setZoom('missing')).toThrow();
  });
});

describe('presentation', () => {
  test('gives the pane that fills the layout and the panes under it', () => {
    const store = storeOf();
    const none = presentation(store.getSnapshot());
    expect(none.filled).toBeNull();
    expect(none.rearrangeable).toBe(true);
    expect(none.covered.size).toBe(0);
    store.setZoom('a');
    const value = presentation(store.getSnapshot());
    expect(value.filled).toBe('a');
    expect(value.rearrangeable).toBe(false);
    expect([...value.covered]).toEqual(['b', 'd']);
    expect(presentation(store.getSnapshot())).toBe(value);
  });

  test('keeps one empty set of covered panes while no pane fills the layout', () => {
    const store = storeOf();
    const before = presentation(store.getSnapshot()).covered;
    store.focusPane('d');
    expect(presentation(store.getSnapshot()).covered).toBe(before);
  });
});

// The modules that may name the zoom state: the core state and its commit,
// `presentation`, the zoom feature, the saved forms, and the old `Layout`
// component with its store class and its DOM helpers.
const ZOOM_STATE_OWNERS = new Set([
  'types.ts',
  'store.ts',
  'presentation.ts',
  'zoom.ts',
  'persistence-model.ts',
  'layout-store.ts',
  'dom/panes.ts',
  'react/layout.tsx',
  'react/features/zoom.tsx',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('no module but the zoom state owners reads the zoom state', () => {
  const root = join(import.meta.dir, '../src');
  const readers = sourceFiles(root)
    .map((path) => relative(root, path))
    .filter((path) => !ZOOM_STATE_OWNERS.has(path))
    .filter((path) =>
      readFileSync(join(root, path), 'utf8').includes('zoomedPane')
    );
  expect(readers).toEqual([]);
});
