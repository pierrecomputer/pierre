import {
  getPanes,
  parentOf,
  replaceNode,
  sameNodes,
  setNodeCollapsed,
  shownPanes,
  slotOf,
  stackOf,
  validateLayout,
} from './model';
import type {
  ChildSize,
  LayoutNode,
  LayoutState,
  PaneNode,
  TreeModel,
} from './types';

/**
 * The commands that every store has: the state, the tree, sizes, collapse, and
 * focus. The features of a store add the other commands.
 */
export interface CoreLayoutStore {
  getSnapshot(): LayoutState;
  subscribe(listener: () => void): () => void;
  /** Set the tree. A store with a tree model gives it the shape of the model. */
  setRoot(root: LayoutNode): void;
  /**
   * Set the sizes of splits, by split ID: one size for each child of the
   * split, as in `SplitNode.sizes`.
   */
  setSizes(sizes: Readonly<Record<string, readonly ChildSize[]>>): void;
  /**
   * Collapse a pane to its `collapsedSize` along its split, or expand it to
   * its size in the split again. A pane of a stack collapses its stack. The
   * pane at the root fills the layout, so it does not collapse.
   */
  setCollapsed(id: string, collapsed: boolean): void;
  focusPane(id: string): void;
}

/** What a store feature uses to build its commands. */
export interface StoreContext {
  /** The current state. */
  get(): LayoutState;
  /**
   * Make a state the current state, and notify the listeners. The tree of
   * `next` holds only nodes that the store owns: nodes of the current tree,
   * and new nodes from a model function or from `own`. The store validates a
   * new tree, freezes its new nodes, and moves the focus and the zoom to panes
   * that show.
   */
  commit(next: LayoutState): void;
  /** The tree model of the store, or null when no feature gives one. */
  model(): TreeModel | null;
  /** Throw unless the current tree holds the pane. */
  requirePane(id: string): void;
  /**
   * A tree from a caller, with the shape of the model, as nodes that the
   * store owns: copied and frozen, except the nodes that the store owns
   * already.
   */
  own(root: LayoutNode): LayoutNode;
  /** A split or stack ID that a tree does not use. */
  nextId(root: LayoutNode, kind?: 'split' | 'stack'): string;
}

/**
 * A set of commands that a store gets when the app passes the feature to
 * `createLayoutStore`. A bundler keeps the code of a feature only when the app
 * imports it.
 */
export interface StoreFeature<Commands extends object = object> {
  /** A tree model: the shape of the tree, and how a split and a close change it. */
  readonly model?: TreeModel;
  commands(context: StoreContext): Commands;
}

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

// The commands of one feature. The type distributes over a union, so that a
// feature without commands does not hide the commands of the others.
type StoreCommandsOf<T> =
  T extends StoreFeature<infer Commands> ? Commands : never;

/** The commands that a list of features adds to a store. */
export type CommandsOf<F extends readonly StoreFeature[]> = UnionToIntersection<
  StoreCommandsOf<F[number]>
>;

/** A store with the commands of a list of features. */
export type StoreWith<F extends readonly StoreFeature[]> = CoreLayoutStore &
  CommandsOf<F>;

/**
 * Create a store that owns an immutable layout state and notifies views. The
 * features give the store its other commands and its tree model, for example
 * `createLayoutStore(root, [edits(naryTree)])`. A view calls each command
 * through the store object, so an app can wrap a command with its own object:
 * `{ ...store, close(id) { record(id); store.close(id); } }`.
 */
export function createLayoutStore<const F extends readonly StoreFeature[] = []>(
  initial: LayoutNode,
  features?: F
): StoreWith<F> {
  const list: readonly StoreFeature[] = features ?? [];
  const model = list.find((feature) => feature.model !== undefined)?.model;
  const listeners = new Set<() => void>();
  let sequence = 0;

  const nextId = (root: LayoutNode, kind: 'split' | 'stack' = 'split') => {
    let id: string;
    do {
      id = `layout-${kind}-${++sequence}`;
    } while (hasId(root, id));
    return id;
  };
  // Give a tree the shape of the model, and validate it. The checks of
  // `validateLayout` come first, so that the model gets a sound tree.
  const shape = (root: LayoutNode): LayoutNode => {
    validateLayout(root);
    if (model === undefined) return root;
    const shaped = model.normalize(root, () => nextId(root));
    model.validate(shaped);
    return shaped;
  };
  const own = (root: LayoutNode): LayoutNode => copyAndFreeze(shape(root));

  const initialRoot = own(initial);
  let state: LayoutState = Object.freeze({
    root: initialRoot,
    focusedPane: shownPanes(initialRoot)[0].id,
    zoomedPane: null,
  });
  const get = (): LayoutState => state;
  const commit = (next: LayoutState): void => {
    const sameTree = next.root === state.root;
    if (!sameTree) (model?.validate ?? validateLayout)(next.root);
    // Focus and zoom belong to panes that show only.
    const panes = shownPanes(next.root);
    state = Object.freeze({
      root: sameTree ? next.root : freezeNew(next.root),
      focusedPane: panes.some(({ id }) => id === next.focusedPane)
        ? next.focusedPane
        : panes[0].id,
      zoomedPane: panes.some(({ id }) => id === next.zoomedPane)
        ? next.zoomedPane
        : null,
    });
    for (const listener of [...listeners]) listener();
  };
  const requirePane = (id: string): void => {
    if (!getPanes(state.root).some((pane) => pane.id === id))
      throw new Error(`Pane not found: ${id}`);
  };
  const context: StoreContext = {
    get,
    commit,
    model: () => model ?? null,
    requirePane,
    own,
    nextId,
  };

  const store: CoreLayoutStore = {
    getSnapshot: get,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRoot(root) {
      commit({ ...state, root: own(root) });
    },
    setSizes(sizes) {
      let root = state.root;
      for (const [id, values] of Object.entries(sizes)) {
        root = replaceNode(root, id, (node) =>
          node.type === 'split' ? { ...node, sizes: [...values] } : node
        );
      }
      commit({ ...state, root });
    },
    setCollapsed(id, collapsed) {
      requirePane(id);
      const slot = slotOf(state.root, id);
      if (parentOf(state.root, slot) === null) return;
      const root = setNodeCollapsed(state.root, slot, collapsed);
      if (root !== state.root) commit({ ...state, root });
    },
    focusPane(id) {
      requirePane(id);
      if (state.focusedPane !== id) commit({ ...state, focusedPane: id });
    },
  };
  for (const feature of list) Object.assign(store, feature.commands(context));
  return store as StoreWith<F>;
}

/**
 * The focus after a pane stops showing: the tab of its stack that shows next,
 * nearest first, when the pane had the focus.
 */
export function focusAfterLeaving(
  state: LayoutState,
  id: string,
  next: LayoutNode
): string {
  const focused = state.focusedPane;
  const stack = stackOf(state.root, id);
  if (focused !== id || stack === null) return focused;
  const shown = new Set(shownPanes(next).map((pane) => pane.id));
  const at = stack.children.findIndex((pane) => pane.id === id);
  const nearest = [
    ...stack.children.slice(at + 1),
    ...stack.children.slice(0, at).reverse(),
  ].find((pane) => shown.has(pane.id));
  return nearest?.id ?? focused;
}

function hasId(node: LayoutNode, id: string): boolean {
  return (
    node.id === id ||
    (node.type !== 'pane' && node.children.some((child) => hasId(child, id)))
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
  if (node.type === 'stack') {
    const tabs = node.children.map((child) => copyAndFreeze(child) as PaneNode);
    if (Object.isFrozen(node) && sameNodes(tabs, node.children)) return node;
    return Object.freeze({ ...node, children: Object.freeze(tabs) });
  }
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
  } else if (node.type === 'stack') {
    node.children.forEach(freezeNew);
    Object.freeze(node.children);
  }
  return Object.freeze(node);
}
