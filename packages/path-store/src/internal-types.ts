import type {
  PathStoreDirectoryLoadState,
  PathStorePathComparator,
  PathStorePreparedInput,
} from './public-types';

export type NodeId = number;
export type SegmentId = number;

export const PATH_STORE_NODE_KIND_FILE = 0;
export const PATH_STORE_NODE_KIND_DIRECTORY = 1;

export type PathStoreNodeKind =
  | typeof PATH_STORE_NODE_KIND_FILE
  | typeof PATH_STORE_NODE_KIND_DIRECTORY;

export const PATH_STORE_NODE_FLAG_EXPLICIT: number = 1 << 0;
export const PATH_STORE_NODE_FLAG_ROOT: number = 1 << 1;
export const PATH_STORE_NODE_FLAG_REMOVED: number = 1 << 2;

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

export interface DirectoryLoadInfo {
  activeAttemptId: number | null;
  errorMessage: string | null;
  nextAttemptId: number;
  state: PathStoreDirectoryLoadState;
}

export interface DirectoryChildIndex {
  childIds: NodeId[];
  childIdByNameId: Map<SegmentId, NodeId>;
  childPositionById: Map<NodeId, number>;
  childVisibleChunkSums: number[] | null;
  totalChildSubtreeNodeCount: number;
  totalChildVisibleSubtreeCount: number;
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

export type InternalPreparedInput = PathStorePreparedInput & {
  readonly preparedPaths: readonly PreparedPath[];
};

export interface LookupPath {
  requiresDirectory: boolean;
  segments: readonly string[];
}

export interface PathStoreSnapshot {
  directories: Map<NodeId, DirectoryChildIndex>;
  nodes: PathStoreNode[];
  options: ResolvedPathStoreOptions;
  rootId: NodeId;
  segmentTable: SegmentTable;
}
