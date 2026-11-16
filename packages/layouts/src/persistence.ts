// Persistence: the store commands that give the saved form of a layout,
// `{ version: 3, root }`, and set a tree from it. Focus and zoom are the state
// of one window, which an app saves if it wants.
import { keepEqual, nodesById } from './keep-equal';
import type { StoreFeature } from './store';
import type { StoredLayoutTree } from './types';

export interface PersistenceCommands {
  /** The saved form of the layout: its tree, without the window's focus and zoom. */
  toStoredTree(): StoredLayoutTree;
  /**
   * Set the tree of a saved form, which `parseStoredLayoutTree` checked. The
   * tree takes the shape of the model. The focus and the zoom stay on panes
   * that show. A node that equals the current one stays, so an equal tree is
   * no change.
   */
  setStoredTree(tree: StoredLayoutTree): void;
}

/** The commands of the saved form of a store. */
export const persistenceStore: StoreFeature<PersistenceCommands> = {
  commands: ({ get, commit, own }) => ({
    toStoredTree: () => Object.freeze({ version: 3, root: get().root }),
    setStoredTree(tree) {
      const operation = { type: 'setRoot', root: own(tree.root) } as const;
      // A saved tree keeps the nodes that equal the current ones, so an equal
      // tree is no change.
      const root = keepEqual(operation.root, nodesById(get().root));
      commit({ ...get(), root }, [operation]);
    },
  }),
};

/** The saved form of a store, for `createLayoutStore`. */
export function persistence(): StoreFeature<PersistenceCommands> {
  return persistenceStore;
}
