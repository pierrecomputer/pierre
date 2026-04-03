import type {
  NodeId,
  PathStoreNode,
  PathStoreSnapshot,
} from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import type { BenchmarkInstrumentation } from './internal/benchmarkInstrumentation';
import type { PathStoreEvent, PathStoreInitialExpansion } from './public-types';

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
  collapsedDirectoryIds: Set<NodeId>;
  defaultExpansion: PathStoreInitialExpansion;
  expandedDirectoryIds: Set<NodeId>;
  instrumentation: BenchmarkInstrumentation | null;
  listeners: Map<string, Set<(event: PathStoreEvent) => void>>;
  pathCacheVersion: number;
  snapshot: PathStoreSnapshot;
  transactionStack: TransactionFrame[];
}

export function createPathStoreState(
  snapshot: PathStoreSnapshot,
  initialExpansion: PathStoreInitialExpansion = 'closed',
  instrumentation: BenchmarkInstrumentation | null = null
): PathStoreState {
  return {
    activeNodeCount: snapshot.nodes.length - 1,
    collapsedDirectoryIds: new Set<NodeId>(),
    defaultExpansion: resolveInitialExpansion(initialExpansion),
    expandedDirectoryIds: new Set<NodeId>(),
    instrumentation,
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

export function resolveInitialExpansion(
  initialExpansion: PathStoreInitialExpansion
): PathStoreInitialExpansion {
  if (typeof initialExpansion !== 'number') {
    return initialExpansion;
  }

  if (!Number.isInteger(initialExpansion) || initialExpansion < 0) {
    throw new Error(
      `initialExpansion must be "open", "closed", or a non-negative integer depth. Received: ${String(
        initialExpansion
      )}`
    );
  }

  return initialExpansion;
}

function isDirectoryExpandedByDefault(
  state: PathStoreState,
  node: PathStoreNode
): boolean {
  if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    return true;
  }

  if (state.defaultExpansion === 'open') {
    return true;
  }

  if (state.defaultExpansion === 'closed') {
    return false;
  }

  return node.depth <= state.defaultExpansion;
}

export function isDirectoryExpanded(
  state: PathStoreState,
  nodeId: NodeId,
  node = state.snapshot.nodes[nodeId]
): boolean {
  if (node == null || node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return false;
  }

  if (state.collapsedDirectoryIds.has(nodeId)) {
    return false;
  }

  if (state.expandedDirectoryIds.has(nodeId)) {
    return true;
  }

  return isDirectoryExpandedByDefault(state, node);
}

export function setDirectoryExpanded(
  state: PathStoreState,
  nodeId: NodeId,
  expanded: boolean,
  node = state.snapshot.nodes[nodeId]
): void {
  if (node == null || node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return;
  }

  const expandedByDefault = isDirectoryExpandedByDefault(state, node);
  if (expanded) {
    if (expandedByDefault) {
      state.collapsedDirectoryIds.delete(nodeId);
      return;
    }

    state.expandedDirectoryIds.add(nodeId);
    return;
  }

  if (expandedByDefault) {
    state.collapsedDirectoryIds.add(nodeId);
    return;
  }

  state.expandedDirectoryIds.delete(nodeId);
}
