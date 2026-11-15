// The operations of a layout: what each store change did, in a plain JSON
// form that listeners read and that a server folds in the same way as the
// store (`DEC-layouts-store-operations`).
import type { ChildSize, Edge, LayoutNode, PaneNode } from './types';

/**
 * A change of the saved tree. The store and the server fold these the same
 * way. `id` is the ID of the split or the stack that the operation makes, when
 * it makes one: the store that runs the command makes it, so the server's tree
 * gets the same ID.
 */
export type LayoutTreeOperation =
  | { readonly type: 'setRoot'; readonly root: LayoutNode }
  | {
      readonly type: 'resize';
      readonly sizes: Readonly<Record<string, readonly ChildSize[]>>;
    }
  | {
      readonly type: 'collapse';
      readonly pane: string;
      readonly collapsed: boolean;
    }
  | {
      readonly type: 'split';
      readonly target: string;
      readonly pane: PaneNode;
      readonly edge: Edge;
      readonly id?: string;
    }
  | { readonly type: 'close'; readonly pane: string }
  | {
      readonly type: 'move';
      readonly pane: string;
      readonly target: string;
      readonly edge: Edge;
      readonly id?: string;
    }
  | { readonly type: 'swap'; readonly panes: readonly [string, string] }
  | { readonly type: 'activate'; readonly pane: string }
  | {
      readonly type: 'addTab';
      readonly target: string;
      readonly pane: PaneNode;
      readonly index?: number;
      readonly activate: boolean;
      readonly id?: string;
    }
  | {
      readonly type: 'moveToStack';
      readonly pane: string;
      readonly target: string;
      readonly index?: number;
      readonly activate: boolean;
      readonly id?: string;
    }
  | { readonly type: 'moveTab'; readonly pane: string; readonly index: number }
  | { readonly type: 'hide'; readonly pane: string; readonly hidden: boolean };

/**
 * A change of the state of one window: its focus and its zoom. Listeners get
 * these; the saved tree and the server do not.
 */
export type LayoutWindowOperation =
  | { readonly type: 'focus'; readonly pane: string }
  | { readonly type: 'zoom'; readonly pane: string | null };

export type LayoutOperation = LayoutTreeOperation | LayoutWindowOperation;

/** True for an operation of the saved tree, which a server folds. */
export const isTreeOperation = (
  operation: LayoutOperation
): operation is LayoutTreeOperation =>
  operation.type !== 'focus' && operation.type !== 'zoom';

/** One change of a store, for its listeners. */
export interface LayoutChange {
  /**
   * The operations of the change, in order: usually one. Empty for a
   * transient change, such as a frame of a resize drag.
   */
  readonly operations: readonly LayoutOperation[];
  /** `local` for a command of this store, `remote` for operations from elsewhere. */
  readonly origin: 'local' | 'remote';
}

/** The codes of `LayoutOperationError`. */
export type LayoutOperationErrorCode =
  | 'pane_not_found'
  | 'node_not_found'
  | 'last_pane'
  | 'invalid_sizes'
  | 'id_in_use'
  | 'unknown_operation';

/**
 * An operation that a tree refuses. The tree stays as it was. The message is
 * the code and a detail, such as the ID of the pane: `pane_not_found: editor`.
 */
export class LayoutOperationError extends Error {
  // The constructor sets the field, so the class declares no empty field.
  declare readonly code: LayoutOperationErrorCode;

  constructor(code: LayoutOperationErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'LayoutOperationError';
    this.code = code;
  }
}
