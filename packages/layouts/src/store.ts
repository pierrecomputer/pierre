import {
  type BinaryLayoutNode,
  fromBinaryLayout,
  getPanes,
  replaceNode,
  sameNodes,
  setPaneHidden,
  validateLayout,
} from './model';
import { binaryTree } from './models/binary';
import type {
  Edge,
  LayoutNode,
  LayoutState,
  PaneNode,
  TreeModel,
} from './types';

export interface LayoutStoreOptions {
  /**
   * The rules of the tree's shape, and how a split and a close change it:
   * `binaryTree` (the default) or `naryTree`.
   */
  model?: TreeModel;
}

/** Own immutable layout state and notify adapters without coupling the model to a UI framework. */
export class LayoutStore {
  private state: LayoutState;
  private model: TreeModel;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;

  constructor(root: LayoutNode, options: LayoutStoreOptions = {}) {
    this.model = options.model ?? binaryTree;
    const owned = copyAndFreeze(this.shape(root));
    this.state = Object.freeze({
      root: owned,
      focusedPane: getPanes(owned).filter(({ hidden }) => hidden !== true)[0]
        .id,
      zoomedPane: null,
    });
  }

  readonly getSnapshot = (): LayoutState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getModel(): TreeModel {
    return this.model;
  }

  /** Change the tree model, and give the tree the shape of the new model. */
  setModel(model: TreeModel): void {
    if (model === this.model) return;
    const previous = this.model;
    this.model = model;
    try {
      this.commit({ ...this.state, root: this.shape(this.state.root) });
    } catch (error) {
      this.model = previous;
      throw error;
    }
  }

  /** Set the tree. A tree of another shape takes the shape of the model. */
  setRoot(root: LayoutNode): void {
    this.commit({ ...this.state, root: copyAndFreeze(this.shape(root)) });
  }

  focusPane(id: string): void {
    this.requirePane(id);
    if (this.state.focusedPane !== id)
      this.commit({ ...this.state, focusedPane: id });
  }

  toggleZoom(id: string = this.state.focusedPane): void {
    this.requirePane(id);
    this.commit({
      ...this.state,
      focusedPane: id,
      zoomedPane: this.state.zoomedPane === id ? null : id,
    });
  }

  split(targetId: string, pane: PaneNode, edge: Edge = 'right'): void {
    // The new pane comes from the caller, so the store keeps its own copy.
    const root = this.model.split(
      this.state.root,
      targetId,
      { ...pane },
      edge,
      () => this.nextId(this.state.root)
    );
    this.commit({ root, focusedPane: pane.id, zoomedPane: null });
  }

  close(id: string): void {
    this.requirePane(id);
    const root = this.model.remove(this.state.root, id);
    // The last visible pane stays: a layout needs one.
    if (root !== null && getPanes(root).some((pane) => pane.hidden !== true))
      this.commit({ ...this.state, root });
  }

  /**
   * Hide a pane or show it again. A hidden pane keeps its place in the tree,
   * its content, and its state, but takes no space. The last visible pane
   * stays visible. A pane that shows again gets the focus.
   */
  setHidden(id: string, hidden: boolean): void {
    this.requirePane(id);
    const visible = getPanes(this.state.root).filter(
      (pane) => pane.hidden !== true
    );
    if (hidden && visible.length === 1 && visible[0].id === id) return;
    const root = setPaneHidden(this.state.root, id, hidden);
    if (root === this.state.root) return;
    this.commit({
      ...this.state,
      root,
      focusedPane: hidden ? this.state.focusedPane : id,
    });
  }

  /** Move a pane to one edge of another pane. */
  move(sourceId: string, targetId: string, edge: Edge): void {
    const current = this.state.root;
    const source = getPanes(current).find(({ id }) => id === sourceId);
    if (source === undefined) throw new Error(`Pane not found: ${sourceId}`);
    const remaining =
      sourceId === targetId ? null : this.model.remove(current, sourceId);
    const root =
      remaining === null
        ? current
        : this.model.split(remaining, targetId, source, edge, () =>
            this.nextId(current)
          );
    this.commit({ root, focusedPane: sourceId, zoomedPane: null });
  }

  /**
   * Set the sizes of splits, by split ID: one positive weight for each child
   * of the split, as in `SplitNode.sizes`.
   */
  setSizes(sizes: Readonly<Record<string, readonly number[]>>): void {
    let root = this.state.root;
    for (const [id, values] of Object.entries(sizes)) {
      root = replaceNode(root, id, (node) =>
        node.type === 'split' ? { ...node, sizes: [...values] } : node
      );
    }
    this.commit({ ...this.state, root });
  }

  serialize(): string {
    return JSON.stringify({ version: 2, ...this.state });
  }

  /**
   * Restore a layout from `serialize`. A layout of version 1, where each split
   * had two children, also restores. The tree takes the shape of the model.
   */
  restore(serialized: string): void {
    const value: unknown = JSON.parse(serialized);
    if (
      value === null ||
      typeof value !== 'object' ||
      !('version' in value) ||
      (value.version !== 1 && value.version !== 2) ||
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
    const root =
      value.version === 1
        ? fromBinaryLayout(value.root as BinaryLayoutNode)
        : (value.root as LayoutNode);
    this.commit({
      root: copyAndFreeze(this.shape(root)),
      focusedPane: value.focusedPane,
      zoomedPane: value.zoomedPane,
    });
  }

  /**
   * Give a tree the shape of the model, and validate it. The checks of
   * `validateLayout` come first, so that the model gets a sound tree.
   */
  private shape(root: LayoutNode): LayoutNode {
    validateLayout(root);
    const shaped = this.model.normalize(root, () => this.nextId(root));
    this.model.validate(shaped);
    return shaped;
  }

  private requirePane(id: string): void {
    if (!getPanes(this.state.root).some((pane) => pane.id === id))
      throw new Error(`Pane not found: ${id}`);
  }

  /** A split ID that the tree does not use. */
  private nextId(root: LayoutNode): string {
    let id: string;
    do {
      id = `layout-split-${++this.sequence}`;
    } while (hasId(root, id));
    return id;
  }

  // The root of `next` holds only nodes that the store owns: frozen nodes of
  // the current tree, and new nodes from the model functions or from a copy of
  // caller input. Unchanged nodes keep their identity, so a view can skip them.
  private commit(next: LayoutState): void {
    const sameTree = next.root === this.state.root;
    if (!sameTree) this.model.validate(next.root);
    // Focus and zoom belong to visible panes only.
    const panes = getPanes(next.root).filter(({ hidden }) => hidden !== true);
    const focusedPane = panes.some(({ id }) => id === next.focusedPane)
      ? next.focusedPane
      : panes[0].id;
    const zoomedPane = panes.some(({ id }) => id === next.zoomedPane)
      ? next.zoomedPane
      : null;
    this.state = Object.freeze({
      root: sameTree ? next.root : freezeNew(next.root),
      focusedPane,
      zoomedPane,
    });
    for (const listener of [...this.listeners]) listener();
  }
}

function hasId(node: LayoutNode, id: string): boolean {
  return (
    node.id === id ||
    (node.type === 'split' && node.children.some((child) => hasId(child, id)))
  );
}

/**
 * Copy the nodes of a tree that a caller owns and freeze the copies, so
 * neither side can change the other's state. A node that is frozen with its
 * whole subtree, such as a node of the store's own tree, is kept: a kept pane
 * node keeps its content from rendering again.
 */
function copyAndFreeze(node: LayoutNode): LayoutNode {
  if (node.type === 'pane')
    return Object.isFrozen(node) ? node : Object.freeze({ ...node });
  const children = node.children.map(copyAndFreeze);
  if (
    Object.isFrozen(node) &&
    Object.isFrozen(node.sizes) &&
    sameNodes(children, node.children)
  )
    return node;
  return Object.freeze({
    ...node,
    children: Object.freeze(children),
    sizes: Object.freeze([...node.sizes]),
  });
}

/**
 * Freeze the nodes that a model function created, with their lists. A frozen
 * node is a node of an earlier tree, frozen with its whole subtree, so the
 * walk stops there.
 */
function freezeNew(node: LayoutNode): LayoutNode {
  if (Object.isFrozen(node)) return node;
  if (node.type === 'split') {
    node.children.forEach(freezeNew);
    Object.freeze(node.children);
    Object.freeze(node.sizes);
  }
  return Object.freeze(node);
}
