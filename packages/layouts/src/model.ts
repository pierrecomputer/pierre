// The core of the layout tree: validation, queries, and the changes that every
// layout needs (sizes, collapse, hidden panes, the active pane of a stack).
// Feature modules import from this module. This module imports no feature.
import { LayoutOperationError } from './layout-operation';
import type { Fold } from './store';
import type {
  ChildSize,
  LayoutNode,
  PaneNode,
  SplitNode,
  StackNode,
} from './types';
import { hasVisiblePane, validateLayout } from './validate';

/** True for a child size in pixels, false for a weight. */
export const isFixed = (size: ChildSize): size is { readonly px: number } =>
  typeof size === 'object';

/**
 * The size along its split of a collapsed pane or stack, or null for a node
 * that is not collapsed.
 */
export function collapsedSizeOf(node: LayoutNode): number | null {
  return node.type !== 'split' && node.collapsed === true
    ? (node.collapsedSize ?? 0)
    : null;
}

/** Collapse a pane or a stack, or expand it, in place. */
export function setNodeCollapsed(
  root: LayoutNode,
  id: string,
  collapsed: boolean
): LayoutNode {
  const next = replaceNode(root, id, (node) => {
    if (node.type === 'split') throw new Error(`Pane not found: ${id}`);
    if ((node.collapsed === true) === collapsed) return node;
    if (collapsed) return { ...node, collapsed: true };
    const { collapsed: _collapsed, ...expanded } = node;
    return expanded;
  });
  validateLayout(next);
  return next;
}

export function getPanes(root: LayoutNode): PaneNode[] {
  return root.type === 'pane' ? [root] : root.children.flatMap(getPanes);
}

/** A pane of a tree, or `LayoutOperationError('pane_not_found')`. */
export function paneIn(root: LayoutNode, id: string): PaneNode {
  const pane = getPanes(root).find((each) => each.id === id);
  if (pane === undefined) throw new LayoutOperationError('pane_not_found', id);
  return pane;
}

/**
 * True when a pane can close or hide: the tree holds another pane that is
 * not hidden, so a pane still shows after it. The store, the views, and the
 * server use this one rule; a close or a hide that breaks it throws
 * `last_pane`.
 */
export function canClose(root: LayoutNode, id: string): boolean {
  return getPanes(root).some((pane) => pane.id !== id && pane.hidden !== true);
}

/** Throw `id_in_use` when a tree holds a node with the ID of a new pane. */
export function requireNewPane(root: LayoutNode, pane: PaneNode): void {
  if (findNode(root, pane.id) !== null)
    throw new LayoutOperationError('id_in_use', pane.id);
}

/**
 * The fold of `activate`: the pane shows in its stack. A pane outside a
 * stack shows already. `stacks` and `zoom` fold it.
 */
export const foldActivate: Fold<{ type: 'activate'; pane: string }> = (
  root,
  { pane }
) => {
  paneIn(root, pane);
  return stackOf(root, pane) === null ? root : activatePane(root, pane);
};

/**
 * The panes that show: hidden panes and the panes of a stack that are not
 * active are left out.
 */
export function shownPanes(node: LayoutNode): PaneNode[] {
  if (node.type === 'pane') return node.hidden === true ? [] : [node];
  if (node.type === 'stack') {
    const shown = shownPane(node);
    return shown === null ? [] : [shown];
  }
  return node.children.flatMap(shownPanes);
}

/**
 * The pane of a stack that shows: the active pane, or, when a caller hid it,
 * the first visible pane. Null when every pane of the stack is hidden.
 */
export function shownPane(stack: StackNode): PaneNode | null {
  const active = stack.children.find(({ id }) => id === stack.active);
  if (active !== undefined && active.hidden !== true) return active;
  return stack.children.find(({ hidden }) => hidden !== true) ?? null;
}

/** A node of the tree by its ID, or null. */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return root;
  if (root.type === 'pane') return null;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found !== null) return found;
  }
  return null;
}

/** The stack that holds a pane, or null when the pane is not in a stack. */
export function stackOf(root: LayoutNode, id: string): StackNode | null {
  if (root.type === 'pane') return null;
  if (root.type === 'stack')
    return root.children.some((child) => child.id === id) ? root : null;
  for (const child of root.children) {
    const stack = stackOf(child, id);
    if (stack !== null) return stack;
  }
  return null;
}

/**
 * The node that takes the place of a pane in its split: its stack, or the
 * pane itself. A split or a move beside a pane in a stack goes beside the
 * whole stack.
 */
export function slotOf(root: LayoutNode, id: string): string {
  return stackOf(root, id)?.id ?? id;
}

/**
 * The tree that takes space: hidden panes are left out, and a split with one
 * visible child gives way to that child. A subtree with no hidden pane keeps
 * its identity. Null when no pane is visible.
 */
export function visibleTree(node: LayoutNode): LayoutNode | null {
  if (node.type === 'pane') return node.hidden === true ? null : node;
  if (node.type === 'stack') return hasVisiblePane(node) ? node : null;
  const children: LayoutNode[] = [];
  const sizes: ChildSize[] = [];
  node.children.forEach((child, index) => {
    const visible = visibleTree(child);
    if (visible === null) return;
    children.push(visible);
    sizes.push(node.sizes[index]);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return sameNodes(children, node.children)
    ? node
    : { ...node, children, sizes };
}

/** Hide a pane or show it again, in its place. */
export function setPaneHidden(
  root: LayoutNode,
  id: string,
  hidden: boolean
): LayoutNode {
  let next = replaceNode(root, id, (node) => {
    if (node.type !== 'pane') throw new Error(`Pane not found: ${id}`);
    if ((node.hidden === true) === hidden) return node;
    if (hidden) return { ...node, hidden: true };
    const { hidden: _hidden, ...shown } = node;
    return shown;
  });
  // A stack whose active pane hides shows its nearest visible pane.
  const stack = stackOf(next, id);
  if (hidden && stack !== null && stack.active === id) {
    const heir = nearestVisible(stack.children, id);
    if (heir !== null)
      next = replaceNode(next, stack.id, () => ({ ...stack, active: heir }));
  }
  validateLayout(next);
  return next;
}

/**
 * The visible pane nearest to a pane in a list of tabs: the next one, or the
 * one before it. Null when no other pane is visible.
 */
export function nearestVisible(
  panes: readonly PaneNode[],
  id: string
): string | null {
  const at = panes.findIndex((pane) => pane.id === id);
  const after = panes.slice(at + 1).find(({ hidden }) => hidden !== true);
  const before = panes
    .slice(0, Math.max(0, at))
    .reverse()
    .find(({ hidden }) => hidden !== true);
  return (after ?? before)?.id ?? null;
}

/** Show a pane of a stack. */
export function activatePane(root: LayoutNode, id: string): LayoutNode {
  const stack = stackOf(root, id);
  if (stack === null) throw new Error(`Pane not in a stack: ${id}`);
  if (stack.active === id) return root;
  return replaceNode(root, stack.id, () => ({ ...stack, active: id }));
}

/** True when two lists hold the same nodes in the same order. */
export function sameNodes(
  a: readonly LayoutNode[],
  b: readonly LayoutNode[]
): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/** Replace a node immutably, preserving the identity of unaffected branches. */
export function replaceNode(
  root: LayoutNode,
  id: string,
  replace: (node: LayoutNode) => LayoutNode
): LayoutNode {
  if (root.id === id) return replace(root);
  if (root.type === 'pane') return root;
  if (root.type === 'stack') {
    const children = root.children.map((child) => {
      if (child.id !== id) return child;
      const next = replace(child);
      if (next.type !== 'pane')
        throw new Error('A stack holds panes only: replace the stack instead');
      return next;
    });
    return sameNodes(children, root.children) ? root : { ...root, children };
  }
  const children = root.children.map((child) =>
    replaceNode(child, id, replace)
  );
  return sameNodes(children, root.children) ? root : { ...root, children };
}

/** The split that holds a node as a direct child, or null for the root. */
export function parentOf(root: LayoutNode, id: string): SplitNode | null {
  if (root.type !== 'split') return null;
  for (const child of root.children) {
    if (child.id === id) return root;
    const parent = parentOf(child, id);
    if (parent !== null) return parent;
  }
  return null;
}
