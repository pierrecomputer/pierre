import { describe, expect, test } from 'bun:test';

import {
  applyLayoutOperations,
  defaultLayoutTree,
  groupsOf,
  type LayoutNode,
  reconcileLayoutTree,
  toLayoutNodeView,
} from '../src/index';
import { validateLayout } from '../src/model';

test('default group IDs do not collide with tab IDs', () => {
  const root = defaultLayoutTree(['group-primary', 'group-primary:1']);
  if (root === null) throw new Error('Expected a group');
  expect(() => validateLayout(root)).not.toThrow();
});

const split = (): LayoutNode =>
  applyLayoutOperations(defaultLayoutTree(['info', 'diff', 'terminal'])!, [
    {
      op: 'move',
      tab: 'terminal',
      place: { beside: 'info', edge: 'bottom' },
    },
  ]);

describe('defaultLayoutTree', () => {
  test('is null without tabs, a lone tab for one, and one group for more', () => {
    expect(defaultLayoutTree([])).toBeNull();
    expect(toLayoutNodeView(defaultLayoutTree(['info'])!)).toEqual({
      type: 'group',
      tabs: ['info'],
      active: 'info',
    });
    expect(toLayoutNodeView(defaultLayoutTree(['info', 'diff'])!)).toEqual({
      type: 'group',
      tabs: ['info', 'diff'],
      active: 'info',
    });
  });
});

describe('reconcileLayoutTree', () => {
  test('builds the default tree when there is none', () => {
    expect(reconcileLayoutTree(null, ['a', 'b'])).toEqual(
      defaultLayoutTree(['a', 'b'])
    );
  });

  test('returns the same tree when the tabs agree', () => {
    const root = split();
    expect(reconcileLayoutTree(root, ['terminal', 'diff', 'info'])).toBe(root);
  });

  test('adds new tabs at the end of the first group, not active', () => {
    const root = reconcileLayoutTree(split(), [
      'info',
      'diff',
      'terminal',
      'file',
      'browser',
    ])!;
    expect(groupsOf(root)).toEqual([
      {
        type: 'group',
        tabs: ['info', 'diff', 'file', 'browser'],
        active: 'info',
      },
      { type: 'group', tabs: ['terminal'], active: 'terminal' },
    ]);
  });

  test('removes closed tabs, and a group that loses its last tab', () => {
    const root = reconcileLayoutTree(split(), ['info'])!;
    expect(toLayoutNodeView(root)).toEqual({
      type: 'group',
      tabs: ['info'],
      active: 'info',
    });
  });

  test('adds and removes in one pass', () => {
    const root = reconcileLayoutTree(split(), ['terminal', 'file'])!;
    expect(groupsOf(root)).toEqual([
      { type: 'group', tabs: ['terminal', 'file'], active: 'terminal' },
    ]);
  });

  test('starts again from the default tree when no tab stays', () => {
    expect(reconcileLayoutTree(split(), ['x', 'y'])).toEqual(
      defaultLayoutTree(['x', 'y'])
    );
    expect(reconcileLayoutTree(split(), [])).toBeNull();
  });
});
