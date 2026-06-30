import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { describe, expect, test } from 'bun:test';

import { PathStoreBuilder, preparePathEntries } from '../src/builder';
import { PathStore } from '../src/index';
import {
  getNodeDepth,
  getNodeFlags,
  getNodeKind,
  isDirectoryNode,
  PATH_STORE_NODE_FLAG_REMOVED,
  type PathStoreSnapshot,
} from '../src/internal-types';
import {
  buildSoaNodeStore,
  getSoaNodeDepth,
  getSoaNodeFlags,
  getSoaNodeKind,
  hasSoaNodeFlag,
  isSoaDirectoryNode,
  sweepOpenVisibleCountsSoa,
} from '../src/soa-node-store';

const SMALL_PATHS: string[] = [
  'alpha/docs/readme.md',
  'alpha/src/app.ts',
  'alpha/src/utils/math.ts',
  'alpha/todo.txt',
  'beta/archive/notes.txt',
  'beta/keep.txt',
  'gamma/logs/today.txt',
  'zeta.md',
];

function buildSnapshotFromPaths(
  paths: readonly string[],
  flattenEmptyDirectories: boolean
): PathStoreSnapshot {
  const builder = new PathStoreBuilder({ flattenEmptyDirectories });
  builder.appendPreparedPaths(
    preparePathEntries(paths, { flattenEmptyDirectories })
  );
  // Leave subtree counts un-accumulated, matching the PathStore constructor's
  // skipSubtreeCountPass usage: the SoA sweep populates them.
  return builder.finish({ skipSubtreeCountPass: true });
}

function buildPresortedSnapshot(workloadName: string): PathStoreSnapshot {
  const workload = getVirtualizationWorkload(workloadName);
  const builder = new PathStoreBuilder({ flattenEmptyDirectories: false });
  builder.appendPresortedPaths(workload.presortedFiles, false);
  return builder.finish({ skipSubtreeCountPass: false });
}

describe('SoA node store', () => {
  test('accessors return identical values to the object-array helpers for every node', () => {
    const snapshot = buildPresortedSnapshot('linux-1x');
    const store = buildSoaNodeStore(snapshot);

    expect(store.nodeCount).toBe(snapshot.nodes.length);

    for (let id = 0; id < snapshot.nodes.length; id += 1) {
      const node = snapshot.nodes[id];
      if (node == null) {
        continue;
      }
      expect(store.parentId[id]).toBe(node.parentId);
      expect(store.nameId[id]).toBe(node.nameId);
      expect(store.depthAndFlags[id]).toBe(node.depthAndFlags);
      expect(getSoaNodeDepth(store, id)).toBe(getNodeDepth(node));
      expect(getSoaNodeKind(store, id)).toBe(getNodeKind(node));
      expect(isSoaDirectoryNode(store, id)).toBe(isDirectoryNode(node));
      expect(getSoaNodeFlags(store, id)).toBe(getNodeFlags(node));
      expect(hasSoaNodeFlag(store, id, PATH_STORE_NODE_FLAG_REMOVED)).toBe(
        (getNodeFlags(node) & PATH_STORE_NODE_FLAG_REMOVED) !== 0
      );
    }
  });

  test('CSR child table reproduces every directory child list', () => {
    const snapshot = buildPresortedSnapshot('linux-1x');
    const store = buildSoaNodeStore(snapshot);

    for (const [dirId, index] of snapshot.directories) {
      const base = store.childStart[dirId];
      const count = store.childCount[dirId];
      expect(count).toBe(index.childIds.length);
      for (let i = 0; i < count; i += 1) {
        expect(store.childIdsFlat[base + i]).toBe(index.childIds[i]);
      }
    }
  });

  test('count-only sweep matches initializeOpenVisibleCounts (presorted, no flatten)', () => {
    // Reference: a default PathStore built all-open over the same input. Its
    // per-node subtreeNodeCount / visibleSubtreeCount are produced by
    // initializeOpenVisibleCounts.
    const workload = getVirtualizationWorkload('linux-1x');
    const referenceStore = new PathStore({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      presorted: true,
      paths: workload.presortedFiles,
    });

    // The SoA sweep over a fresh skip-pass snapshot must agree with the values
    // the default constructor computed via initializeOpenVisibleCounts. The
    // root's visibleSubtreeCount is exactly the store's total visible count.
    const soaSnapshot = buildPresortedSnapshot('linux-1x');
    const store = buildSoaNodeStore(soaSnapshot);
    sweepOpenVisibleCountsSoa(store);

    expect(store.visibleSubtreeCount[store.rootId]).toBe(
      referenceStore.getVisibleCount()
    );

    // Spot check: every directory's subtreeNodeCount equals 1 + sum of child
    // subtree counts (internal consistency of the sweep).
    for (const [dirId, index] of soaSnapshot.directories) {
      let expected = 1;
      for (const childId of index.childIds) {
        expected += store.subtreeNodeCount[childId];
      }
      expect(store.subtreeNodeCount[dirId]).toBe(expected);
    }
  });

  test('sweep handles the flatten-empty-directories case', () => {
    const snapshot = buildSnapshotFromPaths(SMALL_PATHS, true);
    const store = buildSoaNodeStore(snapshot);
    sweepOpenVisibleCountsSoa(store);

    const reference = new PathStore({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: SMALL_PATHS,
    });
    expect(store.visibleSubtreeCount[store.rootId]).toBe(
      reference.getVisibleCount()
    );
  });
});

describe('PathStore useSoaCountSweep flag', () => {
  function assertIdenticalProjection(a: PathStore, b: PathStore): void {
    expect(a.getVisibleCount()).toBe(b.getVisibleCount());
    const count = a.getVisibleCount();
    const rowsA = count > 0 ? a.getVisibleSlice(0, count - 1) : [];
    const rowsB = count > 0 ? b.getVisibleSlice(0, count - 1) : [];
    expect(rowsA.length).toBe(rowsB.length);
    for (let i = 0; i < rowsA.length; i += 1) {
      expect(rowsA[i].path).toBe(rowsB[i].path);
      expect(rowsA[i].depth).toBe(rowsB[i].depth);
      expect(rowsA[i].kind).toBe(rowsB[i].kind);
      expect(rowsA[i].hasChildren).toBe(rowsB[i].hasChildren);
      expect(rowsA[i].isExpanded).toBe(rowsB[i].isExpanded);
      expect(rowsA[i].isFlattened).toBe(rowsB[i].isFlattened);
    }
  }

  test('flag produces identical projection to the default path (small, flatten)', () => {
    const base = {
      flattenEmptyDirectories: true,
      initialExpansion: 'open' as const,
      paths: SMALL_PATHS,
    };
    assertIdenticalProjection(
      new PathStore(base),
      new PathStore({ ...base, useSoaCountSweep: true })
    );
  });

  test('flag produces identical projection to the default path (small, no flatten)', () => {
    const base = {
      flattenEmptyDirectories: false,
      initialExpansion: 'open' as const,
      paths: SMALL_PATHS,
    };
    assertIdenticalProjection(
      new PathStore(base),
      new PathStore({ ...base, useSoaCountSweep: true })
    );
  });

  test('flag produces identical visible count over a real presorted workload', () => {
    const workload = getVirtualizationWorkload('linux-1x');
    const base = {
      flattenEmptyDirectories: false,
      initialExpansion: 'open' as const,
      presorted: true,
      paths: workload.presortedFiles,
    };
    const def = new PathStore(base);
    const soa = new PathStore({ ...base, useSoaCountSweep: true });
    expect(soa.getVisibleCount()).toBe(def.getVisibleCount());

    // Full visible-slice checksum equality (path-length sum + depth sum).
    const count = def.getVisibleCount();
    const rowsDef = def.getVisibleSlice(0, count - 1);
    const rowsSoa = soa.getVisibleSlice(0, count - 1);
    let checksumDef = 0;
    let checksumSoa = 0;
    for (let i = 0; i < rowsDef.length; i += 1) {
      checksumDef =
        (checksumDef + rowsDef[i].path.length + rowsDef[i].depth) | 0;
      checksumSoa =
        (checksumSoa + rowsSoa[i].path.length + rowsSoa[i].depth) | 0;
    }
    expect(rowsSoa.length).toBe(rowsDef.length);
    expect(checksumSoa).toBe(checksumDef);
  });

  test('flag is inert when the all-open count fast path is not eligible', () => {
    // initialExpandedPaths makes canInitializeOpenVisibleCounts false unless all
    // directories happen to be expanded; with a single expanded path the store
    // falls back to recomputeCountsRecursive and the flag has no effect.
    const base = {
      flattenEmptyDirectories: true,
      initialExpansion: 'closed' as const,
      initialExpandedPaths: ['alpha/'],
      paths: SMALL_PATHS,
    };
    assertIdenticalProjection(
      new PathStore(base),
      new PathStore({ ...base, useSoaCountSweep: true })
    );
  });
});
