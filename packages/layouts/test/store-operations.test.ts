import { describe, expect, test } from 'bun:test';

import {
  applyLayoutOperations,
  applyOperations,
} from '../src/apply-operations';
import { edits } from '../src/edits';
import { hiddenPanes } from '../src/hidden-panes';
import {
  isTreeOperation,
  type LayoutChange,
  type LayoutOperation,
  type LayoutTreeOperation,
} from '../src/layout-operation';
import { canClose, getPanes } from '../src/model';
import { naryTree } from '../src/models/n-ary';
import { persistence } from '../src/persistence';
import type { ViewContext } from '../src/react/contract';
import { canClose as viewCanClose } from '../src/react/parts/close';
import { startResizeGesture } from '../src/resize-gesture';
import { stacks } from '../src/stacks';
import { type CoreLayoutStore, createLayoutStore } from '../src/store';
import {
  parseLayoutOperations,
  parseStoredLayoutTree,
} from '../src/stored-tree';
import type { LayoutNode, LayoutState, PaneNode } from '../src/types';
import { zoom } from '../src/zoom';
import { testStore } from './helpers/store';

const pane = (id: string): PaneNode => ({ type: 'pane', id });

// A row of a pane, a stack of two tabs, and a pane.
const start: LayoutNode = {
  type: 'split',
  id: 'row',
  direction: 'horizontal',
  sizes: [1, 1, 1],
  children: [
    pane('a'),
    {
      type: 'stack',
      id: 'tabs',
      active: 'c',
      children: [pane('c'), pane('d')],
    },
    pane('b'),
  ],
};

// A column with a pane in pixels, for the collapse.
const column: LayoutNode = {
  type: 'split',
  id: 'column',
  direction: 'vertical',
  sizes: [1, { px: 200 }],
  children: [pane('top'), { ...pane('bottom'), collapsedSize: 30 }],
};

const features = [
  edits(naryTree),
  stacks(),
  zoom(),
  hiddenPanes(),
  persistence(),
];

function storeOf(root: LayoutNode = start) {
  return createLayoutStore(root, features);
}

function record(store: CoreLayoutStore): LayoutChange[] {
  const changes: LayoutChange[] = [];
  store.subscribe((change) => changes.push(change));
  return changes;
}

type Store = ReturnType<typeof storeOf>;

// Each command, the operations that a listener gets, and the tree it starts from.
const COMMANDS: readonly [
  string,
  (store: Store) => void,
  readonly LayoutOperation[],
  LayoutNode?,
][] = [
  [
    'setRoot',
    (store) => store.setRoot({ ...start, sizes: [1, 2, 1] }),
    [{ type: 'setRoot', root: { ...start, sizes: [1, 2, 1] } }],
  ],
  [
    'setSizes',
    (store) => store.setSizes({ row: [2, 1, 1] }),
    [{ type: 'resize', sizes: { row: [2, 1, 1] } }],
  ],
  [
    'setCollapsed',
    (store) => store.setCollapsed('bottom', true),
    [{ type: 'collapse', pane: 'bottom', collapsed: true }],
    column,
  ],
  [
    'focusPane',
    (store) => store.focusPane('b'),
    [{ type: 'focus', pane: 'b' }],
  ],
  [
    'split',
    (store) => store.split('a', pane('e'), 'bottom'),
    [
      {
        type: 'split',
        target: 'a',
        pane: pane('e'),
        edge: 'bottom',
        id: expect.stringMatching(/^split-/) as unknown as string,
      },
    ],
  ],
  ['close', (store) => store.close('b'), [{ type: 'close', pane: 'b' }]],
  [
    'move',
    (store) => store.move('b', 'a', 'top'),
    [
      {
        type: 'move',
        pane: 'b',
        target: 'a',
        edge: 'top',
        id: expect.stringMatching(/^split-/) as unknown as string,
      },
    ],
  ],
  [
    'swap',
    (store) => store.swap('a', 'b'),
    [{ type: 'swap', panes: ['a', 'b'] }],
  ],
  [
    'activate',
    (store) => store.activate('d'),
    [{ type: 'activate', pane: 'd' }],
  ],
  [
    'activate on a lone pane',
    (store) => store.activate('b'),
    [{ type: 'focus', pane: 'b' }],
  ],
  [
    'addTab',
    (store) => store.addTab('a', pane('e')),
    [
      {
        type: 'addTab',
        target: 'a',
        pane: pane('e'),
        activate: true,
        id: expect.stringMatching(/^stack-/) as unknown as string,
      },
    ],
  ],
  [
    'moveToStack',
    (store) => store.moveToStack('b', 'c', 1, { activate: false }),
    [
      {
        type: 'moveToStack',
        pane: 'b',
        target: 'c',
        index: 1,
        activate: false,
        id: expect.stringMatching(/^stack-/) as unknown as string,
      },
    ],
  ],
  [
    'moveTab',
    (store) => store.moveTab('c', 1),
    [{ type: 'moveTab', pane: 'c', index: 1 }],
  ],
  [
    'addTab at a negative index',
    (store) => store.addTab('c', pane('e'), -1),
    [
      {
        type: 'addTab',
        target: 'c',
        pane: pane('e'),
        index: 0,
        activate: true,
        id: expect.stringMatching(/^stack-/) as unknown as string,
      },
    ],
  ],
  [
    'moveToStack at an index past the tabs',
    (store) => store.moveToStack('b', 'c', 9),
    [
      {
        type: 'moveToStack',
        pane: 'b',
        target: 'c',
        index: 2,
        activate: true,
        id: expect.stringMatching(/^stack-/) as unknown as string,
      },
    ],
  ],
  [
    'moveTab at a fractional index',
    (store) => store.moveTab('c', 0.6),
    [{ type: 'moveTab', pane: 'c', index: 1 }],
  ],
  [
    'setHidden',
    (store) => store.setHidden('b', true),
    [{ type: 'hide', pane: 'b', hidden: true }],
  ],
  [
    'setPinned',
    (store) => store.setPinned('d', true),
    [{ type: 'setPinned', pane: 'd', pinned: true }],
  ],
  [
    'toggleZoom of a tab that does not show',
    (store) => store.toggleZoom('d'),
    [
      { type: 'activate', pane: 'd' },
      { type: 'zoom', pane: 'd' },
    ],
  ],
  [
    'setZoom',
    (store) => store.setZoom('b'),
    [
      { type: 'focus', pane: 'b' },
      { type: 'zoom', pane: 'b' },
    ],
  ],
  [
    'setStoredTree',
    (store) => store.setStoredTree({ version: 3, root: column }),
    [{ type: 'setRoot', root: column }],
  ],
];

describe('the operations of each command', () => {
  test.each(COMMANDS)(
    '%s gives its operations to listeners, and the server folds them to the same tree',
    (_name, run, operations, root = start) => {
      const store = storeOf(root);
      const before = store.getSnapshot().root;
      const changes = record(store);
      run(store);
      expect(changes).toEqual([{ operations, origin: 'local' }]);
      const tree = changes[0].operations.filter(isTreeOperation);
      // The operations go over the wire as JSON, and the server checks them.
      const sent = parseLayoutOperations(JSON.parse(JSON.stringify(tree)));
      expect(sent).toEqual(tree);
      expect(applyLayoutOperations(before, sent)).toEqual(
        store.getSnapshot().root
      );
    }
  );

  test('the server gives the new split and the new stack the IDs of the client', () => {
    const store = storeOf();
    const before = store.getSnapshot().root;
    const changes = record(store);
    store.split('a', pane('e'), 'bottom');
    store.addTab('b', pane('f'));
    const operations = changes.flatMap((change) => change.operations);
    const ids = (root: LayoutNode): string[] =>
      root.type === 'pane' ? [] : [root.id, ...root.children.flatMap(ids)];
    const after = applyLayoutOperations(
      before,
      operations.filter(isTreeOperation)
    );
    expect(ids(after)).toEqual(ids(store.getSnapshot().root));
    expect(ids(after).filter((id) => /^(split|stack)-/.test(id))).toHaveLength(
      2
    );
  });

  test('a command that changes nothing notifies no listener', () => {
    const store = storeOf();
    store.activate('c');
    const changes = record(store);
    store.setSizes({ row: [1, 1, 1] });
    store.activate('c');
    store.focusPane('c');
    store.setZoom(null);
    store.moveTab('c', 0);
    expect(changes).toEqual([]);
  });

  test('a refused operation throws its code, and the tree stays as it was', () => {
    const store = storeOf();
    const before = store.getSnapshot();
    expect(() => store.close('nothing')).toThrow(
      expect.objectContaining({ code: 'pane_not_found' })
    );
    // A server checks the sizes of an operation from elsewhere.
    expect(() =>
      applyOperations(store, [{ type: 'resize', sizes: { nothing: [1, 1] } }])
    ).toThrow(expect.objectContaining({ code: 'node_not_found' }));
    expect(() =>
      applyLayoutOperations(start, [{ type: 'resize', sizes: { row: [1, 1] } }])
    ).toThrow(expect.objectContaining({ code: 'invalid_sizes' }));
    expect(() => store.split('a', pane('b'))).toThrow(
      expect.objectContaining({ code: 'id_in_use' })
    );
    expect(() =>
      applyLayoutOperations(start, [
        {
          type: 'split',
          target: 'a',
          pane: pane('e'),
          edge: 'left',
          id: 'tabs',
        },
      ])
    ).toThrow(expect.objectContaining({ code: 'id_in_use' }));
    expect(() =>
      applyLayoutOperations(start, [{ type: 'close', pane: 'a' }], {
        features: [],
      })
    ).toThrow(expect.objectContaining({ code: 'unknown_operation' }));
    // A batch with a refused operation leaves the store as it was.
    expect(() =>
      applyOperations(store, [
        { type: 'close', pane: 'a' },
        { type: 'close', pane: 'nothing' },
      ])
    ).toThrow(expect.objectContaining({ code: 'pane_not_found' }));
    expect(store.getSnapshot()).toBe(before);
  });
});

describe('remote operations', () => {
  test('a remote change gives the store the operations in one change, and keeps the focus', () => {
    const store = storeOf();
    const changes = record(store);
    const operations: LayoutTreeOperation[] = [
      { type: 'split', target: 'b', pane: pane('e'), edge: 'right' },
      { type: 'close', pane: 'a' },
    ];
    store.focusPane('b');
    changes.length = 0;
    applyOperations(store, operations);
    expect(changes).toEqual([{ operations, origin: 'remote' }]);
    expect(getPanes(store.getSnapshot().root).map(({ id }) => id)).toEqual([
      'c',
      'd',
      'b',
      'e',
    ]);
    expect(store.getSnapshot().focusedPane).toBe('b');
  });

  test('a remote change during a gesture starts from the settled state', () => {
    const store = storeOf();
    store.transient(() => store.setSizes({ row: [3, 1, 1] }));
    applyOperations(store, [{ type: 'close', pane: 'b' }]);
    // The neighbour takes the space of the pane that closes; the sizes of
    // the gesture are gone.
    const root = store.getSnapshot().root;
    expect(root.type === 'split' && root.sizes).toEqual([1, 2]);
  });
});

describe('the zoom rule of local and remote changes', () => {
  for (const [name, create] of [
    ['a store of the core features', () => storeOf()],
    ['a store of every feature', () => testStore(start)],
  ] as const) {
    test(`${name}: a local structural edit ends the zoom`, () => {
      const store = create();
      store.toggleZoom('a');
      store.split('b', pane('e'));
      expect(store.getSnapshot().zoomedPane).toBeNull();
    });

    test(`${name}: a remote structural edit keeps the zoom while the zoomed pane shows`, () => {
      const store = create();
      store.toggleZoom('a');
      applyOperations(store, [
        { type: 'split', target: 'b', pane: pane('e'), edge: 'right' },
        { type: 'move', pane: 'b', target: 'c', edge: 'top' },
      ]);
      expect(store.getSnapshot().zoomedPane).toBe('a');
      // A zoomed stack follows the tab that shows.
      store.toggleZoom('c');
      applyOperations(store, [{ type: 'activate', pane: 'd' }]);
      expect(store.getSnapshot().zoomedPane).toBe('d');
      // The zoom ends when the zoomed pane stops showing.
      applyOperations(store, [{ type: 'close', pane: 'd' }]);
      applyOperations(store, [{ type: 'close', pane: 'c' }]);
      expect(store.getSnapshot().zoomedPane).toBeNull();
    });
  }
});

describe('transient changes and gestures', () => {
  test('a resize drag of 16 pointer moves gives one resize operation', () => {
    const store = storeOf();
    const changes = record(store);
    const gesture = startResizeGesture(store, ['row']);
    for (let step = 1; step <= 16; step += 1)
      gesture.move({ row: [1 + step / 16, 1, 1] });
    gesture.end(false);
    const operations = changes.flatMap((change) => change.operations);
    expect(operations).toEqual([{ type: 'resize', sizes: { row: [2, 1, 1] } }]);
    // Each frame reached the listeners as a transient change.
    expect(
      changes.filter((change) => change.operations.length === 0)
    ).toHaveLength(17);
  });

  test('a cancelled drag gives no operation, and the state from before it', () => {
    const store = storeOf();
    const before = store.getSnapshot();
    const changes = record(store);
    const gesture = startResizeGesture(store, ['row']);
    gesture.move({ row: [2, 1, 1] });
    gesture.end(true);
    expect(changes.flatMap((change) => change.operations)).toEqual([]);
    expect(store.getSnapshot()).toBe(before);
  });

  test('a drag that ends where it started gives no operation', () => {
    const store = storeOf();
    const changes = record(store);
    const gesture = startResizeGesture(store, ['row']);
    gesture.move({ row: [2, 1, 1] });
    gesture.move({ row: [1, 1, 1] });
    gesture.end(false);
    expect(changes.flatMap((change) => change.operations)).toEqual([]);
  });
});

describe('one close rule', () => {
  // Pane `a` is the only visible pane, beside hidden pane `b`.
  const lastVisible: LayoutNode = {
    type: 'split',
    id: 'row',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [pane('a'), { ...pane('b'), hidden: true }],
  };

  test('the store, the view, and the server refuse the close of the only visible pane beside a hidden pane', () => {
    expect(canClose(lastVisible, 'a')).toBe(false);
    expect(canClose(lastVisible, 'b')).toBe(true);
    const store = storeOf(lastVisible);
    expect(() => store.close('a')).toThrow(
      expect.objectContaining({ code: 'last_pane' })
    );
    expect(() =>
      applyLayoutOperations(lastVisible, [{ type: 'close', pane: 'a' }])
    ).toThrow(expect.objectContaining({ code: 'last_pane' }));
    const view = {
      store,
      onPaneClose: () => undefined,
    } as unknown as ViewContext;
    expect(viewCanClose(view, store.getSnapshot(), 'a')).toBe(false);
    expect(viewCanClose(view, store.getSnapshot(), 'b')).toBe(true);
    // The close of the hidden pane is allowed everywhere.
    store.close('b');
    expect(
      applyLayoutOperations(lastVisible, [{ type: 'close', pane: 'b' }])
    ).toEqual(store.getSnapshot().root);
  });
});

describe('undo from the changes', () => {
  test('a snapshot undo listener needs only the origin, the transient mark, and one change for each user action', () => {
    const store = storeOf();
    const history: LayoutState[] = [];
    let settled = store.getSnapshot();
    let undoing = false;
    store.subscribe(({ operations, origin }) => {
      // A frame of a gesture is not a step, and a remote change is not ours.
      if (operations.length === 0 || undoing) return;
      if (origin === 'local') history.push(settled);
      settled = store.getSnapshot();
    });
    const undo = (): void => {
      const before = history.pop();
      if (before === undefined) return;
      undoing = true;
      store.setRoot(before.root);
      undoing = false;
      settled = store.getSnapshot();
    };
    const trees = [store.getSnapshot().root];
    store.split('a', pane('e'));
    trees.push(store.getSnapshot().root);
    const gesture = startResizeGesture(store, ['row']);
    for (let step = 1; step <= 4; step += 1)
      gesture.move({ row: [1 + step, 1, 1, 1] });
    gesture.end(false);
    trees.push(store.getSnapshot().root);
    store.close('b');
    expect(history).toHaveLength(3);
    undo();
    expect(store.getSnapshot().root).toEqual(trees[2]);
    undo();
    expect(store.getSnapshot().root).toEqual(trees[1]);
    undo();
    expect(store.getSnapshot().root).toEqual(trees[0]);
  });
});

describe('parseLayoutOperations', () => {
  test('it names the path of a field that does not have a valid form', () => {
    const cases: [unknown, string][] = [
      [{}, 'operations'],
      [[{ type: 'nothing' }], 'operations[0].type'],
      [[{ type: 'close', pane: 'a', extra: 1 }], 'operations[0].extra'],
      [
        [{ type: 'split', target: 'a', pane: pane('b'), edge: 'up' }],
        'operations[0].edge',
      ],
      [
        [{ type: 'addTab', target: 'a', pane: pane('b') }],
        'operations[0].activate',
      ],
      [[{ type: 'moveTab', pane: 'a', index: -1 }], 'operations[0].index'],
      [
        [{ type: 'resize', sizes: { row: [1, 0] } }],
        'operations[0].sizes.row[1]',
      ],
      [[{ type: 'swap', panes: ['a'] }], 'operations[0].panes'],
      [[{ type: 'focus', pane: 'a' }], 'operations[0].type'],
    ];
    for (const [value, path] of cases)
      expect(() => parseLayoutOperations(value)).toThrow(
        expect.objectContaining({ path })
      );
  });
});

describe('a tree that equals the current tree', () => {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  test('is no change from a remote setRoot or a saved form', () => {
    const store = storeOf();
    store.setSizes({ row: [2, 1, 1] });
    const before = store.getSnapshot();
    const changes = record(store);
    applyOperations(store, [{ type: 'setRoot', root: copy(before.root) }]);
    store.setStoredTree(copy(store.toStoredTree()));
    expect(changes).toEqual([]);
    expect(store.getSnapshot()).toBe(before);
  });

  test('keeps the node of each pane that does not change', () => {
    const store = storeOf();
    const before = store.getSnapshot().root;
    const next = copy(before);
    if (next.type !== 'split') throw new Error('Expected a split');
    applyOperations(store, [
      {
        type: 'setRoot',
        root: {
          ...next,
          sizes: [3, 1, 1],
          children: next.children.map((child) =>
            child.id === 'a' ? { ...child, minWidth: 40 } : child
          ),
        },
      },
    ]);
    const after = store.getSnapshot().root;
    expect(after).not.toBe(before);
    if (after.type !== 'split' || before.type !== 'split')
      throw new Error('Expected a split');
    expect(
      after.children.map((child, index) => child === before.children[index])
    ).toEqual(after.children.map((child) => child.id !== 'a'));
  });
});

describe('the boundary where an app sends operations', () => {
  // Fold the tree operations of the changes on a server, from the JSON that a
  // client sends.
  const replay = (root: LayoutNode, changes: readonly LayoutChange[]) =>
    applyLayoutOperations(
      root,
      parseLayoutOperations(
        JSON.parse(
          JSON.stringify(
            changes.flatMap((change) =>
              change.operations.filter(isTreeOperation)
            )
          )
        )
      )
    );

  test('every listener gets the changes in commit order, also a change that a listener makes, and they replay to the same tree', () => {
    const store = storeOf();
    const before = store.getSnapshot().root;
    // The first listener pins each new tab; the second one sends the changes.
    store.subscribe(({ operations }) => {
      for (const operation of operations)
        if (operation.type === 'addTab')
          store.setPinned(operation.pane.id, true);
    });
    const sent = record(store);
    store.addTab('c', pane('e'));
    expect(
      sent.map(({ operations }) => operations.map(({ type }) => type))
    ).toEqual([['addTab'], ['setPinned']]);
    expect(replay(before, sent)).toEqual(store.getSnapshot().root);
  });

  test('a listener that throws does not stop the delivery to the others', () => {
    const store = storeOf();
    store.subscribe(() => {
      throw new Error('listener');
    });
    const changes = record(store);
    expect(() => store.activate('d')).toThrow('listener');
    expect(changes).toHaveLength(1);
    // The delivery ended: the next change reaches the listeners too.
    expect(() => store.activate('c')).toThrow('listener');
    expect(changes).toHaveLength(2);
  });

  test('setSizes with a split that the tree does not hold, or a wrong number of sizes, throws as a server does and changes nothing', () => {
    const store = storeOf();
    const before = store.getSnapshot();
    const changes = record(store);
    expect(() => store.setSizes({ gone: [1, 1], row: [2, 3, 1] })).toThrow(
      expect.objectContaining({ code: 'node_not_found' })
    );
    expect(() => store.setSizes({ row: [2, 3] })).toThrow(
      expect.objectContaining({ code: 'invalid_sizes' })
    );
    expect(changes).toEqual([]);
    expect(store.getSnapshot()).toBe(before);
  });

  test('the place rule gets the tree, the same on the client and on the server', () => {
    const seen: LayoutNode[] = [];
    const canPlace = (_source: PaneNode, _place: unknown, root: LayoutNode) => {
      seen.push(root);
      return true;
    };
    const store = createLayoutStore(start, features, { canPlace });
    const before = store.getSnapshot().root;
    store.focusPane('b');
    const changes = record(store);
    store.addTab('c', pane('e'));
    expect(seen).toEqual([before]);
    applyLayoutOperations(
      before,
      changes[0].operations.filter(isTreeOperation),
      { canPlace }
    );
    expect(seen).toEqual([before, before]);
  });

  test('a size record that the caller changes after it passed it in changes no state, and the operation keeps its values', () => {
    const fixed = { px: 22 };
    const store = createLayoutStore(
      {
        type: 'split',
        id: 'row',
        direction: 'horizontal',
        sizes: [fixed, 1],
        children: [pane('a'), pane('b')],
      },
      features
    );
    const changes = record(store);
    fixed.px = 500;
    const sizesOf = () => {
      const root = store.getSnapshot().root;
      return root.type === 'split' ? root.sizes : null;
    };
    expect(sizesOf()).toEqual([{ px: 22 }, 1]);
    const next = { px: 30 };
    const values = [next, 1];
    store.setSizes({ row: values });
    next.px = 600;
    values[1] = 9;
    expect(sizesOf()).toEqual([{ px: 30 }, 1]);
    expect(changes).toHaveLength(1);
    expect(changes[0].operations).toEqual([
      { type: 'resize', sizes: { row: [{ px: 30 }, 1] } },
    ]);
  });

  describe('the pinned tabs of a stack from elsewhere come first, in their order', () => {
    // A save with a stack that mixes pinned tabs with the others.
    const mixed: LayoutNode = {
      type: 'stack',
      id: 'tabs',
      active: 'c',
      children: [
        pane('a'),
        { ...pane('b'), pinned: true },
        pane('c'),
        { ...pane('d'), pinned: true },
      ],
    };
    const order = (root: LayoutNode): string[] =>
      root.type === 'stack' ? root.children.map(({ id }) => id) : [];
    const sorted = ['b', 'd', 'a', 'c'];

    test('at parse', () => {
      expect(
        order(parseStoredLayoutTree({ version: 3, root: mixed }).root)
      ).toEqual(sorted);
    });

    test('at initialization, at setRoot, and from a remote setRoot', () => {
      const store = storeOf(mixed);
      expect(order(store.getSnapshot().root)).toEqual(sorted);
      store.setRoot(start);
      store.setRoot(mixed);
      expect(order(store.getSnapshot().root)).toEqual(sorted);
      store.setRoot(start);
      applyOperations(store, [{ type: 'setRoot', root: mixed }]);
      expect(order(store.getSnapshot().root)).toEqual(sorted);
    });

    test('on a server', () => {
      expect(
        order(applyLayoutOperations(start, [{ type: 'setRoot', root: mixed }]))
      ).toEqual(sorted);
    });
  });
});
