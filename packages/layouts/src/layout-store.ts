// The store of the `Layout` component: a class with every command, over
// `createLayoutStore` with every store feature. It keeps the API of the earlier
// store, so that apps and their subclasses keep working until they move to
// `createLayoutStore` and its features.
import { type EditCommands, edits } from './edits';
import { type HiddenPaneCommands, hiddenPanes } from './hidden-panes';
import type { LayoutChange } from './layout-operation';
import { naryTree } from './models/n-ary';
import { persistence, type PersistenceCommands } from './persistence';
import { type StackCommands, stacks } from './stacks';
import {
  type ContextOfStore,
  createLayoutStore,
  STORE_CONTEXT,
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
import { zoom, type ZoomCommands } from './zoom';

export interface LayoutStoreOptions {
  /**
   * The rules of the tree's shape, and how a split and a close change it.
   * `naryTree` by default.
   */
  model?: TreeModel;
}

type AllFeatures = [
  StoreFeature<EditCommands>,
  StoreFeature<StackCommands>,
  StoreFeature<ZoomCommands>,
  StoreFeature<HiddenPaneCommands>,
  StoreFeature<PersistenceCommands>,
];

/** Own immutable layout state and notify adapters without coupling the model to a UI framework. */
export class LayoutStore {
  readonly getSnapshot: () => LayoutState;
  readonly subscribe: (listener: (change: LayoutChange) => void) => () => void;
  private readonly store: StoreWith<AllFeatures>;

  constructor(root: LayoutNode, options: LayoutStoreOptions = {}) {
    this.store = createLayoutStore(root, [
      edits(options.model ?? naryTree),
      stacks,
      zoom,
      hiddenPanes,
      persistence,
    ]);
    this.getSnapshot = this.store.getSnapshot;
    this.subscribe = this.store.subscribe;
    // The context of the store, for `applyOperations`.
    (this as unknown as Record<symbol, unknown>)[STORE_CONTEXT] = (
      this.store as unknown as ContextOfStore
    )[STORE_CONTEXT];
  }

  /** Set the tree. A tree of another shape takes the shape of the model. */
  setRoot(root: LayoutNode): void {
    this.store.setRoot(root);
  }

  focusPane(id: string): void {
    this.store.focusPane(id);
  }

  /** Zoom a pane, or restore it. A pane of a stack also becomes active. */
  toggleZoom(id?: string): void {
    this.store.toggleZoom(id);
  }

  /**
   * Show a pane of a stack. It takes the focus, and the zoom when the zoomed
   * pane is in the same stack.
   */
  activate(id: string): void {
    this.store.activate(id);
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
    this.store.addTab(targetId, pane, index, options);
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
    this.store.moveToStack(sourceId, targetId, index, options);
  }

  /**
   * Move a pane to `index` among the tabs of its stack: the index in the
   * order of the other tabs, hidden ones included, from 0 to their number.
   * The pane shows and keeps the focus, and the zoom of its stack.
   */
  moveTab(id: string, index: number): void {
    this.store.moveTab(id, index);
  }

  split(targetId: string, pane: PaneNode, edge: Edge = 'right'): void {
    this.store.split(targetId, pane, edge);
  }

  /**
   * Remove a pane. The close of the last pane that is not hidden throws
   * `last_pane`: check `canClose` first.
   */
  close(id: string): void {
    this.store.close(id);
  }

  /**
   * Hide a pane or show it again. A hidden pane keeps its place in the tree,
   * its content, and its state, but takes no space. The hide of the last pane
   * that is not hidden throws `last_pane`. A pane that shows again gets the
   * focus, and becomes the active pane of its stack.
   */
  setHidden(id: string, hidden: boolean): void {
    this.store.setHidden(id, hidden);
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

  /** Run commands whose changes are transient, as `CoreLayoutStore.transient` does. */
  transient(run: () => void): void {
    this.store.transient(run);
  }

  /** Go back to the settled state, in a transient change. */
  revert(): void {
    this.store.revert();
  }

  serialize(): string {
    return this.store.serialize();
  }

  /** Return the tree without the window's focus and zoom state. */
  toStoredTree(): StoredLayoutTree {
    return this.store.toStoredTree();
  }

  setStoredTree(tree: StoredLayoutTree): void {
    this.setRoot(tree.root);
  }

  /**
   * Restore a layout from `serialize`, in one change. Version 3 added stacks.
   * A layout of version 2 has the same form with no stack. A layout of
   * version 1, where each split had two children, converts. The tree takes the
   * shape of the model.
   */
  restore(serialized: string): void {
    this.store.restore(serialized);
  }
}
