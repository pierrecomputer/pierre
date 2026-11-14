// The store of the `Layout` component: a class with every command, over
// `createLayoutStore`. It keeps the API of the earlier store, so that apps and
// their subclasses keep working until they move to `createLayoutStore` and its
// features.
import { type EditCommands, edits } from './edits';
import { activatePane, getPanes, setPaneHidden, stackOf } from './model';
import { binaryTree } from './models/binary';
import { type BinaryLayoutNode, fromBinaryLayout } from './persistence-model';
import { addToStack, moveTabTo } from './stacks-model';
import {
  createLayoutStore,
  focusAfterLeaving,
  type StoreContext,
  type StoreFeature,
  type StoreWith,
} from './store';
import type {
  ChildSize,
  Edge,
  LayoutNode,
  LayoutState,
  PaneNode,
  StoredLayoutTree,
  TabOptions,
  TreeModel,
} from './types';

export interface LayoutStoreOptions {
  /**
   * The rules of the tree's shape, and how a split and a close change it:
   * `binaryTree` (the default) or `naryTree`.
   */
  model?: TreeModel;
}

/**
 * A tree model that calls the current model of a `LayoutStore`, so that
 * `setModel` can change the model of the store that the class wraps.
 */
function currentModel(get: () => TreeModel): TreeModel {
  return {
    get name() {
      return get().name;
    },
    validate: (root) => get().validate(root),
    normalize: (root, nextId) => get().normalize(root, nextId),
    split: (root, targetId, pane, edge, nextId) =>
      get().split(root, targetId, pane, edge, nextId),
    remove: (root, id) => get().remove(root, id),
  };
}

/** Own immutable layout state and notify adapters without coupling the model to a UI framework. */
export class LayoutStore {
  readonly getSnapshot: () => LayoutState;
  readonly subscribe: (listener: () => void) => () => void;
  private model: TreeModel;
  private readonly store: StoreWith<[StoreFeature<EditCommands>]>;
  private readonly context: StoreContext;

  constructor(root: LayoutNode, options: LayoutStoreOptions = {}) {
    this.model = options.model ?? binaryTree;
    const kept: { context?: StoreContext } = {};
    // A feature with no commands, which keeps the store's context for the
    // commands of this class.
    const keepContext: StoreFeature = {
      commands: (context) => {
        kept.context = context;
        return {};
      },
    };
    this.store = createLayoutStore(root, [
      edits(currentModel(() => this.model)),
      keepContext,
    ]);
    this.context = kept.context!;
    this.getSnapshot = this.store.getSnapshot;
    this.subscribe = this.store.subscribe;
  }

  getModel(): TreeModel {
    return this.model;
  }

  /** Change the tree model, and give the tree the shape of the new model. */
  setModel(model: TreeModel): void {
    if (model === this.model) return;
    const previous = this.model;
    this.model = model;
    try {
      this.store.setRoot(this.getSnapshot().root);
    } catch (error) {
      this.model = previous;
      throw error;
    }
  }

  /** Set the tree. A tree of another shape takes the shape of the model. */
  setRoot(root: LayoutNode): void {
    this.store.setRoot(root);
  }

  focusPane(id: string): void {
    this.store.focusPane(id);
  }

  /** Zoom a pane, or restore it. A pane of a stack also becomes active. */
  toggleZoom(id: string = this.getSnapshot().focusedPane): void {
    const { get, commit, requirePane } = this.context;
    requirePane(id);
    const state = get();
    const restore = state.zoomedPane === id;
    commit({
      root:
        restore || stackOf(state.root, id) === null
          ? state.root
          : activatePane(state.root, id),
      focusedPane: id,
      zoomedPane: restore ? null : id,
    });
  }

  /**
   * Show a pane of a stack. It takes the focus, and the zoom when the zoomed
   * pane is in the same stack.
   */
  activate(id: string): void {
    const { get, commit, requirePane } = this.context;
    requirePane(id);
    const state = get();
    const stack = stackOf(state.root, id);
    if (stack === null) throw new Error(`Pane not in a stack: ${id}`);
    const zoomed = state.zoomedPane;
    commit({
      root: activatePane(state.root, id),
      focusedPane: id,
      zoomedPane:
        zoomed !== null && stack.children.some((child) => child.id === zoomed)
          ? id
          : zoomed,
    });
  }

  /**
   * Add a new pane as a tab of a target pane, at `index` among the tabs of
   * its stack, or after the target. A target that is not in a stack gets a
   * stack in its place. The new pane shows and takes the focus unless
   * `activate` is false.
   */
  addTab(
    targetId: string,
    pane: PaneNode,
    index?: number,
    options: TabOptions = {}
  ): void {
    const { get, commit, requirePane, nextId } = this.context;
    requirePane(targetId);
    const state = get();
    const activate = options.activate ?? true;
    const root = addToStack(
      state.root,
      targetId,
      { ...pane },
      nextId(state.root, 'stack'),
      index,
      activate
    );
    commit(
      activate
        ? {
            root,
            focusedPane: pane.id,
            zoomedPane: zoomAfterTab(state, targetId, pane.id),
          }
        : { ...state, root }
    );
  }

  /**
   * Move a pane into the stack of a target pane, at `index` among its tabs, or
   * after the target. A move inside one stack changes the order of its tabs.
   * With `activate: false`, the destination keeps its active tab.
   */
  moveToStack(
    sourceId: string,
    targetId: string,
    index?: number,
    options: TabOptions = {}
  ): void {
    const { get, commit, requirePane, nextId } = this.context;
    requirePane(sourceId);
    requirePane(targetId);
    if (sourceId === targetId) return;
    const state = get();
    const activate = options.activate ?? true;
    const current = state.root;
    const source = getPanes(current).find(({ id }) => id === sourceId)!;
    const stack = stackOf(current, sourceId);
    let root: LayoutNode;
    if (stack !== null && stack === stackOf(current, targetId)) {
      // Keep the stack, and put the source at its new place among the tabs.
      const others = stack.children.filter(({ id }) => id !== sourceId);
      root = moveTabTo(
        current,
        sourceId,
        index ?? others.findIndex(({ id }) => id === targetId) + 1,
        activate
      );
    } else {
      const remaining = this.model.remove(current, sourceId);
      if (remaining === null) return;
      root = addToStack(
        remaining,
        targetId,
        source,
        nextId(current, 'stack'),
        index,
        activate
      );
    }
    commit(
      activate
        ? { root, focusedPane: sourceId, zoomedPane: null }
        : {
            ...state,
            root,
            focusedPane: focusAfterLeaving(state, sourceId, root),
          }
    );
  }

  /**
   * Move a pane to `index` among the tabs of its stack: the index in the
   * order of the other tabs, hidden ones included, from 0 to their number.
   * The pane shows and keeps the focus, and the zoom of its stack.
   */
  moveTab(id: string, index: number): void {
    const { get, commit, requirePane } = this.context;
    requirePane(id);
    const state = get();
    const root = moveTabTo(state.root, id, index);
    if (root === state.root) return;
    const zoomed = state.zoomedPane;
    const stack = stackOf(root, id);
    commit({
      root,
      focusedPane: id,
      zoomedPane:
        zoomed !== null &&
        stack?.children.some((pane) => pane.id === zoomed) === true
          ? id
          : zoomed,
    });
  }

  split(targetId: string, pane: PaneNode, edge: Edge = 'right'): void {
    this.store.split(targetId, pane, edge);
  }

  close(id: string): void {
    this.store.close(id);
  }

  /**
   * Hide a pane or show it again. A hidden pane keeps its place in the tree,
   * its content, and its state, but takes no space. The last visible pane
   * stays visible. A pane that shows again gets the focus, and becomes the
   * active pane of its stack.
   */
  setHidden(id: string, hidden: boolean): void {
    const { get, commit, requirePane } = this.context;
    requirePane(id);
    const state = get();
    const visible = getPanes(state.root).filter((pane) => pane.hidden !== true);
    if (hidden && visible.length === 1 && visible[0].id === id) return;
    let root = setPaneHidden(state.root, id, hidden);
    if (!hidden && stackOf(root, id) !== null) root = activatePane(root, id);
    if (root === state.root) return;
    commit({
      ...state,
      root,
      focusedPane: hidden ? focusAfterLeaving(state, id, root) : id,
    });
  }

  /**
   * Collapse a pane to its `collapsedSize` along its split, or expand it to
   * its size in the split again. A pane of a stack collapses its stack. The
   * pane at the root fills the layout, so it does not collapse.
   */
  setCollapsed(id: string, collapsed: boolean): void {
    this.store.setCollapsed(id, collapsed);
  }

  /**
   * Move a pane to one edge of another pane. A target in a stack takes the
   * pane beside the whole stack. A pane of a stack leaves its stack.
   */
  move(sourceId: string, targetId: string, edge: Edge): void {
    this.store.move(sourceId, targetId, edge);
  }

  /**
   * Set the sizes of splits, by split ID: one positive weight for each child
   * of the split, as in `SplitNode.sizes`.
   */
  setSizes(sizes: Readonly<Record<string, readonly ChildSize[]>>): void {
    this.store.setSizes(sizes);
  }

  serialize(): string {
    return JSON.stringify({ version: 3, ...this.getSnapshot() });
  }

  /** Return the tree without the window's focus and zoom state. */
  toStoredTree(): StoredLayoutTree {
    return Object.freeze({ version: 3, root: this.getSnapshot().root });
  }

  setStoredTree(tree: StoredLayoutTree): void {
    this.setRoot(tree.root);
  }

  /**
   * Restore a layout from `serialize`. Version 3 added stacks. A layout of
   * version 2 has the same form with no stack. A layout of version 1, where
   * each split had two children, converts. The tree takes the shape of the
   * model.
   */
  restore(serialized: string): void {
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
    const root =
      value.version === 1
        ? fromBinaryLayout(value.root as BinaryLayoutNode)
        : (value.root as LayoutNode);
    this.context.commit({
      root: this.context.own(root),
      focusedPane: value.focusedPane,
      zoomedPane: value.zoomedPane,
    });
  }
}

/**
 * The zoom after a new tab: the new tab takes the zoom of its stack or of its
 * target. A zoom of another pane ends, so that the new tab shows.
 */
function zoomAfterTab(
  state: LayoutState,
  targetId: string,
  paneId: string
): string | null {
  const zoomed = state.zoomedPane;
  if (zoomed === null) return null;
  const stack = stackOf(state.root, targetId);
  const same =
    zoomed === targetId ||
    (stack !== null && stack.children.some(({ id }) => id === zoomed));
  return same ? paneId : null;
}
