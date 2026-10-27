import type { Direction, Edge, LayoutNode, PaneNode, SplitNode } from './types';

/**
 * Reject malformed trees before they can create ambiguous pane identity or
 * geometry. A tree model adds the rules of its shape (`TreeModel.validate`).
 */
export function validateLayout(root: LayoutNode): void {
  const ids = new Set<string>();
  const objects = new Set<LayoutNode>();
  function visit(node: LayoutNode): void {
    if (node == null || typeof node !== 'object' || objects.has(node)) {
      throw new Error('Layout must be a tree without cycles or shared nodes');
    }
    objects.add(node);
    if (
      typeof node.id !== 'string' ||
      node.id.length === 0 ||
      ids.has(node.id)
    ) {
      throw new Error('Every layout node must have a unique, non-empty ID');
    }
    ids.add(node.id);
    if (node.type === 'pane') {
      for (const size of [node.minWidth, node.minHeight]) {
        if (size !== undefined && (!Number.isFinite(size) || size < 0)) {
          throw new Error('Pane minimum sizes must be finite and non-negative');
        }
      }
      if (node.hidden !== undefined && typeof node.hidden !== 'boolean') {
        throw new Error('Pane hidden must be a boolean');
      }
    } else if (node.type === 'split') {
      if (node.direction !== 'horizontal' && node.direction !== 'vertical') {
        throw new Error('Split direction must be horizontal or vertical');
      }
      if (!Array.isArray(node.children) || node.children.length < 2) {
        throw new Error('A split needs at least two children');
      }
      if (
        !Array.isArray(node.sizes) ||
        node.sizes.length !== node.children.length ||
        !node.sizes.every((size) => Number.isFinite(size) && size > 0)
      ) {
        throw new Error('A split needs a positive size for each child');
      }
      node.children.forEach(visit);
    } else {
      throw new Error('Unknown layout node type');
    }
  }
  visit(root);
  if (!hasVisiblePane(root)) {
    throw new Error('A layout needs at least one visible pane');
  }
}

export function getPanes(root: LayoutNode): PaneNode[] {
  return root.type === 'pane' ? [root] : root.children.flatMap(getPanes);
}

export function hasVisiblePane(node: LayoutNode): boolean {
  return node.type === 'pane'
    ? node.hidden !== true
    : node.children.some(hasVisiblePane);
}

/**
 * The tree that takes space: hidden panes are left out, and a split with one
 * visible child gives way to that child. A subtree with no hidden pane keeps
 * its identity. Null when no pane is visible.
 */
export function visibleTree(node: LayoutNode): LayoutNode | null {
  if (node.type === 'pane') return node.hidden === true ? null : node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
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
  const next = replaceNode(root, id, (node) => {
    if (node.type !== 'pane') throw new Error(`Pane not found: ${id}`);
    if ((node.hidden === true) === hidden) return node;
    if (hidden) return { ...node, hidden: true };
    const { hidden: _hidden, ...shown } = node;
    return shown;
  });
  validateLayout(next);
  return next;
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
  const children = root.children.map((child) =>
    replaceNode(child, id, replace)
  );
  return sameNodes(children, root.children) ? root : { ...root, children };
}

/** The split that holds a node as a direct child, or null for the root. */
export function parentOf(root: LayoutNode, id: string): SplitNode | null {
  if (root.type === 'pane') return null;
  for (const child of root.children) {
    if (child.id === id) return root;
    const parent = parentOf(child, id);
    if (parent !== null) return parent;
  }
  return null;
}

/** The direction of a split that puts a pane at an edge of another. */
export const directionOf = (edge: Edge): Direction =>
  edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';

/** Throw unless a tree holds the pane. */
export function requirePane(root: LayoutNode, id: string): void {
  if (!getPanes(root).some((pane) => pane.id === id))
    throw new Error(`Pane not found: ${id}`);
}

/**
 * Put a new split with `splitId` in the place of a target pane. The split
 * holds the target and the new pane, each with half of the space.
 */
export function wrapPane(
  root: LayoutNode,
  targetId: string,
  pane: PaneNode,
  splitId: string,
  edge: Edge
): LayoutNode {
  requirePane(root, targetId);
  const before = edge === 'left' || edge === 'top';
  return replaceNode(root, targetId, (target) => ({
    type: 'split',
    id: splitId,
    direction: directionOf(edge),
    children: before ? [pane, target] : [target, pane],
    sizes: [0.5, 0.5],
  }));
}

/**
 * Remove a pane. A visible pane gives its size to the nearest visible child
 * before it in its split, or after it when there is none, so that the other
 * children keep their size. A hidden pane takes no space, so its size goes
 * away with it. A split with one child left gives way to that child. With
 * `join`, a child split of the same direction as its new parent joins it (see
 * `joinChildren`).
 */
export function removePane(
  root: LayoutNode,
  id: string,
  join: boolean
): LayoutNode | null {
  if (root.type === 'pane') return root.id === id ? null : root;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  // The place of the removed child among the children that stay, its size,
  // and whether it took space.
  let removed: { at: number; size: number; visible: boolean } | null = null;
  for (let index = 0; index < root.children.length; index++) {
    const child = root.children[index];
    const next = removePane(child, id, join);
    if (next === null) {
      removed = {
        at: children.length,
        size: root.sizes[index],
        visible: hasVisiblePane(child),
      };
    } else {
      children.push(next);
      sizes.push(root.sizes[index]);
    }
  }
  if (removed === null && sameNodes(children, root.children)) return root;
  if (children.length === 0) return null;
  if (removed?.visible === true) {
    const visible = children.map(hasVisiblePane);
    const before = visible.slice(0, removed.at).lastIndexOf(true);
    const after = visible.indexOf(true, removed.at);
    const heir =
      before !== -1
        ? before
        : after !== -1
          ? after
          : Math.max(0, removed.at - 1);
    sizes[heir] += removed.size;
  }
  if (children.length === 1) return children[0];
  return join
    ? { ...root, ...joinChildren(root.direction, children, sizes) }
    : { ...root, children, sizes };
}

/**
 * The children and sizes of a split, where each child that is a split of the
 * same direction joins the split in its place. The children of a joined split
 * share the size that it had, in proportion to their own sizes.
 */
export function joinChildren(
  direction: Direction,
  children: readonly LayoutNode[],
  sizes: readonly number[]
): { children: LayoutNode[]; sizes: number[] } {
  const joined: { children: LayoutNode[]; sizes: number[] } = {
    children: [],
    sizes: [],
  };
  children.forEach((child, index) => {
    if (child.type === 'split' && child.direction === direction) {
      const total = child.sizes.reduce((sum, size) => sum + size, 0);
      joined.children.push(...child.children);
      joined.sizes.push(
        ...child.sizes.map((size) => (sizes[index] * size) / total)
      );
    } else {
      joined.children.push(child);
      joined.sizes.push(sizes[index]);
    }
  });
  return joined;
}

export function swapPanes(
  root: LayoutNode,
  firstId: string,
  secondId: string
): LayoutNode {
  const panes = getPanes(root);
  const first = panes.find(({ id }) => id === firstId);
  const second = panes.find(({ id }) => id === secondId);
  if (first === undefined || second === undefined)
    throw new Error('Pane not found');
  const firstPane = first;
  const secondPane = second;
  function swap(node: LayoutNode): LayoutNode {
    if (node.type === 'pane')
      return node.id === firstId
        ? secondPane
        : node.id === secondId
          ? firstPane
          : node;
    return { ...node, children: node.children.map(swap) };
  }
  return swap(root);
}

/** A node of the saved form of version 1, where each split had two children. */
export type BinaryLayoutNode =
  | PaneNode
  | {
      readonly type: 'split';
      readonly id: string;
      readonly direction: Direction;
      /** The share of the first child. */
      readonly ratio: number;
      readonly first: BinaryLayoutNode;
      readonly second: BinaryLayoutNode;
    };

/** Convert a tree of the saved form of version 1. The shape stays the same. */
export function fromBinaryLayout(node: BinaryLayoutNode): LayoutNode {
  if (node.type === 'pane') return node;
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    children: [fromBinaryLayout(node.first), fromBinaryLayout(node.second)],
    sizes: [node.ratio, 1 - node.ratio],
  };
}
