import {
  applyChildAggregateDelta,
  createDirectoryChildIndex,
  rebuildDirectoryChildAggregates,
  rebuildVisibleChildChunks,
  updateChildPositionsFrom,
} from './child-index';
import { createAddEvent, createMoveEvent, createRemoveEvent } from './events';
import { getFlattenedChildDirectoryId } from './flatten';
import type {
  DirectoryChildIndex,
  NodeId,
  PathStoreNode,
} from './internal-types';
import { PATH_STORE_NODE_FLAG_EXPLICIT } from './internal-types';
import { PATH_STORE_NODE_FLAG_REMOVED } from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import { PATH_STORE_NODE_KIND_FILE } from './internal-types';
import { withBenchmarkPhase } from './internal/benchmarkInstrumentation';
import { parseInputPath, parseLookupPath } from './path';
import type {
  PathStoreAddEvent,
  PathStoreCollisionStrategy,
  PathStoreCompareEntry,
  PathStoreMoveEvent,
  PathStoreMoveOptions,
  PathStoreRemoveEvent,
  PathStoreRemoveOptions,
} from './public-types';
import { getSegmentValue, internSegment } from './segments';
import { compareSegmentSortKeys, getSegmentSortKey } from './sort';
import { clearDirectoryLoadInfo, isDirectoryExpanded } from './state';
import type { MoveTarget, PathStoreState } from './state';

export function listPaths(state: PathStoreState, path?: string): string[] {
  const nodeId = path == null ? state.snapshot.rootId : findNodeId(state, path);
  if (nodeId == null) {
    return [];
  }

  return collectCanonicalEntries(state, nodeId);
}

export function addPath(
  state: PathStoreState,
  path: string
): PathStoreAddEvent {
  const preparedPath = parseInputPath(path);
  const parentSegments = preparedPath.isDirectory
    ? preparedPath.segments
    : preparedPath.segments.slice(0, -1);
  const { createdNodeIds, directoryId } = ensureDirectoryChain(
    state,
    parentSegments
  );

  const affectedNodeIds = new Set<NodeId>(createdNodeIds);
  const previousChildCount = getDirectoryIndex(state, directoryId).childIds
    .length;
  let addedNodeId = directoryId;

  if (preparedPath.isDirectory) {
    const directoryNode = requireNode(state, directoryId);
    if ((directoryNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0) {
      throw new Error(`Path already exists: "${path}"`);
    }

    directoryNode.flags |= PATH_STORE_NODE_FLAG_EXPLICIT;
    directoryNode.pathCache = path;
    directoryNode.pathCacheVersion = state.pathCacheVersion;
    affectedNodeIds.add(directoryId);
  } else {
    addedNodeId = createFileNode(state, directoryId, preparedPath.basename);
    affectedNodeIds.add(addedNodeId);
  }

  recomputeCountsUpwardFrom(state, directoryId);
  return createAddEvent({
    affectedAncestorIds: collectAncestorIds(state, addedNodeId),
    affectedNodeIds: [...affectedNodeIds],
    path,
    projectionChanged: didAddAffectProjection(
      state,
      directoryId,
      previousChildCount
    ),
  });
}

export function removePath(
  state: PathStoreState,
  path: string,
  options: PathStoreRemoveOptions
): PathStoreRemoveEvent {
  const nodeId = findNodeId(state, path);
  if (nodeId == null) {
    throw new Error(`Path does not exist: "${path}"`);
  }

  const node = requireNode(state, nodeId);
  if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    throw new Error('The root node cannot be removed');
  }

  if (
    node.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    getDirectoryIndex(state, nodeId).childIds.length > 0 &&
    options.recursive !== true
  ) {
    throw new Error(
      `Cannot remove a non-empty directory without recursive: "${path}"`
    );
  }

  const parentId = node.parentId;
  const previousChildCount = getDirectoryIndex(state, parentId).childIds.length;
  const removedNodeIds = removeSubtree(state, nodeId);
  removeChildReference(state, parentId, nodeId, node.nameId);
  promoteEmptyAncestorsToExplicit(state, parentId);
  recomputeCountsUpwardFrom(state, parentId);

  return createRemoveEvent({
    affectedAncestorIds: collectAncestorIds(state, parentId),
    affectedNodeIds: removedNodeIds,
    path,
    projectionChanged: didRemoveAffectProjection(
      state,
      parentId,
      previousChildCount
    ),
    recursive: options.recursive === true,
  });
}

export function movePath(
  state: PathStoreState,
  fromPath: string,
  toPath: string,
  options: PathStoreMoveOptions
): PathStoreMoveEvent | null {
  const sourceNodeId = findNodeId(state, fromPath);
  if (sourceNodeId == null) {
    throw new Error(`Source path does not exist: "${fromPath}"`);
  }

  const sourceNode = requireNode(state, sourceNodeId);
  if ((sourceNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    throw new Error('The root node cannot be moved');
  }

  const collision = options.collision ?? 'error';
  const moveTarget = resolveMoveTarget(state, sourceNodeId, toPath);
  const previousParentChildCount = getDirectoryIndex(state, sourceNode.parentId)
    .childIds.length;
  const targetParentChildCount = getDirectoryIndex(state, moveTarget.parentId)
    .childIds.length;
  const sourceName = getSegmentValue(
    state.snapshot.segmentTable,
    sourceNode.nameId
  );
  const targetNameId = internSegment(
    state.snapshot.segmentTable,
    moveTarget.basename
  );

  if (
    moveTarget.parentId === sourceNode.parentId &&
    sourceName === moveTarget.basename
  ) {
    return null;
  }

  if (
    sourceNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    isAncestor(state, sourceNodeId, moveTarget.parentId)
  ) {
    throw new Error('Cannot move a directory into one of its descendants');
  }

  const siblingCollisionId = getDirectoryIndex(
    state,
    moveTarget.parentId
  ).childIdByNameId.get(targetNameId);
  const collisionNodeId =
    moveTarget.existingNodeId ?? siblingCollisionId ?? null;
  if (collisionNodeId != null && collisionNodeId !== sourceNodeId) {
    const resolvedCollision = handleMoveCollision(
      state,
      collisionNodeId,
      collision,
      sourceNode.kind
    );
    if (resolvedCollision === 'skip') {
      return null;
    }
  }

  const previousParentId = sourceNode.parentId;
  removeChildReference(
    state,
    previousParentId,
    sourceNodeId,
    sourceNode.nameId
  );

  sourceNode.parentId = moveTarget.parentId;
  sourceNode.nameId = targetNameId;
  sourceNode.pathCache = null;
  sourceNode.pathCacheVersion = -1;
  recomputeDepths(state, sourceNodeId);
  insertChildReference(state, moveTarget.parentId, sourceNodeId);
  promoteEmptyAncestorsToExplicit(state, previousParentId);
  state.pathCacheVersion++;
  recomputeCountsUpwardFrom(state, previousParentId);
  if (moveTarget.parentId !== previousParentId) {
    recomputeCountsUpwardFrom(state, moveTarget.parentId);
  }

  return createMoveEvent({
    affectedAncestorIds: [
      ...new Set([
        ...collectAncestorIds(state, previousParentId),
        ...collectAncestorIds(state, moveTarget.parentId),
      ]),
    ],
    affectedNodeIds: [sourceNodeId],
    from: fromPath,
    projectionChanged: didMoveAffectProjection(
      state,
      sourceNodeId,
      previousParentId,
      previousParentChildCount,
      moveTarget.parentId,
      targetParentChildCount
    ),
    to: materializeNodePath(state, sourceNodeId),
  });
}

// Materializes canonical paths only for nodes the caller actually touches, so
// folder moves stay local instead of rewriting descendant strings eagerly.
export function materializeNodePath(
  state: PathStoreState,
  nodeId: NodeId
): string {
  const node = requireNode(state, nodeId);

  if (
    node.pathCache != null &&
    node.pathCacheVersion === state.pathCacheVersion
  ) {
    return node.pathCache;
  }

  if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    node.pathCache = '';
    node.pathCacheVersion = state.pathCacheVersion;
    return node.pathCache;
  }

  const parentPath = materializeNodePath(state, node.parentId);
  const nodeName = getSegmentValue(state.snapshot.segmentTable, node.nameId);
  const path = parentPath.length === 0 ? nodeName : `${parentPath}${nodeName}`;
  node.pathCache =
    node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? `${path}/` : path;
  node.pathCacheVersion = state.pathCacheVersion;
  return node.pathCache;
}

export function recomputeCountsUpwardFrom(
  state: PathStoreState,
  startNodeId: NodeId
): void {
  const instrumentation = state.instrumentation;
  if (instrumentation == null) {
    recomputeCountsUpwardFromNow(state, startNodeId);
    return;
  }

  withBenchmarkPhase(instrumentation, 'store.recomputeCountsUpwardFrom', () =>
    recomputeCountsUpwardFromNow(state, startNodeId)
  );
}

export function recomputeCountsRecursive(
  state: PathStoreState,
  nodeId: NodeId
): void {
  const currentNode = requireNode(state, nodeId);
  if (currentNode.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
    const currentIndex = getDirectoryIndex(state, nodeId);
    for (const childId of currentIndex.childIds) {
      recomputeCountsRecursive(state, childId);
    }
  }

  recomputeNodeCounts(state, nodeId, currentNode, true);
}

export function collectAncestorIds(
  state: PathStoreState,
  nodeId: NodeId
): NodeId[] {
  const ancestorIds: NodeId[] = [];
  let currentNodeId: NodeId | null = nodeId;

  while (currentNodeId != null) {
    const currentNode = requireNode(state, currentNodeId);
    ancestorIds.push(currentNodeId);
    if (currentNodeId === state.snapshot.rootId) {
      break;
    }

    currentNodeId = currentNode.parentId;
  }

  return ancestorIds;
}

export function findNodeId(state: PathStoreState, path: string): NodeId | null {
  if (path.length === 0) {
    return state.snapshot.rootId;
  }

  const lookupPath = parseLookupPath(path);
  return findNodeIdBySegments(
    state,
    lookupPath.segments,
    lookupPath.requiresDirectory
  );
}

export function findNodeIdBySegments(
  state: PathStoreState,
  segments: readonly string[],
  requireDirectory: boolean
): NodeId | null {
  let currentNodeId = state.snapshot.rootId;

  for (const segment of segments) {
    const segmentId = state.snapshot.segmentTable.idByValue.get(segment);
    if (segmentId === undefined) {
      return null;
    }

    const currentIndex = getDirectoryIndex(state, currentNodeId);
    const nextNodeId = currentIndex.childIdByNameId.get(segmentId);
    if (nextNodeId === undefined) {
      return null;
    }

    currentNodeId = nextNodeId;
  }

  const currentNode = requireNode(state, currentNodeId);
  if (requireDirectory && currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return null;
  }

  return currentNodeId;
}

export function getDirectoryIndex(
  state: PathStoreState,
  directoryId: NodeId
): DirectoryChildIndex {
  const directoryIndex = state.snapshot.directories.get(directoryId);
  if (directoryIndex === undefined) {
    throw new Error(
      `Unknown directory child index for node ${String(directoryId)}`
    );
  }

  return directoryIndex;
}

export function requireNode(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreNode {
  const node = state.snapshot.nodes[nodeId];
  if (node === undefined || (node.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0) {
    throw new Error(`Unknown node ID: ${String(nodeId)}`);
  }

  return node;
}

// Canonical list output only includes files and explicit empty directories so
// the result can round-trip back into an equivalent store.
function collectCanonicalEntries(
  state: PathStoreState,
  nodeId: NodeId
): string[] {
  const rootNode = state.snapshot.nodes[nodeId];
  if (
    rootNode === undefined ||
    (rootNode.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0
  ) {
    return [];
  }

  if (rootNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return [materializeNodePath(state, nodeId)];
  }

  if (getDirectoryIndex(state, nodeId).childIds.length === 0) {
    return (rootNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
      (rootNode.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
      ? [materializeNodePath(state, nodeId)]
      : [];
  }

  const entries: string[] = [];

  const stack: Array<{ childIndex: number; nodeId: NodeId }> = [
    { childIndex: 0, nodeId },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame == null) {
      break;
    }

    const currentNode = state.snapshot.nodes[frame.nodeId];
    if (
      currentNode === undefined ||
      (currentNode.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0
    ) {
      stack.pop();
      continue;
    }

    if (currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      entries.push(materializeNodePath(state, frame.nodeId));
      stack.pop();
      continue;
    }

    const currentIndex = getDirectoryIndex(state, frame.nodeId);
    if (currentIndex.childIds.length === 0) {
      if (
        (currentNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
        (currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
      ) {
        entries.push(materializeNodePath(state, frame.nodeId));
      }

      stack.pop();
      continue;
    }

    const nextChildId = currentIndex.childIds[frame.childIndex];
    if (nextChildId == null) {
      stack.pop();
      continue;
    }

    frame.childIndex++;
    stack.push({ childIndex: 0, nodeId: nextChildId });
  }

  return entries;
}

function ensureDirectoryChain(
  state: PathStoreState,
  directorySegments: readonly string[]
): { createdNodeIds: NodeId[]; directoryId: NodeId } {
  const createdNodeIds: NodeId[] = [];
  let currentDirectoryId = state.snapshot.rootId;

  for (const segment of directorySegments) {
    const segmentId = internSegment(state.snapshot.segmentTable, segment);
    const currentIndex = getDirectoryIndex(state, currentDirectoryId);
    const existingChildId = currentIndex.childIdByNameId.get(segmentId);

    if (existingChildId !== undefined) {
      const existingChild = requireNode(state, existingChildId);
      if (existingChild.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
        throw new Error(
          `Cannot create a directory that collides with an existing file: "${segment}"`
        );
      }

      currentDirectoryId = existingChildId;
      continue;
    }

    currentDirectoryId = createDirectoryNode(
      state,
      currentDirectoryId,
      segmentId
    );
    createdNodeIds.push(currentDirectoryId);
  }

  return { createdNodeIds, directoryId: currentDirectoryId };
}

function createDirectoryNode(
  state: PathStoreState,
  parentId: NodeId,
  nameId: number
): NodeId {
  const parentNode = requireNode(state, parentId);
  const nodeId = state.snapshot.nodes.length;
  state.snapshot.nodes.push({
    depth: parentNode.depth + 1,
    flags: 0,
    id: nodeId,
    kind: PATH_STORE_NODE_KIND_DIRECTORY,
    nameId,
    parentId,
    pathCache: null,
    pathCacheVersion: -1,
    subtreeNodeCount: 1,
    visibleSubtreeCount: 1,
  });
  state.snapshot.directories.set(nodeId, createDirectoryChildIndex());
  insertChildReference(state, parentId, nodeId);
  state.activeNodeCount++;
  return nodeId;
}

function createFileNode(
  state: PathStoreState,
  parentId: NodeId,
  basename: string
): NodeId {
  const nameId = internSegment(state.snapshot.segmentTable, basename);
  const parentIndex = getDirectoryIndex(state, parentId);
  if (parentIndex.childIdByNameId.has(nameId)) {
    throw new Error(
      `Path already exists: "${buildPathPreview(state, parentId, basename)}"`
    );
  }

  const parentNode = requireNode(state, parentId);
  const nodeId = state.snapshot.nodes.length;
  state.snapshot.nodes.push({
    depth: parentNode.depth + 1,
    flags: 0,
    id: nodeId,
    kind: PATH_STORE_NODE_KIND_FILE,
    nameId,
    parentId,
    pathCache: null,
    pathCacheVersion: -1,
    subtreeNodeCount: 1,
    visibleSubtreeCount: 1,
  });

  insertChildReference(state, parentId, nodeId);
  state.activeNodeCount++;
  return nodeId;
}

function findChildInsertIndex(
  state: PathStoreState,
  parentIndex: DirectoryChildIndex,
  childId: NodeId
): number {
  let low = 0;
  let high = parentIndex.childIds.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    const existingChildId = parentIndex.childIds[middle];
    if (existingChildId == null) {
      high = middle;
      continue;
    }

    if (compareSiblingNodes(state, childId, existingChildId) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

function insertChildReference(
  state: PathStoreState,
  parentId: NodeId,
  childId: NodeId
): void {
  const parentIndex = getDirectoryIndex(state, parentId);
  const childNode = requireNode(state, childId);
  parentIndex.childIdByNameId.set(childNode.nameId, childId);
  applyChildAggregateDelta(
    parentIndex,
    childId,
    childNode.subtreeNodeCount,
    childNode.visibleSubtreeCount
  );

  const insertIndex = findChildInsertIndex(state, parentIndex, childId);
  parentIndex.childIds.splice(insertIndex, 0, childId);
  updateChildPositionsFrom(parentIndex, insertIndex);
  rebuildVisibleChildChunks(state.snapshot.nodes, parentIndex);
}

function removeChildReference(
  state: PathStoreState,
  parentId: NodeId,
  childId: NodeId,
  childNameId: number
): void {
  const parentIndex = getDirectoryIndex(state, parentId);
  const childIndex = parentIndex.childPositionById.get(childId) ?? -1;
  parentIndex.childIdByNameId.delete(childNameId);
  parentIndex.childPositionById.delete(childId);
  const childNode = state.snapshot.nodes[childId];
  if (childNode != null) {
    applyChildAggregateDelta(
      parentIndex,
      childId,
      -childNode.subtreeNodeCount,
      -childNode.visibleSubtreeCount
    );
  }

  if (childIndex >= 0) {
    parentIndex.childIds.splice(childIndex, 1);
    updateChildPositionsFrom(parentIndex, childIndex);
    rebuildVisibleChildChunks(state.snapshot.nodes, parentIndex);
  }
}

function compareSiblingNodes(
  state: PathStoreState,
  leftId: NodeId,
  rightId: NodeId
): number {
  const sortOption = state.snapshot.options.sort;
  if (sortOption === 'default') {
    return compareSiblingNodesDefault(state, leftId, rightId);
  }

  return sortOption(
    createCompareEntry(state, leftId),
    createCompareEntry(state, rightId)
  );
}

function compareSiblingNodesDefault(
  state: PathStoreState,
  leftId: NodeId,
  rightId: NodeId
): number {
  const leftNode = requireNode(state, leftId);
  const rightNode = requireNode(state, rightId);

  if (leftNode.kind !== rightNode.kind) {
    return leftNode.kind === PATH_STORE_NODE_KIND_DIRECTORY ? -1 : 1;
  }

  const leftSortKey = getSegmentSortKey(
    state.snapshot.segmentTable,
    leftNode.nameId
  );
  const rightSortKey = getSegmentSortKey(
    state.snapshot.segmentTable,
    rightNode.nameId
  );
  const comparison = compareSegmentSortKeys(leftSortKey, rightSortKey);
  if (comparison !== 0) {
    return comparison;
  }

  const leftName = getSegmentValue(
    state.snapshot.segmentTable,
    leftNode.nameId
  );
  const rightName = getSegmentValue(
    state.snapshot.segmentTable,
    rightNode.nameId
  );
  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }

  return leftId < rightId ? -1 : 1;
}

function createCompareEntry(
  state: PathStoreState,
  nodeId: NodeId
): PathStoreCompareEntry {
  const node = requireNode(state, nodeId);
  const path = materializeNodePath(state, nodeId);
  const normalizedPath =
    node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? path.slice(0, -1) : path;

  return {
    basename: getSegmentValue(state.snapshot.segmentTable, node.nameId),
    depth: node.depth,
    isDirectory: node.kind === PATH_STORE_NODE_KIND_DIRECTORY,
    path,
    segments: normalizedPath.length === 0 ? [] : normalizedPath.split('/'),
  };
}

function resolveMoveTarget(
  state: PathStoreState,
  sourceNodeId: NodeId,
  toPath: string
): MoveTarget {
  const sourceNode = requireNode(state, sourceNodeId);
  const existingDestinationId = findNodeId(state, toPath);
  if (existingDestinationId != null) {
    const existingDestination = requireNode(state, existingDestinationId);
    if (existingDestination.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
      return {
        basename: getSegmentValue(
          state.snapshot.segmentTable,
          sourceNode.nameId
        ),
        existingNodeId: null,
        parentId: existingDestinationId,
      };
    }

    const destinationSegments = parseLookupPath(toPath).segments;
    return {
      basename: destinationSegments[destinationSegments.length - 1] ?? '',
      existingNodeId: existingDestinationId,
      parentId: existingDestination.parentId,
    };
  }

  const destinationLookup = parseLookupPath(toPath);
  const basename =
    destinationLookup.segments[destinationLookup.segments.length - 1] ?? '';
  const parentSegments = destinationLookup.segments.slice(0, -1);
  const parentId =
    parentSegments.length === 0
      ? state.snapshot.rootId
      : findNodeIdBySegments(state, parentSegments, true);
  if (parentId == null) {
    throw new Error(`Destination parent does not exist: "${toPath}"`);
  }

  return {
    basename,
    existingNodeId: null,
    parentId,
  };
}

function handleMoveCollision(
  state: PathStoreState,
  collisionNodeId: NodeId,
  strategy: PathStoreCollisionStrategy,
  sourceKind: number
): 'handled' | 'skip' {
  if (strategy === 'skip') {
    return 'skip';
  }

  if (strategy === 'error') {
    throw new Error(
      `Destination already exists: "${materializeNodePath(state, collisionNodeId)}"`
    );
  }

  const collisionNode = requireNode(state, collisionNodeId);
  if (collisionNode.kind !== sourceKind) {
    throw new Error(
      'replace collision requires the same source and destination kinds'
    );
  }

  if (
    collisionNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    getDirectoryIndex(state, collisionNodeId).childIds.length > 0
  ) {
    throw new Error('replace collision does not support non-empty directories');
  }

  const collisionParentId = collisionNode.parentId;
  const collisionNameId = collisionNode.nameId;
  removeSubtree(state, collisionNodeId);
  removeChildReference(
    state,
    collisionParentId,
    collisionNodeId,
    collisionNameId
  );
  promoteEmptyAncestorsToExplicit(state, collisionParentId);
  recomputeCountsUpwardFrom(state, collisionParentId);
  return 'handled';
}

function removeSubtree(state: PathStoreState, nodeId: NodeId): NodeId[] {
  const removedNodeIds: NodeId[] = [];
  const stack: Array<{ nodeId: NodeId; visitedChildren: boolean }> = [
    { nodeId, visitedChildren: false },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame == null) {
      break;
    }

    const node = requireNode(state, frame.nodeId);
    if (frame.visitedChildren || node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      if (node.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
        state.snapshot.directories.delete(frame.nodeId);
      }

      node.flags |= PATH_STORE_NODE_FLAG_REMOVED;
      node.pathCache = null;
      node.pathCacheVersion = -1;
      state.collapsedDirectoryIds.delete(frame.nodeId);
      state.expandedDirectoryIds.delete(frame.nodeId);
      clearDirectoryLoadInfo(state, frame.nodeId);
      state.activeNodeCount--;
      removedNodeIds.push(frame.nodeId);
      continue;
    }

    stack.push({ nodeId: frame.nodeId, visitedChildren: true });

    const directoryIndex = getDirectoryIndex(state, frame.nodeId);
    for (
      let childIndex = directoryIndex.childIds.length - 1;
      childIndex >= 0;
      childIndex--
    ) {
      const childId = directoryIndex.childIds[childIndex];
      if (childId != null) {
        stack.push({ nodeId: childId, visitedChildren: false });
      }
    }
  }

  return removedNodeIds;
}

function promoteEmptyAncestorsToExplicit(
  state: PathStoreState,
  startDirectoryId: NodeId
): void {
  let currentDirectoryId: NodeId | null = startDirectoryId;

  while (currentDirectoryId != null) {
    const currentNode = requireNode(state, currentDirectoryId);
    if (
      currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
      (currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0
    ) {
      return;
    }

    if (getDirectoryIndex(state, currentDirectoryId).childIds.length > 0) {
      return;
    }

    currentNode.flags |= PATH_STORE_NODE_FLAG_EXPLICIT;
    currentDirectoryId =
      currentNode.parentId === currentDirectoryId ? null : currentNode.parentId;
  }
}

function findNearestCollapsedAncestor(
  state: PathStoreState,
  startDirectoryId: NodeId
): NodeId | null {
  let currentDirectoryId: NodeId | null = startDirectoryId;

  while (currentDirectoryId != null) {
    const currentNode = requireNode(state, currentDirectoryId);
    if (
      currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
      (currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0
    ) {
      return null;
    }

    if (!isDirectoryExpanded(state, currentDirectoryId, currentNode)) {
      return currentDirectoryId;
    }

    currentDirectoryId = currentNode.parentId;
  }

  return null;
}

// Marks obvious no-visible-change canonical edits inside collapsed subtrees as
// projection-stable without trying to solve perfect visibility inference yet.
function didAddAffectProjection(
  state: PathStoreState,
  parentId: NodeId,
  previousChildCount: number
): boolean {
  const collapsedAncestorId = findNearestCollapsedAncestor(state, parentId);
  if (collapsedAncestorId == null) {
    return true;
  }

  return collapsedAncestorId === parentId && previousChildCount === 0;
}

function didRemoveAffectProjection(
  state: PathStoreState,
  parentId: NodeId,
  previousChildCount: number
): boolean {
  const collapsedAncestorId = findNearestCollapsedAncestor(state, parentId);
  if (collapsedAncestorId == null) {
    return true;
  }

  return collapsedAncestorId === parentId && previousChildCount === 1;
}

function didMoveAffectProjection(
  state: PathStoreState,
  sourceNodeId: NodeId,
  previousParentId: NodeId,
  previousParentChildCount: number,
  targetParentId: NodeId,
  targetParentChildCount: number
): boolean {
  const sourceNode = requireNode(state, sourceNodeId);
  if (
    sourceNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    findNearestCollapsedAncestor(state, sourceNodeId) == null
  ) {
    return true;
  }

  const sourceCollapsedAncestorId = findNearestCollapsedAncestor(
    state,
    previousParentId
  );
  if (sourceCollapsedAncestorId == null) {
    return true;
  }

  const targetCollapsedAncestorId = findNearestCollapsedAncestor(
    state,
    targetParentId
  );
  if (targetCollapsedAncestorId == null) {
    return true;
  }

  if (
    sourceCollapsedAncestorId === previousParentId &&
    previousParentChildCount === 1
  ) {
    return true;
  }

  return (
    targetCollapsedAncestorId === targetParentId && targetParentChildCount === 0
  );
}

function recomputeDepths(state: PathStoreState, nodeId: NodeId): void {
  const node = requireNode(state, nodeId);
  const parentDepth =
    nodeId === state.snapshot.rootId
      ? -1
      : requireNode(state, node.parentId).depth;
  node.depth = parentDepth + 1;

  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return;
  }

  const directoryIndex = getDirectoryIndex(state, nodeId);
  for (const childId of directoryIndex.childIds) {
    recomputeDepths(state, childId);
  }
}

function isAncestor(
  state: PathStoreState,
  ancestorNodeId: NodeId,
  nodeId: NodeId
): boolean {
  let currentNodeId: NodeId | null = nodeId;

  while (currentNodeId != null) {
    if (currentNodeId === ancestorNodeId) {
      return true;
    }

    const currentNode = requireNode(state, currentNodeId);
    if (currentNodeId === state.snapshot.rootId) {
      return false;
    }

    currentNodeId = currentNode.parentId;
  }

  return false;
}

function recomputeNodeCounts(
  state: PathStoreState,
  nodeId: NodeId,
  currentNode = requireNode(state, nodeId),
  rebuildChildAggregates = false
): void {
  const instrumentation = state.instrumentation;
  if (instrumentation == null) {
    recomputeNodeCountsNow(state, nodeId, currentNode, rebuildChildAggregates);
    return;
  }

  withBenchmarkPhase(instrumentation, 'store.recomputeNodeCounts', () =>
    recomputeNodeCountsNow(state, nodeId, currentNode, rebuildChildAggregates)
  );
}

function recomputeCountsUpwardFromNow(
  state: PathStoreState,
  startNodeId: NodeId
): void {
  let currentNodeId: NodeId | null = startNodeId;

  while (currentNodeId != null) {
    const currentNode = requireNode(state, currentNodeId);
    const previousSubtreeNodeCount = currentNode.subtreeNodeCount;
    const previousVisibleSubtreeCount = currentNode.visibleSubtreeCount;
    recomputeNodeCounts(state, currentNodeId, currentNode);

    if (currentNodeId === state.snapshot.rootId) {
      return;
    }

    const subtreeNodeDelta =
      currentNode.subtreeNodeCount - previousSubtreeNodeCount;
    const visibleSubtreeDelta =
      currentNode.visibleSubtreeCount - previousVisibleSubtreeCount;
    const parentId = currentNode.parentId;

    if (subtreeNodeDelta !== 0 || visibleSubtreeDelta !== 0) {
      applyChildAggregateDelta(
        getDirectoryIndex(state, parentId),
        currentNodeId,
        subtreeNodeDelta,
        visibleSubtreeDelta
      );
    }

    currentNodeId = parentId;
  }
}

// Recomputes one node's stored subtree counts from its cached child aggregates.
function recomputeNodeCountsNow(
  state: PathStoreState,
  nodeId: NodeId,
  currentNode: PathStoreNode,
  rebuildChildAggregates: boolean
): void {
  if (currentNode.kind === PATH_STORE_NODE_KIND_FILE) {
    currentNode.subtreeNodeCount = 1;
    currentNode.visibleSubtreeCount = 1;
    return;
  }

  const currentIndex = getDirectoryIndex(state, nodeId);
  if (rebuildChildAggregates) {
    const instrumentation = state.instrumentation;
    if (instrumentation == null) {
      rebuildDirectoryChildAggregates(state.snapshot.nodes, currentIndex);
    } else {
      withBenchmarkPhase(
        instrumentation,
        'store.recomputeNodeCounts.rebuildChildAggregates',
        () =>
          rebuildDirectoryChildAggregates(state.snapshot.nodes, currentIndex)
      );
    }
  }
  const subtreeNodeCount = 1 + currentIndex.totalChildSubtreeNodeCount;
  const visibleChildCount = currentIndex.totalChildVisibleSubtreeCount;

  currentNode.subtreeNodeCount = subtreeNodeCount;
  if ((currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    currentNode.visibleSubtreeCount = visibleChildCount;
    return;
  }

  currentNode.visibleSubtreeCount = isDirectoryExpanded(
    state,
    nodeId,
    currentNode
  )
    ? getFlattenedChildDirectoryId(state, nodeId) == null
      ? 1 + visibleChildCount
      : visibleChildCount
    : 1;
}

function buildPathPreview(
  state: PathStoreState,
  parentId: NodeId,
  basename: string
): string {
  const parentPath = materializeNodePath(state, parentId);
  return parentPath.length === 0 ? basename : `${parentPath}${basename}`;
}
