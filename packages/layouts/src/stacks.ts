// Stacks of panes with tabs: the store commands that show, add, and move tabs,
// and the folds of their operations. A move of a tab into another stack takes
// the pane out of its place with the tree model of the store, so it needs
// `edits`. The store commit moves the zoom of a stack to the tab that shows.
import { randomIds } from './ids';
import { LayoutOperationError } from './layout-operation';
import { foldActivate, paneIn, requireNewPane, stackOf } from './model';
import { addToStack, moveTabTo, pinPane } from './stacks-model';
import { focusAfterLeaving, type StoreFeature } from './store';
import type { PaneNode, TabOptions } from './types';

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
   * With `activate: false`, the destination keeps its active tab. A pinned
   * pane of a stack does not leave it: the move throws `pane_pinned`.
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
  /**
   * Pin a pane, or unpin it. A pinned tab comes before the other tabs of its
   * stack and stays in it. The pane goes to the end of the pinned run: the
   * last pinned tab, or the first tab after the pinned ones.
   */
  setPinned(id: string, pinned: boolean): void;
}

/** The tab commands of a store. */
export const stacks: StoreFeature<StackCommands> = {
  ids: randomIds,
  folds: {
    activate: foldActivate,
    addTab(root, { target, pane, index, activate, id }, { newId }) {
      paneIn(root, target);
      requireNewPane(root, pane);
      return addToStack(
        root,
        target,
        { ...pane },
        id ?? newId('stack'),
        index,
        activate
      );
    },
    moveToStack(root, { pane, target, index, activate, id }, { model, newId }) {
      const source = paneIn(root, pane);
      paneIn(root, target);
      if (pane === target) return root;
      const stack = stackOf(root, pane);
      if (stack !== null && stack === stackOf(root, target)) {
        // Keep the stack, and put the source at its new place among the tabs.
        const others = stack.children.filter(({ id }) => id !== pane);
        return moveTabTo(
          root,
          pane,
          index ?? others.findIndex(({ id }) => id === target) + 1,
          activate
        );
      }
      if (source.pinned === true && stack !== null)
        throw new LayoutOperationError('pane_pinned', pane);
      if (model === null)
        throw new LayoutOperationError(
          'unknown_operation',
          'A move into another stack needs a tree model'
        );
      const remaining = model.remove(root, pane);
      return remaining === null
        ? root
        : addToStack(
            remaining,
            target,
            source,
            id ?? newId('stack'),
            index,
            activate
          );
    },
    moveTab(root, { pane, index }) {
      paneIn(root, pane);
      return moveTabTo(root, pane, index);
    },
    setPinned(root, { pane, pinned }) {
      paneIn(root, pane);
      return pinPane(root, pane, pinned);
    },
  },
  commands: ({ get, fold, commit, newId }) => ({
    activate(id) {
      const operation = { type: 'activate', pane: id } as const;
      commit({ ...get(), root: fold(operation), focusedPane: id }, [operation]);
    },
    addTab(targetId, pane, index, options = {}) {
      const state = get();
      const activate = options.activate ?? true;
      // The operation holds its own copy of the caller's pane.
      const operation = {
        type: 'addTab',
        target: targetId,
        pane: { ...pane },
        index,
        activate,
        id: newId('stack'),
      } as const;
      const root = fold(operation);
      commit(
        activate
          ? { ...state, root, focusedPane: pane.id }
          : { ...state, root },
        [operation],
        'local',
        pane.id
      );
    },
    moveToStack(sourceId, targetId, index, options = {}) {
      const state = get();
      const activate = options.activate ?? true;
      const operation = {
        type: 'moveToStack',
        pane: sourceId,
        target: targetId,
        index,
        activate,
        id: newId('stack'),
      } as const;
      const root = fold(operation);
      if (root === state.root) return;
      commit(
        {
          ...state,
          root,
          focusedPane: activate
            ? sourceId
            : focusAfterLeaving(state, sourceId, root),
        },
        [operation],
        'local',
        sourceId
      );
    },
    moveTab(id, index) {
      const state = get();
      const operation = { type: 'moveTab', pane: id, index } as const;
      const root = fold(operation);
      if (root === state.root) return;
      commit({ ...state, root, focusedPane: id }, [operation]);
    },
    setPinned(id, pinned) {
      const state = get();
      const operation = { type: 'setPinned', pane: id, pinned } as const;
      const root = fold(operation);
      if (root !== state.root) commit({ ...state, root }, [operation]);
    },
  }),
};
