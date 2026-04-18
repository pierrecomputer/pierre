import {
  getPreparedInputEntries,
  getPreparedInputPresortedPaths,
  PathStoreBuilder,
  preparePathEntries,
} from './builder';
import {
  PATH_STORE_NODE_FLAG_EXPLICIT,
  PATH_STORE_NODE_FLAG_ROOT,
  PATH_STORE_NODE_KIND_DIRECTORY,
  type PathStoreNodeKind,
  type PathStoreSnapshot,
  type SegmentTable,
} from './internal-types';
import { parseLookupPath } from './path';
import type {
  PathStoreConstructorOptions,
  PathStoreVisibleRow,
} from './public-types';
import { getSegmentValue } from './segments';
import { compareSegmentValues } from './sort';
import { resolveInitialExpansion } from './state';

const STATIC_CHILD_INDEX_CHUNK_SHIFT = 5;
const STATIC_CHILD_INDEX_CHUNK_SIZE = 1 << STATIC_CHILD_INDEX_CHUNK_SHIFT;
const STATIC_CHILD_INDEX_CHUNK_THRESHOLD = STATIC_CHILD_INDEX_CHUNK_SIZE * 2;

interface StaticPathStoreNode {
  childCount: number;
  depth: number;
  firstChildIndex: number;
  flags: number;
  id: number;
  kind: PathStoreNodeKind;
  nameId: number;
  parentId: number;
  subtreeNodeCount: number;
  visibleSubtreeCount: number;
}

interface StaticPathStoreSnapshot {
  childIds: readonly number[];
  childPositionByNodeId: readonly number[];
  childVisibleChunkSumsByDirectory: Array<readonly number[] | null>;
  nodes: StaticPathStoreNode[];
  options: PathStoreSnapshot['options'];
  rootId: number;
  segmentTable: SegmentTable;
}

interface StaticPathStoreState {
  collapsedDirectoryIds: Set<number>;
  defaultExpansion: 'closed' | 'open' | number;
  expandedDirectoryIds: Set<number>;
  pathByNodeId: Array<string | null>;
  snapshot: StaticPathStoreSnapshot;
}

interface StaticVisibleRowCursor {
  headNodeId: number;
  terminalNodeId: number;
  visibleDepth: number;
}

// Rebuilds the mutable builder snapshot into a read-optimized static snapshot
// with dense child ranges and no mutation-oriented maps.
function createStaticSnapshot(
  sourceSnapshot: PathStoreSnapshot
): StaticPathStoreSnapshot {
  const childIds: number[] = [];
  const childPositionByNodeId = new Array<number>(
    sourceSnapshot.nodes.length
  ).fill(-1);
  const childVisibleChunkSumsByDirectory = new Array<readonly number[] | null>(
    sourceSnapshot.nodes.length
  ).fill(null);
  const nodes = sourceSnapshot.nodes.map(
    (node): StaticPathStoreNode => ({
      childCount: 0,
      depth: node.depth,
      firstChildIndex: -1,
      flags: node.flags,
      id: node.id,
      kind: node.kind,
      nameId: node.nameId,
      parentId: node.parentId,
      subtreeNodeCount: node.subtreeNodeCount,
      visibleSubtreeCount: node.visibleSubtreeCount,
    })
  );

  for (const node of nodes) {
    if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      continue;
    }

    const directoryIndex = sourceSnapshot.directories.get(node.id);
    if (directoryIndex == null) {
      continue;
    }

    node.firstChildIndex = childIds.length;
    node.childCount = directoryIndex.childIds.length;
    for (const childId of directoryIndex.childIds) {
      childPositionByNodeId[childId] = childIds.length;
      childIds.push(childId);
    }
    childVisibleChunkSumsByDirectory[node.id] =
      directoryIndex.childVisibleChunkSums == null
        ? null
        : [...directoryIndex.childVisibleChunkSums];
  }

  return {
    childIds,
    childPositionByNodeId,
    childVisibleChunkSumsByDirectory,
    nodes,
    options: sourceSnapshot.options,
    rootId: sourceSnapshot.rootId,
    segmentTable: {
      idByValue: Object.assign(
        Object.create(null),
        sourceSnapshot.segmentTable.idByValue
      ) as typeof sourceSnapshot.segmentTable.idByValue,
      sortKeyById: [...sourceSnapshot.segmentTable.sortKeyById],
      valueById: [...sourceSnapshot.segmentTable.valueById],
    },
  };
}

// Static mode keeps topology immutable, so full paths can be cached forever
// without any path-cache version invalidation bookkeeping.
function materializeStaticNodePath(
  state: StaticPathStoreState,
  nodeId: number
): string {
  const cachedPath = state.pathByNodeId[nodeId];
  if (cachedPath != null) {
    return cachedPath;
  }

  const node = requireStaticNode(state, nodeId);
  if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    state.pathByNodeId[nodeId] = '';
    return '';
  }

  const parentPath = materializeStaticNodePath(state, node.parentId);
  const nodeName = getSegmentValue(state.snapshot.segmentTable, node.nameId);
  const joinedPath =
    parentPath.length === 0 ? nodeName : `${parentPath}${nodeName}`;
  const path =
    node.kind === PATH_STORE_NODE_KIND_DIRECTORY
      ? `${joinedPath}/`
      : joinedPath;
  state.pathByNodeId[nodeId] = path;
  return path;
}

// Lookup walks sorted child ranges with binary search so static mode does not
// need to keep a mutation-oriented child-name map per directory.
function findStaticNodeId(
  state: StaticPathStoreState,
  path: string
): number | null {
  if (path.length === 0) {
    return state.snapshot.rootId;
  }

  const lookupPath = parseLookupPath(path);
  let currentNodeId = state.snapshot.rootId;

  for (const segment of lookupPath.segments) {
    const currentNode = requireStaticNode(state, currentNodeId);
    if (currentNode.childCount <= 0) {
      return null;
    }

    const nextNodeId = findStaticChildIdBySegment(
      state,
      currentNode.firstChildIndex,
      currentNode.childCount,
      segment
    );
    if (nextNodeId == null) {
      return null;
    }

    currentNodeId = nextNodeId;
  }

  const currentNode = requireStaticNode(state, currentNodeId);
  if (
    lookupPath.requiresDirectory &&
    currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY
  ) {
    return null;
  }

  return currentNodeId;
}

function findStaticChildIdBySegment(
  state: StaticPathStoreState,
  firstChildIndex: number,
  childCount: number,
  segment: string
): number | null {
  let low = firstChildIndex;
  let high = firstChildIndex + childCount - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const childId = state.snapshot.childIds[middle];
    if (childId == null) {
      return null;
    }

    const childNode = requireStaticNode(state, childId);
    const childSegment = getSegmentValue(
      state.snapshot.segmentTable,
      childNode.nameId
    );
    const comparison = compareSegmentValues(childSegment, segment);

    if (comparison === 0) {
      return childId;
    }

    if (comparison < 0) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return null;
}

function requireStaticNode(
  state: StaticPathStoreState,
  nodeId: number
): StaticPathStoreNode {
  const node = state.snapshot.nodes[nodeId];
  if (node == null) {
    throw new Error(`Unknown node ID: ${String(nodeId)}`);
  }

  return node;
}

function isStaticDirectoryExpandedByDefault(
  state: StaticPathStoreState,
  node: StaticPathStoreNode
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

function isStaticDirectoryExpanded(
  state: StaticPathStoreState,
  nodeId: number
): boolean {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return false;
  }

  if (state.collapsedDirectoryIds.has(nodeId)) {
    return false;
  }

  if (state.expandedDirectoryIds.has(nodeId)) {
    return true;
  }

  return isStaticDirectoryExpandedByDefault(state, node);
}

function setStaticDirectoryExpanded(
  state: StaticPathStoreState,
  nodeId: number,
  expanded: boolean
): void {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return;
  }

  const expandedByDefault = isStaticDirectoryExpandedByDefault(state, node);
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

// Rebuilds per-directory visible-child chunk sums after a projection-state
// change so static visible selection can skip large child ranges efficiently.
function rebuildStaticVisibleChildChunks(
  state: StaticPathStoreState,
  directoryNodeId: number
): void {
  const directoryNode = requireStaticNode(state, directoryNodeId);
  if (directoryNode.childCount < STATIC_CHILD_INDEX_CHUNK_THRESHOLD) {
    state.snapshot.childVisibleChunkSumsByDirectory[directoryNodeId] = null;
    return;
  }

  const chunkCount = Math.ceil(
    directoryNode.childCount / STATIC_CHILD_INDEX_CHUNK_SIZE
  );
  const chunkSums = new Array<number>(chunkCount).fill(0);

  for (
    let childOffset = 0;
    childOffset < directoryNode.childCount;
    childOffset++
  ) {
    const childId =
      state.snapshot.childIds[directoryNode.firstChildIndex + childOffset];
    if (childId == null) {
      continue;
    }

    chunkSums[childOffset >> STATIC_CHILD_INDEX_CHUNK_SHIFT] +=
      requireStaticNode(state, childId).visibleSubtreeCount;
  }

  state.snapshot.childVisibleChunkSumsByDirectory[directoryNodeId] = chunkSums;
}

// Recomputes visible counts from immutable topology plus current expansion
// state, which is the only mutable part of the static store. This is a full
// tree walk today, so static mode optimizes steady-state reads more than
// expand/collapse-heavy interaction patterns.
function recomputeStaticVisibleCountsRecursive(
  state: StaticPathStoreState,
  nodeId: number
): number {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    node.visibleSubtreeCount = 1;
    return 1;
  }

  let visibleChildCount = 0;
  for (let childOffset = 0; childOffset < node.childCount; childOffset++) {
    const childId = state.snapshot.childIds[node.firstChildIndex + childOffset];
    if (childId == null) {
      continue;
    }

    visibleChildCount += recomputeStaticVisibleCountsRecursive(state, childId);
  }

  const flattenedChildDirectoryId = getStaticFlattenedChildDirectoryId(
    state,
    nodeId
  );
  let visibleSubtreeCount: number;
  if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
    visibleSubtreeCount = visibleChildCount;
  } else if (flattenedChildDirectoryId != null) {
    visibleSubtreeCount = visibleChildCount;
  } else if (!isStaticDirectoryExpanded(state, nodeId)) {
    visibleSubtreeCount = 1;
  } else {
    visibleSubtreeCount = 1 + visibleChildCount;
  }

  node.visibleSubtreeCount = visibleSubtreeCount;
  rebuildStaticVisibleChildChunks(state, nodeId);
  return visibleSubtreeCount;
}

function recomputeStaticVisibleCounts(state: StaticPathStoreState): void {
  recomputeStaticVisibleCountsRecursive(state, state.snapshot.rootId);
}

function getStaticFlattenedChildDirectoryId(
  state: StaticPathStoreState,
  directoryNodeId: number
): number | null {
  if (state.snapshot.options.flattenEmptyDirectories !== true) {
    return null;
  }

  const directoryNode = requireStaticNode(state, directoryNodeId);
  if (
    directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
    (directoryNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0 ||
    directoryNode.childCount !== 1
  ) {
    return null;
  }

  const childId = state.snapshot.childIds[directoryNode.firstChildIndex];
  if (childId == null) {
    return null;
  }

  return requireStaticNode(state, childId).kind ===
    PATH_STORE_NODE_KIND_DIRECTORY
    ? childId
    : null;
}

function getStaticFlattenedTerminalDirectoryId(
  state: StaticPathStoreState,
  directoryNodeId: number
): number {
  let currentDirectoryId = directoryNodeId;

  while (true) {
    const nextDirectoryId = getStaticFlattenedChildDirectoryId(
      state,
      currentDirectoryId
    );
    if (nextDirectoryId == null) {
      return currentDirectoryId;
    }

    currentDirectoryId = nextDirectoryId;
  }
}

function collectStaticFlattenedDirectoryChainIds(
  state: StaticPathStoreState,
  directoryNodeId: number
): number[] {
  const chainIds = [directoryNodeId];
  let currentDirectoryId = directoryNodeId;

  while (true) {
    const nextDirectoryId = getStaticFlattenedChildDirectoryId(
      state,
      currentDirectoryId
    );
    if (nextDirectoryId == null) {
      return chainIds;
    }

    chainIds.push(nextDirectoryId);
    currentDirectoryId = nextDirectoryId;
  }
}

function isStaticVisibleRowHeadNode(
  state: StaticPathStoreState,
  nodeId: number
): boolean {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return true;
  }

  const parentId = node.parentId;
  if (parentId === state.snapshot.rootId) {
    return true;
  }

  return getStaticFlattenedChildDirectoryId(state, parentId) !== nodeId;
}

function selectStaticChildIndexByVisibleIndex(
  state: StaticPathStoreState,
  directoryNodeId: number,
  visibleIndex: number
): { childId: number; localVisibleIndex: number } {
  const directoryNode = requireStaticNode(state, directoryNodeId);
  const chunkSums =
    state.snapshot.childVisibleChunkSumsByDirectory[directoryNodeId];

  if (chunkSums != null) {
    let remainingIndex = visibleIndex;
    let childOffset = 0;
    for (const chunkVisibleCount of chunkSums) {
      if (remainingIndex < chunkVisibleCount) {
        return selectStaticChildIndexWithinChunk(
          state,
          directoryNode,
          childOffset,
          remainingIndex
        );
      }

      remainingIndex -= chunkVisibleCount;
      childOffset += STATIC_CHILD_INDEX_CHUNK_SIZE;
    }

    throw new Error(
      `Visible child index ${String(visibleIndex)} is out of range`
    );
  }

  let remainingIndex = visibleIndex;
  for (
    let childOffset = 0;
    childOffset < directoryNode.childCount;
    childOffset++
  ) {
    const childId =
      state.snapshot.childIds[directoryNode.firstChildIndex + childOffset];
    if (childId == null) {
      continue;
    }

    const childNode = requireStaticNode(state, childId);
    if (remainingIndex < childNode.visibleSubtreeCount) {
      return { childId, localVisibleIndex: remainingIndex };
    }

    remainingIndex -= childNode.visibleSubtreeCount;
  }

  throw new Error(
    `Visible child index ${String(visibleIndex)} is out of range`
  );
}

function selectStaticChildIndexWithinChunk(
  state: StaticPathStoreState,
  directoryNode: StaticPathStoreNode,
  chunkStartOffset: number,
  visibleIndex: number
): { childId: number; localVisibleIndex: number } {
  const chunkEndOffset = Math.min(
    directoryNode.childCount,
    chunkStartOffset + STATIC_CHILD_INDEX_CHUNK_SIZE
  );
  let remainingIndex = visibleIndex;

  for (
    let childOffset = chunkStartOffset;
    childOffset < chunkEndOffset;
    childOffset++
  ) {
    const childId =
      state.snapshot.childIds[directoryNode.firstChildIndex + childOffset];
    if (childId == null) {
      continue;
    }

    const childNode = requireStaticNode(state, childId);
    if (remainingIndex < childNode.visibleSubtreeCount) {
      return { childId, localVisibleIndex: remainingIndex };
    }

    remainingIndex -= childNode.visibleSubtreeCount;
  }

  throw new Error(
    `Visible child index ${String(visibleIndex)} is out of range`
  );
}

function createStaticVisibleRowCursor(
  state: StaticPathStoreState,
  nodeId: number,
  visibleDepth: number
): StaticVisibleRowCursor {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return {
      headNodeId: nodeId,
      terminalNodeId: nodeId,
      visibleDepth,
    };
  }

  return {
    headNodeId: nodeId,
    terminalNodeId: getStaticFlattenedTerminalDirectoryId(state, nodeId),
    visibleDepth,
  };
}

function selectStaticVisibleRow(
  state: StaticPathStoreState,
  index: number
): StaticVisibleRowCursor | null {
  if (index < 0 || index >= getStaticVisibleCount(state)) {
    return null;
  }

  return selectStaticVisibleRowWithinDirectory(
    state,
    state.snapshot.rootId,
    index,
    -1
  );
}

function selectStaticVisibleRowWithinDirectory(
  state: StaticPathStoreState,
  directoryNodeId: number,
  index: number,
  parentVisibleDepth: number
): StaticVisibleRowCursor {
  const { childId, localVisibleIndex } = selectStaticChildIndexByVisibleIndex(
    state,
    directoryNodeId,
    index
  );

  return selectStaticVisibleRowWithinSubtree(
    state,
    childId,
    localVisibleIndex,
    parentVisibleDepth + 1
  );
}

function selectStaticVisibleRowWithinSubtree(
  state: StaticPathStoreState,
  nodeId: number,
  index: number,
  visibleDepth: number
): StaticVisibleRowCursor {
  const node = requireStaticNode(state, nodeId);
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

  const currentCursor = createStaticVisibleRowCursor(
    state,
    nodeId,
    visibleDepth
  );
  if (index === 0) {
    return currentCursor;
  }

  const terminalNode = requireStaticNode(state, currentCursor.terminalNodeId);
  if (
    terminalNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
    !isStaticDirectoryExpanded(state, currentCursor.terminalNodeId)
  ) {
    throw new Error(
      `Visible index ${String(index)} is out of range for collapsed directory`
    );
  }

  return selectStaticVisibleRowWithinDirectory(
    state,
    currentCursor.terminalNodeId,
    index - 1,
    currentCursor.visibleDepth
  );
}

function getStaticNextVisibleRowCursor(
  state: StaticPathStoreState,
  currentCursor: StaticVisibleRowCursor
): StaticVisibleRowCursor | null {
  const terminalNode = requireStaticNode(state, currentCursor.terminalNodeId);
  if (
    terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
    isStaticDirectoryExpanded(state, currentCursor.terminalNodeId) &&
    terminalNode.childCount > 0
  ) {
    const firstChildId = state.snapshot.childIds[terminalNode.firstChildIndex];
    return firstChildId == null
      ? null
      : selectStaticVisibleRowWithinSubtree(
          state,
          firstChildId,
          0,
          currentCursor.visibleDepth + 1
        );
  }

  let currentNodeId = currentCursor.terminalNodeId;
  let currentVisibleDepth = currentCursor.visibleDepth;

  while (true) {
    const currentNode = requireStaticNode(state, currentNodeId);
    if (currentNodeId === state.snapshot.rootId) {
      return null;
    }

    const parentNode = requireStaticNode(state, currentNode.parentId);
    const absolutePosition =
      state.snapshot.childPositionByNodeId[currentNodeId];
    const nextSiblingPosition = absolutePosition + 1;
    const siblingRangeEnd = parentNode.firstChildIndex + parentNode.childCount;

    if (absolutePosition >= 0 && nextSiblingPosition < siblingRangeEnd) {
      const nextSiblingId = state.snapshot.childIds[nextSiblingPosition];
      return nextSiblingId == null
        ? null
        : selectStaticVisibleRowWithinSubtree(
            state,
            nextSiblingId,
            0,
            currentVisibleDepth
          );
    }

    if (isStaticVisibleRowHeadNode(state, currentNodeId)) {
      currentVisibleDepth -= 1;
    }
    currentNodeId = currentNode.parentId;
  }
}

function materializeStaticVisibleRow(
  state: StaticPathStoreState,
  cursor: StaticVisibleRowCursor
): PathStoreVisibleRow {
  const terminalNode = requireStaticNode(state, cursor.terminalNodeId);
  const path = materializeStaticNodePath(state, cursor.terminalNodeId);
  const name = getSegmentValue(
    state.snapshot.segmentTable,
    terminalNode.nameId
  );
  const isFlattened = cursor.headNodeId !== cursor.terminalNodeId;
  const flattenedSegments = isFlattened
    ? collectStaticFlattenedDirectoryChainIds(state, cursor.headNodeId).map(
        (nodeId) => {
          const node = requireStaticNode(state, nodeId);
          return {
            isTerminal: nodeId === cursor.terminalNodeId,
            name: getSegmentValue(state.snapshot.segmentTable, node.nameId),
            nodeId,
            path: materializeStaticNodePath(state, nodeId),
          };
        }
      )
    : undefined;

  return {
    depth: cursor.visibleDepth,
    flattenedSegments,
    hasChildren: terminalNode.childCount > 0,
    id: cursor.terminalNodeId,
    isExpanded:
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      isStaticDirectoryExpanded(state, cursor.terminalNodeId),
    isFlattened,
    isLoading: false,
    kind:
      terminalNode.kind === PATH_STORE_NODE_KIND_DIRECTORY
        ? 'directory'
        : 'file',
    loadState: undefined,
    name,
    path,
  };
}

// Enumerates canonical entries from immutable topology without relying on any
// mutation-oriented side tables.
function collectStaticCanonicalEntries(
  state: StaticPathStoreState,
  nodeId: number
): string[] {
  const node = requireStaticNode(state, nodeId);
  if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return [materializeStaticNodePath(state, nodeId)];
  }

  if (node.childCount === 0) {
    return (node.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
      (node.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
      ? [materializeStaticNodePath(state, nodeId)]
      : [];
  }

  const entries: string[] = [];
  const stack: Array<{ childOffset: number; nodeId: number }> = [
    { childOffset: 0, nodeId },
  ];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame == null) {
      break;
    }

    const currentNode = requireStaticNode(state, frame.nodeId);
    if (currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      entries.push(materializeStaticNodePath(state, frame.nodeId));
      stack.pop();
      continue;
    }

    if (currentNode.childCount === 0) {
      if (
        (currentNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
        (currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
      ) {
        entries.push(materializeStaticNodePath(state, frame.nodeId));
      }
      stack.pop();
      continue;
    }

    if (frame.childOffset >= currentNode.childCount) {
      stack.pop();
      continue;
    }

    const childId =
      state.snapshot.childIds[currentNode.firstChildIndex + frame.childOffset];
    frame.childOffset += 1;
    if (childId != null) {
      stack.push({ childOffset: 0, nodeId: childId });
    }
  }

  return entries;
}

function getStaticVisibleCount(state: StaticPathStoreState): number {
  return requireStaticNode(state, state.snapshot.rootId).visibleSubtreeCount;
}

export class StaticPathStore {
  readonly #state: StaticPathStoreState;

  public constructor(options: PathStoreConstructorOptions = {}) {
    const builder = new PathStoreBuilder(options);
    if (options.preparedInput != null) {
      const presortedPaths = getPreparedInputPresortedPaths(
        options.preparedInput
      );
      if (presortedPaths != null) {
        builder.appendPresortedPaths(presortedPaths);
      } else {
        // preparedInput is the caller's explicit fast path, so skip the
        // builder's redundant monotonic-order validation and only keep
        // duplicate checks.
        builder.appendPreparedPaths(
          getPreparedInputEntries(options.preparedInput),
          false
        );
      }
    } else {
      const inputPaths = options.paths ?? [];
      if (options.presorted === true) {
        builder.appendPaths(inputPaths);
      } else {
        builder.appendPreparedPaths(preparePathEntries(inputPaths, options));
      }
    }

    const staticSnapshot = createStaticSnapshot(builder.finish());
    this.#state = {
      collapsedDirectoryIds: new Set<number>(),
      defaultExpansion: resolveInitialExpansion(
        options.initialExpansion ?? 'closed'
      ),
      expandedDirectoryIds: new Set<number>(),
      pathByNodeId: new Array(staticSnapshot.nodes.length).fill(null),
      snapshot: staticSnapshot,
    };
    this.#state.pathByNodeId[staticSnapshot.rootId] = '';
    this.initializeExpandedPaths(options.initialExpandedPaths);
    recomputeStaticVisibleCounts(this.#state);
  }

  public list(path?: string): string[] {
    const nodeId =
      path == null
        ? this.#state.snapshot.rootId
        : findStaticNodeId(this.#state, path);
    if (nodeId == null) {
      return [];
    }

    return collectStaticCanonicalEntries(this.#state, nodeId);
  }

  public getVisibleCount(): number {
    return getStaticVisibleCount(this.#state);
  }

  public getVisibleSlice(
    start: number,
    end: number
  ): readonly PathStoreVisibleRow[] {
    const totalVisibleCount = getStaticVisibleCount(this.#state);
    if (totalVisibleCount <= 0 || end < start) {
      return [];
    }

    const normalizedStart = Math.max(0, Math.min(start, totalVisibleCount - 1));
    const normalizedEnd = Math.max(
      normalizedStart,
      Math.min(end, totalVisibleCount - 1)
    );
    const rows: PathStoreVisibleRow[] = [];
    let currentCursor = selectStaticVisibleRow(this.#state, normalizedStart);

    for (
      let visibleIndex = normalizedStart;
      visibleIndex <= normalizedEnd && currentCursor != null;
      visibleIndex++
    ) {
      rows.push(materializeStaticVisibleRow(this.#state, currentCursor));
      currentCursor = getStaticNextVisibleRowCursor(this.#state, currentCursor);
    }

    return rows;
  }

  public expand(path: string): void {
    const directoryNodeId = findStaticNodeId(this.#state, path);
    if (directoryNodeId == null) {
      throw new Error(`Path does not exist: "${path}"`);
    }

    const directoryNode = requireStaticNode(this.#state, directoryNodeId);
    if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      throw new Error(`Path is not a directory: "${path}"`);
    }

    if (isStaticDirectoryExpanded(this.#state, directoryNodeId)) {
      return;
    }

    setStaticDirectoryExpanded(this.#state, directoryNodeId, true);
    recomputeStaticVisibleCounts(this.#state);
  }

  public collapse(path: string): void {
    const directoryNodeId = findStaticNodeId(this.#state, path);
    if (directoryNodeId == null) {
      throw new Error(`Path does not exist: "${path}"`);
    }

    const directoryNode = requireStaticNode(this.#state, directoryNodeId);
    if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      throw new Error(`Path is not a directory: "${path}"`);
    }

    if (!isStaticDirectoryExpanded(this.#state, directoryNodeId)) {
      return;
    }

    setStaticDirectoryExpanded(this.#state, directoryNodeId, false);
    recomputeStaticVisibleCounts(this.#state);
  }

  private initializeExpandedPaths(
    expandedPaths: readonly string[] | undefined
  ): void {
    if (expandedPaths == null || expandedPaths.length === 0) {
      return;
    }

    for (const path of expandedPaths) {
      const directoryNodeId = findStaticNodeId(this.#state, path);
      if (directoryNodeId == null) {
        throw new Error(`Path does not exist: "${path}"`);
      }

      const directoryNode = requireStaticNode(this.#state, directoryNodeId);
      if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
        throw new Error(`Path is not a directory: "${path}"`);
      }

      setStaticDirectoryExpanded(this.#state, directoryNodeId, true);
    }
  }
}
