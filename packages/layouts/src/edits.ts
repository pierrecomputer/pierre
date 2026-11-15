// Tree edits: the store commands that split, close, move, and swap panes, and
// the folds of their operations. The tree model is an argument, so an app
// loads only the model that it uses.
import { swapPanes } from './edits-model';
import { randomIds } from './ids';
import { TreeOperationError } from './layout-operation';
import { canClose, paneIn, requireNewPane, slotOf } from './model';
import { focusAfterLeaving, type StoreFeature } from './store';
import type { Edge, PaneNode, TreeModel } from './types';

export interface EditCommands {
  /**
   * Put a new pane at one edge of a target pane. A split of a pane in a stack
   * puts the new pane beside the stack. The new pane takes the focus.
   */
  split(targetId: string, pane: PaneNode, edge?: Edge): void;
  /**
   * Remove a pane. A layout needs a pane that is not hidden, so the close of
   * the last one throws `last_pane`: check `canClose` first.
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
    ids: randomIds,
    folds: {
      split(root, { target, pane, edge, id }, { newId }) {
        paneIn(root, target);
        requireNewPane(root, pane);
        return model.split(
          root,
          slotOf(root, target),
          { ...pane },
          edge,
          () => id ?? newId('split')
        );
      },
      close(root, { pane }) {
        paneIn(root, pane);
        if (!canClose(root, pane))
          throw new TreeOperationError('last_pane', pane);
        return model.remove(root, pane) ?? root;
      },
      move(root, { pane, target, edge, id }, { newId }) {
        const source = paneIn(root, pane);
        paneIn(root, target);
        const remaining = pane === target ? null : model.remove(root, pane);
        return remaining === null
          ? root
          : model.split(
              remaining,
              slotOf(remaining, target),
              source,
              edge,
              () => id ?? newId('split')
            );
      },
      swap(root, { panes: [first, second] }) {
        paneIn(root, first);
        paneIn(root, second);
        return swapPanes(root, first, second);
      },
    },
    commands: ({ get, fold, commit, newId }) => ({
      split(targetId, pane, edge = 'right') {
        // The operation holds its own copy of the caller's pane.
        const operation = {
          type: 'split',
          target: targetId,
          pane: { ...pane },
          edge,
          id: newId('split'),
        } as const;
        commit(
          { ...get(), root: fold(operation), focusedPane: pane.id },
          [operation],
          'local',
          pane.id
        );
      },
      close(id) {
        const state = get();
        const operation = { type: 'close', pane: id } as const;
        const root = fold(operation);
        commit(
          { ...state, root, focusedPane: focusAfterLeaving(state, id, root) },
          [operation]
        );
      },
      move(sourceId, targetId, edge) {
        const operation = {
          type: 'move',
          pane: sourceId,
          target: targetId,
          edge,
          id: newId('split'),
        } as const;
        commit(
          { ...get(), root: fold(operation), focusedPane: sourceId },
          [operation],
          'local',
          sourceId
        );
      },
      swap(firstId, secondId) {
        const operation = {
          type: 'swap',
          panes: [firstId, secondId],
        } as const;
        commit({ ...get(), root: fold(operation) }, [operation]);
      },
    }),
  };
}
