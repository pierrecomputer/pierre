// Stacks of panes with tabs: the store commands that show, add, and move tabs.
// A move of a tab into another stack takes the pane out of its place with the
// tree model of the store, so it needs `edits`.
import { activatePane, getPanes, stackOf } from './model';
import { addToStack, moveTabTo } from './stacks-model';
import { focusAfterLeaving, type StoreFeature } from './store';
import type { LayoutNode, LayoutState, PaneNode, TabOptions } from './types';

export interface StackCommands {
  /**
   * Show a pane of a stack. It takes the focus, and the zoom when the zoomed
   * pane is in the same stack.
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

/**
 * The zoom after a pane of a stack shows: it takes the zoom when the zoomed
 * pane is in the same stack of `root`.
 */
function zoomInStack(
  state: LayoutState,
  root: LayoutNode,
  id: string
): string | null {
  const zoomed = state.zoomedPane;
  return zoomed !== null &&
    stackOf(root, id)?.children.some((pane) => pane.id === zoomed) === true
    ? id
    : zoomed;
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

/** The tab commands of a store. */
export const stacks: StoreFeature<StackCommands> = {
  commands: ({ get, commit, model, requirePane, nextId }) => ({
    activate(id) {
      requirePane(id);
      const state = get();
      if (stackOf(state.root, id) === null)
        throw new Error(`Pane not in a stack: ${id}`);
      commit({
        root: activatePane(state.root, id),
        focusedPane: id,
        zoomedPane: zoomInStack(state, state.root, id),
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
          ? {
              root,
              focusedPane: pane.id,
              zoomedPane: zoomAfterTab(state, targetId, pane.id),
            }
          : { ...state, root }
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
        activate
          ? { root, focusedPane: sourceId, zoomedPane: null }
          : {
              ...state,
              root,
              focusedPane: focusAfterLeaving(state, sourceId, root),
            }
      );
    },
    moveTab(id, index) {
      requirePane(id);
      const state = get();
      const root = moveTabTo(state.root, id, index);
      if (root === state.root) return;
      commit({
        root,
        focusedPane: id,
        zoomedPane: zoomInStack(state, root, id),
      });
    },
  }),
};
