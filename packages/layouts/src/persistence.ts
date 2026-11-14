// Persistence: the store commands that save a layout and restore it. The saved
// form has version 3; `restore` also reads versions 2 and 1.
import { type BinaryLayoutNode, fromBinaryLayout } from './persistence-model';
import type { StoreFeature } from './store';
import type { LayoutNode, LayoutState, StoredLayoutTree } from './types';

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

/**
 * Read a layout from `serialize`, of version 1, 2, or 3. Throw when the value
 * does not have the form of a saved layout.
 */
export function parseSerializedLayout(serialized: string): LayoutState {
  const value: unknown = JSON.parse(serialized);
  if (
    value === null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    !('root' in value) ||
    value.root === null ||
    typeof value.root !== 'object' ||
    !('focusedPane' in value) ||
    typeof value.focusedPane !== 'string' ||
    !('zoomedPane' in value) ||
    (value.zoomedPane !== null && typeof value.zoomedPane !== 'string')
  ) {
    throw new Error('Invalid layout state');
  }
  return {
    root:
      value.version === 1
        ? fromBinaryLayout(value.root as BinaryLayoutNode)
        : (value.root as LayoutNode),
    focusedPane: value.focusedPane,
    zoomedPane: value.zoomedPane,
  };
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
