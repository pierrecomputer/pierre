import { describe, expect, test } from 'bun:test';

import {
  computeLayout,
  getExitEdge,
  getPanes,
  type LayoutNode,
  LayoutStore,
  movePane,
  removePane,
  splitPane,
  swapPanes,
  validateLayout,
} from '../src';

const root: LayoutNode = {
  type: 'split',
  id: 'outer',
  direction: 'horizontal',
  ratio: 0.3,
  first: { type: 'pane', id: 'files', minWidth: 160, minHeight: 90 },
  second: {
    type: 'split',
    id: 'inner',
    direction: 'vertical',
    ratio: 0.7,
    first: { type: 'pane', id: 'editor', minWidth: 320, minHeight: 120 },
    second: { type: 'pane', id: 'terminal', minWidth: 200, minHeight: 80 },
  },
};

describe('tree operations', () => {
  test('moves a pane across ancestors and promotes the former sibling', () => {
    const next = movePane(root, 'files', 'terminal', 'bottom', 'new-split');
    validateLayout(next);
    expect(next.id).toBe('inner');
    expect(getPanes(next).map(({ id }) => id)).toEqual([
      'editor',
      'terminal',
      'files',
    ]);
    expect(getPanes(root).map(({ id }) => id)).toEqual([
      'files',
      'editor',
      'terminal',
    ]);
  });

  test('splits at each edge with the expected ordering and axis', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const next = splitPane(
        { type: 'pane', id: 'a' },
        'a',
        { type: 'pane', id: 'b' },
        'split',
        edge
      );
      expect(next.type).toBe('split');
      if (next.type !== 'split') throw new Error('Expected split');
      expect(next.direction).toBe(
        edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
      );
      expect(next.first.id).toBe(edge === 'left' || edge === 'top' ? 'b' : 'a');
    }
  });

  test('swap keeps both identities and their constraints', () => {
    const next = swapPanes(root, 'files', 'terminal');
    validateLayout(next);
    expect(getPanes(next).map(({ id }) => id)).toEqual([
      'terminal',
      'editor',
      'files',
    ]);
    expect(getPanes(next)[0].minWidth).toBe(200);
  });

  test('remove collapses empty splits and supports the final leaf', () => {
    expect(removePane(root, 'terminal')).toEqual({
      ...root,
      second: getPanes(root)[1],
    });
    expect(removePane({ type: 'pane', id: 'only' }, 'only')).toBeNull();
    expect(removePane(root, 'missing')).toBe(root);
  });

  test('duplicate IDs, invalid dimensions, and invalid ratios are rejected', () => {
    expect(() =>
      splitPane(root, 'editor', { type: 'pane', id: 'files' }, 'duplicate')
    ).toThrow();
    expect(() =>
      validateLayout({ type: 'pane', id: '', minWidth: 1 })
    ).toThrow();
    expect(() =>
      validateLayout({ type: 'pane', id: 'a', minHeight: NaN })
    ).toThrow();
    expect(() => validateLayout({ ...root, ratio: Infinity })).toThrow();
  });
});

describe('geometry', () => {
  test('minimums propagate through nested subtrees', () => {
    const layout = computeLayout(root, 600, 400);
    expect(
      layout.panes.find(({ pane }) => pane.id === 'editor')?.rect.width
    ).toBeGreaterThanOrEqual(320);
    expect(
      layout.panes.find(({ pane }) => pane.id === 'files')?.rect.width
    ).toBeGreaterThanOrEqual(160);
    expect(layout.corners.length).toBe(1);
  });

  test('tiny viewports never produce negative sizes or overflow', () => {
    for (const width of [0, 1, 7, 50, 1000]) {
      for (const height of [0, 2, 50, 400]) {
        for (const { rect } of computeLayout(root, width, height).panes) {
          expect(rect.width).toBeGreaterThanOrEqual(0);
          expect(rect.height).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.000001);
          expect(rect.y + rect.height).toBeLessThanOrEqual(height + 0.000001);
        }
      }
    }
  });

  test('viewport constraints do not overwrite preferred ratios', () => {
    computeLayout(root, 100, 100);
    expect(computeLayout(root, 1200, 600).separators[0].ratio).toBe(0.3);
    expect(() => computeLayout(root, NaN, 10)).toThrow();
  });

  test('zoom exits use a touched edge before a distant one', () => {
    expect(
      getExitEdge({ x: 0, y: 50, width: 800, height: 100 }, 1000, 600)
    ).toBe('left');
    expect(
      getExitEdge({ x: 300, y: 400, width: 100, height: 200 }, 1000, 600)
    ).toBe('bottom');
  });
});

describe('store', () => {
  test('snapshots are stable between updates and do not freeze caller inputs', () => {
    const store = new LayoutStore(root);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(Object.isFrozen(store.getSnapshot().root)).toBe(true);
    expect(Object.isFrozen(root)).toBe(false);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });
    store.toggleZoom('terminal');
    expect(calls).toBe(1);
    unsubscribe();
    store.close('terminal');
    expect(calls).toBe(1);
    expect(store.getSnapshot().zoomedPane).toBeNull();
    expect(store.getSnapshot().focusedPane).toBe('files');
  });

  test('failed updates are atomic and persistence validates before committing', () => {
    const store = new LayoutStore(root);
    const before = store.getSnapshot();
    expect(() =>
      store.split('editor', { type: 'pane', id: 'files' })
    ).toThrow();
    expect(() =>
      store.restore(
        '{"version":1,"root":null,"focusedPane":"a","zoomedPane":null}'
      )
    ).toThrow();
    expect(store.getSnapshot()).toBe(before);
    store.toggleZoom('editor');
    const saved = store.serialize();
    store.close('editor');
    store.restore(saved);
    expect(store.getSnapshot().zoomedPane).toBe('editor');
    expect(getPanes(store.getSnapshot().root)).toHaveLength(3);
  });

  test('zoom does not change geometry and final pane cannot be closed', () => {
    const store = new LayoutStore({ type: 'pane', id: 'only' });
    const tree = store.getSnapshot().root;
    store.toggleZoom();
    store.toggleZoom();
    store.close('only');
    expect(store.getSnapshot().root).toEqual(tree);
    expect(store.getSnapshot().zoomedPane).toBeNull();
  });

  test('generated split IDs avoid restored trees', () => {
    const store = new LayoutStore({ ...root, id: 'layout-split-1' });
    store.split('editor', { type: 'pane', id: 'new' });
    validateLayout(store.getSnapshot().root);
  });
});
