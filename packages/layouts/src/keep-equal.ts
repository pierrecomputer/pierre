// Keep the nodes of a tree that equal the nodes of the current tree. An app
// that applies a tree from elsewhere, such as its server's tree after each
// sync or a saved tree, gets no change for an equal tree, and each pane that
// does not change keeps its node, so its content does not render again. Only
// `applyOperations` and the persistence feature import this module.
import { sameNodes } from './model';
import type { LayoutNode } from './types';

/** The fields of two nodes, besides their children, are the same. */
function sameFields(a: LayoutNode, b: LayoutNode): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        key === 'children' ||
        (key === 'sizes'
          ? JSON.stringify(a[key as never]) === JSON.stringify(b[key as never])
          : a[key as never] === b[key as never])
    )
  );
}

/**
 * Keep each node of `next` that equals the node of `current` with the same
 * ID, with its subtree: the node of `current`. So a tree that equals the
 * current tree is the current tree, which is no change, and each pane that
 * does not change keeps its node, so its content does not render again.
 */
export function keepEqual(
  next: LayoutNode,
  current: ReadonlyMap<string, LayoutNode>
): LayoutNode {
  const old = current.get(next.id);
  if (next.type === 'pane')
    return old?.type === 'pane' && sameFields(next, old) ? old : next;
  const children = next.children.map((child) => keepEqual(child, current));
  if (
    old !== undefined &&
    old.type === next.type &&
    sameNodes(children, old.children) &&
    sameFields(next, old)
  )
    return old;
  return sameNodes(children, next.children)
    ? next
    : (Object.freeze({
        ...next,
        children: Object.freeze(children),
      }) as LayoutNode);
}

/** Each node of a tree, by ID. */
export function nodesById(root: LayoutNode): Map<string, LayoutNode> {
  const nodes = new Map<string, LayoutNode>();
  const visit = (node: LayoutNode): void => {
    nodes.set(node.id, node);
    if (node.type !== 'pane') node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}
