export type NodeId = number;
export type SegmentId = number;

export const PATH_STORE_NODE_KIND_FILE = 0;
export const PATH_STORE_NODE_KIND_DIRECTORY = 1;

export type PathStoreNodeKind =
  | typeof PATH_STORE_NODE_KIND_FILE
  | typeof PATH_STORE_NODE_KIND_DIRECTORY;

export const PATH_STORE_NODE_FLAG_EXPLICIT = 1 << 0;
export const PATH_STORE_NODE_FLAG_ROOT = 1 << 1;
export const PATH_STORE_NODE_FLAG_REMOVED = 1 << 2;

export interface SegmentSortKey {
  lowerValue: string;
  tokens: readonly (number | string)[];
}

export interface SegmentTable {
  idByValue: Map<string, SegmentId>;
  valueById: string[];
  sortKeyById: SegmentSortKey[];
}

export interface PathStoreNode {
  id: NodeId;
  parentId: NodeId;
  nameId: SegmentId;
  kind: PathStoreNodeKind;
  depth: number;
  flags: number;
  subtreeNodeCount: number;
  visibleSubtreeCount: number;
  pathCache: string | null;
  pathCacheVersion: number;
}

export interface DirectoryChildIndex {
  childIds: NodeId[];
  childIdByNameId: Map<SegmentId, NodeId>;
}

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

export interface PathStoreBuilderOptions extends PathStoreOptions {}

export interface PathStoreConstructorOptions extends PathStoreOptions {
  initialExpandedPaths?: readonly string[];
  paths?: readonly string[];
  presorted?: boolean;
}

export interface ResolvedPathStoreOptions {
  flattenEmptyDirectories: boolean;
  sort: 'default' | PathStorePathComparator;
}

export interface PreparedPath {
  basename: string;
  isDirectory: boolean;
  path: string;
  segments: readonly string[];
}

export interface LookupPath {
  requiresDirectory: boolean;
  segments: readonly string[];
}

export interface PathStoreFlattenedRowSegment {
  isTerminal: boolean;
  name: string;
  nodeId: NodeId;
  path: string;
}

export interface PathStoreVisibleRow {
  depth: number;
  flattenedSegments?: readonly PathStoreFlattenedRowSegment[];
  hasChildren: boolean;
  id: NodeId;
  isExpanded: boolean;
  isFlattened: boolean;
  isLoading: boolean;
  kind: 'directory' | 'file';
  name: string;
  path: string;
}

export interface PathStoreEvent {
  affectedAncestorIds?: readonly NodeId[];
  affectedNodeIds?: readonly NodeId[];
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

export interface PathStoreSnapshot {
  directories: Map<NodeId, DirectoryChildIndex>;
  nodes: PathStoreNode[];
  options: ResolvedPathStoreOptions;
  rootId: NodeId;
  segmentTable: SegmentTable;
}
