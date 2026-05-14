import type {
  FileTreeHydrationProps,
  FileTreeListener,
  FileTreeModel,
  FileTreeRenderProps,
  FileTreeSsrPayload,
  FileTreeOptions as InternalFileTreeOptions,
  FileTreeRenderOptions as InternalFileTreeRenderOptions,
} from '../model/publicTypes';

// Callers should usually report `'user'` or `'programmatic'`. The runtime uses
// `'unknown'` when a source omits the field or cannot classify the change yet.
export type FileTreeExternalScrollOrigin = 'programmatic' | 'unknown' | 'user';

// Host-local viewport metrics from a caller-owned scroller. `viewportTop` is the
// scroller viewport's top edge in the file-tree host coordinate system, so it may
// be negative or below the tree when the tree is partially or fully offscreen.
export interface FileTreeExternalScrollSnapshot {
  viewportTop: number;
  viewportHeight: number;
  topInset?: number;
  bottomInset?: number;
  isScrolling?: boolean;
  scrollOrigin?: FileTreeExternalScrollOrigin;
}

export type FileTreeExternalScrollRequestReason =
  | 'focus-reveal'
  | 'search-restore'
  | 'sticky-row-restore'
  | 'sticky-keyboard-restore';

export interface FileTreeExternalScrollRequestContext {
  origin: 'programmatic';
  path?: string | null;
  reason: FileTreeExternalScrollRequestReason;
}

// External scroll sources bridge the tree's virtualization math to a
// caller-owned scroller.
//
// `scrollToViewportTop(...)` must update `getSnapshot()` synchronously before it
// returns so the tree can recompute layout against the new position in the same
// turn.
export interface FileTreeExternalScrollSource {
  getSnapshot(): FileTreeExternalScrollSnapshot;
  scrollToViewportTop(
    viewportTop: number,
    context: FileTreeExternalScrollRequestContext
  ): void;
  subscribe(listener: () => void): () => void;
}

export interface FileTreeExternalScrollOptions {
  initialSnapshot?: FileTreeExternalScrollSnapshot;
  source?: FileTreeExternalScrollSource;
}

export type FileTreeRenderOptions = InternalFileTreeRenderOptions & {
  externalScroll?: FileTreeExternalScrollOptions;
};

export type FileTreeOptions = InternalFileTreeOptions & {
  externalScroll?: FileTreeExternalScrollOptions;
};

export interface FileTreeExternalScrollModel extends FileTreeModel {
  // Swap the live source without rebuilding the tree model. Pass `undefined` to
  // detach a source while keeping the model in external-scroll mode.
  setExternalScrollSource(source?: FileTreeExternalScrollSource): void;
}

export type {
  FileTreeHydrationProps,
  FileTreeListener,
  FileTreeModel,
  FileTreeRenderProps,
  FileTreeSsrPayload,
};
