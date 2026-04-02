export interface PathStoreCompareEntry {
  basename: string;
  depth: number;
  isDirectory: boolean;
  path: string;
  segments: readonly string[];
}

export type PathStorePathComparator = (
  left: PathStoreCompareEntry,
  right: PathStoreCompareEntry
) => number;

export interface PathStoreOptions {
  flattenEmptyDirectories?: boolean;
  sort?: 'default' | PathStorePathComparator;
}

export type PathStoreInitialExpansion = 'closed' | 'open' | number;

export interface PathStoreConstructorOptions extends PathStoreOptions {
  initialExpansion?: PathStoreInitialExpansion;
  initialExpandedPaths?: readonly string[];
  paths?: readonly string[];
  presorted?: boolean;
}

export interface PathStoreFlattenedRowSegment {
  isTerminal: boolean;
  name: string;
  nodeId: number;
  path: string;
}

export interface PathStoreVisibleRow {
  depth: number;
  flattenedSegments?: readonly PathStoreFlattenedRowSegment[];
  hasChildren: boolean;
  id: number;
  isExpanded: boolean;
  isFlattened: boolean;
  isLoading: boolean;
  kind: 'directory' | 'file';
  name: string;
  path: string;
}

export interface PathStoreEvent {
  affectedAncestorIds?: readonly number[];
  affectedNodeIds?: readonly number[];
  changeset?: Record<string, unknown>;
  operation: string;
}

export interface PathStoreRemoveOptions {
  recursive?: boolean;
}

export type PathStoreCollisionStrategy = 'error' | 'replace' | 'skip';

export interface PathStoreMoveOptions {
  collision?: PathStoreCollisionStrategy;
}

export type PathStoreOperation =
  | { path: string; type: 'add' }
  | ({ path: string; type: 'remove' } & PathStoreRemoveOptions)
  | ({ from: string; to: string; type: 'move' } & PathStoreMoveOptions);
