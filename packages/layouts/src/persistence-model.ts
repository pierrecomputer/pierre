// The saved form of version 1, where each split had two children, and its
// conversion to the current tree.
import type { Direction, LayoutNode, PaneNode } from './types';

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
