import { PathStoreBuilder } from './builder';
import {
  findNodeId,
  listPaths,
  materializeNodePath,
  recomputeCountsRecursive,
  requireNode,
} from './canonical';
import { rebuildDirectoryChildAggregates } from './child-index';
import {
  type DirectoryLoadInfo,
  hasNodeFlag,
  isDirectoryNode,
  type NodeId,
  PATH_STORE_NODE_FLAG_REMOVED,
  PATH_STORE_NODE_FLAG_ROOT,
  type PathStoreNode,
  type SegmentTable,
} from './internal-types';
import {
  attachBenchmarkInstrumentation,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import type {
  PathStoreCleanupMode,
  PathStoreCleanupResult,
} from './public-types';
import { getSegmentValue, internSegment } from './segments';
import { createSegmentTable } from './segments';
import { getDirectoryLoadState, setDirectoryExpanded } from './state';
import type { PathStoreState } from './state';

interface CleanupMetricSnapshot {
  activeNodeCount: number;
  cachedPathEntryCount: number;
  loadInfoEntryCount: number;
  segmentCount: number;
  totalNodeSlotCount: number;
}

interface PersistedDirectoryLoadInfo {
  info: DirectoryLoadInfo;
  path: string;
}

interface PersistedExpansionState {
  collapsedPaths: string[];
  expandedPaths: string[];
}

function isLiveNode(node: PathStoreNode | undefined): node is PathStoreNode {
  return node != null && !hasNodeFlag(node, PATH_STORE_NODE_FLAG_REMOVED);
}

function isLiveDirectoryNode(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreNode | null {
  const node = state.snapshot.nodes[nodeId];
  if (
    !isLiveNode(node) ||
    !isDirectoryNode(node) ||
    hasNodeFlag(node, PATH_STORE_NODE_FLAG_ROOT)
  ) {
    return null;
  }

  return node;
}

function countCachedPathEntries(state: PathStoreState): number {
  let cachedPathEntryCount = 0;

  for (const [nodeId, cachedEntry] of state.pathCacheByNodeId) {
    if (cachedEntry.version !== state.pathCacheVersion) {
      continue;
    }

    if (!isLiveNode(state.snapshot.nodes[nodeId])) {
      continue;
    }

    cachedPathEntryCount += 1;
  }

  return cachedPathEntryCount;
}

function countSegmentEntries(segmentTable: SegmentTable): number {
  return Math.max(0, segmentTable.valueById.length - 1);
}

function createCleanupMetricSnapshot(
  state: PathStoreState
): CleanupMetricSnapshot {
  return {
    activeNodeCount: state.activeNodeCount,
    cachedPathEntryCount: countCachedPathEntries(state),
    loadInfoEntryCount: state.directoryLoadInfoById.size,
    segmentCount: countSegmentEntries(state.snapshot.segmentTable),
    totalNodeSlotCount: Math.max(0, state.snapshot.nodes.length - 1),
  };
}

function createCleanupResult(
  mode: PathStoreCleanupMode,
  idsPreserved: boolean,
  before: CleanupMetricSnapshot,
  after: CleanupMetricSnapshot
): PathStoreCleanupResult {
  return {
    activeNodeCountAfter: after.activeNodeCount,
    activeNodeCountBefore: before.activeNodeCount,
    cachedPathEntryCountAfter: after.cachedPathEntryCount,
    cachedPathEntryCountBefore: before.cachedPathEntryCount,
    idsPreserved,
    loadInfoEntryCountAfter: after.loadInfoEntryCount,
    loadInfoEntryCountBefore: before.loadInfoEntryCount,
    mode,
    reclaimedCachedPathEntryCount:
      before.cachedPathEntryCount - after.cachedPathEntryCount,
    reclaimedLoadInfoEntryCount:
      before.loadInfoEntryCount - after.loadInfoEntryCount,
    reclaimedNodeSlotCount:
      before.totalNodeSlotCount - after.totalNodeSlotCount,
    reclaimedSegmentCount: before.segmentCount - after.segmentCount,
    segmentCountAfter: after.segmentCount,
    segmentCountBefore: before.segmentCount,
    totalNodeSlotCountAfter: after.totalNodeSlotCount,
    totalNodeSlotCountBefore: before.totalNodeSlotCount,
  };
}

// Captures caller-visible expansion overrides by path so cleanup can rebuild
// internal sets without depending on stale node IDs.
function collectExpansionOverridePaths(
  state: PathStoreState
): PersistedExpansionState {
  const collapsedPaths: string[] = [];
  const expandedPaths: string[] = [];

  for (const nodeId of state.collapsedDirectoryIds) {
    const node = isLiveDirectoryNode(state, nodeId);
    if (node != null) {
      collapsedPaths.push(materializeNodePath(state, nodeId));
    }
  }

  for (const nodeId of state.expandedDirectoryIds) {
    const node = isLiveDirectoryNode(state, nodeId);
    if (node != null) {
      expandedPaths.push(materializeNodePath(state, nodeId));
    }
  }

  return {
    collapsedPaths,
    expandedPaths,
  };
}

// Keeps only non-default load states so cleanup can rebuild the load-info map
// and still restore unloaded/error directories after compaction.
function collectDirectoryLoadInfos(
  state: PathStoreState
): PersistedDirectoryLoadInfo[] {
  const retainedInfos: PersistedDirectoryLoadInfo[] = [];

  for (const [nodeId, info] of state.directoryLoadInfoById) {
    const node = isLiveDirectoryNode(state, nodeId);
    if (node == null || getDirectoryLoadState(state, nodeId) === 'loaded') {
      continue;
    }

    retainedInfos.push({
      info: {
        activeAttemptId: null,
        errorMessage: info.errorMessage,
        nextAttemptId: info.nextAttemptId,
        state: info.state,
      },
      path: materializeNodePath(state, nodeId),
    });
  }

  return retainedInfos;
}

// Reapplies expansion overrides onto the current snapshot after cleanup has
// rebuilt or replaced the underlying node/index structures.
function restoreExpansionOverridePaths(
  state: PathStoreState,
  persistedExpansionState: PersistedExpansionState
): void {
  state.collapsedDirectoryIds.clear();
  state.hasCollapsedDirectoryOverrides = false;
  state.expandedDirectoryIds.clear();

  for (const path of persistedExpansionState.expandedPaths) {
    const nodeId = findNodeId(state, path);
    if (nodeId == null) {
      continue;
    }

    setDirectoryExpanded(state, nodeId, true, requireNode(state, nodeId));
  }

  for (const path of persistedExpansionState.collapsedPaths) {
    const nodeId = findNodeId(state, path);
    if (nodeId == null) {
      continue;
    }

    setDirectoryExpanded(state, nodeId, false, requireNode(state, nodeId));
  }
}

// Restores non-default directory load states by path so cleanup can preserve
// unloaded/error semantics without carrying stale node IDs forward.
function restoreDirectoryLoadInfos(
  state: PathStoreState,
  persistedLoadInfos: readonly PersistedDirectoryLoadInfo[]
): void {
  state.directoryLoadInfoById.clear();

  for (const retainedInfo of persistedLoadInfos) {
    const nodeId = findNodeId(state, retainedInfo.path);
    if (nodeId == null) {
      continue;
    }

    const node = isLiveDirectoryNode(state, nodeId);
    if (node == null) {
      continue;
    }

    state.directoryLoadInfoById.set(nodeId, {
      activeAttemptId: null,
      errorMessage: retainedInfo.info.errorMessage,
      nextAttemptId: retainedInfo.info.nextAttemptId,
      state: retainedInfo.info.state,
    });
  }
}

// Clears materialized path strings so manual cleanup can reclaim path-cache
// memory without changing canonical topology or node IDs.
function clearPathCaches(state: PathStoreState): void {
  state.pathCacheVersion += 1;
  state.pathCacheByNodeId.clear();
  state.pathCacheByNodeId.set(state.snapshot.rootId, {
    path: '',
    version: state.pathCacheVersion,
  });
}

// Rebuilds the segment table and remaps live nodes to the compacted segment IDs
// while preserving externally observable node IDs.
function rebuildSegmentTablePreservingNodeIds(state: PathStoreState): void {
  const previousSegmentTable = state.snapshot.segmentTable;
  const nextSegmentTable = createSegmentTable();

  for (const node of state.snapshot.nodes) {
    if (!isLiveNode(node)) {
      continue;
    }

    if (hasNodeFlag(node, PATH_STORE_NODE_FLAG_ROOT)) {
      node.nameId = 0;
      continue;
    }

    node.nameId = internSegment(
      nextSegmentTable,
      getSegmentValue(previousSegmentTable, node.nameId)
    );
  }

  state.snapshot.segmentTable = nextSegmentTable;
}

// Reconstructs directory-side lookup maps and visible aggregates from live
// child IDs after cleanup has remapped segments or trimmed tombstones.
function rebuildDirectoryIndexes(state: PathStoreState): void {
  for (const [directoryId, directoryIndex] of state.snapshot.directories) {
    const directoryNode = state.snapshot.nodes[directoryId];
    if (!isLiveNode(directoryNode) || !isDirectoryNode(directoryNode)) {
      state.snapshot.directories.delete(directoryId);
      continue;
    }

    const liveChildIds = directoryIndex.childIds.filter((childId) => {
      const childNode = state.snapshot.nodes[childId];
      return isLiveNode(childNode) && childNode.parentId === directoryId;
    });

    directoryIndex.childIds = liveChildIds;
    directoryIndex.childIdByNameId = new Map(
      liveChildIds.map((childId) => [
        requireNode(state, childId).nameId,
        childId,
      ])
    );
    directoryIndex.childPositionById = new Map(
      liveChildIds.map((childId, childIndex) => [childId, childIndex])
    );
    rebuildDirectoryChildAggregates(state.snapshot.nodes, directoryIndex);
  }
}

// Stable cleanup can only reclaim node slots from the array tail, where
// dropping tombstones does not force any surviving ID to change.
function trimTrailingRemovedNodeSlots(state: PathStoreState): void {
  let lastNodeIndex = state.snapshot.nodes.length - 1;

  while (lastNodeIndex > state.snapshot.rootId) {
    const node = state.snapshot.nodes[lastNodeIndex];
    if (isLiveNode(node)) {
      break;
    }

    lastNodeIndex -= 1;
  }

  state.snapshot.nodes.length = lastNodeIndex + 1;
}

// Stable cleanup refreshes reclaimable secondary structures while keeping node
// IDs unchanged.
function runStableCleanup(state: PathStoreState): void {
  const persistedExpansionState = collectExpansionOverridePaths(state);
  const persistedLoadInfos = collectDirectoryLoadInfos(state);

  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.clearPathCaches',
    () => clearPathCaches(state)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.rebuildSegmentTable',
    () => rebuildSegmentTablePreservingNodeIds(state)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.rebuildDirectoryIndexes',
    () => rebuildDirectoryIndexes(state)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.trimTrailingRemovedNodeSlots',
    () => trimTrailingRemovedNodeSlots(state)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.restoreExpansionOverrides',
    () => restoreExpansionOverridePaths(state, persistedExpansionState)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.restoreDirectoryLoadInfos',
    () => restoreDirectoryLoadInfos(state, persistedLoadInfos)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.stable.recomputeCounts',
    () => recomputeCountsRecursive(state, state.snapshot.rootId)
  );
}

// Aggressive cleanup rebuilds a dense snapshot from canonical truth and then
// restores path-based expansion/load semantics onto the new snapshot.
function runAggressiveCleanup(state: PathStoreState): void {
  const persistedExpansionState = collectExpansionOverridePaths(state);
  const persistedLoadInfos = collectDirectoryLoadInfos(state);
  const canonicalPaths = withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.aggressive.listPaths',
    () => listPaths(state)
  );
  const builderOptions = attachBenchmarkInstrumentation(
    {
      ...state.snapshot.options,
    },
    state.instrumentation
  );
  const rebuiltSnapshot = withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.aggressive.rebuildSnapshot',
    () => {
      const builder = new PathStoreBuilder(builderOptions);
      builder.appendPaths(canonicalPaths);
      return builder.finish();
    }
  );

  state.snapshot = rebuiltSnapshot;
  state.activeNodeCount = rebuiltSnapshot.nodes.length - 1;
  state.pathCacheByNodeId = new Map([
    [rebuiltSnapshot.rootId, { path: '', version: 0 }],
  ]);
  state.pathCacheVersion = 0;

  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.aggressive.restoreExpansionOverrides',
    () => restoreExpansionOverridePaths(state, persistedExpansionState)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.aggressive.restoreDirectoryLoadInfos',
    () => restoreDirectoryLoadInfos(state, persistedLoadInfos)
  );
  withBenchmarkPhase(
    state.instrumentation,
    'store.cleanup.aggressive.recomputeCounts',
    () => recomputeCountsRecursive(state, state.snapshot.rootId)
  );
}

// Cleanup must not race active directory loads because both stable and
// aggressive modes would otherwise invalidate live attempt state.
export function hasActiveCleanupBlockingLoads(state: PathStoreState): boolean {
  for (const loadInfo of state.directoryLoadInfoById.values()) {
    if (loadInfo.state === 'loading' && loadInfo.activeAttemptId != null) {
      return true;
    }
  }

  return false;
}

// Runs the requested cleanup mode and returns before/after metrics so callers
// can judge compaction value without inferring it from unrelated events.
export function cleanupPathStoreState(
  state: PathStoreState,
  mode: PathStoreCleanupMode
): PathStoreCleanupResult {
  const before = createCleanupMetricSnapshot(state);

  if (mode === 'stable') {
    withBenchmarkPhase(state.instrumentation, 'store.cleanup.stable', () =>
      runStableCleanup(state)
    );
  } else {
    withBenchmarkPhase(state.instrumentation, 'store.cleanup.aggressive', () =>
      runAggressiveCleanup(state)
    );
  }

  const after = createCleanupMetricSnapshot(state);
  return createCleanupResult(mode, mode === 'stable', before, after);
}
