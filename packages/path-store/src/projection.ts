import {
  collectAncestorIds,
  findNodeId,
  getDirectoryIndex,
  materializeNodePath,
  recomputeCountsUpwardFrom,
  requireNode,
} from './canonical';
import {
  ensureChildPositions,
  selectChildIndexByVisibleIndex,
} from './child-index';
import { createCollapseEvent, createExpandEvent } from './events';
import {
  collectFlattenedDirectoryChainIds,
  getFlattenedChildDirectoryId,
  getFlattenedTerminalDirectoryId,
} from './flatten';
import type { DirectoryChildIndex, NodeId } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import {
  setBenchmarkCounter,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import type {
  PathStoreCollapseEvent,
  PathStoreDirectoryLoadState,
  PathStoreExpandEvent,
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjection,
  PathStoreVisibleTreeProjectionData,
  PathStoreVisibleTreeProjectionRow,
} from './public-types';
import { getSegmentValue } from './segments';
import {
  getDirectoryLoadState,
  isDirectoryExpanded,
  setDirectoryExpanded,
} from './state';
import type { PathStoreState } from './state';

const INITIAL_PROJECTION_DEPTH_CAPACITY = 64;
type ProjectionDepthTable = Int32Array<ArrayBufferLike>;

interface VisibleRowCursor {
  headNodeId: NodeId;
  terminalNodeId: NodeId;
  visibleDepth: number;
}

function ensureProjectionDepthCapacity(
  depthTable: ProjectionDepthTable,
  depth: number
): ProjectionDepthTable {
  const requiredLength = depth + 2;
  if (requiredLength <= depthTable.length) {
    return depthTable;
  }

  let nextLength = depthTable.length;
  while (nextLength < requiredLength) {
    nextLength *= 2;
  }

  const nextDepthTable = new Int32Array(nextLength);
  nextDepthTable.fill(-1);
  nextDepthTable.set(depthTable);
  return nextDepthTable;
}

export function getVisibleCount(state: PathStoreState): number {
  return requireNode(state, state.snapshot.rootId).visibleSubtreeCount;
}

export function getVisibleSlice(
  state: PathStoreState,
  start: number,
  end: number
): readonly PathStoreVisibleRow[] {
  const instrumentation = state.instrumentation;
  const totalVisibleCount = getVisibleCount(state);
  if (totalVisibleCount <= 0 || end < start) {
    return [];
  }

  const normalizedStart = Math.max(0, Math.min(start, totalVisibleCount - 1));
  const normalizedEnd = Math.max(
    normalizedStart,
    Math.min(end, totalVisibleCount - 1)
  );

  if (instrumentation == null) {
    // Fast path: full-tree DFS avoids the expensive parent-walk for finding
    // next siblings that getNextVisibleRowCursor performs.
    if (normalizedStart === 0) {
      return collectVisibleRowsDFS(state, normalizedEnd + 1);
    }

    const rows: PathStoreVisibleRow[] = [];
    let currentCursor = selectVisibleRow(state, normalizedStart);

    for (
      let visibleIndex = normalizedStart;
      visibleIndex <= normalizedEnd && currentCursor != null;
      visibleIndex++
    ) {
      const row = materializeVisibleRow(state, currentCursor);
      rows.push(row);
      currentCursor = getNextVisibleRowCursor(state, currentCursor);
    }

    return rows;
  }

  const rows: PathStoreVisibleRow[] = [];
  let flattenedRowCount = 0;
  let flattenedSegmentCount = 0;
  let currentCursor = withBenchmarkPhase(
    instrumentation,
    'store.getVisibleSlice.selectFirstRow',
    () => selectVisibleRow(state, normalizedStart)
  );

  for (
    let visibleIndex = normalizedStart;
    visibleIndex <= normalizedEnd && currentCursor != null;
    visibleIndex++
  ) {
    const row = withBenchmarkPhase(
      instrumentation,
      'store.getVisibleSlice.materializeRow',
      () => materializeVisibleRow(state, currentCursor as VisibleRowCursor)
    );
    rows.push(row);
    if (row.isFlattened) {
      flattenedRowCount++;
      flattenedSegmentCount += row.flattenedSegments?.length ?? 0;
    }
    currentCursor = withBenchmarkPhase(
      instrumentation,
      'store.getVisibleSlice.advanceCursor',
      () => getNextVisibleRowCursor(state, currentCursor as VisibleRowCursor)
    );
  }

  setBenchmarkCounter(instrumentation, 'workload.visibleRowsRead', rows.length);
  setBenchmarkCounter(
    instrumentation,
    'workload.flattenedRowsRead',
    flattenedRowCount
  );
  setBenchmarkCounter(
    instrumentation,
    'workload.flattenedSegmentsRead',
    flattenedSegmentCount
  );
  return rows;
}

export function getVisibleTreeProjectionData(
  state: PathStoreState,
  maxRows: number = getVisibleCount(state)
): PathStoreVisibleTreeProjectionData {
  const instrumentation = state.instrumentation;
  if (instrumentation == null) {
    return buildVisibleTreeProjectionDataDFS(state, maxRows);
  }

  return withBenchmarkPhase(
    instrumentation,
    'store.getVisibleTreeProjection',
    () => buildVisibleTreeProjectionDataDFS(state, maxRows)
  );
}

export function getVisibleTreeProjection(
  state: PathStoreState
): PathStoreVisibleTreeProjection {
  return createVisibleTreeProjectionFromData(
    getVisibleTreeProjectionData(state)
  );
}

export function expandPath(
  state: PathStoreState,
  path: string
): PathStoreExpandEvent | null {
  const directoryNodeId = findNodeId(state, path);
  if (directoryNodeId == null) {
    throw new Error(`Path does not exist: "${path}"`);
  }

  const directoryNode = requireNode(state, directoryNodeId);
  if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    throw new Error(`Path is not a directory: "${path}"`);
  }

  if (isDirectoryExpanded(state, directoryNodeId, directoryNode)) {
    return null;
  }

  setDirectoryExpanded(state, directoryNodeId, true, directoryNode);
  recomputeCountsUpwardFrom(state, directoryNodeId);
  return createExpandEvent({
    affectedAncestorIds: collectAncestorIds(state, directoryNodeId),
    affectedNodeIds: [directoryNodeId],
    path,
    projectionChanged: true,
  });
}

export function collapsePath(
  state: PathStoreState,
  path: string
): PathStoreCollapseEvent | null {
  const directoryNodeId = findNodeId(state, path);
  if (directoryNodeId == null) {
    throw new Error(`Path does not exist: "${path}"`);
  }

  const directoryNode = requireNode(state, directoryNodeId);
  if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    throw new Error(`Path is not a directory: "${path}"`);
  }

  if (!isDirectoryExpanded(state, directoryNodeId, directoryNode)) {
    return null;
  }

  setDirectoryExpanded(state, directoryNodeId, false, directoryNode);
  recomputeCountsUpwardFrom(state, directoryNodeId);
  return createCollapseEvent({
    affectedAncestorIds: collectAncestorIds(state, directoryNodeId),
    affectedNodeIds: [directoryNodeId],
    path,
    projectionChanged: true,
  });
}

function selectVisibleRow(
  state: PathStoreState,
  index: number
): VisibleRowCursor | null {
  if (index < 0 || index >= getVisibleCount(state)) {
    return null;
  }

  return selectVisibleRowWithinDirectory(
    state,
    state.snapshot.rootId,
    index,
    -1
  );
}

function selectVisibleRowWithinDirectory(
  state: PathStoreState,
  directoryNodeId: NodeId,
  index: number,
  parentVisibleDepth: number
): VisibleRowCursor {
  const directoryIndex = getDirectoryIndex(state, directoryNodeId);
  const instrumentation = state.instrumentation;
  const { childIndex, localVisibleIndex } =
    instrumentation == null
      ? selectChildIndexByVisibleIndex(
          state.snapshot.nodes,
          directoryIndex,
          index
        )
      : withBenchmarkPhase(
          instrumentation,
          'store.getVisibleSlice.selectChildIndex',
          () =>
            selectChildIndexByVisibleIndex(
              state.snapshot.nodes,
              directoryIndex,
              index
            )
        );
  const childId = directoryIndex.childIds[childIndex];
  if (childId != null) {
    return selectVisibleRowWithinSubtree(
      state,
      childId,
      localVisibleIndex,
      parentVisibleDepth + 1
    );
  }

  throw new Error(`Visible index ${String(index)} is out of range`);
}

function selectVisibleRowWithinSubtree(
  state: PathStoreState,
  nodeId: NodeId,
  index: number,
  visibleDepth: number
): VisibleRowCursor {
  const node = requireNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    if (index === 0) {
      return {
        headNodeId: nodeId,
        terminalNodeId: nodeId,
        visibleDepth,
      };
    }

    throw new Error(`Visible index ${String(index)} is out of range for file`);
  }

  const currentCursor = createVisibleRowCursor(state, nodeId, visibleDepth);
  if (index === 0) {
    return currentCursor;
  }

  const terminalNode = requireNode(state, currentCursor.terminalNodeId);
  if (
    terminalNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
    !isDirectoryExpanded(state, currentCursor.terminalNodeId, terminalNode)
  ) {
    throw new Error(
      `Visible index ${String(index)} is out of range for collapsed directory`
    );
  }

  return selectVisibleRowWithinDirectory(
    state,
    currentCursor.terminalNodeId,
    index - 1,
    currentCursor.visibleDepth
  );
}

function createVisibleRowCursor(
  state: PathStoreState,
  nodeId: NodeId,
  visibleDepth: number
): VisibleRowCursor {
  const node = requireNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return {
      headNodeId: nodeId,
      terminalNodeId: nodeId,
      visibleDepth,
    };
  }

  if (state.instrumentation == null) {
    return {
      headNodeId: nodeId,
      terminalNodeId: getFlattenedTerminalDirectoryId(state, nodeId),
      visibleDepth,
    };
  }

  return {
    headNodeId: nodeId,
    terminalNodeId: withBenchmarkPhase(
      state.instrumentation,
      'store.getVisibleSlice.flatten.resolveTerminalDirectory',
      () => getFlattenedTerminalDirectoryId(state, nodeId)
    ),
    visibleDepth,
  };
}

function isVisibleRowHeadNode(state: PathStoreState, nodeId: NodeId): boolean {
  const node = requireNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return true;
  }

  const parentId = node.parentId;
  if (parentId === state.snapshot.rootId) {
    return true;
  }

  return getFlattenedChildDirectoryId(state, parentId) !== nodeId;
}

// Walks the visible preorder sequence without materializing the full row list.
function getNextVisibleRowCursor(
  state: PathStoreState,
  currentCursor: VisibleRowCursor
): VisibleRowCursor | null {
  const terminalNode = requireNode(state, currentCursor.terminalNodeId);
  if (terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
    const currentIndex = getDirectoryIndex(state, currentCursor.terminalNodeId);
    if (
      isDirectoryExpanded(state, currentCursor.terminalNodeId, terminalNode) &&
      currentIndex.childIds.length > 0
    ) {
      const firstChildId = currentIndex.childIds[0];
      return firstChildId == null
        ? null
        : selectVisibleRowWithinSubtree(
            state,
            firstChildId,
            0,
            currentCursor.visibleDepth + 1
          );
    }
  }

  let currentNodeId: NodeId = currentCursor.terminalNodeId;
  let currentVisibleDepth = currentCursor.visibleDepth;
  while (true) {
    const currentNode = requireNode(state, currentNodeId);
    if (currentNodeId === state.snapshot.rootId) {
      return null;
    }

    const parentId = currentNode.parentId;
    const parentIndex = getDirectoryIndex(state, parentId);
    const siblingIndex =
      ensureChildPositions(parentIndex).get(currentNodeId) ?? -1;
    if (siblingIndex < 0) {
      throw new Error(
        `Child ${String(currentNodeId)} was not found in its parent index`
      );
    }

    const nextSiblingId = parentIndex.childIds[siblingIndex + 1] ?? null;
    if (nextSiblingId != null) {
      return selectVisibleRowWithinSubtree(
        state,
        nextSiblingId,
        0,
        currentVisibleDepth
      );
    }

    if (isVisibleRowHeadNode(state, currentNodeId)) {
      currentVisibleDepth--;
    }
    currentNodeId = parentId;
  }
}

function createVisibleTreeProjectionFromData(
  projection: PathStoreVisibleTreeProjectionData
): PathStoreVisibleTreeProjection {
  const rowCount = projection.paths.length;
  const projectionRows: PathStoreVisibleTreeProjectionRow[] = new Array(
    rowCount
  );

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const parentIndex = projection.getParentIndex(rowIndex);
    projectionRows[rowIndex] = {
      index: rowIndex,
      parentPath:
        parentIndex >= 0 ? (projection.paths[parentIndex] ?? null) : null,
      path: projection.paths[rowIndex] ?? '',
      posInSet: projection.posInSetByIndex[rowIndex] ?? 0,
      setSize: projection.setSizeByIndex[rowIndex] ?? 0,
    };
  }

  return {
    getParentIndex: projection.getParentIndex,
    rows: projectionRows,
    get visibleIndexByPath(): Map<string, number> {
      return projection.visibleIndexByPath;
    },
  };
}

// Walks the full visible preorder and builds the ARIA projection data directly
// into path and typed-array buffers so tree startup can avoid allocating a
// projection row object for every visible item.
function buildVisibleTreeProjectionDataDFS(
  state: PathStoreState,
  maxRows: number
): PathStoreVisibleTreeProjectionData {
  const paths = new Array<string>(maxRows);
  const parentRowIndex = new Int32Array(maxRows);
  const posInSetByIndex = new Int32Array(maxRows);
  const setSizeByIndex = new Int32Array(maxRows);
  let lastRowAtDepth: ProjectionDepthTable = new Int32Array(
    INITIAL_PROJECTION_DEPTH_CAPACITY
  );
  lastRowAtDepth.fill(-1);

  let rowCount = 0;
  const { nodes, directories, segmentTable } = state.snapshot;
  const stack: Array<[DirectoryChildIndex, number, number, string]> = [
    [directories.get(state.snapshot.rootId)!, 0, -1, ''],
  ];
  const flattenEnabled = state.snapshot.options.flattenEmptyDirectories;
  const pathCacheVersion = state.pathCacheVersion;
  const segmentValues = segmentTable.valueById;

  while (stack.length > 0 && rowCount < maxRows) {
    const frame = stack[stack.length - 1];
    const dirIndex = frame[0];

    if (frame[1] >= dirIndex.childIds.length) {
      stack.pop();
      continue;
    }

    const childOffset = frame[1];
    const childId = dirIndex.childIds[frame[1]++];
    const childNode = nodes[childId];
    const visibleDepth = frame[2] + 1;
    const parentPath = frame[3];
    lastRowAtDepth = ensureProjectionDepthCapacity(
      lastRowAtDepth,
      visibleDepth
    );

    let path: string;
    let terminalNodeId = childId;
    if (childNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      path =
        childNode.pathCache != null &&
        childNode.pathCacheVersion === pathCacheVersion
          ? childNode.pathCache
          : `${parentPath}${segmentValues[childNode.nameId]}`;
    } else {
      terminalNodeId = flattenEnabled
        ? getFlattenedTerminalDirectoryId(state, childId)
        : childId;
      path =
        terminalNodeId === childId
          ? `${parentPath}${segmentValues[childNode.nameId]}/`
          : materializeNodePath(state, terminalNodeId);
    }

    const parentIdx = lastRowAtDepth[visibleDepth];
    parentRowIndex[rowCount] = parentIdx;
    paths[rowCount] = path;
    posInSetByIndex[rowCount] = childOffset;
    // The current frame iterates the full child array for the row's parent, so
    // childIds.length stays correct even when we cap the emitted projection.
    setSizeByIndex[rowCount] = dirIndex.childIds.length;
    lastRowAtDepth[visibleDepth + 1] = rowCount;

    rowCount += 1;

    const terminalNode = nodes[terminalNodeId];
    if (
      terminalNode != null &&
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      isDirectoryExpanded(state, terminalNodeId, terminalNode)
    ) {
      stack.push([directories.get(terminalNodeId)!, 0, visibleDepth, path]);
    }
  }

  if (rowCount < maxRows) {
    paths.length = rowCount;
  }

  const finalParentRowIndex = parentRowIndex.subarray(0, rowCount);
  const finalPosInSetByIndex = posInSetByIndex.subarray(0, rowCount);
  const finalSetSizeByIndex = setSizeByIndex.subarray(0, rowCount);
  let cachedVisibleIndexByPath: Map<string, number> | null = null;
  return {
    getParentIndex(index: number): number {
      return index < 0 || index >= rowCount
        ? -1
        : (finalParentRowIndex[index] ?? -1);
    },
    paths,
    posInSetByIndex: finalPosInSetByIndex,
    setSizeByIndex: finalSetSizeByIndex,
    get visibleIndexByPath(): Map<string, number> {
      if (cachedVisibleIndexByPath == null) {
        cachedVisibleIndexByPath = new Map<string, number>();
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          cachedVisibleIndexByPath.set(paths[rowIndex] ?? '', rowIndex);
        }
      }

      return cachedVisibleIndexByPath;
    },
  };
}

// Iterative depth-first traversal that collects visible rows by walking the
// child arrays directly.  This is faster than the cursor-based approach for
// large contiguous slices starting from index 0, because it never needs to
// walk up the tree to locate the next sibling.
function collectVisibleRowsDFS(
  state: PathStoreState,
  maxRows: number
): PathStoreVisibleRow[] {
  // Pre-allocate output array to avoid dynamic resizing from push().
  const rows: PathStoreVisibleRow[] = new Array(maxRows);
  let rowCount = 0;
  // Stack frame: [directoryChildIndex, childOffset, visibleDepth]
  // Caching the DirectoryChildIndex directly avoids a Map.get per child
  // iteration — the lookup is done once when entering the directory.
  const { nodes, directories, segmentTable } = state.snapshot;
  const stack: Array<[DirectoryChildIndex, number, number]> = [
    [directories.get(state.snapshot.rootId)!, 0, -1],
  ];
  const segmentValues = segmentTable.valueById;
  const flattenEnabled = state.snapshot.options.flattenEmptyDirectories;
  const pathCacheVersion = state.pathCacheVersion;

  while (stack.length > 0 && rowCount < maxRows) {
    const frame = stack[stack.length - 1];
    const dirIndex = frame[0];

    if (frame[1] >= dirIndex.childIds.length) {
      stack.pop();
      continue;
    }

    const childId = dirIndex.childIds[frame[1]++];
    const childNode = nodes[childId];

    const visibleDepth = frame[2] + 1;

    if (childNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      // File node — inline materialization avoids cursor allocation and
      // directory-specific checks (load state, flattening, expansion).
      rows[rowCount++] = {
        depth: visibleDepth,
        flattenedSegments: undefined,
        hasChildren: false,
        id: childId,
        isExpanded: false,
        isFlattened: false,
        isLoading: false,
        kind: 'file',
        loadState: undefined,
        name: segmentValues[childNode.nameId],
        path:
          childNode.pathCache != null &&
          childNode.pathCacheVersion === pathCacheVersion
            ? childNode.pathCache
            : materializeNodePath(state, childId),
      };
      continue;
    }

    // Directory node — delegate to materializeVisibleRow which correctly
    // handles load states, flattened chains, and all edge cases.
    const terminalNodeId = flattenEnabled
      ? getFlattenedTerminalDirectoryId(state, childId)
      : childId;
    const cursor: VisibleRowCursor = {
      headNodeId: childId,
      terminalNodeId,
      visibleDepth,
    };
    rows[rowCount++] = materializeVisibleRow(state, cursor);

    // Descend into expanded directories.
    const terminalNode = nodes[terminalNodeId];
    if (
      terminalNode != null &&
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      isDirectoryExpanded(state, terminalNodeId, terminalNode)
    ) {
      stack.push([directories.get(terminalNodeId)!, 0, visibleDepth]);
    }
  }

  if (rowCount < maxRows) {
    rows.length = rowCount;
  }

  return rows;
}

function materializeVisibleRow(
  state: PathStoreState,
  cursor: VisibleRowCursor
): PathStoreVisibleRow {
  const terminalNode = requireNode(state, cursor.terminalNodeId);
  const loadState =
    terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY
      ? getVisibleRowLoadState(state, cursor)
      : null;
  const path = materializeNodePath(state, cursor.terminalNodeId);
  const name = getSegmentValue(
    state.snapshot.segmentTable,
    terminalNode.nameId
  );
  const hasChildren =
    terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    getDirectoryIndex(state, cursor.terminalNodeId).childIds.length > 0;
  const isFlattened = cursor.headNodeId !== cursor.terminalNodeId;
  const instrumentation = state.instrumentation;
  const flattenedSegments = isFlattened
    ? instrumentation == null
      ? collectFlattenedDirectoryChainIds(state, cursor.headNodeId).map(
          (nodeId) => {
            const node = requireNode(state, nodeId);
            return {
              isTerminal: nodeId === cursor.terminalNodeId,
              name: getSegmentValue(state.snapshot.segmentTable, node.nameId),
              nodeId,
              path: materializeNodePath(state, nodeId),
            };
          }
        )
      : withBenchmarkPhase(
          instrumentation,
          'store.getVisibleSlice.flatten.collectSegments',
          () =>
            collectFlattenedDirectoryChainIds(state, cursor.headNodeId).map(
              (nodeId) => {
                const node = requireNode(state, nodeId);
                return {
                  isTerminal: nodeId === cursor.terminalNodeId,
                  name: getSegmentValue(
                    state.snapshot.segmentTable,
                    node.nameId
                  ),
                  nodeId,
                  path: materializeNodePath(state, nodeId),
                };
              }
            )
        )
    : undefined;

  return {
    depth: cursor.visibleDepth,
    flattenedSegments,
    hasChildren,
    id: cursor.terminalNodeId,
    isExpanded:
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      isDirectoryExpanded(state, cursor.terminalNodeId, terminalNode),
    isFlattened,
    isLoading: loadState === 'loading',
    kind:
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY
        ? 'directory'
        : 'file',
    loadState:
      loadState == null || loadState === 'loaded'
        ? undefined
        : (loadState as PathStoreDirectoryLoadState),
    name,
    path,
  };
}

function getVisibleRowLoadState(
  state: PathStoreState,
  cursor: VisibleRowCursor
): PathStoreDirectoryLoadState {
  if (cursor.headNodeId === cursor.terminalNodeId) {
    return getDirectoryLoadState(state, cursor.terminalNodeId);
  }

  const chainNodeIds = collectFlattenedDirectoryChainIds(
    state,
    cursor.headNodeId
  );
  let hasUnloaded = false;
  let hasError = false;

  for (const nodeId of chainNodeIds) {
    const loadState = getDirectoryLoadState(state, nodeId);
    if (loadState === 'loading') {
      return 'loading';
    }

    if (loadState === 'error') {
      hasError = true;
      continue;
    }

    if (loadState === 'unloaded') {
      hasUnloaded = true;
    }
  }

  if (hasError) {
    return 'error';
  }

  if (hasUnloaded) {
    return 'unloaded';
  }

  return 'loaded';
}
