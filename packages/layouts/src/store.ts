import type {
  LayoutChange,
  LayoutOperation,
  LayoutTreeOperation,
} from './layout-operation';
import { LayoutOperationError } from './layout-operation';
import {
  findNode,
  focusablePanes,
  paneIn,
  parentOf,
  replaceNode,
  sameNodes,
  setNodeCollapsed,
  shownPanes,
  slotOf,
  stackOf,
} from './model';
import type {
  CanPlace,
  ChildSize,
  LayoutNode,
  LayoutState,
  PaneNode,
  Place,
  TreeModel,
} from './types';
import { validateLayout } from './validate';

/**
 * The commands that every store has: the state, the tree, sizes, collapse, and
 * focus. The features of a store add the other commands.
 */
export interface CoreLayoutStore {
  getSnapshot(): LayoutState;
  /**
   * Call a listener after each change, with the operations of the change and
   * its origin. A change with no operations is transient, such as a frame of
   * a resize drag: a listener that skips them sees one change for each user
   * action.
   */
  subscribe(listener: (change: LayoutChange) => void): () => void;
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
  /**
   * Give a pane the focus of the layout. With `reveal`, the view also moves
   * the DOM focus into the pane: to the element that had it last, else to its
   * `Layout.Content`, else to its host. A pane that cannot take the focus
   * does not get it: a pane that does not show, a pane collapsed to 0
   * pixels, and a pane that an overlay covers (`coverLayout`).
   */
  focusPane(id: string, options?: { readonly reveal?: boolean }): void;
  /**
   * Move the focus, with the DOM focus, to the next pane that can take it, in
   * `visualOrder`, from the last to the first. False when no other pane can
   * take it: one pane can, or a pane fills the layout. F6 uses it.
   */
  focusNext(): boolean;
  /** As `focusNext`, to the previous pane, from the first to the last. */
  focusPrevious(): boolean;
  /**
   * Run commands whose changes are transient: the listeners get them with no
   * operations, and the store keeps the settled state from before them. A
   * gesture changes the layout in each frame this way, then ends with one
   * command, or with `revert`.
   */
  transient(run: () => void): void;
  /** Go back to the settled state, in a transient change. */
  revert(): void;
}

/** What a fold uses besides the tree and the operation. */
export interface FoldContext {
  /** The tree model of the store, or null when no feature gives one. */
  readonly model: TreeModel | null;
  /** A new ID, for an operation that makes a node and carries no ID. */
  newId(kind: 'split' | 'stack'): string;
  /** A tree from a caller, with the shape of the model, as nodes that the store owns. */
  own(root: LayoutNode): LayoutNode;
  /**
   * Throw `place_refused` when the app's rule refuses a place for a pane, on
   * the tree that the operation folds.
   */
  requirePlace(source: PaneNode, place: Place, root: LayoutNode): void;
}

/**
 * The change that one operation makes to a tree: the same change for the
 * command of a store and for a server. It throws `LayoutOperationError` for an
 * operation that the tree refuses.
 */
export type Fold<T extends LayoutTreeOperation = LayoutTreeOperation> = (
  root: LayoutNode,
  operation: T,
  context: FoldContext
) => LayoutNode;

/** The folds of a feature, one for each type of operation that it makes. */
export type Folds = {
  readonly [T in LayoutTreeOperation['type']]?: Fold<
    Extract<LayoutTreeOperation, { type: T }>
  >;
};

/** What a store feature uses to build its commands. */
export interface StoreContext {
  /** The current state. */
  get(): LayoutState;
  /** The folds of the store: the core's and its features'. */
  readonly folds: Folds;
  /** The state after the last change that was not transient. */
  settled(): LayoutState;
  /**
   * The tree after a tree operation: the fold of the operation, on the
   * current tree or on `root`. It throws as the fold does. The store must
   * have the fold of the operation.
   */
  fold(operation: LayoutTreeOperation, root?: LayoutNode): LayoutNode;
  /**
   * Make a state the current state with the operations that made it, and
   * notify the listeners. The tree of `next` holds only nodes that the store
   * owns. The store validates a new tree, freezes its new nodes, and moves the
   * focus to a pane that shows. A tree operation that changes no tree is left
   * out, a focus change with no tree change gives a `focus` operation, and a
   * change that changes nothing notifies no listener.
   *
   * The commit owns the rules of the zoom. A zoom that `next` sets stays on a
   * pane that shows. A zoom that `next` carries from the current state
   * follows the tab that shows in the stack of the zoomed pane. A local
   * structural edit ends it: `placed`, the pane that the change puts in a new
   * place (a new pane, or a pane that moves), is the zoomed pane, or it shows
   * outside the zoom. A remote change ends it only when the zoomed pane stops
   * showing.
   */
  commit(
    next: LayoutState,
    operations: readonly LayoutOperation[],
    origin?: LayoutChange['origin'],
    placed?: string
  ): void;
  /** The tree model of the store, or null when no feature gives one. */
  model(): TreeModel | null;
  /** Throw `pane_not_found` unless the current tree holds the pane. */
  requirePane(id: string): void;
  /**
   * A tree from a caller, with the shape of the model, as nodes that the
   * store owns: copied and frozen, except the nodes that the store owns
   * already.
   */
  own(root: LayoutNode): LayoutNode;
  /** A new split or stack ID: `<kind>-<random prefix of the store>-<count>`. */
  newId(kind: 'split' | 'stack'): string;
  /** False when the app's rule refuses a place for a pane, in the current state. */
  canPlace(source: PaneNode, place: Place): boolean;
  /**
   * Add the rule of a view for the panes that its overlays cover: they take
   * no focus. It returns a function that removes the rule.
   */
  coverFocus(covered: (id: string) => boolean): () => void;
  /**
   * `focusNext` (`by` 1) or `focusPrevious` (`by` -1) for a view. At an end of
   * the order, `wrap` can refuse to go around: then the focus stays, and the
   * step still returns true.
   */
  focusStep(by: 1 | -1, wrap?: () => boolean): boolean;
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
  /** The folds of the operations of the commands. */
  readonly folds?: Folds;
  /**
   * The maker of the new IDs of the store, for a feature that makes nodes:
   * `randomIds`. The first feature that has one gives it to the store.
   */
  readonly ids?: () => (kind: 'split' | 'stack') => string;
}

export interface CreateLayoutStoreOptions {
  /**
   * The maker of new split and stack IDs, for a test or a server. By
   * default, the maker of the features (`randomIds`):
   * `<kind>-<prefix>-<count>`, with 8 random characters of prefix for each
   * store.
   */
  readonly newId?: (kind: 'split' | 'stack') => string;
  /** The app's rule for places, which the folds of the store read. */
  readonly canPlace?: CanPlace;
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
 * The key of a store's context, for `applyOperations`, which a bundler keeps
 * only when an app imports it. A copy of the store with a spread keeps it.
 */
export const STORE_CONTEXT: unique symbol = /* @__PURE__ */ Symbol();

/** A store, with the context that `applyOperations` uses. */
export interface ContextOfStore {
  readonly [STORE_CONTEXT]: StoreContext;
}

// The folds of the core commands.
const CORE_FOLDS: Folds = {
  setRoot: (_root, { root }, { own }) => own(root),
  resize(root, { sizes }) {
    let next = root;
    for (const [id, values] of Object.entries(sizes)) {
      // `applyOperations` checks the splits and the sizes of an operation
      // from elsewhere.
      const node = findNode(next, id);
      // Sizes that do not change keep the tree, so the change has no operation.
      if (
        node?.type === 'split' &&
        JSON.stringify(values) !== JSON.stringify(node.sizes)
      )
        next = replaceNode(next, id, () => ({ ...node, sizes: [...values] }));
    }
    return next;
  },
  collapse(root, { pane, collapsed }) {
    paneIn(root, pane);
    const slot = slotOf(root, pane);
    return parentOf(root, slot) === null
      ? root
      : setNodeCollapsed(root, slot, collapsed);
  },
};

/**
 * Create a store that owns an immutable layout state and notifies views. The
 * features give the store its other commands and its tree model, for example
 * `createLayoutStore(root, [edits(naryTree)])`. Each change reaches the
 * listeners with its operations, so an app syncs, announces, or keeps an undo
 * history with `subscribe`.
 */
export function createLayoutStore<const F extends readonly StoreFeature[] = []>(
  initial: LayoutNode,
  features?: F,
  options: CreateLayoutStoreOptions = {}
): StoreWith<F> {
  const list: readonly StoreFeature[] = features ?? [];
  const model = list.find((feature) => feature.model !== undefined)?.model;
  const folds: Folds = Object.assign(
    {},
    CORE_FOLDS,
    ...list.map((feature) => feature.folds)
  );
  const listeners = new Set<(change: LayoutChange) => void>();
  let count = 0;
  // While above 0, each commit is transient.
  let transientDepth = 0;

  // A store whose features make no node keeps a plain count.
  const newId =
    options.newId ??
    list.find((feature) => feature.ids !== undefined)?.ids?.() ??
    ((kind: 'split' | 'stack'): string => `${kind}-${++count}`);
  // Give a tree the shape of the model, and validate it. The checks of
  // `validateLayout` come first, so that the model gets a sound tree.
  const shape = (root: LayoutNode): LayoutNode => {
    validateLayout(root);
    if (model === undefined) return root;
    const shaped = model.normalize(root, () => newId('split'));
    model.validate(shaped);
    return shaped;
  };
  const own = (root: LayoutNode): LayoutNode => copyAndFreeze(shape(root));
  // The app's rule, on the state with the tree that an operation folds.
  const allows = (
    source: PaneNode,
    place: Place,
    root: LayoutNode = state.root
  ): boolean => options.canPlace?.(source, place, { ...state, root }) ?? true;
  const foldContext: FoldContext = {
    model: model ?? null,
    newId,
    own,
    requirePlace(source, place, root) {
      if (!allows(source, place, root))
        throw new LayoutOperationError('place_refused', source.id);
    },
  };

  const initialRoot = own(initial);
  let state: LayoutState = Object.freeze({
    root: initialRoot,
    focusedPane: (focusablePanes(initialRoot)[0] ?? shownPanes(initialRoot)[0])
      .id,
    zoomedPane: null,
  });
  // The state after the last change that was not transient.
  let settled = state;
  const get = (): LayoutState => state;
  const notify = (
    operations: readonly LayoutOperation[],
    origin: LayoutChange['origin']
  ): void => {
    const change: LayoutChange = { operations, origin };
    for (const listener of [...listeners]) listener(change);
  };
  // A command runs the fold of its own operation; `applyOperations` checks an
  // operation from elsewhere first.
  const fold = (
    operation: LayoutTreeOperation,
    root: LayoutNode = state.root
  ): LayoutNode =>
    (folds[operation.type] as Fold)(root, operation, foldContext);
  const commit = (
    next: LayoutState,
    operations: readonly LayoutOperation[],
    origin: LayoutChange['origin'] = 'local',
    placed?: string
  ): void => {
    const sameTree = next.root === state.root;
    if (!sameTree) (model?.validate ?? validateLayout)(next.root);
    // Zoom belongs to a pane that shows, and focus to a pane that can take
    // it: the pane of `next`, else the pane that has it, else the first.
    const panes = shownPanes(next.root);
    const focusable = focusablePanes(next.root);
    const takes = (id: string): boolean =>
      focusable.some((pane) => pane.id === id);
    const shows = (id: string | null): boolean =>
      panes.some((pane) => pane.id === id);
    let zoomed = next.zoomedPane;
    if (zoomed !== null && zoomed === state.zoomedPane && !sameTree) {
      // A zoomed stack follows the tab that shows.
      zoomed = stackOf(next.root, zoomed)?.active ?? zoomed;
      // A local structural edit that moves the zoomed pane, or that shows a
      // pane in a new place outside the zoom, ends it. A remote change names
      // no placed pane, so it keeps the zoom while the zoomed pane shows.
      if (
        placed === state.zoomedPane ||
        (placed !== undefined && placed !== zoomed && shows(placed))
      )
        zoomed = null;
    }
    const focusedPane = takes(next.focusedPane)
      ? next.focusedPane
      : takes(state.focusedPane)
        ? state.focusedPane
        : (focusable[0] ?? panes[0]).id;
    const zoomedPane = shows(zoomed) ? zoomed : null;
    // `focusPane` with `reveal` gives its focus operation: a change, also on
    // the focused pane, as the view moves the DOM focus.
    const reveal = operations.find((operation) => operation.type === 'focus');
    if (
      sameTree &&
      reveal === undefined &&
      focusedPane === state.focusedPane &&
      zoomedPane === state.zoomedPane
    )
      return;
    let list = sameTree
      ? operations.filter((operation) => operation.type === 'zoom')
      : operations;
    if (sameTree && (reveal !== undefined || focusedPane !== state.focusedPane))
      list = [reveal ?? { type: 'focus', pane: focusedPane }, ...list];
    state = Object.freeze({
      root: sameTree ? next.root : freezeNew(next.root),
      focusedPane,
      zoomedPane,
    });
    if (transientDepth > 0) list = [];
    else settled = state;
    notify(list, origin);
  };
  const requirePane = (id: string): void => {
    paneIn(state.root, id);
  };
  // The rules of the views for the panes that their overlays cover.
  const covers = new Set<(id: string) => boolean>();
  // The panes that can take the focus, in order: the panes of the tree that
  // can, without the panes that an overlay covers.
  const focusOrder = (): PaneNode[] =>
    focusablePanes(state.root).filter(
      ({ id }) => ![...covers].some((covered) => covered(id))
    );
  // The pane `by` places from the focused pane in the focus order, with the
  // DOM focus. No step while a pane fills the layout.
  const focusStep = (by: 1 | -1, wrap?: () => boolean): boolean => {
    const order = focusOrder();
    if (state.zoomedPane !== null || order.length < 2) return false;
    const at = order.findIndex(({ id }) => id === state.focusedPane);
    // From a pane outside the order, the step starts at an end.
    const next = at === -1 ? (by > 0 ? 0 : order.length - 1) : at + by;
    if ((next < 0 || next === order.length) && wrap?.() === false) return true;
    store.focusPane(order[(next + order.length) % order.length].id, {
      reveal: true,
    });
    return true;
  };
  const context: StoreContext = {
    get,
    folds,
    settled: () => settled,
    fold,
    commit,
    model: () => model ?? null,
    requirePane,
    own,
    newId,
    canPlace: (source, place) => allows(source, place),
    coverFocus(covered) {
      covers.add(covered);
      return () => {
        covers.delete(covered);
      };
    },
    focusStep,
  };

  const store: CoreLayoutStore & ContextOfStore = {
    [STORE_CONTEXT]: context,
    getSnapshot: get,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRoot(root) {
      const operation: LayoutTreeOperation = {
        type: 'setRoot',
        root: own(root),
      };
      commit({ ...state, root: operation.root }, [operation]);
    },
    setSizes(sizes) {
      const operation: LayoutTreeOperation = { type: 'resize', sizes };
      commit({ ...state, root: fold(operation) }, [operation]);
    },
    setCollapsed(id, collapsed) {
      const operation: LayoutTreeOperation = {
        type: 'collapse',
        pane: id,
        collapsed,
      };
      commit({ ...state, root: fold(operation) }, [operation]);
    },
    focusPane(id, options) {
      requirePane(id);
      if (!focusOrder().some((pane) => pane.id === id)) return;
      commit(
        { ...state, focusedPane: id },
        options?.reveal === true
          ? [{ type: 'focus', pane: id, reveal: true }]
          : []
      );
    },
    focusNext: () => focusStep(1),
    focusPrevious: () => focusStep(-1),
    transient(run) {
      transientDepth += 1;
      try {
        run();
      } finally {
        transientDepth -= 1;
      }
    },
    revert() {
      if (state === settled) return;
      state = settled;
      notify([], 'local');
    },
  };
  for (const feature of list) Object.assign(store, feature.commands(context));
  return store as unknown as StoreWith<F>;
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
