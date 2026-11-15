import { shownPanes } from './model';
import type { LayoutNode, PaneNode, StackNode } from './types';

/** A pane of a tree, with the stack that holds it. */
export interface IndexedPane {
  readonly pane: PaneNode;
  /** The stack that holds the pane, or null. */
  readonly stack: StackNode | null;
}

/** The panes of a tree by ID, and the count of panes that show. */
export interface TreeIndex {
  readonly panes: ReadonlyMap<string, IndexedPane>;
  readonly shown: number;
}

// The index of each tree. The selectors of parts and of `usePane` run on each
// store change, also on each pointer move of a resize, so they read the index,
// which a tree builds once, and do not walk the tree.
const indexes = new WeakMap<LayoutNode, TreeIndex>();

/** The index of a tree, built once for each tree. */
export function treeIndex(root: LayoutNode): TreeIndex {
  let index = indexes.get(root);
  if (index === undefined) {
    const panes = new Map<string, IndexedPane>();
    const visit = (node: LayoutNode, stack: StackNode | null): void => {
      if (node.type === 'pane') panes.set(node.id, { pane: node, stack });
      else
        for (const child of node.children)
          visit(child, node.type === 'stack' ? node : null);
    };
    visit(root, null);
    index = { panes, shown: shownPanes(root).length };
    indexes.set(root, index);
  }
  return index;
}
