import {
  collectAncestorIds,
  findNodeId,
  getDirectoryIndex,
  materializeNodePath,
  recomputeCountsUpwardFrom,
  requireNode,
} from './canonical';
import { selectChildIndexByVisibleIndex } from './child-index';
import type { NodeId } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import type { PathStoreEvent, PathStoreVisibleRow } from './public-types';
import { getSegmentValue } from './segments';
import { isDirectoryExpanded, setDirectoryExpanded } from './state';
import type { PathStoreState } from './state';

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
  let currentNodeId = selectVisibleNode(state, normalizedStart);

  for (
    let visibleIndex = normalizedStart;
    visibleIndex <= normalizedEnd && currentNodeId != null;
    visibleIndex++
  ) {
    rows.push(materializeVisibleRow(state, currentNodeId));
    currentNodeId = getNextVisibleNodeId(state, currentNodeId);
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

function selectVisibleNode(
  state: PathStoreState,
  index: number
): NodeId | null {
  if (index < 0 || index >= getVisibleCount(state)) {
    return null;
  }

  return selectVisibleNodeWithinDirectory(state, state.snapshot.rootId, index);
}

function selectVisibleNodeWithinDirectory(
  state: PathStoreState,
  directoryNodeId: NodeId,
  index: number
): NodeId {
  const directoryIndex = getDirectoryIndex(state, directoryNodeId);
  const { childIndex, localVisibleIndex } = selectChildIndexByVisibleIndex(
    state.snapshot.nodes,
    directoryIndex,
    index
  );
  const childId = directoryIndex.childIds[childIndex];
  if (childId != null) {
    return selectVisibleNodeWithinSubtree(state, childId, localVisibleIndex);
  }

  throw new Error(`Visible index ${String(index)} is out of range`);
}

function selectVisibleNodeWithinSubtree(
  state: PathStoreState,
  nodeId: NodeId,
  index: number
): NodeId {
  const node = requireNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    if (index === 0) {
      return nodeId;
    }

    throw new Error(`Visible index ${String(index)} is out of range for file`);
  }

  if (index === 0) {
    return nodeId;
  }

  if (!isDirectoryExpanded(state, nodeId, node)) {
    throw new Error(
      `Visible index ${String(index)} is out of range for collapsed directory`
    );
  }

  return selectVisibleNodeWithinDirectory(state, nodeId, index - 1);
}

// Walks the visible preorder sequence without materializing the full row list.
function getNextVisibleNodeId(
  state: PathStoreState,
  nodeId: NodeId
): NodeId | null {
  const node = requireNode(state, nodeId);
  if (node.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
    const currentIndex = getDirectoryIndex(state, nodeId);
    if (
      isDirectoryExpanded(state, nodeId, node) &&
      currentIndex.childIds.length > 0
    ) {
      return currentIndex.childIds[0] ?? null;
    }
  }

  let currentNodeId: NodeId = nodeId;
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
      return nextSiblingId;
    }

    currentNodeId = parentId;
  }
}

function materializeVisibleRow(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreVisibleRow {
  const node = requireNode(state, nodeId);
  const path = materializeNodePath(state, nodeId);
  const name = getSegmentValue(state.snapshot.segmentTable, node.nameId);
  const hasChildren =
    node.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    getDirectoryIndex(state, nodeId).childIds.length > 0;

  return {
    depth: node.depth - 1,
    hasChildren,
    id: nodeId,
    isExpanded:
      node.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      isDirectoryExpanded(state, nodeId, node),
    isFlattened: false,
    isLoading: false,
    kind: node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? 'directory' : 'file',
    name,
    path,
  };
}
