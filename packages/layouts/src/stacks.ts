// Stacks of panes with tabs: the store commands that show, add, and move tabs.
// A move of a tab into another stack takes the pane out of its place with the
// tree model of the store, so it needs `edits`. The store commit moves the
// zoom of a stack to the tab that shows.
import { activatePane, getPanes, stackOf } from './model';
import { addToStack, moveTabTo } from './stacks-model';
import { focusAfterLeaving, type StoreFeature } from './store';
import type { LayoutNode, PaneNode, TabOptions } from './types';

export interface StackCommands {
  /**
   * Show a pane of a stack. It takes the focus, and the zoom when the zoomed
   * pane is in the same stack. A pane outside a stack, whose tab is its own,
   * takes the focus.
   */
  activate(id: string): void;
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
    options?: TabOptions
  ): void;
  /**
   * Move a pane into the stack of a target pane, at `index` among its tabs, or
   * after the target. A move inside one stack changes the order of its tabs.
   * With `activate: false`, the destination keeps its active tab.
   */
  moveToStack(
    sourceId: string,
    targetId: string,
    index?: number,
    options?: TabOptions
  ): void;
  /**
   * Move a pane to `index` among the tabs of its stack: the index in the
   * order of the other tabs, hidden ones included, from 0 to their number.
   * The pane shows and keeps the focus, and the zoom of its stack.
   */
  moveTab(id: string, index: number): void;
}

/** The tab commands of a store. */
export const stacks: StoreFeature<StackCommands> = {
  commands: ({ get, commit, model, requirePane, nextId }) => ({
    activate(id) {
      requirePane(id);
      const state = get();
      if (stackOf(state.root, id) === null) {
        if (state.focusedPane !== id) commit({ ...state, focusedPane: id });
      } else
        commit({
          ...state,
          root: activatePane(state.root, id),
          focusedPane: id,
        });
    },
    addTab(targetId, pane, index, options = {}) {
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
          ? { ...state, root, focusedPane: pane.id }
          : { ...state, root },
        pane.id
      );
    },
    moveToStack(sourceId, targetId, index, options = {}) {
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
        const tree = model();
        if (tree === null)
          throw new Error('A move into another stack needs a tree model');
        const remaining = tree.remove(current, sourceId);
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
        {
          ...state,
          root,
          focusedPane: activate
            ? sourceId
            : focusAfterLeaving(state, sourceId, root),
        },
        sourceId
      );
    },
    moveTab(id, index) {
      requirePane(id);
      const state = get();
      const root = moveTabTo(state.root, id, index);
      if (root === state.root) return;
      commit({ ...state, root, focusedPane: id });
    },
  }),
};
