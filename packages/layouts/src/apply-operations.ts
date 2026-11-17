// Operations from elsewhere: apply them to a store as one change, or fold them
// on a tree on a server. A bundler keeps this module only when an app imports
// it.
import { edits } from './edits';
import { hiddenPanesStore } from './hidden-panes';
import { keepEqual, nodesById } from './keep-equal';
import type {
  LayoutChange,
  LayoutOperation,
  LayoutTreeOperation,
} from './layout-operation';
import { LayoutOperationError } from './layout-operation';
import { findNode, paneIn } from './model';
import { naryTree } from './models/n-ary';
import { stacksStore } from './stacks';
import {
  type ContextOfStore,
  type CoreLayoutStore,
  createLayoutStore,
  STORE_CONTEXT,
  type StoreFeature,
} from './store';
import type { CanPlace, LayoutNode } from './types';

/**
 * Apply operations to a store in one change, `remote` by default: the
 * operations of a server or of another window. A tree operation changes the
 * tree only: the focus and the zoom stay on panes that show. A `focus` or a
 * `zoom` operation sets that state of the window. A remote change during a
 * gesture starts from the state before the gesture, which then ends with no
 * operation. A refused operation throws, and the store keeps its state.
 */
export function applyOperations(
  layout: CoreLayoutStore,
  operations: readonly LayoutOperation[],
  origin: LayoutChange['origin'] = 'remote'
): void {
  const context = (layout as CoreLayoutStore & ContextOfStore)[STORE_CONTEXT];
  let { root, focusedPane, zoomedPane } =
    origin === 'remote' ? context.settled() : context.get();
  for (const operation of operations) {
    if (operation.type === 'focus')
      focusedPane = paneIn(root, operation.pane).id;
    else if (operation.type === 'zoom')
      zoomedPane =
        operation.pane === null ? null : paneIn(root, operation.pane).id;
    else {
      if (context.folds[operation.type] === undefined)
        throw new LayoutOperationError('unknown_operation', operation.type);
      const id = (operation as { id?: string }).id;
      if (id !== undefined && findNode(root, id) !== null)
        throw new LayoutOperationError('id_in_use', id);
      // A tree from elsewhere keeps the nodes that equal the current ones, so
      // an equal tree is no change.
      root =
        operation.type === 'setRoot'
          ? keepEqual(context.fold(operation, root), nodesById(root))
          : context.fold(operation, root);
    }
  }
  context.commit({ root, focusedPane, zoomedPane }, operations, origin);
}

/** The options of `applyLayoutOperations`. */
export interface ApplyLayoutOperationsOptions {
  /**
   * The store features whose operations the tree takes. By default
   * `edits(naryTree)`, `stacks()`, and `hiddenPanes()`.
   */
  readonly features?: readonly StoreFeature[];
  /** The maker of the IDs of new nodes, for operations that carry none. */
  readonly newId?: (kind: 'split' | 'stack') => string;
  /**
   * The app's rule for places, as in `createLayout`: an operation that puts
   * a pane in a place that it refuses throws `place_refused`.
   */
  readonly canPlace?: CanPlace;
}

/**
 * Fold tree operations on a tree, as the store of a client folded them: the
 * same operations on the same tree give the same tree, with the same IDs. A
 * refused operation throws `LayoutOperationError`, and the caller keeps its
 * tree.
 */
export function applyLayoutOperations(
  root: LayoutNode,
  operations: readonly LayoutTreeOperation[],
  options: ApplyLayoutOperationsOptions = {}
): LayoutNode {
  const store = createLayoutStore(
    root,
    options.features ?? [edits(naryTree), stacksStore, hiddenPanesStore],
    { newId: options.newId, canPlace: options.canPlace }
  );
  applyOperations(store, operations);
  return store.getSnapshot().root;
}
