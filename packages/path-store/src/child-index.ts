import type {
  DirectoryChildIndex,
  NodeId,
  PathStoreNode,
} from './internal-types';
import type { SegmentId } from './internal-types';

const PATH_STORE_CHILD_INDEX_CHUNK_SHIFT = 5;
const PATH_STORE_CHILD_INDEX_CHUNK_SIZE =
  1 << PATH_STORE_CHILD_INDEX_CHUNK_SHIFT;
const PATH_STORE_CHILD_INDEX_CHUNK_THRESHOLD =
  PATH_STORE_CHILD_INDEX_CHUNK_SIZE * 2;

export function createDirectoryChildIndex(): DirectoryChildIndex {
  return {
    childIdByNameId: new Map<SegmentId, NodeId>(),
    childIds: [],
    childPositionById: new Map<NodeId, number>(),
    childVisibleChunkSums: null,
    totalChildSubtreeNodeCount: 0,
    totalChildVisibleSubtreeCount: 0,
  };
}

export function appendChildReference(
  index: DirectoryChildIndex,
  childId: NodeId
): void {
  index.childPositionById.set(childId, index.childIds.length);
  index.childIds.push(childId);
}

// Rebuilds the child-position map from the first changed index after a splice.
export function updateChildPositionsFrom(
  index: DirectoryChildIndex,
  startIndex: number
): void {
  for (
    let position = startIndex;
    position < index.childIds.length;
    position++
  ) {
    const childId = index.childIds[position];
    if (childId != null) {
      index.childPositionById.set(childId, position);
    }
  }
}

// Stores fast aggregate totals on each directory so ancestor count repair
// doesn't need to rescan every child after small edits.
export function rebuildDirectoryChildAggregates(
  nodes: readonly PathStoreNode[],
  index: DirectoryChildIndex
): void {
  let totalChildSubtreeNodeCount = 0;
  let totalChildVisibleSubtreeCount = 0;

  for (const childId of index.childIds) {
    const childNode = nodes[childId];
    if (childNode == null) {
      continue;
    }

    totalChildSubtreeNodeCount += childNode.subtreeNodeCount;
    totalChildVisibleSubtreeCount += childNode.visibleSubtreeCount;
  }

  index.totalChildSubtreeNodeCount = totalChildSubtreeNodeCount;
  index.totalChildVisibleSubtreeCount = totalChildVisibleSubtreeCount;
  rebuildVisibleChildChunks(nodes, index);
}

export function applyChildAggregateDelta(
  index: DirectoryChildIndex,
  childId: NodeId,
  subtreeNodeDelta: number,
  visibleSubtreeDelta: number
): void {
  index.totalChildSubtreeNodeCount += subtreeNodeDelta;
  index.totalChildVisibleSubtreeCount += visibleSubtreeDelta;

  if (index.childVisibleChunkSums == null || visibleSubtreeDelta === 0) {
    return;
  }

  const childPosition = index.childPositionById.get(childId);
  if (childPosition === undefined) {
    return;
  }

  const chunkIndex = childPosition >> PATH_STORE_CHILD_INDEX_CHUNK_SHIFT;
  const nextChunkValue =
    (index.childVisibleChunkSums[chunkIndex] ?? 0) + visibleSubtreeDelta;
  index.childVisibleChunkSums[chunkIndex] = nextChunkValue;
}

// Skips over wide child arrays by using chunked visible-count summaries first
// and then scanning only within the selected chunk.
export function selectChildIndexByVisibleIndex(
  nodes: readonly PathStoreNode[],
  index: DirectoryChildIndex,
  visibleIndex: number
): { childIndex: number; localVisibleIndex: number } {
  const chunkSums = index.childVisibleChunkSums;

  if (chunkSums != null) {
    let remainingIndex = visibleIndex;
    let childIndex = 0;
    for (const chunkVisibleCount of chunkSums) {
      if (remainingIndex < chunkVisibleCount) {
        return selectChildIndexWithinChunk(
          nodes,
          index,
          childIndex,
          remainingIndex
        );
      }

      remainingIndex -= chunkVisibleCount;
      childIndex += PATH_STORE_CHILD_INDEX_CHUNK_SIZE;
    }

    throw new Error(
      `Visible child index ${String(visibleIndex)} is out of range`
    );
  }

  let remainingIndex = visibleIndex;
  for (let childIndex = 0; childIndex < index.childIds.length; childIndex++) {
    const childId = index.childIds[childIndex];
    if (childId == null) {
      continue;
    }

    const childNode = nodes[childId];
    if (childNode == null) {
      continue;
    }

    if (remainingIndex < childNode.visibleSubtreeCount) {
      return { childIndex, localVisibleIndex: remainingIndex };
    }

    remainingIndex -= childNode.visibleSubtreeCount;
  }

  throw new Error(
    `Visible child index ${String(visibleIndex)} is out of range`
  );
}

export function rebuildVisibleChildChunks(
  nodes: readonly PathStoreNode[],
  index: DirectoryChildIndex
): void {
  if (index.childIds.length < PATH_STORE_CHILD_INDEX_CHUNK_THRESHOLD) {
    index.childVisibleChunkSums = null;
    return;
  }

  const chunkCount = Math.ceil(
    index.childIds.length / PATH_STORE_CHILD_INDEX_CHUNK_SIZE
  );
  const chunkSums = new Array<number>(chunkCount).fill(0);

  for (let childIndex = 0; childIndex < index.childIds.length; childIndex++) {
    const childId = index.childIds[childIndex];
    if (childId == null) {
      continue;
    }

    const childNode = nodes[childId];
    if (childNode == null) {
      continue;
    }

    chunkSums[childIndex >> PATH_STORE_CHILD_INDEX_CHUNK_SHIFT] +=
      childNode.visibleSubtreeCount;
  }

  index.childVisibleChunkSums = chunkSums;
}

function selectChildIndexWithinChunk(
  nodes: readonly PathStoreNode[],
  index: DirectoryChildIndex,
  chunkStartIndex: number,
  visibleIndex: number
): { childIndex: number; localVisibleIndex: number } {
  const chunkEndIndex = Math.min(
    index.childIds.length,
    chunkStartIndex + PATH_STORE_CHILD_INDEX_CHUNK_SIZE
  );
  let remainingIndex = visibleIndex;

  for (
    let childIndex = chunkStartIndex;
    childIndex < chunkEndIndex;
    childIndex++
  ) {
    const childId = index.childIds[childIndex];
    if (childId == null) {
      continue;
    }

    const childNode = nodes[childId];
    if (childNode == null) {
      continue;
    }

    if (remainingIndex < childNode.visibleSubtreeCount) {
      return { childIndex, localVisibleIndex: remainingIndex };
    }

    remainingIndex -= childNode.visibleSubtreeCount;
  }

  throw new Error(
    `Visible child index ${String(visibleIndex)} is out of range`
  );
}
