// The saved forms of a layout: the reader of `serialize`, and the form of
// version 1, where each split had two children, with its conversion to the
// current tree.
import type { Direction, LayoutNode, LayoutState, PaneNode } from './types';

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

/**
 * Read a layout from `serialize`, of version 1, 2, or 3. Throw when the value
 * does not have the form of a saved layout.
 */
export function parseSerializedLayout(serialized: string): LayoutState {
  const value: unknown = JSON.parse(serialized);
  if (
    value === null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    !('root' in value) ||
    value.root === null ||
    typeof value.root !== 'object' ||
    !('focusedPane' in value) ||
    typeof value.focusedPane !== 'string' ||
    !('zoomedPane' in value) ||
    (value.zoomedPane !== null && typeof value.zoomedPane !== 'string')
  ) {
    throw new Error('Invalid layout state');
  }
  return {
    root:
      value.version === 1
        ? fromBinaryLayout(value.root as BinaryLayoutNode)
        : (value.root as LayoutNode),
    focusedPane: value.focusedPane,
    zoomedPane: value.zoomedPane,
  };
}
