import type { NodeId, PathStoreSnapshot } from './internal-types';
import type { PathStoreEvent } from './public-types';

export interface TransactionFrame {
  readonly affectedAncestorIds: Set<NodeId>;
  readonly affectedNodeIds: Set<NodeId>;
  readonly events: PathStoreEvent[];
}

export interface MoveTarget {
  basename: string;
  existingNodeId: NodeId | null;
  parentId: NodeId;
}

export interface PathStoreState {
  activeNodeCount: number;
  expandedDirectoryIds: Set<NodeId>;
  listeners: Map<string, Set<(event: PathStoreEvent) => void>>;
  pathCacheVersion: number;
  snapshot: PathStoreSnapshot;
  transactionStack: TransactionFrame[];
}

export function createPathStoreState(
  snapshot: PathStoreSnapshot
): PathStoreState {
  return {
    activeNodeCount: snapshot.nodes.length - 1,
    expandedDirectoryIds: new Set<NodeId>(),
    listeners: new Map<string, Set<(event: PathStoreEvent) => void>>(),
    pathCacheVersion: 0,
    snapshot,
    transactionStack: [],
  };
}

export function createTransactionFrame(): TransactionFrame {
  return {
    affectedAncestorIds: new Set<NodeId>(),
    affectedNodeIds: new Set<NodeId>(),
    events: [],
  };
}
