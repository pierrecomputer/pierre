import { describe, expect, test } from 'bun:test';

import {
  binaryTree,
  type ChildSize,
  computeCSSLayout,
  computeLayout,
  fromBinaryLayout,
  getExitEdge,
  getPanes,
  type LayoutNode,
  LayoutStore,
  naryTree,
  type PaneNode,
  setPaneHidden,
  type SplitNode,
  swapPanes,
  validateLayout,
  visibleTree,
} from '../src';
import { shareSpace } from '../src/geometry';

const root: LayoutNode = {
  type: 'split',
  id: 'outer',
  direction: 'horizontal',
  sizes: [0.3, 0.7],
  children: [
    { type: 'pane', id: 'files', minWidth: 160, minHeight: 90 },
    {
      type: 'split',
      id: 'inner',
      direction: 'vertical',
      sizes: [0.7, 0.3],
      children: [
        { type: 'pane', id: 'editor', minWidth: 320, minHeight: 120 },
        { type: 'pane', id: 'terminal', minWidth: 200, minHeight: 80 },
      ],
    },
  ],
};

const pane = (id: string, hidden?: boolean): PaneNode =>
  hidden === true ? { type: 'pane', id, hidden } : { type: 'pane', id };

const row = (
  id: string,
  sizes: number[],
  children: LayoutNode[]
): SplitNode => ({
  type: 'split',
  id,
  direction: 'horizontal',
  sizes,
  children,
});

const column = (
  id: string,
  sizes: number[],
  children: LayoutNode[]
): SplitNode => ({ type: 'split', id, direction: 'vertical', sizes, children });

const ids = (node: LayoutNode): string[] => getPanes(node).map(({ id }) => id);

/** Expect numbers close to the expected ones, one by one. */
function near(actual: readonly ChildSize[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) =>
    expect(value as number).toBeCloseTo(expected[index], 9)
  );
}

const sizesOf = (node: LayoutNode | null): readonly ChildSize[] =>
  node?.type === 'split' ? node.sizes : [];

let sequence = 0;
const nextId = (): string => `new-${++sequence}`;

describe('tree operations', () => {
  test('a move across ancestors promotes the former sibling, in both models', () => {
    for (const model of [binaryTree, naryTree]) {
      const store = new LayoutStore(root, { model });
      store.move('files', 'terminal', 'bottom');
      const next = store.getSnapshot().root;
      expect(next.id).toBe('inner');
      expect(ids(next)).toEqual(['editor', 'terminal', 'files']);
    }
    expect(ids(root)).toEqual(['files', 'editor', 'terminal']);
  });

  test('the binary model splits at each edge with a new split', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const next = binaryTree.split(pane('a'), 'a', pane('b'), edge, () => 's');
      if (next.type !== 'split') throw new Error('Expected split');
      expect(next.direction).toBe(
        edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
      );
      expect(ids(next)).toEqual(
        edge === 'left' || edge === 'top' ? ['b', 'a'] : ['a', 'b']
      );
    }
    // A split beside a pane in a row is a new row in that row.
    const next = binaryTree.split(root, 'files', pane('x'), 'right', nextId);
    if (next.type !== 'split') throw new Error('Expected split');
    expect(next.children).toHaveLength(2);
    expect(next.children[0].type).toBe('split');
    binaryTree.validate(next);
  });

  test('the n-ary model adds a pane to a split of the same direction', () => {
    const next = naryTree.split(root, 'files', pane('x'), 'right', nextId);
    expect(next.id).toBe('outer');
    near(sizesOf(next), [0.15, 0.15, 0.7]);
    expect(ids(next)).toEqual(['files', 'x', 'editor', 'terminal']);
    // Another direction puts a new split in the place of the target.
    const below = naryTree.split(root, 'files', pane('y'), 'bottom', () => 'c');
    if (below.type !== 'split') throw new Error('Expected split');
    expect(below.children[0]).toMatchObject({ id: 'c', direction: 'vertical' });
    naryTree.validate(below);
  });

  test('the n-ary model gives the size of a closed pane to its neighbour', () => {
    const three = row('r', [0.2, 0.3, 0.5], [pane('a'), pane('b'), pane('c')]);
    near(sizesOf(naryTree.remove(three, 'b')), [0.5, 0.5]);
    expect(ids(naryTree.remove(three, 'b') ?? three)).toEqual(['a', 'c']);
    // The first pane gives its size to the next one.
    near(sizesOf(naryTree.remove(three, 'a')), [0.5, 0.5]);
    // A hidden neighbour takes no space, so the next visible one takes it.
    const hidden = row(
      'r',
      [0.2, 0.3, 0.5],
      [pane('a', true), pane('b'), pane('c')]
    );
    near(sizesOf(naryTree.remove(hidden, 'b')), [0.2, 0.8]);
    // A hidden pane takes no space, so its size goes with it.
    near(sizesOf(naryTree.remove(hidden, 'a')), [0.3, 0.5]);
  });

  test('the n-ary model joins a split that a close leaves in a split of its direction', () => {
    const nested = row(
      'r',
      [0.4, 0.6],
      [
        pane('a'),
        column(
          'c',
          [0.5, 0.5],
          [pane('b'), row('i', [0.25, 0.75], [pane('d'), pane('e')])]
        ),
      ]
    );
    naryTree.validate(nested);
    const next = naryTree.remove(nested, 'b');
    expect(next?.id).toBe('r');
    near(sizesOf(next), [0.4, 0.15, 0.45]);
    expect(ids(next ?? nested)).toEqual(['a', 'd', 'e']);
    // The binary model keeps the row in the row.
    const binary = fromBinaryLayout({
      type: 'split',
      id: 'r',
      direction: 'horizontal',
      ratio: 0.4,
      first: pane('a'),
      second: {
        type: 'split',
        id: 'c',
        direction: 'vertical',
        ratio: 0.5,
        first: pane('b'),
        second: {
          type: 'split',
          id: 'i',
          direction: 'horizontal',
          ratio: 0.25,
          first: pane('d'),
          second: pane('e'),
        },
      },
    });
    expect(binaryTree.remove(binary, 'b')).toMatchObject({
      id: 'r',
      sizes: [0.4, 0.6],
      children: [{ id: 'a' }, { id: 'i', sizes: [0.25, 0.75] }],
    });
  });

  test('normalize gives a tree the shape of a model, and keeps the nodes that have it', () => {
    const flat = row('r', [0.2, 0.3, 0.5], [pane('a'), pane('b'), pane('c')]);
    expect(naryTree.normalize(flat, nextId)).toBe(flat);
    const nested = binaryTree.normalize(flat, () => 'rest');
    binaryTree.validate(nested);
    expect(nested).toMatchObject({
      id: 'r',
      sizes: [0.2, 0.8],
      children: [{ id: 'a' }, { id: 'rest', sizes: [0.3, 0.5] }],
    });
    const joined = naryTree.normalize(nested, nextId);
    naryTree.validate(joined);
    expect(joined.id).toBe('r');
    near(sizesOf(joined), [0.2, 0.3, 0.5]);
    expect(getPanes(joined)[1]).toBe(getPanes(flat)[1]);
    expect(binaryTree.normalize(root, nextId)).toBe(root);
    expect(naryTree.normalize(root, nextId)).toBe(root);
  });

  test('swap keeps both identities and their constraints', () => {
    const next = swapPanes(root, 'files', 'terminal');
    validateLayout(next);
    expect(ids(next)).toEqual(['terminal', 'editor', 'files']);
    expect(getPanes(next)[0].minWidth).toBe(200);
  });

  test('the binary model collapses a split that a close empties', () => {
    if (root.type !== 'split') throw new Error('Expected split');
    expect(binaryTree.remove(root, 'terminal')).toEqual({
      ...root,
      children: [root.children[0], getPanes(root)[1]],
    });
    expect(binaryTree.remove(pane('only'), 'only')).toBeNull();
    expect(binaryTree.remove(root, 'missing')).toBe(root);
  });

  test('duplicate IDs, invalid dimensions, invalid sizes, and other shapes are rejected', () => {
    expect(() =>
      validateLayout(row('r', [0.5, 0.5], [pane('a'), pane('a')]))
    ).toThrow();
    expect(() =>
      validateLayout({ type: 'pane', id: '', minWidth: 1 })
    ).toThrow();
    expect(() =>
      validateLayout({ type: 'pane', id: 'a', minHeight: NaN })
    ).toThrow();
    expect(() => validateLayout({ ...root, sizes: [0.5, 0] })).toThrow();
    expect(() => validateLayout({ ...root, sizes: [1] })).toThrow();
    expect(() => validateLayout(row('r', [1], [pane('a')]))).toThrow();
    const three = row('r', [1, 1, 1], [pane('a'), pane('b'), pane('c')]);
    expect(() => binaryTree.validate(three)).toThrow();
    naryTree.validate(three);
    const nested = row(
      'r',
      [1, 1],
      [pane('a'), row('i', [1, 1], [pane('b'), pane('c')])]
    );
    expect(() => naryTree.validate(nested)).toThrow();
    binaryTree.validate(nested);
  });

  test('a saved tree of version 1 converts with its shape', () => {
    expect(
      fromBinaryLayout({
        type: 'split',
        id: 's',
        direction: 'vertical',
        ratio: 0.25,
        first: pane('a'),
        second: pane('b'),
      })
    ).toEqual(column('s', [0.25, 0.75], [pane('a'), pane('b')]));
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
    expect(() => computeLayout(root, NaN, 10)).toThrow();
  });

  test('children share the space by weight, above their minimum sizes', () => {
    // Shares of 200, 400, and 400 px, but the first needs 300.
    near(shareSpace(1000, [0.2, 0.4, 0.4], [300, 100, 100]), [300, 350, 350]);
    near(shareSpace(1000, [1, 1, 2], [0, 0, 0]), [250, 250, 500]);
    // Below the sum of the minimums, each child gets a part in proportion to its minimum.
    near(shareSpace(250, [0.2, 0.4, 0.4], [300, 100, 100]), [150, 50, 50]);
    // Two children: the share, held between the two minimums.
    for (const available of [0, 150, 260, 400, 1000]) {
      const [first, second] = shareSpace(available, [0.7, 0.3], [100, 160]);
      const expected =
        available < 260
          ? (available * 100) / 260
          : Math.max(100, Math.min(available * 0.7, available - 160));
      expect(first).toBeCloseTo(expected, 9);
      expect(first + second).toBeCloseTo(available, 9);
    }
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

describe('css layout', () => {
  test('each element gets container-unit values and no custom properties', () => {
    const layout = computeCSSLayout(root);
    const values = [
      ...layout.panes.flatMap(({ rect }) => [
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      ]),
      ...layout.separators.flatMap(({ rect }) => [
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      ]),
      ...layout.corners.flatMap(({ left, top }) => [left, top]),
    ];
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toContain('var(');
      expect(value).toMatch(/^(calc\(.*\)|-?[\d.]+px|100cq[wh])$/);
    }
  });

  test('a separator has the ID of its split and place, and its preferred place', () => {
    const three = row('r', [0.2, 0.3, 0.5], [pane('a'), pane('b'), pane('c')]);
    const layout = computeCSSLayout(three);
    expect(
      layout.separators.map(({ id, index, before, value }) => [
        id,
        index,
        before.id,
        value,
      ])
    ).toEqual([
      ['r:1', 1, 'a', 0.2],
      ['r:2', 2, 'b', 0.5],
    ]);
  });

  test('a split that wraps a pane keeps the IDs of the separators around it', () => {
    const before = computeCSSLayout(root).separators.map(({ id }) => id);
    expect(before).toEqual(['outer:1', 'inner:1']);
    const next = binaryTree.split(
      root,
      'terminal',
      pane('x'),
      'right',
      () => 'w'
    );
    expect(computeCSSLayout(next).separators.map(({ id }) => id)).toEqual([
      ...before,
      'w:1',
    ]);
  });

  test('a row in a column meets each separator of the row at a corner', () => {
    const layout = computeCSSLayout(
      column(
        'c',
        [0.5, 0.5],
        [row('r', [1, 1, 1], [pane('a'), pane('b'), pane('c2')]), pane('d')]
      )
    );
    expect(layout.corners.map(({ separatorIds }) => separatorIds)).toEqual([
      ['r:1', 'c:1'],
      ['r:2', 'c:1'],
    ]);
  });
});

describe('hidden panes', () => {
  test('a hidden pane keeps its place and gives its space to its sibling', () => {
    const hidden = setPaneHidden(root, 'terminal', true);
    expect(ids(hidden)).toEqual(['files', 'editor', 'terminal']);
    expect(visibleTree(hidden)?.type).toBe('split');
    const geometry = computeLayout(hidden, 1000, 600);
    expect(geometry.panes.map(({ pane }) => pane.id)).toEqual([
      'files',
      'editor',
    ]);
    expect(geometry.separators.map(({ split }) => split.id)).toEqual(['outer']);
    const editor = geometry.panes[1].rect;
    expect(editor.height).toBe(600);
    // Showing it again gives back the tree without the flag.
    const shown = setPaneHidden(hidden, 'terminal', false);
    expect(getPanes(shown)[2]).toEqual(getPanes(root)[2]);
    expect(() =>
      setPaneHidden(setPaneHidden(hidden, 'files', true), 'editor', true)
    ).toThrow();
  });

  test('the visible children of a split share its space by weight', () => {
    const three = row(
      'r',
      [0.2, 0.3, 0.5],
      [pane('a'), pane('b', true), pane('c')]
    );
    const geometry = computeLayout(three, 1008, 600, 8);
    near(
      geometry.panes.map(({ rect }) => rect.width),
      [1000 * (0.2 / 0.7), 1000 * (0.5 / 0.7)]
    );
    expect(geometry.separators.map(({ id }) => id)).toEqual(['r:2']);
  });

  test('the store hides and shows panes, and keeps focus and zoom on visible panes', () => {
    const store = new LayoutStore(root);
    store.focusPane('terminal');
    store.toggleZoom('terminal');
    store.setHidden('terminal', true);
    expect(store.getSnapshot().focusedPane).not.toBe('terminal');
    expect(store.getSnapshot().zoomedPane).toBeNull();
    store.setHidden('files', true);
    // The last visible pane stays, and cannot be closed either.
    store.setHidden('editor', true);
    store.close('editor');
    expect(
      getPanes(store.getSnapshot().root).filter(({ hidden }) => hidden !== true)
    ).toHaveLength(1);
    store.setHidden('terminal', false);
    expect(store.getSnapshot().focusedPane).toBe('terminal');
    expect(() =>
      validateLayout({
        ...root,
        children: [{ type: 'pane', id: 'x', hidden: 1 }, pane('y')],
      } as unknown as LayoutNode)
    ).toThrow();
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
        '{"version":2,"root":null,"focusedPane":"a","zoomedPane":null}'
      )
    ).toThrow();
    expect(() => store.setSizes({ outer: [0.5, -1] })).toThrow();
    expect(() => store.setSizes({ outer: [1, 1, 1] })).toThrow();
    expect(store.getSnapshot()).toBe(before);
    store.toggleZoom('editor');
    const saved = store.serialize();
    expect(JSON.parse(saved).version).toBe(3);
    store.close('editor');
    store.restore(saved);
    expect(store.getSnapshot().zoomedPane).toBe('editor');
    expect(getPanes(store.getSnapshot().root)).toHaveLength(3);
  });

  test('a layout of version 1 restores into either model', () => {
    const saved = JSON.stringify({
      version: 1,
      root: {
        type: 'split',
        id: 'r',
        direction: 'horizontal',
        ratio: 0.5,
        first: pane('a'),
        second: {
          type: 'split',
          id: 'i',
          direction: 'horizontal',
          ratio: 0.5,
          first: pane('b'),
          second: pane('c'),
        },
      },
      focusedPane: 'b',
      zoomedPane: null,
    });
    const binary = new LayoutStore(pane('x'));
    binary.restore(saved);
    expect(binary.getSnapshot().root).toMatchObject({ sizes: [0.5, 0.5] });
    const nary = new LayoutStore(pane('x'), { model: naryTree });
    nary.restore(saved);
    near(sizesOf(nary.getSnapshot().root), [0.5, 0.25, 0.25]);
    expect(nary.getSnapshot().focusedPane).toBe('b');
  });

  test('setModel gives the tree the shape of the new model and keeps its panes', () => {
    const flat = row('r', [0.2, 0.3, 0.5], [pane('a'), pane('b'), pane('c')]);
    const store = new LayoutStore(flat);
    expect(store.getModel()).toBe(binaryTree);
    const panes = getPanes(store.getSnapshot().root);
    expect(store.getSnapshot().root).toMatchObject({ sizes: [0.2, 0.8] });
    store.setModel(naryTree);
    expect(store.getModel()).toBe(naryTree);
    near(sizesOf(store.getSnapshot().root), [0.2, 0.3, 0.5]);
    getPanes(store.getSnapshot().root).forEach((node, index) =>
      expect(node).toBe(panes[index])
    );
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

  test('setRoot keeps the nodes of the store and copies the others', () => {
    const store = new LayoutStore(root);
    const panes = new Map(
      getPanes(store.getSnapshot().root).map((node) => [node.id, node])
    );
    const files = panes.get('files');
    const editor = panes.get('editor');
    if (files === undefined || editor === undefined)
      throw new Error('Missing panes');
    const added: PaneNode = { type: 'pane', id: 'notes' };
    store.setRoot(
      row(
        'next',
        [0.5, 0.5],
        [files, column('tools', [0.5, 0.5], [editor, added])]
      )
    );
    const next = getPanes(store.getSnapshot().root);
    expect(next[0]).toBe(files);
    expect(next[1]).toBe(editor);
    expect(next[2]).not.toBe(added);
    expect(Object.isFrozen(next[2])).toBe(true);
    expect(Object.isFrozen(added)).toBe(false);
  });

  test('a change keeps the identity of every node that it does not touch', () => {
    const store = new LayoutStore(root);
    const before = store.getSnapshot().root;
    const panes = getPanes(before);
    store.setSizes({ inner: [0.4, 0.6] });
    const after = store.getSnapshot().root;
    expect(after).not.toBe(before);
    getPanes(after).forEach((node, index) => expect(node).toBe(panes[index]));
    if (after.type !== 'split' || before.type !== 'split')
      throw new Error('Expected a split root');
    expect(after.children[0]).toBe(before.children[0]);
    expect(after.children[1]).not.toBe(before.children[1]);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.children[1])).toBe(true);
    expect(Object.isFrozen((after.children[1] as SplitNode).sizes)).toBe(true);

    // Focus and zoom keep the whole tree.
    store.focusPane('terminal');
    store.toggleZoom('terminal');
    expect(store.getSnapshot().root).toBe(after);

    // A moved pane keeps its node, so its content need not render again.
    const files = getPanes(after).find(({ id }) => id === 'files');
    store.move('files', 'terminal', 'bottom');
    expect(
      getPanes(store.getSnapshot().root).find(({ id }) => id === 'files')
    ).toBe(files);
  });

  test('the store copies the pane that a caller adds', () => {
    const store = new LayoutStore(root);
    const added = { type: 'pane' as const, id: 'added', minWidth: 100 };
    store.split('editor', added, 'right');
    const node = getPanes(store.getSnapshot().root).find(
      ({ id }) => id === 'added'
    );
    expect(node).toEqual(added);
    expect(node).not.toBe(added);
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(added)).toBe(false);
  });

  test('generated split IDs avoid restored trees', () => {
    const store = new LayoutStore({ ...root, id: 'layout-split-1' });
    store.split('editor', { type: 'pane', id: 'new' });
    validateLayout(store.getSnapshot().root);
  });
});

const stack = (id: string, active: string, children: PaneNode[]) => ({
  type: 'stack' as const,
  id,
  active,
  children,
});

describe('stacks', () => {
  test('a stack holds two or more panes, and its active pane is one of them', () => {
    validateLayout(stack('s', 'b', [pane('a'), pane('b')]));
    expect(() => validateLayout(stack('s', 'a', [pane('a')]))).toThrow();
    expect(() =>
      validateLayout(stack('s', 'c', [pane('a'), pane('b')]))
    ).toThrow();
    expect(() =>
      validateLayout({
        type: 'stack',
        id: 's',
        active: 'a',
        children: [pane('a'), row('r', [1, 1], [pane('b'), pane('c')])],
      } as unknown as LayoutNode)
    ).toThrow();
  });

  test('a new tab makes a stack in the place of its target, and shows', () => {
    for (const model of [binaryTree, naryTree]) {
      const store = new LayoutStore(root, { model });
      store.addTab('terminal', pane('logs'));
      const next = store.getSnapshot();
      expect(next.focusedPane).toBe('logs');
      const inner = next.root.type === 'split' ? next.root.children[1] : null;
      if (inner?.type !== 'split') throw new Error('Expected split');
      expect(inner.sizes).toEqual([0.7, 0.3]);
      expect(inner.children[1]).toMatchObject({
        type: 'stack',
        active: 'logs',
      });
      expect(ids(inner.children[1])).toEqual(['terminal', 'logs']);
      // A second tab goes after its target.
      store.addTab('terminal', pane('build'));
      expect(ids(store.getSnapshot().root)).toEqual([
        'files',
        'editor',
        'terminal',
        'build',
        'logs',
      ]);
      store.addTab('logs', pane('first'), 0);
      expect(ids(store.getSnapshot().root).slice(2)).toEqual([
        'first',
        'terminal',
        'build',
        'logs',
      ]);
    }
  });

  test('each pane of a stack has the box of the stack, and only the active pane shows', () => {
    const tree = row(
      'r',
      [1, 1],
      [
        pane('a'),
        stack('s', 'c', [
          { type: 'pane', id: 'b', minWidth: 300 },
          { type: 'pane', id: 'c', minWidth: 100 },
        ]),
      ]
    );
    const css = computeCSSLayout(tree);
    const b = css.panes.find(({ pane }) => pane.id === 'b');
    const c = css.panes.find(({ pane }) => pane.id === 'c');
    expect(b?.rect).toEqual(c!.rect);
    expect(b?.hidden).toBe(true);
    expect(c?.hidden).toBe(false);
    expect(c?.stack?.id).toBe('s');
    // The stack takes the minimum size of its largest pane, whichever shows.
    const pixels = computeLayout(tree, 500, 300, 8);
    expect(pixels.panes.map(({ pane }) => pane.id)).toEqual(['a', 'c']);
    expect(pixels.panes[1].rect.width).toBeCloseTo(300, 9);
    // A change of tab changes no box.
    const other = computeCSSLayout(
      row(
        'r',
        [1, 1],
        [
          pane('a'),
          { ...(tree.children[1] as ReturnType<typeof stack>), active: 'b' },
        ]
      )
    );
    expect(other.panes.map(({ rect }) => rect)).toEqual(
      css.panes.map(({ rect }) => rect)
    );
    expect(other.separators.map(({ rect }) => rect)).toEqual(
      css.separators.map(({ rect }) => rect)
    );
  });

  test('activate shows a tab, and the zoom of its stack follows it', () => {
    const store = new LayoutStore(
      row('r', [1, 1], [pane('a'), stack('s', 'b', [pane('b'), pane('c')])])
    );
    const before = store.getSnapshot().root;
    store.toggleZoom('b');
    store.activate('c');
    const next = store.getSnapshot();
    expect(next.zoomedPane).toBe('c');
    expect(next.focusedPane).toBe('c');
    // The split and the panes keep their identity.
    expect(next.root.type === 'split' && next.root.children[0]).toBe(
      before.type === 'split' && before.children[0]
    );
    expect(() => store.activate('a')).toThrow();
    // A zoom of a pane that does not show makes it active.
    store.toggleZoom('c');
    store.toggleZoom('b');
    expect(store.getSnapshot().root).toMatchObject({
      children: [{ id: 'a' }, { id: 's', active: 'b' }],
    });
  });

  test('a close shows the nearest tab, and a stack of one pane gives way to it', () => {
    for (const model of [binaryTree, naryTree]) {
      const store = new LayoutStore(
        row(
          'r',
          [0.25, 0.75],
          [pane('a'), stack('s', 'c', [pane('b'), pane('c'), pane('d')])]
        ),
        { model }
      );
      store.close('c');
      expect(store.getSnapshot().root).toMatchObject({
        sizes: [0.25, 0.75],
        children: [{ id: 'a' }, { id: 's', active: 'd' }],
      });
      store.close('d');
      expect(store.getSnapshot().root).toMatchObject({
        sizes: [0.25, 0.75],
        children: [{ id: 'a' }, { type: 'pane', id: 'b' }],
      });
    }
  });

  test('a split or a move beside a tab goes beside its stack', () => {
    for (const model of [binaryTree, naryTree]) {
      const store = new LayoutStore(
        row('r', [1, 1], [pane('a'), stack('s', 'b', [pane('b'), pane('c')])]),
        { model }
      );
      store.split('c', pane('x'), 'bottom');
      const split = store.getSnapshot().root;
      if (split.type !== 'split') throw new Error('Expected split');
      expect(split.children[1]).toMatchObject({
        type: 'split',
        direction: 'vertical',
        children: [{ id: 's' }, { id: 'x' }],
      });
      // A tab that moves leaves its stack; the last tab takes its place.
      store.move('c', 'a', 'left');
      expect(ids(store.getSnapshot().root)).toEqual(['c', 'a', 'b', 'x']);
      expect(getPanes(store.getSnapshot().root)).toHaveLength(4);
      model.validate(store.getSnapshot().root);
    }
  });

  test('moveToStack moves a pane into a stack, or changes the order of tabs', () => {
    for (const model of [binaryTree, naryTree]) {
      const store = new LayoutStore(
        row(
          'r',
          [1, 1, 1],
          [pane('a'), stack('s', 'b', [pane('b'), pane('c')]), pane('d')]
        ),
        { model: naryTree }
      );
      store.setModel(model);
      store.moveToStack('d', 'b');
      expect(ids(store.getSnapshot().root)).toEqual(['a', 'b', 'd', 'c']);
      expect(store.getSnapshot().focusedPane).toBe('d');
      const stackId = store.getSnapshot().root.type === 'split' ? 's' : '';
      store.moveToStack('b', 'c');
      expect(ids(store.getSnapshot().root)).toEqual(['a', 'd', 'c', 'b']);
      // A move inside one stack keeps the stack.
      expect(JSON.stringify(store.getSnapshot().root)).toContain(
        `"id":"${stackId}"`
      );
      store.moveToStack('a', 'c', 0);
      const tree = store.getSnapshot().root;
      expect(ids(tree)).toEqual(['a', 'd', 'c', 'b']);
      expect(tree.type).toBe('stack');
      model.validate(tree);
    }
  });

  test('a hidden tab leaves its stack and shows again as the active tab', () => {
    const store = new LayoutStore(
      row('r', [1, 1], [pane('a'), stack('s', 'b', [pane('b'), pane('c')])])
    );
    store.setHidden('b', true);
    expect(store.getSnapshot().root).toMatchObject({
      children: [{ id: 'a' }, { id: 's', active: 'c' }],
    });
    store.setHidden('c', true);
    // A stack of hidden panes takes no space.
    expect(
      computeLayout(store.getSnapshot().root, 400, 200, 8).panes.map(
        ({ pane }) => pane.id
      )
    ).toEqual(['a']);
    store.setHidden('b', false);
    expect(store.getSnapshot().root).toMatchObject({
      children: [{ id: 'a' }, { id: 's', active: 'b' }],
    });
    expect(store.getSnapshot().focusedPane).toBe('b');
  });

  test('stacks save and restore with version 3, and keep their identity', () => {
    const tree = row(
      'r',
      [1, 1],
      [pane('a'), stack('s', 'c', [pane('b'), pane('c')])]
    );
    const store = new LayoutStore(tree);
    const saved = store.serialize();
    expect(JSON.parse(saved).version).toBe(3);
    const other = new LayoutStore(root);
    other.restore(saved);
    expect(other.getSnapshot().root).toEqual(store.getSnapshot().root);
    // A change outside the stack keeps the stack node.
    const before = store.getSnapshot().root;
    store.setSizes({ r: [2, 1] });
    const after = store.getSnapshot().root;
    expect(after.type === 'split' && after.children[1]).toBe(
      before.type === 'split' && before.children[1]
    );
    expect(Object.isFrozen(after.type === 'split' && after.children[1])).toBe(
      true
    );
    // A layout of version 2 restores as it is.
    other.restore(
      JSON.stringify({ ...JSON.parse(store.serialize()), version: 2 })
    );
    expect(other.getSnapshot().root).toEqual(after);
  });
});

describe('sizes in pixels and maximum sizes', () => {
  // A sidebar of 240 px, an editor, and a preview of at most 300 px.
  const sidebar: PaneNode = { type: 'pane', id: 'sidebar', minWidth: 100 };
  const editor: PaneNode = { type: 'pane', id: 'editor', minWidth: 200 };
  const preview: PaneNode = {
    type: 'pane',
    id: 'preview',
    minWidth: 100,
    maxWidth: 300,
  };
  const tree: SplitNode = {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [{ px: 240 }, 2, 1],
    children: [sidebar, editor, preview],
  };
  const widths = (width: number): number[] =>
    computeLayout(tree, width, 400, 0).panes.map(({ rect }) => rect.width);

  test('a split accepts a size in pixels for a child, and a pane a maximum size', () => {
    validateLayout(tree);
    for (const sizes of [
      [{ px: -1 }, 1],
      [{ px: 1, weight: 2 }, 1],
      ['1', 1],
    ])
      expect(() =>
        validateLayout({ ...tree, sizes, children: [sidebar, editor] } as never)
      ).toThrow();
    expect(() => validateLayout({ ...preview, maxWidth: -1 })).toThrow();
  });

  test('a child with a size in pixels keeps it, and the others share the rest', () => {
    near(widths(2000), [240, 1460, 300]);
    near(widths(1200), [240, 660, 300]);
    near(widths(800), [240, 373.3333333333, 186.6666666667]);
    // The weighted children reach their minimums first, then the sidebar shrinks.
    near(widths(540), [240, 200, 100]);
    near(widths(500), [200, 200, 100]);
    near(widths(400), [100, 200, 100]);
    // Below the sum of the minimums, each child gets a part of its minimum.
    near(widths(300), [75, 150, 75]);
  });

  test('weighted children grow past their maximums when all have reached them', () => {
    const capped: SplitNode = {
      ...tree,
      sizes: [1, 1],
      children: [preview, { ...preview, id: 'other', maxWidth: 100 }],
    };
    const at = (width: number): number[] =>
      computeLayout(capped, width, 400, 0).panes.map(({ rect }) => rect.width);
    near(at(400), [300, 100]);
    near(at(600), [400, 200]);
  });

  test('the preferred place of a separator counts sizes in pixels', () => {
    const css = computeCSSLayout(tree, 0);
    // The preferred place of a separator counts 240 px against 1000 px of
    // weighted space.
    expect(css.separators[0].value).toBeCloseTo(240 / 1240, 9);
  });

  test('a stack takes the largest minimum and the smallest maximum of its panes', () => {
    const tabs = {
      type: 'stack' as const,
      id: 's',
      active: 'a',
      children: [
        { type: 'pane' as const, id: 'a', minWidth: 100, maxWidth: 500 },
        { type: 'pane' as const, id: 'b', minWidth: 150, maxWidth: 400 },
      ],
    };
    const split: SplitNode = {
      type: 'split',
      id: 'r',
      direction: 'horizontal',
      sizes: [1, 1],
      children: [tabs, pane('c')],
    };
    near(
      computeLayout(split, 1200, 400, 0).panes.map(({ rect }) => rect.width),
      [400, 800]
    );
  });

  test('operations keep sizes in pixels', () => {
    // An n-ary split of a child in pixels gives each half of its pixels.
    const split = naryTree.split(tree, 'sidebar', pane('x'), 'right', nextId);
    expect(sizesOf(split)).toEqual([{ px: 120 }, { px: 120 }, 2, 1]);
    // A close of a child in pixels gives its space to the weighted children.
    expect(sizesOf(naryTree.remove(tree, 'sidebar'))).toEqual([2, 1]);
    // A close of a weighted child gives its weight to the nearest weighted
    // child, and none to a child in pixels.
    expect(sizesOf(naryTree.remove(tree, 'editor'))).toEqual([{ px: 240 }, 3]);
    // A split that joins its parent in a place in pixels shares those pixels.
    const nested = naryTree.normalize(
      {
        ...tree,
        sizes: [{ px: 300 }, 1],
        children: [
          {
            type: 'split',
            id: 'inner',
            direction: 'horizontal',
            sizes: [1, 2],
            children: [pane('a'), pane('b')],
          },
          pane('c'),
        ],
      },
      nextId
    );
    expect(sizesOf(nested)).toEqual([{ px: 100 }, { px: 200 }, 1]);
    // The binary model nests a row of three; the place of the rest takes the
    // weights of its children.
    const binary = binaryTree.normalize(tree, nextId);
    expect(sizesOf(binary)).toEqual([{ px: 240 }, 3]);
  });

  test('sizes in pixels save, restore, and change with setSizes', () => {
    const store = new LayoutStore(tree, { model: naryTree });
    store.setSizes({ row: [{ px: 300 }, 1, 1] });
    const saved = store.serialize();
    const other = new LayoutStore(root, { model: naryTree });
    other.restore(saved);
    expect(sizesOf(other.getSnapshot().root)).toEqual([{ px: 300 }, 1, 1]);
    expect(() => store.setSizes({ row: [{ px: -5 }, 1, 1] })).toThrow();
  });
});

describe('collapsed panes', () => {
  // An editor above a terminal that collapses to its 38 px header.
  const tools: SplitNode = {
    type: 'split',
    id: 'tools',
    direction: 'vertical',
    sizes: [0.6, 0.4],
    children: [
      { type: 'pane', id: 'editor', minHeight: 140 },
      { type: 'pane', id: 'terminal', minHeight: 100, collapsedSize: 38 },
    ],
  };
  const heights = (tree: LayoutNode, height: number): number[] =>
    computeLayout(tree, 600, height, 8).panes.map(({ rect }) => rect.height);

  test('a collapsed pane takes its collapsed size, and keeps its size in the split', () => {
    const store = new LayoutStore(tools);
    store.setCollapsed('terminal', true);
    const collapsed = store.getSnapshot().root;
    near(heights(collapsed, 608), [562, 38]);
    expect(sizesOf(collapsed)).toEqual([0.6, 0.4]);
    // Its minimum size along the split is its collapsed size: below the sum
    // of the minimums (140 + 38), each pane gets a part of its minimum.
    expect(
      computeLayout(collapsed, 600, 150, 8).panes[1].rect.height
    ).toBeCloseTo((38 * 142) / 178, 9);
    const css = computeCSSLayout(collapsed);
    expect(css.panes.map(({ collapsed }) => collapsed)).toEqual([false, true]);
    store.setCollapsed('terminal', false);
    near(heights(store.getSnapshot().root, 608), [360, 240]);
  });

  test('a tab collapses its stack, and the root does not collapse', () => {
    const store = new LayoutStore(tools);
    store.addTab('terminal', pane('server'));
    store.setCollapsed('server', true);
    const root = store.getSnapshot().root;
    expect(root).toMatchObject({
      children: [
        { id: 'editor' },
        { type: 'stack', collapsed: true, collapsedSize: 38 },
      ],
    });
    near(heights(root, 608), [562, 38]);
    // The last tab of a stack takes its collapse.
    store.close('server');
    expect(store.getSnapshot().root).toMatchObject({
      children: [
        { id: 'editor' },
        { type: 'pane', id: 'terminal', collapsed: true, collapsedSize: 38 },
      ],
    });
    // A pane alone in the layout fills it.
    const alone = new LayoutStore(pane('only'));
    alone.setCollapsed('only', true);
    expect(alone.getSnapshot().root).toEqual(pane('only'));
  });

  test('collapse is validated, saved, and restored', () => {
    expect(() =>
      validateLayout({
        type: 'stack',
        id: 's',
        active: 'a',
        children: [{ ...pane('a'), collapsed: true }, pane('b')],
      })
    ).toThrow();
    expect(() => validateLayout({ ...pane('a'), collapsedSize: -1 })).toThrow();
    const store = new LayoutStore(tools);
    store.setCollapsed('terminal', true);
    const other = new LayoutStore(root);
    other.restore(store.serialize());
    expect(other.getSnapshot().root).toEqual(store.getSnapshot().root);
  });
});
