// Persistence: the store commands that save a layout and restore it. The saved
// form has version 3; `restore` also reads versions 2 and 1.
import { parseSerializedLayout } from './persistence-model';
import type { StoreFeature } from './store';
import type { StoredLayoutTree } from './types';

export interface PersistenceCommands {
  /** The tree, the focus, and the zoom, as JSON of version 3. */
  serialize(): string;
  /**
   * Restore a layout from `serialize`, in one change. Version 3 added stacks.
   * A layout of version 2 has the same form with no stack. A layout of
   * version 1, where each split had two children, converts. The tree takes the
   * shape of the model.
   */
  restore(serialized: string): void;
  /** Return the tree without the window's focus and zoom state. */
  toStoredTree(): StoredLayoutTree;
  /** Set the tree of a stored tree. The focus and the zoom stay. */
  setStoredTree(tree: StoredLayoutTree): void;
}

/** The save and restore commands of a store. */
export const persistence: StoreFeature<PersistenceCommands> = {
  commands: ({ get, commit, own }) => ({
    serialize: () => JSON.stringify({ version: 3, ...get() }),
    restore(serialized) {
      const state = parseSerializedLayout(serialized);
      commit({ ...state, root: own(state.root) });
    },
    toStoredTree: () => Object.freeze({ version: 3, root: get().root }),
    setStoredTree(tree) {
      commit({ ...get(), root: own(tree.root) });
    },
  }),
};
