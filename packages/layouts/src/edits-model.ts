// Tree edits: the functions that split, close, move, and swap panes. The tree
// models and the store's edit commands use them.
import {
  findNode,
  getPanes,
  hasVisiblePane,
  isFixed,
  nearestVisible,
  replaceNode,
  sameNodes,
  stackOf,
} from './model';
import type {
  ChildSize,
  Direction,
  Edge,
  LayoutNode,
  PaneNode,
  StackNode,
} from './types';

/** The direction of a split that puts a pane at an edge of another. */
export const directionOf = (edge: Edge): Direction =>
  edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';

/** Throw unless a tree holds the pane. */
export function requirePane(root: LayoutNode, id: string): void {
  if (!getPanes(root).some((pane) => pane.id === id))
    throw new Error(`Pane not found: ${id}`);
}

/**
 * Throw unless a tree holds a pane or a stack with the ID, outside a stack:
 * the target of a split or a move.
 */
export function requireSlot(root: LayoutNode, id: string): void {
  const node = findNode(root, id);
  if (node === null || node.type === 'split' || stackOf(root, id) !== null)
    throw new Error(`Pane not found: ${id}`);
}

/**
 * Put a new split with `splitId` in the place of a target pane or stack. The
 * split holds the target and the new pane, each with half of the space.
 */
export function wrapPane(
  root: LayoutNode,
  targetId: string,
  pane: PaneNode,
  splitId: string,
  edge: Edge
): LayoutNode {
  requireSlot(root, targetId);
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
  if (root.type === 'stack') return removeTab(root, id);
  const children: LayoutNode[] = [];
  const sizes: ChildSize[] = [];
  // The place of the removed child among the children that stay, its size,
  // and whether it took space.
  let removed: { at: number; size: ChildSize; visible: boolean } | null = null;
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
  // A child with a size in pixels gives its space to the weighted children
  // as a group. A weighted child gives its weight to the nearest weighted
  // child that takes space.
  const size = removed?.size;
  if (removed?.visible === true && typeof size === 'number') {
    const heirs = children.map(
      (child, index) => hasVisiblePane(child) && !isFixed(sizes[index])
    );
    const before = heirs.slice(0, removed.at).lastIndexOf(true);
    const after = heirs.indexOf(true, removed.at);
    const heir = before !== -1 ? before : after;
    if (heir !== -1) sizes[heir] = (sizes[heir] as number) + size;
  }
  if (children.length === 1) return children[0];
  return join
    ? { ...root, ...joinChildren(root.direction, children, sizes) }
    : { ...root, children, sizes };
}

/**
 * Remove a pane from a stack. When the active pane goes, its nearest visible
 * pane shows. A stack with one pane left gives way to that pane.
 */
function removeTab(stack: StackNode, id: string): LayoutNode | null {
  if (!stack.children.some((child) => child.id === id)) return stack;
  const children = stack.children.filter((child) => child.id !== id);
  if (children.length === 0) return null;
  if (children.length === 1) {
    // The last pane takes the collapse of its stack.
    const [last] = children;
    if (stack.collapsed !== true) return last;
    return {
      ...last,
      collapsed: true,
      collapsedSize: stack.collapsedSize ?? last.collapsedSize ?? 0,
    };
  }
  const active =
    stack.active === id
      ? (nearestVisible(stack.children, id) ?? children[0].id)
      : stack.active;
  return { ...stack, children, active };
}

/**
 * The children and sizes of a split, where each child that is a split of the
 * same direction joins the split in its place. The children of a joined split
 * share the size that it had, in proportion to their own sizes.
 */
export function joinChildren(
  direction: Direction,
  children: readonly LayoutNode[],
  sizes: readonly ChildSize[]
): { children: LayoutNode[]; sizes: ChildSize[] } {
  const joined: { children: LayoutNode[]; sizes: ChildSize[] } = {
    children: [],
    sizes: [],
  };
  children.forEach((child, index) => {
    if (child.type === 'split' && child.direction === direction) {
      joined.children.push(...child.children);
      joined.sizes.push(...shareSlot(sizes[index], child.sizes));
    } else {
      joined.children.push(child);
      joined.sizes.push(sizes[index]);
    }
  });
  return joined;
}

/**
 * The sizes of the children of a split that joins its parent in the place
 * of one child. Sizes in pixels stay. In a weighted place, the weighted
 * children share its weight. In a place in pixels, the weighted children
 * take sizes in pixels from what the others leave of it. The separators of
 * the joined children are not counted, so such a place grows by their gaps.
 */
function shareSlot(slot: ChildSize, sizes: readonly ChildSize[]): ChildSize[] {
  const weights = sizes.filter((size) => !isFixed(size)) as number[];
  const total = weights.reduce((sum, size) => sum + size, 0);
  if (!isFixed(slot))
    return sizes.map((size) => (isFixed(size) ? size : (slot * size) / total));
  const pixels = sizes.reduce<number>(
    (sum, size) => sum + (isFixed(size) ? size.px : 0),
    0
  );
  const rest = Math.max(0, slot.px - pixels);
  return sizes.map((size) =>
    isFixed(size) ? size : { px: (rest * size) / total }
  );
}

/** Half of a child size: half of its weight, or of its size in pixels. */
export const halfOf = (size: ChildSize): ChildSize =>
  isFixed(size) ? { px: size.px / 2 } : size / 2;

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
  const swapId = (id: string): string =>
    id === firstId ? secondId : id === secondId ? firstId : id;
  function swapPane(node: PaneNode): PaneNode {
    return node.id === firstId
      ? secondPane
      : node.id === secondId
        ? firstPane
        : node;
  }
  function swap(node: LayoutNode): LayoutNode {
    if (node.type === 'pane') return swapPane(node);
    if (node.type === 'stack')
      return {
        ...node,
        children: node.children.map(swapPane),
        active: swapId(node.active),
      };
    return { ...node, children: node.children.map(swap) };
  }
  return swap(root);
}
