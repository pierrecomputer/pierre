// Hidden panes: the store command that hides a pane, which keeps its place,
// its content, and its state, and takes no space, and the fold of `hide`.
import { LayoutOperationError } from './layout-operation';
import {
  activatePane,
  canClose,
  paneIn,
  setPaneHidden,
  stackOf,
} from './model';
import { focusAfterLeaving, type StoreFeature } from './store';

export interface HiddenPaneCommands {
  /**
   * Hide a pane or show it again. A hidden pane keeps its place in the tree,
   * its content, and its state, but takes no space. A layout needs a pane
   * that is not hidden, so the hide of the last one throws `last_pane`: check
   * `canClose` first. A pane that shows again gets the focus, and becomes the
   * active pane of its stack.
   */
  setHidden(id: string, hidden: boolean): void;
}

/** The hide command of a store. */
export const hiddenPanes: StoreFeature<HiddenPaneCommands> = {
  folds: {
    hide(root, { pane, hidden }) {
      paneIn(root, pane);
      if (hidden && !canClose(root, pane))
        throw new LayoutOperationError('last_pane', pane);
      const next = setPaneHidden(root, pane, hidden);
      return !hidden && stackOf(next, pane) !== null
        ? activatePane(next, pane)
        : next;
    },
  },
  commands: ({ get, fold, commit }) => ({
    setHidden(id, hidden) {
      const state = get();
      const operation = { type: 'hide', pane: id, hidden } as const;
      const root = fold(operation);
      if (root === state.root) return;
      commit(
        {
          ...state,
          root,
          focusedPane: hidden ? focusAfterLeaving(state, id, root) : id,
        },
        [operation]
      );
    },
  }),
};
