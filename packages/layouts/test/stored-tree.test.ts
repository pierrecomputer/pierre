import { describe, expect, test } from 'bun:test';

import {
  binaryTree,
  InvalidLayoutTreeError,
  type LayoutNode,
  LayoutStore,
  naryTree,
  parseStoredLayoutTree,
} from '../src/index';

const tree: LayoutNode = {
  type: 'split',
  id: 'column',
  direction: 'vertical',
  sizes: [2, { px: 240 }],
  children: [
    {
      type: 'stack',
      id: 'top',
      active: 'info',
      children: [
        { type: 'pane', id: 'info' },
        { type: 'pane', id: 'diff', minHeight: 80 },
      ],
    },
    { type: 'pane', id: 'terminal', collapsedSize: 38 },
  ],
};

describe('the stored tree', () => {
  test('goes from a store through JSON and back with the same tree', () => {
    const store = new LayoutStore(tree, { model: naryTree });
    store.focusPane('terminal');
    store.toggleZoom('terminal');
    const stored = store.toStoredTree();
    expect(Object.keys(stored).sort()).toEqual(['root', 'version']);
    const parsed = parseStoredLayoutTree(JSON.parse(JSON.stringify(stored)));
    expect(parsed).toEqual({ version: 3, root: tree });

    const other = new LayoutStore(
      { type: 'pane', id: 'placeholder' },
      {
        model: naryTree,
      }
    );
    other.setStoredTree(parsed);
    expect(other.getSnapshot().root).toEqual(tree);
    expect(other.getSnapshot().zoomedPane).toBeNull();
  });

  test("keeps a window's focus and zoom when they still show", () => {
    const store = new LayoutStore(tree, { model: naryTree });
    store.focusPane('terminal');
    store.toggleZoom('terminal');
    store.setStoredTree(
      parseStoredLayoutTree({
        version: 3,
        root: { ...tree, sizes: [1, 1] },
      })
    );
    expect(store.getSnapshot().focusedPane).toBe('terminal');
    expect(store.getSnapshot().zoomedPane).toBe('terminal');
  });

  test.each([
    ['a string', 'tree', 'tree: must be an object'],
    [{ version: 2, root: tree }, 'tree.version', 'must be 3'],
    [
      { version: 3, root: tree, focusedPane: 'info' },
      'tree.focusedPane',
      'is not allowed',
    ],
    [
      { version: 3, root: { type: 'pane', id: 'a', content: 'x' } },
      'tree.root.content',
      'is not allowed',
    ],
    [
      { version: 3, root: { type: 'pane', id: '' } },
      'tree.root.id',
      'must be a non-empty string',
    ],
    [
      { version: 3, root: { type: 'pane', id: 'a', maxWidth: 'wide' } },
      'tree.root.maxWidth',
      'must be a finite number',
    ],
    [
      { version: 3, root: { type: 'window', id: 'a' } },
      'tree.root.type',
      'must be',
    ],
    [
      {
        version: 3,
        root: {
          type: 'stack',
          id: 's',
          active: 'a',
          children: [{ type: 'pane', id: 'a' }],
        },
      },
      'tree.root',
      'A stack needs at least two panes',
    ],
    [
      {
        version: 3,
        root: {
          type: 'stack',
          id: 's',
          active: 'a',
          children: [
            { type: 'pane', id: 'a' },
            {
              type: 'stack',
              id: 't',
              active: 'b',
              children: [
                { type: 'pane', id: 'b' },
                { type: 'pane', id: 'c' },
              ],
            },
          ],
        },
      },
      'tree.root.children[1].type',
      'a stack holds panes only',
    ],
    [
      {
        version: 3,
        root: {
          type: 'split',
          id: 'r',
          direction: 'horizontal',
          sizes: [1, 0],
          children: [
            { type: 'pane', id: 'a' },
            { type: 'pane', id: 'b' },
          ],
        },
      },
      'tree.root.sizes[1]',
      'must be a positive weight',
    ],
    [
      {
        version: 3,
        root: {
          type: 'split',
          id: 'r',
          direction: 'horizontal',
          sizes: [1, 1],
          children: [
            { type: 'pane', id: 'a' },
            { type: 'pane', id: 'a' },
          ],
        },
      },
      'tree.root',
      'unique',
    ],
    [
      {
        version: 3,
        root: {
          type: 'split',
          id: 'r',
          direction: 'horizontal',
          sizes: [1, 1],
          children: [
            { type: 'pane', id: 'a' },
            {
              type: 'split',
              id: 'inner',
              direction: 'horizontal',
              sizes: [1, 1],
              children: [
                { type: 'pane', id: 'b' },
                { type: 'pane', id: 'c' },
              ],
            },
          ],
        },
      },
      'tree.root',
      'same direction',
    ],
  ])('rejects %j at %s', (value, path, message) => {
    let error: unknown;
    try {
      parseStoredLayoutTree(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidLayoutTreeError);
    expect((error as InvalidLayoutTreeError).path).toBe(path);
    expect((error as InvalidLayoutTreeError).message).toContain(message);
  });

  test('checks the shape of the model that the caller names', () => {
    const row = {
      version: 3,
      root: {
        type: 'split',
        id: 'r',
        direction: 'horizontal',
        sizes: [1, 1, 1],
        children: [
          { type: 'pane', id: 'a' },
          { type: 'pane', id: 'b' },
          { type: 'pane', id: 'c' },
        ],
      },
    };
    expect(parseStoredLayoutTree(row).root.type).toBe('split');
    expect(() => parseStoredLayoutTree(row, binaryTree)).toThrow(
      InvalidLayoutTreeError
    );
  });
});
