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

export interface PathStorePreparedInput {
  paths: readonly string[];
}

export interface PathStoreConstructorOptions extends PathStoreOptions {
  initialExpansion?: PathStoreInitialExpansion;
  initialExpandedPaths?: readonly string[];
  paths?: readonly string[];
  preparedInput?: PathStorePreparedInput;
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

export interface PathStoreEventInvalidation {
  affectedAncestorIds: readonly number[];
  affectedNodeIds: readonly number[];
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
}

export interface PathStoreAddEvent extends PathStoreEventInvalidation {
  operation: 'add';
  path: string;
}

export interface PathStoreRemoveEvent extends PathStoreEventInvalidation {
  operation: 'remove';
  path: string;
  recursive: boolean;
}

export interface PathStoreMoveEvent extends PathStoreEventInvalidation {
  from: string;
  operation: 'move';
  to: string;
}

export interface PathStoreExpandEvent extends PathStoreEventInvalidation {
  operation: 'expand';
  path: string;
}

export interface PathStoreCollapseEvent extends PathStoreEventInvalidation {
  operation: 'collapse';
  path: string;
}

export type PathStoreSemanticEvent =
  | PathStoreAddEvent
  | PathStoreRemoveEvent
  | PathStoreMoveEvent
  | PathStoreExpandEvent
  | PathStoreCollapseEvent;

export interface PathStoreBatchEvent extends PathStoreEventInvalidation {
  events: readonly PathStoreSemanticEvent[];
  operation: 'batch';
}

export type PathStoreEvent = PathStoreSemanticEvent | PathStoreBatchEvent;

export type PathStoreEventType =
  | PathStoreSemanticEvent['operation']
  | PathStoreBatchEvent['operation'];

export type PathStoreEventForType<TType extends PathStoreEventType | '*'> =
  TType extends '*'
    ? PathStoreEvent
    : Extract<PathStoreEvent, { operation: TType }>;

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
