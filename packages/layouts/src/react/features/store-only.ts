// Features with a store part only: their commands need no view.
import { type EditCommands, edits as editsStore } from '../../edits';
import {
  type HiddenPaneCommands,
  hiddenPanes as hiddenPanesStore,
} from '../../hidden-panes';
import {
  type PersistenceCommands,
  persistence as persistenceStore,
} from '../../persistence';
import type { TreeModel } from '../../types';
import type { Feature } from '../contract';

/**
 * Split, close, move, and swap panes, with the rules of a tree model:
 * `edits(naryTree)` or `edits(binaryTree)`. The layout gives its trees the
 * shape of the model.
 */
export function edits(model: TreeModel): Feature<EditCommands> {
  return { name: 'edits', store: editsStore(model) };
}

/** Hide a pane and show it again: `layout.setHidden`. */
export function hiddenPanes(): Feature<HiddenPaneCommands> {
  return { name: 'hidden-panes', store: hiddenPanesStore };
}

/** Save and restore a layout: `layout.serialize`, `layout.restore`, and the stored tree. */
export function persistence(): Feature<PersistenceCommands> {
  return { name: 'persistence', store: persistenceStore };
}
