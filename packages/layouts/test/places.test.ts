import { describe, expect, test } from 'bun:test';

import {
  type CanPlace,
  createLayoutStore,
  edits,
  getPanes,
  moveTo,
  naryTree,
  openAt,
  stackOf,
  stacks,
} from '../src';
import { applyLayoutOperations } from '../src/apply-operations';
import type { FeatureModule } from '../src/react/contract';
import { arrange, type ArrangeCommands } from '../src/react/features/arrange';
import type { StoreFeature } from '../src/store';
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

describe('moveTo and openAt', () => {
  test('take a pane to each kind of place', () => {
    const store = testStore(tabs);
    moveTo(store, 'files', { beside: 'notes', edge: 'bottom' });
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: [
        { tabs: ['diff', 'chat'] },
        { vertical: ['notes', 'files'] },
      ],
    });
    moveTo(store, 'files', { into: 'diff', index: 0 });
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: [{ tabs: ['files', 'diff', 'chat'] }, 'notes'],
    });
    openAt(store, pane('log'), { beside: 'row', edge: 'left' });
    openAt(store, pane('help'), { into: 'notes' });
    expect(shape(store.getSnapshot().root)).toEqual({
      horizontal: [
        'log',
        { tabs: ['files', 'diff', 'chat'] },
        { tabs: ['notes', 'help'] },
      ],
    });
  });

  test('name the feature that a place needs', () => {
    const store = createLayoutStore(tabs, [edits(naryTree)]);
    expect(() => moveTo(store, 'files', { into: 'notes' })).toThrow('stacks()');
    expect(() =>
      openAt(createLayoutStore(tabs), pane('log'), {
        beside: 'files',
        edge: 'left',
      })
    ).toThrow('edits()');
  });
});

describe('the store part of arrange()', () => {
  const store = () => {
    const feature = arrange() as unknown as FeatureModule<ArrangeCommands>;
    return createLayoutStore(tabs, [
      edits(naryTree),
      feature.store as StoreFeature<ArrangeCommands>,
    ]);
  };

  test('focusToward moves the focus across an edge, with reveal, and stops at an edge of the layout', () => {
    const layout = store();
    const operations: unknown[] = [];
    layout.subscribe((change) => operations.push(...change.operations));
    expect(layout.focusToward('right')).toBe(true);
    expect(layout.getSnapshot().focusedPane).toBe('chat');
    expect(layout.focusToward('right')).toBe(true);
    expect(layout.focusToward('right')).toBe(false);
    expect(layout.getSnapshot().focusedPane).toBe('notes');
    expect(operations).toEqual([
      { type: 'focus', pane: 'chat', reveal: true },
      { type: 'focus', pane: 'notes', reveal: true },
    ]);
  });

  test('grow and shrink need the boxes of a view', () => {
    const layout = store();
    expect(layout.grow('files', 'horizontal')).toBe(false);
    expect(layout.shrink('files', 'vertical')).toBe(false);
  });
});

describe('one rule for places', () => {
  // A group is a pane or a stack outside a stack. A place beside a node adds
  // a group, unless the source is a pane alone already; a place in a stack
  // adds none.
  const groups = (node: LayoutNode): number =>
    node.type === 'split'
      ? node.children.reduce((sum, child) => sum + groups(child), 0)
      : 1;
  const asked: unknown[] = [];
  const atMostThreeGroups: CanPlace = (source, place, state) => {
    asked.push({ source: source.id, place });
    if (!('beside' in place)) return true;
    const alone =
      getPanes(state.root).some(({ id }) => id === source.id) &&
      stackOf(state.root, source.id) === null;
    return alone || groups(state.root) < 3;
  };
  const store = () =>
    createLayoutStore(tabs, [edits(naryTree), stacks()], {
      canPlace: atMostThreeGroups,
    });

  test('a command throws place_refused, and the tree stays', () => {
    const layout = store();
    const before = layout.getSnapshot().root;
    expect(() => layout.split('files', pane('x'), 'right')).toThrow(
      'place_refused'
    );
    expect(() => layout.move('chat', 'notes', 'right')).toThrow(
      'place_refused'
    );
    expect(layout.getSnapshot().root).toBe(before);
    // A pane alone moves beside another: the count stays.
    layout.move('files', 'notes', 'right');
    expect(shape(layout.getSnapshot().root)).toEqual({
      horizontal: [{ tabs: ['diff', 'chat'] }, 'notes', 'files'],
    });
  });

  test('moveTo and openAt change nothing for a refused place, and say so', () => {
    const layout = store();
    const before = layout.getSnapshot().root;
    expect(moveTo(layout, 'chat', { beside: 'notes', edge: 'right' })).toBe(
      false
    );
    expect(openAt(layout, pane('x'), { beside: 'row', edge: 'left' })).toBe(
      false
    );
    expect(layout.getSnapshot().root).toBe(before);
    expect(openAt(layout, pane('x'), { into: 'notes' })).toBe(true);
    expect(moveTo(layout, 'chat', { into: 'files', index: 0 })).toBe(true);
  });

  test('a server refuses the same places with the same rule', () => {
    const split = {
      type: 'split',
      target: 'files',
      pane: pane('x'),
      edge: 'right',
      id: 'split-x',
    } as const;
    expect(() =>
      applyLayoutOperations(tabs, [split], { canPlace: atMostThreeGroups })
    ).toThrow('place_refused');
    // Without the rule, the server takes it.
    expect(applyLayoutOperations(tabs, [split])).toBeDefined();
    // The rule reads the tree of each operation in turn: a merge first
    // leaves room for the split.
    asked.length = 0;
    const merged = applyLayoutOperations(
      tabs,
      [
        {
          type: 'moveToStack',
          pane: 'notes',
          target: 'files',
          activate: true,
          id: 'stack-x',
        },
        split,
      ],
      { canPlace: atMostThreeGroups }
    );
    expect(shape(merged)).toEqual({
      horizontal: [
        { tabs: ['files', 'notes'] },
        'x',
        { tabs: ['diff', 'chat'] },
      ],
    });
    expect(asked).toEqual([
      { source: 'notes', place: { into: 'files', index: undefined } },
      { source: 'x', place: { beside: 'files', edge: 'right' } },
    ]);
  });
});
