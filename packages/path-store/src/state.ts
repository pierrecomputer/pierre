import type {
  DirectoryLoadInfo,
  NodeId,
  PathStoreNode,
  PathStoreSnapshot,
} from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import type { BenchmarkInstrumentation } from './internal/benchmarkInstrumentation';
import type {
  PathStoreDirectoryLoadState,
  PathStoreEvent,
  PathStoreInitialExpansion,
  PathStoreLoadAttempt,
  PathStoreSemanticEvent,
} from './public-types';

export interface TransactionFrame {
  readonly affectedAncestorIds: Set<NodeId>;
  readonly affectedNodeIds: Set<NodeId>;
  readonly events: PathStoreSemanticEvent[];
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
  directoryLoadInfoById: Map<NodeId, DirectoryLoadInfo>;
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
    directoryLoadInfoById: new Map<NodeId, DirectoryLoadInfo>(),
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
  node: PathStoreNode | undefined = state.snapshot.nodes[nodeId]
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
  node: PathStoreNode | undefined = state.snapshot.nodes[nodeId]
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

function getOrCreateDirectoryLoadInfo(
  state: PathStoreState,
  nodeId: NodeId
): DirectoryLoadInfo {
  const existingInfo = state.directoryLoadInfoById.get(nodeId);
  if (existingInfo != null) {
    return existingInfo;
  }

  const nextInfo: DirectoryLoadInfo = {
    activeAttemptId: null,
    errorMessage: null,
    nextAttemptId: 1,
    state: 'loaded',
  };
  state.directoryLoadInfoById.set(nodeId, nextInfo);
  return nextInfo;
}

export function getDirectoryLoadState(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreDirectoryLoadState {
  return state.directoryLoadInfoById.get(nodeId)?.state ?? 'loaded';
}

export function getDirectoryLoadError(
  state: PathStoreState,
  nodeId: NodeId
): string | null {
  return state.directoryLoadInfoById.get(nodeId)?.errorMessage ?? null;
}

export function beginDirectoryLoad(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreLoadAttempt {
  const loadInfo = getOrCreateDirectoryLoadInfo(state, nodeId);
  if (loadInfo.state === 'loading' && loadInfo.activeAttemptId != null) {
    return {
      attemptId: loadInfo.activeAttemptId,
      nodeId,
      reused: true,
    };
  }

  const attemptId = loadInfo.nextAttemptId;
  loadInfo.activeAttemptId = attemptId;
  loadInfo.errorMessage = null;
  loadInfo.nextAttemptId += 1;
  loadInfo.state = 'loading';
  return {
    attemptId,
    nodeId,
    reused: false,
  };
}

export function markDirectoryUnloadedState(
  state: PathStoreState,
  nodeId: NodeId
): void {
  const loadInfo = getOrCreateDirectoryLoadInfo(state, nodeId);
  loadInfo.activeAttemptId = null;
  loadInfo.errorMessage = null;
  loadInfo.state = 'unloaded';
}

export function completeDirectoryLoad(
  state: PathStoreState,
  nodeId: NodeId,
  attemptId: number
): boolean {
  const loadInfo = state.directoryLoadInfoById.get(nodeId);
  if (loadInfo == null || loadInfo.activeAttemptId !== attemptId) {
    return false;
  }

  loadInfo.activeAttemptId = null;
  loadInfo.errorMessage = null;
  loadInfo.state = 'loaded';
  return true;
}

export function isDirectoryLoadAttemptCurrent(
  state: PathStoreState,
  nodeId: NodeId,
  attemptId: number
): boolean {
  return state.directoryLoadInfoById.get(nodeId)?.activeAttemptId === attemptId;
}

export function failDirectoryLoad(
  state: PathStoreState,
  nodeId: NodeId,
  attemptId: number,
  errorMessage: string | undefined
): boolean {
  const loadInfo = state.directoryLoadInfoById.get(nodeId);
  if (loadInfo == null || loadInfo.activeAttemptId !== attemptId) {
    return false;
  }

  loadInfo.activeAttemptId = null;
  loadInfo.errorMessage = errorMessage ?? null;
  loadInfo.state = 'error';
  return true;
}

export function clearDirectoryLoadInfo(
  state: PathStoreState,
  nodeId: NodeId
): void {
  state.directoryLoadInfoById.delete(nodeId);
}
