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
    this.state = this.freezeState({
      root,
      focusedPane: getPanes(root)[0].id,
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
    this.commit({ ...this.state, root });
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
    const root = splitPane(
      this.state.root,
      targetId,
      pane,
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
    this.commit({
      root: value.root as LayoutNode,
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

  private commit(next: LayoutState): void {
    validateLayout(next.root);
    const panes = getPanes(next.root);
    const focusedPane = panes.some(({ id }) => id === next.focusedPane)
      ? next.focusedPane
      : panes[0].id;
    const zoomedPane = panes.some(({ id }) => id === next.zoomedPane)
      ? next.zoomedPane
      : null;
    this.state = this.freezeState({ root: next.root, focusedPane, zoomedPane });
    for (const listener of [...this.listeners]) listener();
  }

  // Copy caller-owned trees before freezing, so neither side can mutate the other's state.
  private freezeState(state: LayoutState): LayoutState {
    function copy(node: LayoutNode): LayoutNode {
      return Object.freeze(
        node.type === 'pane'
          ? { ...node }
          : { ...node, first: copy(node.first), second: copy(node.second) }
      );
    }
    return Object.freeze({ ...state, root: copy(state.root) });
  }
}
