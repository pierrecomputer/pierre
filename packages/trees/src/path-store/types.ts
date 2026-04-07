import type { PathStoreConstructorOptions } from '@pierre/path-store';

/**
 * Phase 0 keeps the public identity path-first on purpose so internal
 * path-store row IDs stay free to change later without freezing the trees API.
 */
export type PathStoreTreesPublicId = string;

export interface PathStoreTreesControllerOptions extends PathStoreConstructorOptions {
  controllerId?: string;
  paths: readonly string[];
}

export interface PathStoreTreesBootstrapItem {
  isFlattened: boolean;
  kind: 'directory' | 'file';
  name: string;
  path: PathStoreTreesPublicId;
}

export interface PathStoreTreesBootstrapSnapshot {
  controllerId: string;
  firstVisibleItem: PathStoreTreesBootstrapItem | null;
  phase: 'bootstrap';
  publicIdentity: 'path';
  visibleCount: number;
}

export interface PathStoreTreesShellTarget {
  innerHTML: string;
}

export type PathStoreTreesControllerListener = (
  snapshot: PathStoreTreesBootstrapSnapshot
) => void;
