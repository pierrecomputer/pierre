import { describe, expect, test } from 'bun:test';

import {
  applyLayoutOperations,
  exceedsGroupLimit,
  groupOf,
  groupsOf,
  type LayoutNode,
  LayoutOperationError,
  type LayoutOperationErrorCode,
  type LayoutTreeOperation,
  parseStoredLayoutTree,
  splitAddressOf,
  splitOfTab,
  toLayoutNodeView,
} from '../src/index';

const INFO = 'info';
const DIFF = 'diff';
const TERMINAL = 'terminal';
const FILE = 'editor';
const BROWSER = 'preview';

const exampleRoot: LayoutNode = {
  type: 'stack',
  id: 'group-primary',
  active: INFO,
  children: [
    { type: 'pane', id: INFO },
    { type: 'pane', id: DIFF },
  ],
};

const apply = (
  root: LayoutNode,
  ...operations: LayoutTreeOperation[]
): LayoutNode => applyLayoutOperations(root, operations, { maxGroups: 8 });

function errorCode(run: () => unknown): LayoutOperationErrorCode | null {
  try {
    run();
  } catch (error) {
    if (error instanceof LayoutOperationError) return error.code;
    throw error;
  }
  return null;
}

describe('the model and the store', () => {
  test('run without DOM globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof HTMLElement).toBe('undefined');
  });
});

describe('a workspace example', () => {
  test('gives the read form of step 1', () => {
    expect(toLayoutNodeView(exampleRoot)).toEqual({
      type: 'group',
      tabs: [INFO, DIFF],
      active: INFO,
    });
  });

  test('adds the terminal at the end of the group, not active (step 2)', () => {
    const root = apply(exampleRoot, { op: 'open', tab: TERMINAL });
    expect(toLayoutNodeView(root)).toEqual({
      type: 'group',
      tabs: [INFO, DIFF, TERMINAL],
      active: INFO,
    });
  });

  test('moves the terminal into its own group below (step 3)', () => {
    const root = apply(
      exampleRoot,
      { op: 'open', tab: TERMINAL },
      { op: 'move', tab: TERMINAL, place: { beside: INFO, edge: 'bottom' } }
    );
    const view = toLayoutNodeView(root);
    expect(view).toEqual({
      type: 'split',
      direction: 'column',
      sizes: [expect.any(Number), expect.any(Number)],
      children: [
        { type: 'group', tabs: [INFO, DIFF], active: INFO },
        { type: 'group', tabs: [TERMINAL], active: TERMINAL },
      ],
    });
    if (view.type !== 'split') throw new Error('Expected a split');
    expect(view.sizes[0]).toBe(view.sizes[1]);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  test('shows the Diff tab for `open diff` (step 5)', () => {
    const root = apply(
      exampleRoot,
      { op: 'open', tab: TERMINAL },
      { op: 'move', tab: TERMINAL, place: { beside: INFO, edge: 'bottom' } },
      { op: 'select', tab: DIFF }
    );
    expect(groupOf(root, DIFF)).toEqual({
      type: 'group',
      tabs: [INFO, DIFF],
      active: DIFF,
    });
  });

  test('keeps a tree that parses as a stored tree after each step', () => {
    const root = apply(
      exampleRoot,
      { op: 'open', tab: TERMINAL },
      { op: 'move', tab: TERMINAL, place: { beside: INFO, edge: 'bottom' } }
    );
    const stored = JSON.parse(JSON.stringify({ version: 3, root }));
    expect(parseStoredLayoutTree(stored).root).toEqual(root);
  });
});

describe('open', () => {
  test.each([
    ['terminal', TERMINAL],
    ['file', FILE],
    ['browser', BROWSER],
  ])(
    'puts a new %s tab at the end of the first group in tree order',
    (_, tab) => {
      const twoGroups = apply(exampleRoot, {
        op: 'open',
        tab: TERMINAL,
        place: { beside: DIFF, edge: 'right' },
      });
      const root = apply(twoGroups, {
        op: 'open',
        tab: tab === TERMINAL ? 'terminal:term_second:none' : tab,
      });
      expect(groupsOf(root)[0]).toEqual({
        type: 'group',
        tabs: [
          INFO,
          DIFF,
          tab === TERMINAL ? 'terminal:term_second:none' : tab,
        ],
        active: INFO,
      });
    }
  );

  test('with select makes the new tab active', () => {
    const root = apply(exampleRoot, { op: 'open', tab: FILE, select: true });
    expect(groupOf(root, FILE)?.active).toBe(FILE);
  });

  test('into a group puts the tab at the index, not active', () => {
    const root = apply(exampleRoot, {
      op: 'open',
      tab: FILE,
      place: { into: DIFF, index: 1 },
    });
    expect(groupOf(root, FILE)).toEqual({
      type: 'group',
      tabs: [INFO, FILE, DIFF],
      active: INFO,
    });
  });

  test('into a lone tab makes a group of the two, not active', () => {
    const split = apply(exampleRoot, {
      op: 'open',
      tab: TERMINAL,
      place: { beside: INFO, edge: 'bottom' },
    });
    const root = apply(split, {
      op: 'open',
      tab: FILE,
      place: { into: TERMINAL },
    });
    expect(groupOf(root, FILE)).toEqual({
      type: 'group',
      tabs: [TERMINAL, FILE],
      active: TERMINAL,
    });
  });

  test('beside a tab puts the new tab in its own group at that edge', () => {
    const root = apply(exampleRoot, {
      op: 'open',
      tab: BROWSER,
      place: { beside: DIFF, edge: 'left' },
    });
    expect(toLayoutNodeView(root)).toMatchObject({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'group', tabs: [BROWSER], active: BROWSER },
        { type: 'group', tabs: [INFO, DIFF], active: INFO },
      ],
    });
  });

  test('of a tab that the tree holds changes nothing, or selects it', () => {
    expect(apply(exampleRoot, { op: 'open', tab: DIFF })).toEqual(exampleRoot);
    expect(
      groupOf(apply(exampleRoot, { op: 'open', tab: DIFF, select: true }), DIFF)
        ?.active
    ).toBe(DIFF);
  });

  test('into or beside an unknown tab gives tab_not_found', () => {
    expect(
      errorCode(() =>
        apply(exampleRoot, {
          op: 'open',
          tab: FILE,
          place: { into: 'missing' },
        })
      )
    ).toBe('tab_not_found');
    expect(
      errorCode(() =>
        apply(exampleRoot, {
          op: 'open',
          tab: FILE,
          place: { beside: 'missing', edge: 'top' },
        })
      )
    ).toBe('tab_not_found');
  });
});

describe('select', () => {
  test('makes the tab the active tab of its group', () => {
    const root = apply(exampleRoot, { op: 'select', tab: DIFF });
    expect(groupOf(root, DIFF)?.active).toBe(DIFF);
  });

  test('of a lone tab changes nothing', () => {
    const split = apply(exampleRoot, {
      op: 'open',
      tab: TERMINAL,
      place: { beside: INFO, edge: 'bottom' },
    });
    expect(apply(split, { op: 'select', tab: TERMINAL })).toEqual(split);
  });

  test('of an unknown tab gives tab_not_found', () => {
    expect(
      errorCode(() => apply(exampleRoot, { op: 'select', tab: 'missing' }))
    ).toBe('tab_not_found');
  });
});

describe('close', () => {
  test('removes the tab, and the next tab of its group shows', () => {
    const opened = apply(exampleRoot, {
      op: 'open',
      tab: TERMINAL,
      select: true,
    });
    const root = apply(opened, { op: 'close', tab: TERMINAL });
    expect(toLayoutNodeView(root)).toEqual({
      type: 'group',
      tabs: [INFO, DIFF],
      active: DIFF,
    });
  });

  test('of the last tab of a group of one removes the group', () => {
    const split = apply(exampleRoot, {
      op: 'open',
      tab: TERMINAL,
      place: { beside: INFO, edge: 'bottom' },
    });
    expect(
      toLayoutNodeView(apply(split, { op: 'close', tab: TERMINAL }))
    ).toEqual({ type: 'group', tabs: [INFO, DIFF], active: INFO });
  });

  test('of the last tab of the layout gives last_tab', () => {
    expect(
      errorCode(() =>
        apply({ type: 'pane', id: INFO }, { op: 'close', tab: INFO })
      )
    ).toBe('last_tab');
  });

  test('of an unknown tab gives tab_not_found', () => {
    expect(
      errorCode(() => apply(exampleRoot, { op: 'close', tab: 'missing' }))
    ).toBe('tab_not_found');
  });
});

describe('move into', () => {
  const split = apply(exampleRoot, {
    op: 'open',
    tab: TERMINAL,
    place: { beside: INFO, edge: 'bottom' },
  });

  test("puts the tab at the end of the other tab's group, not active", () => {
    const root = apply(split, {
      op: 'move',
      tab: DIFF,
      place: { into: TERMINAL },
    });
    expect(groupsOf(root)).toEqual([
      { type: 'group', tabs: [INFO], active: INFO },
      { type: 'group', tabs: [TERMINAL, DIFF], active: TERMINAL },
    ]);
  });

  test('puts a lone tab back into a group, which removes its own group', () => {
    const root = apply(split, {
      op: 'move',
      tab: TERMINAL,
      place: { into: INFO, index: 0 },
    });
    expect(toLayoutNodeView(root)).toEqual({
      type: 'group',
      tabs: [TERMINAL, INFO, DIFF],
      active: INFO,
    });
  });

  test('of a tab into its own group moves it among the tabs', () => {
    const root = apply(exampleRoot, {
      op: 'move',
      tab: DIFF,
      place: { into: DIFF, index: 0 },
    });
    expect(toLayoutNodeView(root)).toEqual({
      type: 'group',
      tabs: [DIFF, INFO],
      active: INFO,
    });
  });

  test('of a tab into its own lone group gives invalid_place', () => {
    expect(
      errorCode(() =>
        apply(split, {
          op: 'move',
          tab: TERMINAL,
          place: { into: TERMINAL },
        })
      )
    ).toBe('invalid_place');
  });
});

describe('move beside', () => {
  test('takes a tab out of its group into a new group at the edge', () => {
    const root = apply(exampleRoot, {
      op: 'move',
      tab: DIFF,
      place: { beside: INFO, edge: 'right' },
    });
    expect(toLayoutNodeView(root)).toMatchObject({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'group', tabs: [INFO], active: INFO },
        { type: 'group', tabs: [DIFF], active: DIFF },
      ],
    });
  });

  test('of a tab beside itself gives invalid_place', () => {
    expect(
      errorCode(() =>
        apply(exampleRoot, {
          op: 'move',
          tab: DIFF,
          place: { beside: DIFF, edge: 'right' },
        })
      )
    ).toBe('invalid_place');
  });
});

describe('the group limit', () => {
  test('has no group limit unless the consumer supplies one', () => {
    let root: LayoutNode = { type: 'pane', id: 'first' };
    for (let index = 0; index < 10; index += 1) {
      root = applyLayoutOperations(root, [
        {
          op: 'open',
          tab: `pane-${index}`,
          place: { beside: 'first', edge: 'right' },
        },
      ]);
    }
    expect(groupsOf(root)).toHaveLength(11);
  });
  const groupsOfOne = (count: number): LayoutNode => {
    let root: LayoutNode = { type: 'pane', id: 'tab-1' };
    for (let index = 2; index <= count; index += 1)
      root = apply(root, {
        op: 'open',
        tab: `tab-${index}`,
        place: { beside: `tab-${index - 1}`, edge: 'right' },
      });
    return root;
  };

  test('allows 8 groups and refuses a ninth with layout_limit', () => {
    const eight = groupsOfOne(8);
    expect(groupsOf(eight)).toHaveLength(8);
    expect(exceedsGroupLimit(eight, 8)).toBe(false);
    expect(
      errorCode(() =>
        apply(eight, {
          op: 'open',
          tab: 'tab-9',
          place: { beside: 'tab-8', edge: 'bottom' },
        })
      )
    ).toBe('layout_limit');
    expect(
      errorCode(() =>
        apply(eight, {
          op: 'move',
          tab: 'tab-1',
          place: { beside: 'tab-2', edge: 'bottom' },
        })
      )
    ).toBeNull();
  });

  test('lets a tab join a group when the layout is full', () => {
    const eight = groupsOfOne(8);
    const root = apply(eight, {
      op: 'open',
      tab: 'tab-9',
      place: { into: 'tab-8' },
    });
    expect(groupsOf(root)).toHaveLength(8);
  });

  test('is a check that a caller can run on any tree', () => {
    expect(exceedsGroupLimit(groupsOfOne(3), 2)).toBe(true);
    expect(exceedsGroupLimit(groupsOfOne(3), 3)).toBe(false);
  });
});

describe('a list of operations', () => {
  test('applies all or none, and leaves its input as it was', () => {
    const before = JSON.stringify(exampleRoot);
    expect(
      errorCode(() =>
        apply(
          exampleRoot,
          { op: 'open', tab: TERMINAL },
          { op: 'move', tab: TERMINAL, place: { into: 'missing' } }
        )
      )
    ).toBe('tab_not_found');
    expect(JSON.stringify(exampleRoot)).toBe(before);
  });
});

describe('resize', () => {
  const nested = (): LayoutNode =>
    apply(
      exampleRoot,
      { op: 'open', tab: TERMINAL, place: { beside: INFO, edge: 'bottom' } },
      { op: 'open', tab: FILE, place: { beside: TERMINAL, edge: 'right' } }
    );

  test("sets the sizes of the split that holds the tab's group", () => {
    const root = apply(nested(), {
      op: 'resize',
      tab: FILE,
      sizes: [{ px: 240 }, 3],
    });
    const view = toLayoutNodeView(root);
    expect(view).toMatchObject({
      type: 'split',
      direction: 'column',
      children: [
        { type: 'group', tabs: [INFO, DIFF] },
        {
          type: 'split',
          direction: 'row',
          sizes: [{ px: 240 }, 3],
        },
      ],
    });
  });

  test('with a level sets the sizes of an outer split', () => {
    const root = apply(nested(), {
      op: 'resize',
      tab: FILE,
      sizes: [2, 1],
      level: 1,
    });
    const view = toLayoutNodeView(root);
    expect(view.type === 'split' && view.sizes).toEqual([2, 1]);
    expect(splitOfTab(root, FILE, 1)?.id).toBe(
      root.type === 'split' ? root.id : undefined
    );
  });

  test('addresses each split by splitAddressOf, also a split of splits', () => {
    const twoRows = apply(nested(), {
      op: 'open',
      tab: BROWSER,
      place: { beside: DIFF, edge: 'right' },
    });
    const outer = twoRows.type === 'split' ? twoRows : null;
    expect(outer?.children.every((child) => child.type === 'split')).toBe(true);
    const address = splitAddressOf(twoRows, outer!.id)!;
    expect(address).toEqual({ tab: INFO, level: 1 });
    const resized = apply(twoRows, { op: 'resize', ...address, sizes: [1, 4] });
    expect(resized.type === 'split' && resized.sizes).toEqual([1, 4]);
  });

  test('refuses a wrong number of sizes with invalid_sizes', () => {
    expect(
      errorCode(() =>
        apply(nested(), { op: 'resize', tab: FILE, sizes: [1, 1, 1] })
      )
    ).toBe('invalid_sizes');
    expect(
      errorCode(() =>
        apply(nested(), { op: 'resize', tab: FILE, sizes: [1, 0] })
      )
    ).toBe('invalid_sizes');
  });

  test('refuses a group without a split at that level with invalid_place', () => {
    expect(
      errorCode(() =>
        apply(exampleRoot, { op: 'resize', tab: INFO, sizes: [1, 1] })
      )
    ).toBe('invalid_place');
    expect(
      errorCode(() =>
        apply(nested(), { op: 'resize', tab: FILE, sizes: [1, 1], level: 2 })
      )
    ).toBe('invalid_place');
    expect(
      errorCode(() =>
        apply(nested(), { op: 'resize', tab: 'missing', sizes: [1, 1] })
      )
    ).toBe('tab_not_found');
  });

  test('keeps the sizes through a later open into a group or beside another', () => {
    const resized = apply(nested(), {
      op: 'resize',
      tab: FILE,
      sizes: [2, 1],
      level: 1,
    });
    const into = apply(resized, { op: 'open', tab: BROWSER });
    expect(toLayoutNodeView(into)).toMatchObject({ sizes: [2, 1] });
    const beside = apply(resized, {
      op: 'open',
      tab: BROWSER,
      place: { beside: INFO, edge: 'right' },
    });
    expect(toLayoutNodeView(beside)).toMatchObject({
      sizes: [2, 1],
      children: [{ type: 'split', direction: 'row' }, {}],
    });
  });
});
