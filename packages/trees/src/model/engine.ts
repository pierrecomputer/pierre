import { PathStore } from '@pierre/path-store';
import type {
  PathStoreConstructorOptions,
  PathStoreEventForType,
  PathStoreEventType,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStorePathInfo,
  PathStoreRemoveOptions,
  PathStoreVisibleRow,
  PathStoreVisibleRowContext,
  PathStoreVisibleTreeProjectionData,
} from '@pierre/path-store';

import type { FileTreeEngine } from '../engine';

/**
 * The store surface the controller drives. `@pierre/path-store`'s PathStore
 * and the wasm engine's PathStore both satisfy it structurally.
 */
export interface FileTreeStore {
  add(path: string): void;
  batch(operations: readonly PathStoreOperation[]): void;
  collapse(path: string): void;
  expand(path: string): void;
  getPathInfo(path: string): PathStorePathInfo | null;
  getVisibleCount(): number;
  getVisibleIndex(path: string): number | null;
  getVisibleRowContext(index: number): PathStoreVisibleRowContext | null;
  getVisibleSlice(start: number, end: number): readonly PathStoreVisibleRow[];
  getVisibleTreeProjectionData(
    maxRows?: number
  ): PathStoreVisibleTreeProjectionData;
  isExpanded(path: string): boolean;
  list(path?: string): string[];
  move(fromPath: string, toPath: string, options?: PathStoreMoveOptions): void;
  on<TType extends PathStoreEventType | '*'>(
    type: TType,
    handler: (event: PathStoreEventForType<TType>) => void
  ): () => void;
  remove(path: string, options?: PathStoreRemoveOptions): void;
}

/** What a `FileTreeEngine` really is behind its opaque public type. */
export interface FileTreeEngineImpl {
  createStore(options: PathStoreConstructorOptions): FileTreeStore;
}

const defaultEngine: FileTreeEngineImpl = {
  createStore: (options) => new PathStore(options),
};

/** Brand an implementation as the opaque engine value consumers pass around. */
export function createFileTreeEngine(impl: FileTreeEngineImpl): FileTreeEngine {
  // The brand is a type-level marker only; the runtime value is the impl.
  return impl as unknown as FileTreeEngine;
}

export function resolveFileTreeEngine(
  engine: FileTreeEngine | undefined
): FileTreeEngineImpl {
  return engine == null
    ? defaultEngine
    : (engine as unknown as FileTreeEngineImpl);
}
