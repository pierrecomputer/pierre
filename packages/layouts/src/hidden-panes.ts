// Hidden panes: the store command that hides a pane, which keeps its place,
// its content, and its state, and takes no space.
import { activatePane, getPanes, setPaneHidden, stackOf } from './model';
import { focusAfterLeaving, type StoreFeature } from './store';

export interface HiddenPaneCommands {
  /**
   * Hide a pane or show it again. A hidden pane keeps its place in the tree,
   * its content, and its state, but takes no space. The last visible pane
   * stays visible. A pane that shows again gets the focus, and becomes the
   * active pane of its stack.
   */
  setHidden(id: string, hidden: boolean): void;
}

/** The hide command of a store. */
export const hiddenPanes: StoreFeature<HiddenPaneCommands> = {
  commands: ({ get, commit, requirePane }) => ({
    setHidden(id, hidden) {
      requirePane(id);
      const state = get();
      const visible = getPanes(state.root).filter(
        (pane) => pane.hidden !== true
      );
      if (hidden && visible.length === 1 && visible[0].id === id) return;
      let root = setPaneHidden(state.root, id, hidden);
      if (!hidden && stackOf(root, id) !== null) root = activatePane(root, id);
      if (root === state.root) return;
      commit({
        ...state,
        root,
        focusedPane: hidden ? focusAfterLeaving(state, id, root) : id,
      });
    },
  }),
};
