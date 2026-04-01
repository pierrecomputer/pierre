import type { DirectoryChildIndex, NodeId } from './internal-types';
import { PATH_STORE_NODE_FLAG_EXPLICIT } from './internal-types';
import { PATH_STORE_NODE_FLAG_REMOVED } from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import { PATH_STORE_NODE_KIND_FILE } from './internal-types';
import { parseInputPath, parseLookupPath } from './path';
import type {
  PathStoreCollisionStrategy,
  PathStoreCompareEntry,
  PathStoreEvent,
  PathStoreMoveOptions,
  PathStoreRemoveOptions,
} from './public-types';
import { getSegmentValue, internSegment } from './segments';
import { compareSegmentSortKeys, getSegmentSortKey } from './sort';
import type { MoveTarget, PathStoreState } from './state';

export function listPaths(state: PathStoreState, path?: string): string[] {
  const nodeId = path == null ? state.snapshot.rootId : findNodeId(state, path);
  if (nodeId == null) {
    return [];
  }

  return collectCanonicalEntries(state, nodeId);
}

export function addPath(state: PathStoreState, path: string): PathStoreEvent {
  const preparedPath = parseInputPath(path);
  const parentSegments = preparedPath.isDirectory
    ? preparedPath.segments
    : preparedPath.segments.slice(0, -1);
  const { createdNodeIds, directoryId } = ensureDirectoryChain(
    state,
    parentSegments
  );

  const affectedNodeIds = new Set<NodeId>(createdNodeIds);
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
  return {
    affectedAncestorIds: collectAncestorIds(state, addedNodeId),
    affectedNodeIds: [...affectedNodeIds],
    changeset: { path },
    operation: 'add',
  };
}

export function removePath(
  state: PathStoreState,
  path: string,
  options: PathStoreRemoveOptions
): PathStoreEvent {
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
  const removedNodeIds = removeSubtree(state, nodeId);
  removeChildReference(state, parentId, nodeId, node.nameId);
  promoteEmptyAncestorsToExplicit(state, parentId);
  recomputeCountsUpwardFrom(state, parentId);

  return {
    affectedAncestorIds: collectAncestorIds(state, parentId),
    affectedNodeIds: removedNodeIds,
    changeset: { path, recursive: options.recursive === true },
    operation: 'remove',
  };
}

export function movePath(
  state: PathStoreState,
  fromPath: string,
  toPath: string,
  options: PathStoreMoveOptions
): PathStoreEvent | null {
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
  const previousSubtreeSize = sourceNode.subtreeNodeCount;
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

  return {
    affectedAncestorIds: [
      ...new Set([
        ...collectAncestorIds(state, previousParentId),
        ...collectAncestorIds(state, moveTarget.parentId),
      ]),
    ],
    affectedNodeIds: [sourceNodeId],
    changeset: {
      from: fromPath,
      subtreeNodeCount: previousSubtreeSize,
      to: materializeNodePath(state, sourceNodeId),
    },
    operation: 'move',
  };
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
  let currentNodeId: NodeId | null = startNodeId;

  while (currentNodeId != null) {
    const currentNode = requireNode(state, currentNodeId);
    recomputeNodeCounts(state, currentNodeId, currentNode);

    if (currentNodeId === state.snapshot.rootId) {
      return;
    }

    currentNodeId = currentNode.parentId;
  }
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

  recomputeNodeCounts(state, nodeId, currentNode);
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

export function requireNode(state: PathStoreState, nodeId: NodeId) {
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
  const node = state.snapshot.nodes[nodeId];
  if (node === undefined || (node.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0) {
    return [];
  }

  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return [materializeNodePath(state, nodeId)];
  }

  const directoryIndex = getDirectoryIndex(state, nodeId);
  if (directoryIndex.childIds.length === 0) {
    return (node.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
      (node.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
      ? [materializeNodePath(state, nodeId)]
      : [];
  }

  const entries: string[] = [];
  for (const childId of directoryIndex.childIds) {
    entries.push(...collectCanonicalEntries(state, childId));
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
  state.snapshot.directories.set(nodeId, {
    childIds: [],
    childIdByNameId: new Map(),
  });
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

function insertChildReference(
  state: PathStoreState,
  parentId: NodeId,
  childId: NodeId
): void {
  const parentIndex = getDirectoryIndex(state, parentId);
  const childNode = requireNode(state, childId);
  parentIndex.childIdByNameId.set(childNode.nameId, childId);

  let insertIndex = parentIndex.childIds.length;
  for (let index = 0; index < parentIndex.childIds.length; index++) {
    if (compareSiblingNodes(state, childId, parentIndex.childIds[index]) < 0) {
      insertIndex = index;
      break;
    }
  }

  parentIndex.childIds.splice(insertIndex, 0, childId);
}

function removeChildReference(
  state: PathStoreState,
  parentId: NodeId,
  childId: NodeId,
  childNameId: number
): void {
  const parentIndex = getDirectoryIndex(state, parentId);
  parentIndex.childIdByNameId.delete(childNameId);

  const childIndex = parentIndex.childIds.indexOf(childId);
  if (childIndex >= 0) {
    parentIndex.childIds.splice(childIndex, 1);
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
  const node = requireNode(state, nodeId);
  const removedNodeIds: NodeId[] = [];

  if (node.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
    const directoryIndex = getDirectoryIndex(state, nodeId);
    for (const childId of [...directoryIndex.childIds]) {
      removedNodeIds.push(...removeSubtree(state, childId));
    }

    state.snapshot.directories.delete(nodeId);
  }

  node.flags |= PATH_STORE_NODE_FLAG_REMOVED;
  node.pathCache = null;
  node.pathCacheVersion = -1;
  state.expandedDirectoryIds.delete(nodeId);
  state.activeNodeCount--;
  removedNodeIds.push(nodeId);
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
  currentNode = requireNode(state, nodeId)
): void {
  if (currentNode.kind === PATH_STORE_NODE_KIND_FILE) {
    currentNode.subtreeNodeCount = 1;
    currentNode.visibleSubtreeCount = 1;
    return;
  }

  const currentIndex = getDirectoryIndex(state, nodeId);
  let subtreeNodeCount = 1;
  let visibleChildCount = 0;
  for (const childId of currentIndex.childIds) {
    const childNode = requireNode(state, childId);
    subtreeNodeCount += childNode.subtreeNodeCount;
    visibleChildCount += childNode.visibleSubtreeCount;
  }

  currentNode.subtreeNodeCount = subtreeNodeCount;
  if ((currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    currentNode.visibleSubtreeCount = visibleChildCount;
    return;
  }

  currentNode.visibleSubtreeCount = state.expandedDirectoryIds.has(nodeId)
    ? 1 + visibleChildCount
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
