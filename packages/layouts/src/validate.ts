// The checks of the core shape of a layout tree, and the order of the pinned
// tabs. The parser of the saved form and the store use them; this module
// imports nothing else of the library, so an app that only parses a saved
// tree loads no other module.
import type { ChildSize, LayoutNode, PaneNode, StackNode } from './types';

/** True when a value is a weight or a size in pixels that a split accepts. */
function isChildSize(size: unknown): size is ChildSize {
  if (typeof size === 'number') return Number.isFinite(size) && size > 0;
  if (size === null || typeof size !== 'object') return false;
  const keys = Object.keys(size);
  const px = (size as { px?: unknown }).px;
  return (
    keys.length === 1 &&
    keys[0] === 'px' &&
    typeof px === 'number' &&
    Number.isFinite(px) &&
    px >= 0
  );
}

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
      for (const size of [node.maxWidth, node.maxHeight]) {
        if (size !== undefined && (Number.isNaN(size) || size < 0)) {
          throw new Error('Pane maximum sizes must be non-negative');
        }
      }
      if (node.hidden !== undefined && typeof node.hidden !== 'boolean') {
        throw new Error('Pane hidden must be a boolean');
      }
      validateCollapse(node);
    } else if (node.type === 'stack') {
      if (
        !Array.isArray(node.children) ||
        node.children.length < 2 ||
        !node.children.every((child) => child?.type === 'pane')
      ) {
        throw new Error('A stack needs at least two panes');
      }
      node.children.forEach(visit);
      if (!node.children.some(({ id }) => id === node.active)) {
        throw new Error('The active pane of a stack must be one of its panes');
      }
      if (node.children.some(({ collapsed }) => collapsed !== undefined)) {
        throw new Error(
          'A pane of a stack does not collapse: collapse the stack'
        );
      }
      validateCollapse(node);
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
        !node.sizes.every(isChildSize)
      ) {
        throw new Error(
          'A split needs a positive weight or a size in pixels for each child'
        );
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

function validateCollapse(node: PaneNode | StackNode): void {
  if (node.collapsed !== undefined && typeof node.collapsed !== 'boolean')
    throw new Error('Collapsed must be a boolean');
  const size = node.collapsedSize;
  if (size !== undefined && (!Number.isFinite(size) || size < 0))
    throw new Error('A collapsed size must be finite and non-negative');
}

/** True when a node or one of its descendants is a pane that is not hidden. */
export function hasVisiblePane(node: LayoutNode): boolean {
  return node.type === 'pane'
    ? node.hidden !== true
    : node.children.some(hasVisiblePane);
}

/**
 * The tree with the pinned tabs of each stack first, in their order, then the
 * other tabs in theirs: the order that the commands keep. A tree from
 * elsewhere, such as an old save, can mix them. A tree whose stacks keep the
 * order is returned as it is.
 */
export function pinnedFirst(node: LayoutNode): LayoutNode {
  if (node.type === 'pane') return node;
  const children: LayoutNode[] =
    node.type === 'stack'
      ? [
          ...node.children.filter(({ pinned }) => pinned === true),
          ...node.children.filter(({ pinned }) => pinned !== true),
        ]
      : node.children.map(pinnedFirst);
  return children.every((child, index) => child === node.children[index])
    ? node
    : ({ ...node, children } as LayoutNode);
}
