// Stacks of panes with tabs: the functions that add, move, and pin tabs, and
// the tab indexes of a tab drag.
import { findNode, replaceNode, sameNodes, stackOf } from './model';
import type { LayoutNode, PaneNode } from './types';

/** The number of pinned tabs at the start of a list of tabs: the pinned run. */
export function pinnedRun(tabs: readonly { pinned?: boolean }[]): number {
  const index = tabs.findIndex((tab) => tab.pinned !== true);
  return index === -1 ? tabs.length : index;
}

// The index of a tab among the other tabs of its stack, clamped to the pinned
// run: a pinned tab goes at or before the end of the run, another tab at or
// after it.
const runIndex = (
  others: readonly PaneNode[],
  pane: PaneNode,
  index: number
): number => {
  const run = pinnedRun(others);
  return pane.pinned === true ? Math.min(index, run) : Math.max(index, run);
};

/**
 * Move a pane of a stack to `index` among the panes of its stack: the index
 * in the order of the other panes, hidden ones included, from 0 to their
 * number, clamped to the pinned run. The pane becomes the active pane.
 */
export function moveTabTo(
  root: LayoutNode,
  id: string,
  index: number,
  activate = true
): LayoutNode {
  const stack = stackOf(root, id);
  if (stack === null) throw new Error(`Pane not in a stack: ${id}`);
  const tabs = stack.children.filter((child) => child.id !== id);
  const pane = stack.children.find((child) => child.id === id) as PaneNode;
  tabs.splice(
    runIndex(tabs, pane, clampIndex(index, tabs.length, tabs.length)),
    0,
    pane
  );
  const active = activate ? id : stack.active;
  if (sameNodes(tabs, stack.children) && stack.active === active) return root;
  return replaceNode(root, stack.id, () => ({
    ...stack,
    children: tabs,
    active,
  }));
}

/**
 * Add a pane to the stack of a target pane, at `index` among its tabs, or
 * after the target, clamped to the pinned run. A target that is not in a
 * stack gets a new stack with `stackId`, in its place. The new pane is the
 * active pane.
 */
export function addToStack(
  root: LayoutNode,
  targetId: string,
  pane: PaneNode,
  stackId: string,
  index?: number,
  activate = true
): LayoutNode {
  const target = findNode(root, targetId);
  if (target === null || target.type === 'split')
    throw new Error(`Pane not found: ${targetId}`);
  const stack = target.type === 'stack' ? target : stackOf(root, targetId);
  if (stack === null) {
    // A collapsed target gives its collapse to the new stack.
    const { collapsed, collapsedSize, ...shown } = target as PaneNode;
    const tabs: PaneNode[] = [shown];
    tabs.splice(runIndex(tabs, pane, clampIndex(index, 1, 1)), 0, pane);
    return replaceNode(root, targetId, () => ({
      type: 'stack',
      id: stackId,
      children: tabs,
      active: activate ? pane.id : shown.id,
      ...(collapsed === true ? { collapsed } : {}),
      ...(collapsedSize === undefined ? {} : { collapsedSize }),
    }));
  }
  const after =
    target.type === 'stack'
      ? stack.children.length
      : stack.children.findIndex(({ id }) => id === targetId) + 1;
  const tabs = [...stack.children];
  tabs.splice(
    runIndex(tabs, pane, clampIndex(index, after, tabs.length)),
    0,
    pane
  );
  return replaceNode(root, stack.id, () => ({
    ...stack,
    children: tabs,
    active: activate ? pane.id : stack.active,
  }));
}

/**
 * Pin a pane, or unpin it. In a stack, the pane goes to the end of the pinned
 * run: the last pinned tab, or the first tab after the pinned ones. The
 * active pane stays.
 */
export function pinPane(
  root: LayoutNode,
  id: string,
  pinned: boolean
): LayoutNode {
  const pane = findNode(root, id) as PaneNode;
  if ((pane.pinned === true) === pinned) return root;
  const { pinned: _pinned, ...rest } = pane;
  const next: PaneNode = pinned ? { ...rest, pinned: true } : rest;
  const stack = stackOf(root, id);
  if (stack === null) return replaceNode(root, id, () => next);
  const tabs = stack.children.filter((child) => child.id !== id);
  tabs.splice(pinnedRun(tabs), 0, next);
  return replaceNode(root, stack.id, () => ({ ...stack, children: tabs }));
}

/**
 * The index of a tab among `length` tabs, as a fold takes it: a whole number
 * from 0 to `length`. A command sends this index in its operation, as the
 * parser of a server refuses a negative or a fractional one, so both sides
 * fold the same tree and ask the place rule the same question.
 */
export const tabIndex = (
  index: number | undefined,
  length: number
): number | undefined =>
  index === undefined
    ? undefined
    : Number.isNaN(index)
      ? 0
      : Math.min(length, Math.max(0, Math.round(index)));

/**
 * The number of tabs that a pane goes among in the stack of a target pane:
 * the other tabs of that stack, or the target alone, outside a stack.
 */
export function tabsAround(
  root: LayoutNode,
  target: string,
  pane?: string
): number {
  const tabs = stackOf(root, target)?.children;
  return tabs === undefined ? 1 : tabs.filter(({ id }) => id !== pane).length;
}

const clampIndex = (
  index: number | undefined,
  fallback: number,
  length: number
): number => tabIndex(index, length) ?? fallback;
/**
 * The tab boundary nearest to a point in a tab list: the number of tabs whose
 * middle is before the point, from 0 (before the first tab) to the number of
 * tabs (after the last). Over the stuck pinned tabs (`sticky`), only they
 * count, as the tabs that scroll under them come after them.
 */
export function tabBoundaryAt(
  edges: readonly { left: number; right: number; sticky?: boolean }[],
  x: number
): number {
  const end = stuckEnd(edges);
  return edges.filter(
    ({ left, right, sticky }) =>
      (left + right) / 2 < x && (sticky === true || x >= end)
  ).length;
}

/** The right edge of the stuck pinned tabs of a tab list, or 0. */
export function stuckEnd(
  edges: readonly { right: number; sticky?: boolean }[]
): number {
  return Math.max(
    0,
    ...edges.filter(({ sticky }) => sticky === true).map(({ right }) => right)
  );
}

/**
 * The index for `store.moveTab` of a tab that moves to a boundary of its tab
 * list, or null when the tab stays in place. `visible` holds the IDs of the
 * tabs that the list shows, in order; `order` holds the IDs of all the panes
 * of the stack, hidden ones included. The tab goes before the visible tab at
 * the boundary, or after the last visible tab.
 */
export function tabMoveIndex(
  order: readonly string[],
  visible: readonly string[],
  id: string,
  boundary: number
): number | null {
  const at = visible.indexOf(id);
  if (at === -1 || boundary === at || boundary === at + 1) return null;
  const shown = visible.filter((other) => other !== id);
  const others = order.filter((other) => other !== id);
  const place = boundary > at ? boundary - 1 : boundary;
  return place < shown.length
    ? others.indexOf(shown[place])
    : others.indexOf(shown[shown.length - 1]) + 1;
}

export function tabInsertIndex(
  order: readonly string[],
  visible: readonly string[],
  boundary: number
): number {
  if (visible.length === 0) return order.length;
  return boundary < visible.length
    ? order.indexOf(visible[boundary])
    : order.indexOf(visible[visible.length - 1]) + 1;
}
