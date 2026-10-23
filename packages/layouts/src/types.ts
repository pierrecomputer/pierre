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

export interface SplitNode {
  readonly type: 'split';
  readonly id: string;
  readonly direction: Direction;
  /** Preferred share of the available space assigned to the first child. */
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}

export type LayoutNode = PaneNode | SplitNode;

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

export interface SeparatorGeometry {
  readonly split: SplitNode;
  readonly rect: Rect;
  readonly container: Rect;
  readonly ratio: number;
  readonly minRatio: number;
  readonly maxRatio: number;
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
