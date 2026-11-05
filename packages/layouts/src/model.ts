import type { Edge, LayoutNode, PaneNode } from './types';

/** Reject malformed trees before they can create ambiguous pane identity or geometry. */
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
    } else if (node.type === 'split') {
      if (node.direction !== 'horizontal' && node.direction !== 'vertical') {
        throw new Error('Split direction must be horizontal or vertical');
      }
      if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) {
        throw new Error('Split ratio must be between zero and one');
      }
      visit(node.first);
      visit(node.second);
    } else {
      throw new Error('Unknown layout node type');
    }
  }
  visit(root);
}

export function getPanes(root: LayoutNode): PaneNode[] {
  return root.type === 'pane'
    ? [root]
    : [...getPanes(root.first), ...getPanes(root.second)];
}

/** Replace a node immutably, preserving the identity of unaffected branches. */
export function replaceNode(
  root: LayoutNode,
  id: string,
  replace: (node: LayoutNode) => LayoutNode
): LayoutNode {
  if (root.id === id) return replace(root);
  if (root.type === 'pane') return root;
  const first = replaceNode(root.first, id, replace);
  const second = replaceNode(root.second, id, replace);
  return first === root.first && second === root.second
    ? root
    : { ...root, first, second };
}

export function splitPane(
  root: LayoutNode,
  targetId: string,
  pane: PaneNode,
  splitId: string,
  edge: Edge = 'right'
): LayoutNode {
  if (!getPanes(root).some(({ id }) => id === targetId)) {
    throw new Error(`Pane not found: ${targetId}`);
  }
  const next = replaceNode(root, targetId, (target) => ({
    type: 'split',
    id: splitId,
    direction: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    ratio: 0.5,
    first: edge === 'left' || edge === 'top' ? pane : target,
    second: edge === 'left' || edge === 'top' ? target : pane,
  }));
  validateLayout(next);
  return next;
}

/** Remove a pane and promote its sibling, so empty split containers never survive. */
export function removePane(root: LayoutNode, id: string): LayoutNode | null {
  if (root.type === 'pane') return root.id === id ? null : root;
  const first = removePane(root.first, id);
  const second = removePane(root.second, id);
  if (first === null) return second;
  if (second === null) return first;
  return first === root.first && second === root.second
    ? root
    : { ...root, first, second };
}

/** Detach a pane before inserting it beside a target, including moves across ancestors. */
export function movePane(
  root: LayoutNode,
  sourceId: string,
  targetId: string,
  edge: Edge,
  splitId: string
): LayoutNode {
  if (sourceId === targetId) return root;
  const source = getPanes(root).find(({ id }) => id === sourceId);
  if (source === undefined) throw new Error(`Pane not found: ${sourceId}`);
  const remaining = removePane(root, sourceId);
  if (remaining === null) return root;
  return splitPane(remaining, targetId, source, splitId, edge);
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
    return { ...node, first: swap(node.first), second: swap(node.second) };
  }
  return swap(root);
}
