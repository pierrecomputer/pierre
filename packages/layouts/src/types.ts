export type Direction = 'horizontal' | 'vertical';
export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface PaneNode {
  readonly type: 'pane';
  readonly id: string;
  readonly minWidth?: number;
  readonly minHeight?: number;
  /**
   * A hidden pane keeps its place in the tree, its content, and its state, but
   * takes no space and does not render.
   */
  readonly hidden?: boolean;
}

/**
 * A row (`horizontal`) or a column (`vertical`) of two or more children. The
 * tree model of the store sets the other rules of the shape (see `TreeModel`).
 */
export interface SplitNode {
  readonly type: 'split';
  readonly id: string;
  readonly direction: Direction;
  /** Left to right in a row, top to bottom in a column. */
  readonly children: readonly LayoutNode[];
  /**
   * The preferred size of each child, as a positive weight in the order of
   * `children`. The visible children share the space of the split, without
   * its separators, in proportion to their weights. A hidden child keeps its
   * weight for when it shows again.
   */
  readonly sizes: readonly number[];
}

export type LayoutNode = PaneNode | SplitNode;

/**
 * The rules of the tree's shape, and how a split and a close change it. The
 * geometry, the drag, and the view are the same for each model.
 */
export interface TreeModel {
  readonly name: string;
  /** Throw when a tree does not have the shape of this model. */
  validate(root: LayoutNode): void;
  /**
   * Give a tree the shape of this model. Nodes that have that shape keep their
   * identity. `nextId` names each new split.
   */
  normalize(root: LayoutNode, nextId: () => string): LayoutNode;
  /** Put a pane at one edge of a target pane. `nextId` names a new split. */
  split(
    root: LayoutNode,
    targetId: string,
    pane: PaneNode,
    edge: Edge,
    nextId: () => string
  ): LayoutNode;
  /** Remove a pane. Null when no pane stays. */
  remove(root: LayoutNode, id: string): LayoutNode | null;
}

export interface LayoutState {
  readonly root: LayoutNode;
  readonly focusedPane: string;
  readonly zoomedPane: string | null;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PaneGeometry {
  readonly pane: PaneNode;
  readonly rect: Rect;
}

/** A visible child of a split, along the axis of the split, in pixels. */
export interface ChildExtent {
  /** The index of the child in `split.children`. */
  readonly index: number;
  readonly size: number;
  readonly min: number;
}

export interface SeparatorGeometry {
  /**
   * The ID of the separator: the ID of the split and the index of the child
   * after it (see `separatorId`).
   */
  readonly id: string;
  readonly split: SplitNode;
  /** The index in `split.children` of the child after the separator. */
  readonly index: number;
  readonly rect: Rect;
  /** The box of the split. */
  readonly container: Rect;
  /** The visible children of the split, in order. */
  readonly children: readonly ChildExtent[];
}

export interface CornerGeometry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly separators: readonly SeparatorGeometry[];
}

export interface LayoutGeometry {
  readonly panes: readonly PaneGeometry[];
  readonly separators: readonly SeparatorGeometry[];
  readonly corners: readonly CornerGeometry[];
}
