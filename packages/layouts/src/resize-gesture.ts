// The store side of a resize gesture: transient sizes in each frame, then one
// `resize` operation with the splits that changed, or none at a cancel.
import { findNode } from './model';
import type { CoreLayoutStore } from './store';
import type { ChildSize } from './types';

export interface ResizeGesture {
  /** Apply the sizes of a frame, in a transient change. */
  move(sizes: Readonly<Record<string, readonly ChildSize[]>>): void;
  /**
   * End the gesture: one `resize` operation with the final sizes of the
   * splits that changed, or, at a cancel, the sizes from before the gesture.
   */
  end(cancel: boolean): void;
}

/** Start a resize of the splits with these IDs. */
export function startResizeGesture(
  store: CoreLayoutStore,
  splits: readonly string[]
): ResizeGesture {
  return {
    move(sizes) {
      store.transient(() => store.setSizes(sizes));
    },
    end(cancel) {
      const root = store.getSnapshot().root;
      const sizes = Object.fromEntries(
        splits.flatMap((id) => {
          const node = findNode(root, id);
          return node?.type === 'split' ? [[id, node.sizes]] : [];
        })
      );
      store.revert();
      if (!cancel) store.setSizes(sizes);
    },
  };
}
