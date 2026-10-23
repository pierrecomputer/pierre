import {
  getPanes,
  movePane,
  removePane,
  replaceNode,
  splitPane,
  validateLayout,
} from './model';
import type { Edge, LayoutNode, LayoutState, PaneNode } from './types';

/** Own immutable layout state and notify adapters without coupling the model to a UI framework. */
export class LayoutStore {
  private state: LayoutState;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;

  constructor(root: LayoutNode) {
    validateLayout(root);
    const owned = copyAndFreeze(root);
    this.state = Object.freeze({
      root: owned,
      focusedPane: getPanes(owned)[0].id,
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

  setRoot(root: LayoutNode): void {
    validateLayout(root);
    this.commit({ ...this.state, root: copyAndFreeze(root) });
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
    const root = splitPane(
      this.state.root,
      targetId,
      { ...pane },
      this.nextId(),
      edge
    );
    this.commit({ root, focusedPane: pane.id, zoomedPane: null });
  }

  close(id: string): void {
    this.requirePane(id);
    const root = removePane(this.state.root, id);
    if (root !== null) this.commit({ ...this.state, root });
  }

  move(sourceId: string, targetId: string, edge: Edge): void {
    const root = movePane(
      this.state.root,
      sourceId,
      targetId,
      edge,
      this.nextId()
    );
    this.commit({ root, focusedPane: sourceId, zoomedPane: null });
  }

  setRatios(ratios: Readonly<Record<string, number>>): void {
    let root = this.state.root;
    for (const [id, ratio] of Object.entries(ratios)) {
      if (!Number.isFinite(ratio))
        throw new Error('Split ratio must be finite');
      root = replaceNode(root, id, (node) =>
        node.type === 'split'
          ? { ...node, ratio: Math.max(0.001, Math.min(0.999, ratio)) }
          : node
      );
    }
    this.commit({ ...this.state, root });
  }

  serialize(): string {
    return JSON.stringify({ version: 1, ...this.state });
  }

  restore(serialized: string): void {
    const value: unknown = JSON.parse(serialized);
    if (
      value === null ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('root' in value) ||
      !('focusedPane' in value) ||
      typeof value.focusedPane !== 'string' ||
      !('zoomedPane' in value) ||
      (value.zoomedPane !== null && typeof value.zoomedPane !== 'string')
    ) {
      throw new Error('Invalid layout state');
    }
    validateLayout(value.root as LayoutNode);
    this.commit({
      root: copyAndFreeze(value.root as LayoutNode),
      focusedPane: value.focusedPane,
      zoomedPane: value.zoomedPane,
    });
  }

  private requirePane(id: string): void {
    if (!getPanes(this.state.root).some((pane) => pane.id === id))
      throw new Error(`Pane not found: ${id}`);
  }

  private nextId(): string {
    let id: string;
    do {
      id = `layout-split-${++this.sequence}`;
    } while (this.hasId(this.state.root, id));
    return id;
  }

  private hasId(node: LayoutNode, id: string): boolean {
    return (
      node.id === id ||
      (node.type === 'split' &&
        (this.hasId(node.first, id) || this.hasId(node.second, id)))
    );
  }

  // The root of `next` holds only nodes that the store owns: frozen nodes of
  // the current tree, and new nodes from the model functions or from a copy of
  // caller input. Unchanged nodes keep their identity, so a view can skip them.
  private commit(next: LayoutState): void {
    const sameTree = next.root === this.state.root;
    if (!sameTree) validateLayout(next.root);
    const panes = getPanes(next.root);
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

/**
 * Copy the nodes of a tree that a caller owns and freeze the copies, so
 * neither side can change the other's state. A node that is frozen with its
 * whole subtree, such as a node of the store's own tree, is kept: a kept pane
 * node keeps its content from rendering again.
 */
function copyAndFreeze(node: LayoutNode): LayoutNode {
  if (node.type === 'pane')
    return Object.isFrozen(node) ? node : Object.freeze({ ...node });
  const first = copyAndFreeze(node.first);
  const second = copyAndFreeze(node.second);
  if (Object.isFrozen(node) && first === node.first && second === node.second)
    return node;
  return Object.freeze({ ...node, first, second });
}

/**
 * Freeze the nodes that a model function created. A frozen node is a node of
 * an earlier tree, frozen with its whole subtree, so the walk stops there.
 */
function freezeNew(node: LayoutNode): LayoutNode {
  if (Object.isFrozen(node)) return node;
  if (node.type === 'split') {
    freezeNew(node.first);
    freezeNew(node.second);
  }
  return Object.freeze(node);
}
