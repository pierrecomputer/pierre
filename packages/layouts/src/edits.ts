// Tree edits: the store commands that split, close, move, and swap panes. The
// tree model is an argument, so an app loads only the model that it uses.
import { swapPanes } from './edits-model';
import { getPanes, slotOf } from './model';
import { focusAfterLeaving, type StoreFeature } from './store';
import type { Edge, PaneNode, TreeModel } from './types';

export interface EditCommands {
  /**
   * Put a new pane at one edge of a target pane. A split of a pane in a stack
   * puts the new pane beside the stack. The new pane takes the focus.
   */
  split(targetId: string, pane: PaneNode, edge?: Edge): void;
  /**
   * Remove a pane. The last visible pane stays, because a layout needs one.
   */
  close(id: string): void;
  /**
   * Move a pane to one edge of another pane. A target in a stack takes the
   * pane beside the whole stack. A pane of a stack leaves its stack.
   */
  move(sourceId: string, targetId: string, edge: Edge): void;
  /** Swap the places of two panes. */
  swap(firstId: string, secondId: string): void;
}

/**
 * The tree edits of a store, with the rules of a tree model, such as
 * `naryTree`. The store also gives its trees the shape of the model.
 */
export function edits(model: TreeModel): StoreFeature<EditCommands> {
  return {
    model,
    commands: ({ get, commit, requirePane, nextId }) => ({
      split(targetId, pane, edge = 'right') {
        requirePane(targetId);
        const { root } = get();
        // The new pane comes from the caller, so the store keeps its own copy.
        const next = model.split(
          root,
          slotOf(root, targetId),
          { ...pane },
          edge,
          () => nextId(root)
        );
        commit({ ...get(), root: next, focusedPane: pane.id }, pane.id);
      },
      close(id) {
        requirePane(id);
        const state = get();
        const root = model.remove(state.root, id);
        if (
          root !== null &&
          getPanes(root).some((pane) => pane.hidden !== true)
        )
          commit({
            ...state,
            root,
            focusedPane: focusAfterLeaving(state, id, root),
          });
      },
      move(sourceId, targetId, edge) {
        const current = get().root;
        const source = getPanes(current).find(({ id }) => id === sourceId);
        if (source === undefined)
          throw new Error(`Pane not found: ${sourceId}`);
        requirePane(targetId);
        const remaining =
          sourceId === targetId ? null : model.remove(current, sourceId);
        const root =
          remaining === null
            ? current
            : model.split(
                remaining,
                slotOf(remaining, targetId),
                source,
                edge,
                () => nextId(current)
              );
        commit({ ...get(), root, focusedPane: sourceId }, sourceId);
      },
      swap(firstId, secondId) {
        requirePane(firstId);
        requirePane(secondId);
        const state = get();
        commit({ ...state, root: swapPanes(state.root, firstId, secondId) });
      },
    }),
  };
}
