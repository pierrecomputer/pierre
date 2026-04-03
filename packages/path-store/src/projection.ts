import {
  collectAncestorIds,
  findNodeId,
  getDirectoryIndex,
  materializeNodePath,
  recomputeCountsUpwardFrom,
  requireNode,
} from './canonical';
import { selectChildIndexByVisibleIndex } from './child-index';
import {
  collectFlattenedDirectoryChainIds,
  getFlattenedTerminalDirectoryId,
} from './flatten';
import type { NodeId } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import type { PathStoreEvent, PathStoreVisibleRow } from './public-types';
import { getSegmentValue } from './segments';
import { isDirectoryExpanded, setDirectoryExpanded } from './state';
import type { PathStoreState } from './state';

interface VisibleRowCursor {
  headNodeId: NodeId;
  terminalNodeId: NodeId;
  visibleDepth: number;
}

export function getVisibleCount(state: PathStoreState): number {
  return requireNode(state, state.snapshot.rootId).visibleSubtreeCount;
}

export function getVisibleSlice(
  state: PathStoreState,
  start: number,
  end: number
): readonly PathStoreVisibleRow[] {
  const totalVisibleCount = getVisibleCount(state);
  if (totalVisibleCount <= 0 || end < start) {
    return [];
  }

  const normalizedStart = Math.max(0, Math.min(start, totalVisibleCount - 1));
  const normalizedEnd = Math.max(
    normalizedStart,
    Math.min(end, totalVisibleCount - 1)
  );

  const rows: PathStoreVisibleRow[] = [];
  let currentCursor = selectVisibleRow(state, normalizedStart);

  for (
    let visibleIndex = normalizedStart;
    visibleIndex <= normalizedEnd && currentCursor != null;
    visibleIndex++
  ) {
    rows.push(materializeVisibleRow(state, currentCursor));
    currentCursor = getNextVisibleRowCursor(state, currentCursor);
  }

  return rows;
}

export function expandPath(
  state: PathStoreState,
  path: string
): PathStoreEvent | null {
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
  return {
    affectedAncestorIds: collectAncestorIds(state, directoryNodeId),
    affectedNodeIds: [directoryNodeId],
    changeset: { path },
    operation: 'expand',
  };
}

export function collapsePath(
  state: PathStoreState,
  path: string
): PathStoreEvent | null {
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
  return {
    affectedAncestorIds: collectAncestorIds(state, directoryNodeId),
    affectedNodeIds: [directoryNodeId],
    changeset: { path },
    operation: 'collapse',
  };
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
  const { childIndex, localVisibleIndex } = selectChildIndexByVisibleIndex(
    state.snapshot.nodes,
    directoryIndex,
    index
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

  return {
    headNodeId: nodeId,
    terminalNodeId: getFlattenedTerminalDirectoryId(state, nodeId),
    visibleDepth,
  };
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
    const siblingIndex = parentIndex.childPositionById.get(currentNodeId) ?? -1;
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

    if (currentNodeId === currentCursor.headNodeId) {
      currentVisibleDepth--;
    }

    currentNodeId = parentId;
  }
}

function materializeVisibleRow(
  state: PathStoreState,
  cursor: VisibleRowCursor
): PathStoreVisibleRow {
  const terminalNode = requireNode(state, cursor.terminalNodeId);
  const path = materializeNodePath(state, cursor.terminalNodeId);
  const name = getSegmentValue(
    state.snapshot.segmentTable,
    terminalNode.nameId
  );
  const hasChildren =
    terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    getDirectoryIndex(state, cursor.terminalNodeId).childIds.length > 0;
  const isFlattened = cursor.headNodeId !== cursor.terminalNodeId;
  const flattenedSegments = isFlattened
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
    isLoading: false,
    kind:
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY
        ? 'directory'
        : 'file',
    name,
    path,
  };
}
