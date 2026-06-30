// Struct-of-Arrays (SoA) node store for the count-only DFS sweep.
//
// The default PathStore keeps nodes as an array of plain objects
// (`PathStoreNode[]`) plus per-directory `childIds: number[]` lists. That layout
// is friendly to the string/allocation-bound render path but pays a heavy tax on
// pure topology sweeps at ~1M nodes: object header overhead, pointer chasing
// through the `directories` Map, and a fragmented GC tail.
//
// This module mirrors a finalized `PathStoreSnapshot` into parallel `Int32Array`s
// (one per node field) plus a flat CSR (compressed-sparse-row) child table. It is
// purpose-built for the count-only sweep that `initializeOpenVisibleCounts` /
// `recomputeCountsRecursive` perform, and is consumed ONLY when the caller opts
// in via a flag. The default object-array path is untouched.
//
// The accessor helpers here intentionally mirror the seam in `internal-types.ts`
// (getNodeDepth / getNodeKind / isDirectoryNode / getNodeFlags / hasNodeFlag),
// but keyed by `(store, id)` instead of by node object, so a future migration of
// the render path can reuse the same abstraction.

import {
  type DirectoryChildIndex,
  type NodeId,
  type PathStoreNode,
  type PathStoreNodeKind,
  type PathStoreSnapshot,
  type SegmentId,
} from './internal-types';

// Packing layout mirrors createNodeDepthAndFlags() in internal-types.ts. Kept in
// sync deliberately: depthAndFlags values are copied verbatim from the snapshot,
// so the same shifts/masks decode them.
const KIND_SHIFT = 3;
const KIND_MASK = 1 << KIND_SHIFT;
const DEPTH_SHIFT = 4;
const FLAGS_MASK = (1 << KIND_SHIFT) - 1;

export interface SoaNodeStore {
  // Number of node slots (== snapshot.nodes.length). Slots may be sparse: a
  // null slot in the source snapshot leaves the corresponding entries zeroed.
  readonly nodeCount: number;
  readonly rootId: NodeId;
  readonly flattenEmptyDirectories: boolean;

  // Parallel per-node fields, indexed by node id.
  readonly parentId: Int32Array;
  readonly nameId: Int32Array;
  // depthAndFlags is the same packed integer used on PathStoreNode: the depth in
  // the high bits, the kind bit at KIND_SHIFT, and the flag bits below it.
  readonly depthAndFlags: Int32Array;
  readonly subtreeNodeCount: Int32Array;
  readonly visibleSubtreeCount: Int32Array;

  // Flat CSR child table. The children of node `id` occupy
  // childIdsFlat[childStart[id] .. childStart[id] + childCount[id]).
  // Non-directory nodes have childCount[id] === 0.
  readonly childStart: Int32Array;
  readonly childCount: Int32Array;
  readonly childIdsFlat: Int32Array;
}

// --- Accessors (mirror internal-types.ts helpers, keyed by id) --------------

export function getSoaNodeDepth(store: SoaNodeStore, id: NodeId): number {
  return store.depthAndFlags[id] >>> DEPTH_SHIFT;
}

export function getSoaNodeKind(
  store: SoaNodeStore,
  id: NodeId
): PathStoreNodeKind {
  return ((store.depthAndFlags[id] & KIND_MASK) >>
    KIND_SHIFT) as PathStoreNodeKind;
}

export function isSoaDirectoryNode(store: SoaNodeStore, id: NodeId): boolean {
  return (store.depthAndFlags[id] & KIND_MASK) !== 0;
}

export function getSoaNodeFlags(store: SoaNodeStore, id: NodeId): number {
  return store.depthAndFlags[id] & FLAGS_MASK;
}

export function hasSoaNodeFlag(
  store: SoaNodeStore,
  id: NodeId,
  flag: number
): boolean {
  return (getSoaNodeFlags(store, id) & flag) !== 0;
}

// --- Construction -----------------------------------------------------------

// Mirrors a finalized PathStoreSnapshot into the SoA layout. The snapshot's node
// ids must be in DFS-preorder (which the presorted builder guarantees and the
// generic builder also satisfies), so descendants always have higher ids than
// their ancestor — the property the count-only sweep relies on.
export function buildSoaNodeStore(snapshot: PathStoreSnapshot): SoaNodeStore {
  const { nodes, directories, rootId, options } = snapshot;
  const nodeCount = nodes.length;

  const parentId = new Int32Array(nodeCount);
  const nameId = new Int32Array(nodeCount);
  const depthAndFlags = new Int32Array(nodeCount);
  const subtreeNodeCount = new Int32Array(nodeCount);
  const visibleSubtreeCount = new Int32Array(nodeCount);
  const childStart = new Int32Array(nodeCount);
  const childCount = new Int32Array(nodeCount);

  for (let id = 0; id < nodeCount; id += 1) {
    const node = nodes[id];
    if (node == null) {
      continue;
    }
    parentId[id] = node.parentId;
    nameId[id] = node.nameId;
    depthAndFlags[id] = node.depthAndFlags;
    subtreeNodeCount[id] = node.subtreeNodeCount;
    visibleSubtreeCount[id] = node.visibleSubtreeCount;
  }

  let totalChildren = 0;
  for (const index of directories.values()) {
    totalChildren += index.childIds.length;
  }
  const childIdsFlat = new Int32Array(totalChildren);

  let cursor = 0;
  for (const [dirId, index] of directories) {
    const ids = index.childIds;
    childStart[dirId] = cursor;
    childCount[dirId] = ids.length;
    for (let i = 0; i < ids.length; i += 1) {
      childIdsFlat[cursor] = ids[i];
      cursor += 1;
    }
  }

  return {
    nodeCount,
    rootId,
    flattenEmptyDirectories: options.flattenEmptyDirectories === true,
    parentId,
    nameId,
    depthAndFlags,
    subtreeNodeCount,
    visibleSubtreeCount,
    childStart,
    childCount,
    childIdsFlat,
  };
}

// --- Count-only sweep -------------------------------------------------------

// SoA equivalent of initializeOpenVisibleCounts (store.ts): the all-directories
// -open count sweep. Writes subtreeNodeCount and visibleSubtreeCount for every
// directory into the SoA typed arrays in post-order.
//
// Presorted/preorder id assignment guarantees a directory's descendants all have
// higher ids, so a single reverse-id pass finalizes every child before its
// parent — no explicit stack needed. This mirrors the reverse-walk strategy the
// object-array path uses, but reads/writes dense typed arrays throughout.
//
// The arithmetic is byte-for-byte identical to initializeOpenVisibleCounts so
// the results can be checksum-compared against the existing path in tests.
export function sweepOpenVisibleCountsSoa(store: SoaNodeStore): void {
  const {
    nodeCount,
    rootId,
    flattenEmptyDirectories,
    depthAndFlags,
    subtreeNodeCount,
    visibleSubtreeCount,
    childStart,
    childCount,
    childIdsFlat,
  } = store;

  // Reverse-id post-order walk. Root (id 0) is handled after the loop so its
  // not-root arithmetic never fires inside the body.
  for (let id = nodeCount - 1; id >= 1; id -= 1) {
    const packed = depthAndFlags[id];
    if ((packed & KIND_MASK) === 0) {
      // File: counts stay 1/1 (their snapshot defaults), nothing to aggregate.
      continue;
    }

    const base = childStart[id];
    const count = childCount[id];
    let totalChildSubtreeNodeCount = 0;
    let totalChildVisibleSubtreeCount = 0;
    for (let ci = 0; ci < count; ci += 1) {
      const childId = childIdsFlat[base + ci];
      totalChildSubtreeNodeCount += subtreeNodeCount[childId];
      totalChildVisibleSubtreeCount += visibleSubtreeCount[childId];
    }

    subtreeNodeCount[id] = 1 + totalChildSubtreeNodeCount;

    let newVisibleSubtreeCount: number;
    if (flattenEmptyDirectories && count === 1) {
      // Flattened directories inherit their sole child's visible count rather
      // than contributing their own header row — but only when that sole child
      // is itself a directory (matches initializeOpenVisibleCounts).
      const onlyChildId = childIdsFlat[base];
      newVisibleSubtreeCount =
        (depthAndFlags[onlyChildId] & KIND_MASK) !== 0
          ? totalChildVisibleSubtreeCount
          : 1 + totalChildVisibleSubtreeCount;
    } else {
      newVisibleSubtreeCount = 1 + totalChildVisibleSubtreeCount;
    }
    visibleSubtreeCount[id] = newVisibleSubtreeCount;
  }

  // Root: subtreeNodeCount includes the +1 header, but visibleSubtreeCount is
  // exactly the sum of child visible counts (the root contributes no row),
  // matching initializeOpenVisibleCounts.
  const rootBase = childStart[rootId];
  const rootCount = childCount[rootId];
  let rootTotalChildSubtreeNodeCount = 0;
  let rootTotalChildVisibleSubtreeCount = 0;
  for (let ci = 0; ci < rootCount; ci += 1) {
    const childId = childIdsFlat[rootBase + ci];
    rootTotalChildSubtreeNodeCount += subtreeNodeCount[childId];
    rootTotalChildVisibleSubtreeCount += visibleSubtreeCount[childId];
  }
  subtreeNodeCount[rootId] = 1 + rootTotalChildSubtreeNodeCount;
  visibleSubtreeCount[rootId] = rootTotalChildVisibleSubtreeCount;
}

// Convenience wrapper for the opt-in flow: build the SoA store from a snapshot
// (with subtree counts NOT yet accumulated — i.e. builder.finish was called with
// skipSubtreeCountPass) and run the count-only sweep over it. Returns the store
// so callers can read the finalized counts back.
export function buildAndSweepOpenVisibleCountsSoa(
  snapshot: PathStoreSnapshot
): SoaNodeStore {
  const store = buildSoaNodeStore(snapshot);
  sweepOpenVisibleCountsSoa(store);
  return store;
}

// Re-exported types so consumers don't need to reach back into internal-types
// for the field-id aliases the store works with.
export type { NodeId, SegmentId, PathStoreNode, DirectoryChildIndex };
