// Stacks of panes with tabs: the functions that add and move tabs, and the tab
// indexes of a tab drag.
import { findNode, replaceNode, sameNodes, stackOf } from './model';
import type { LayoutNode, PaneNode } from './types';

/**
 * Move a pane of a stack to `index` among the panes of its stack: the index
 * in the order of the other panes, hidden ones included, from 0 to their
 * number. The pane becomes the active pane.
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
  tabs.splice(clampIndex(index, tabs.length, tabs.length), 0, pane);
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
 * after the target. A target that is not in a stack gets a new stack with
 * `stackId`, in its place. The new pane is the active pane.
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
    tabs.splice(clampIndex(index, 1, 1), 0, pane);
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
  tabs.splice(clampIndex(index, after, tabs.length), 0, pane);
  return replaceNode(root, stack.id, () => ({
    ...stack,
    children: tabs,
    active: activate ? pane.id : stack.active,
  }));
}

const clampIndex = (
  index: number | undefined,
  fallback: number,
  length: number
): number =>
  index === undefined
    ? fallback
    : Math.min(length, Math.max(0, Math.round(index)));
/**
 * The tab boundary nearest to a point in a tab list: the number of tabs whose
 * middle is before the point, from 0 (before the first tab) to the number of
 * tabs (after the last).
 */
export function tabBoundaryAt(
  edges: readonly { left: number; right: number }[],
  x: number
): number {
  return edges.filter(({ left, right }) => (left + right) / 2 < x).length;
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
