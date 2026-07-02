// packages/path-store/scripts/benchmarkNodeStorageSoA.ts

import { getVirtualizationWorkload } from '@pierre/tree-test-data';
/**
 * Hypothesis #1 probe: does converting the `PathStoreNode[]` array-of-objects
 * (AoS) plus the per-directory `childIds: number[]` / `directories: Map` into a
 * Struct-of-Arrays layout (parallel Int32Arrays + a flat CSR child table)
 * measurably help on the hot full-tree projection sweep at ~1M nodes?
 *
 * The experiment builds the REAL linux-10x snapshot via PathStoreBuilder, then
 * mirrors its node fields and child topology into typed arrays. It runs the
 * identical preorder DFS (the shape of buildVisibleTreeProjectionDataDFS,
 * minus path-string materialization which is the same in both and would only
 * dilute the signal) over each representation, writing into identical
 * Int32Array output buffers and accumulating a checksum so nothing is
 * optimized away.
 *
 * It isolates exactly the variable in hypothesis #1: the cost of reading node
 * fields + child lists from objects/Maps vs from dense typed arrays. It also
 * reports construction time and retained heap for each representation.
 *
 * Run: AGENT=1 bun run ./scripts/benchmarkNodeStorageSoA.ts --workload linux-10x
 */
import { performance } from 'node:perf_hooks';

import { PathStoreBuilder } from '../src/builder';
import {
  type DirectoryChildIndex,
  isDirectoryNode,
  type PathStoreNode,
  type PathStoreSnapshot,
} from '../src/internal-types';

interface Config {
  runs: number;
  warmupRuns: number;
  workload: string;
}

// Fixed stack capacity: even linux-10x tree depth stays far under this, so the
// DFS never needs to grow its stack. Keeps both sweeps allocation-free.
const STACK_CAPACITY = 256;
const KIND_MASK = 1 << 3; // PATH_STORE_NODE_KIND_SHIFT === 3
const DEPTH_SHIFT = 4;

function parseArgs(argv: readonly string[]): Config {
  const config: Config = { runs: 25, warmupRuns: 5, workload: 'linux-10x' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runs') config.runs = Number(argv[++i] ?? config.runs);
    else if (arg === '--warmup-runs')
      config.warmupRuns = Number(argv[++i] ?? config.warmupRuns);
    else if (arg === '--workload')
      config.workload = argv[++i] ?? config.workload;
  }
  return config;
}

function summarize(durationsMs: readonly number[]) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((t, d) => t + d, 0);
  const pct = (f: number) =>
    n === 0 ? 0 : sorted[Math.min(n - 1, Math.max(0, Math.ceil(n * f) - 1))];
  return {
    averageMs: n === 0 ? 0 : sum / n,
    medianMs: pct(0.5),
    p95Ms: pct(0.95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[n - 1] ?? 0,
  };
}

function fmt(metrics: ReturnType<typeof summarize>): string {
  return [
    `avg=${metrics.averageMs.toFixed(2)}ms`,
    `median=${metrics.medianMs.toFixed(2)}ms`,
    `p95=${metrics.p95Ms.toFixed(2)}ms`,
    `min=${metrics.minMs.toFixed(2)}ms`,
  ].join('  ');
}

// Returns resident set size in MB after forcing a synchronous GC. Bun's
// JSC-backed `heapUsed` does not reliably reflect large typed-array / object
// allocations, so RSS deltas are used to compare retained footprint instead.
function retainedRssMb(): number {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  return process.memoryUsage().rss / (1024 * 1024);
}

// Builds the real snapshot the way PathStore's constructor does for bulk
// presorted file ingest, but WITHOUT skipping the subtree-count pass so node
// fields arrive fully populated for traversal.
function buildSnapshot(workloadName: string): PathStoreSnapshot {
  const workload = getVirtualizationWorkload(workloadName);
  const builder = new PathStoreBuilder({ flattenEmptyDirectories: false });
  builder.appendPresortedPaths(workload.presortedFiles, false);
  return builder.finish({ skipSubtreeCountPass: false });
}

interface SoaNodes {
  parentId: Int32Array;
  nameId: Int32Array;
  depthAndFlags: Int32Array;
  subtreeNodeCount: Int32Array;
  visibleSubtreeCount: Int32Array;
  // Flat CSR child table: children of node `id` occupy
  // childIdsFlat[childStart[id] .. childStart[id] + childCount[id]).
  childStart: Int32Array;
  childCount: Int32Array;
  childIdsFlat: Int32Array;
}

// Mirrors the AoS snapshot into parallel Int32Arrays + a flat CSR child table.
// Returns the SoA structure plus the wall-clock time spent allocating/filling.
function buildSoa(snapshot: PathStoreSnapshot): {
  soa: SoaNodes;
  buildMs: number;
} {
  const { nodes, directories } = snapshot;
  const n = nodes.length;
  const started = performance.now();

  const parentId = new Int32Array(n);
  const nameId = new Int32Array(n);
  const depthAndFlags = new Int32Array(n);
  const subtreeNodeCount = new Int32Array(n);
  const visibleSubtreeCount = new Int32Array(n);
  const childStart = new Int32Array(n);
  const childCount = new Int32Array(n);

  let totalChildren = 0;
  for (const index of directories.values()) {
    totalChildren += index.childIds.length;
  }
  const childIdsFlat = new Int32Array(totalChildren);

  for (let id = 0; id < n; id += 1) {
    const node = nodes[id];
    if (node == null) continue;
    parentId[id] = node.parentId;
    nameId[id] = node.nameId;
    depthAndFlags[id] = node.depthAndFlags;
    subtreeNodeCount[id] = node.subtreeNodeCount;
    visibleSubtreeCount[id] = node.visibleSubtreeCount;
  }

  let cursor = 0;
  for (const [dirId, index] of directories) {
    const ids = index.childIds;
    childStart[dirId] = cursor;
    childCount[dirId] = ids.length;
    for (let i = 0; i < ids.length; i += 1) {
      childIdsFlat[cursor++] = ids[i];
    }
  }

  return {
    soa: {
      parentId,
      nameId,
      depthAndFlags,
      subtreeNodeCount,
      visibleSubtreeCount,
      childStart,
      childCount,
      childIdsFlat,
    },
    buildMs: performance.now() - started,
  };
}

interface SweepOutput {
  rowCount: number;
  checksum: number;
}

// Preorder DFS over the AoS snapshot (PathStoreNode objects + a
// Map<dirId, {childIds: number[]}>), treating every directory as expanded so
// the whole tree is swept. Per node it reads the same fields the real
// projection reads and writes parent/posInSet/setSize into the shared output
// buffers, accumulating a checksum.
function sweepAoS(
  snapshot: PathStoreSnapshot,
  parentRowIndex: Int32Array,
  posInSet: Int32Array,
  setSize: Int32Array,
  lastRowAtDepth: Int32Array,
  stackDirId: Int32Array,
  stackCursor: Int32Array,
  stackDepth: Int32Array
): SweepOutput {
  const { nodes, directories, rootId } = snapshot;
  lastRowAtDepth.fill(-1);
  let sp = 0;
  stackDirId[0] = rootId;
  stackCursor[0] = 0;
  stackDepth[0] = -1;

  let rowCount = 0;
  let checksum = 0;

  while (sp >= 0) {
    const dir = directories.get(stackDirId[sp]) as DirectoryChildIndex;
    const childIds = dir.childIds;
    const cursor = stackCursor[sp];
    if (cursor >= childIds.length) {
      sp -= 1;
      continue;
    }
    stackCursor[sp] = cursor + 1;
    const childId = childIds[cursor];
    const node: PathStoreNode = nodes[childId];
    const visibleDepth = stackDepth[sp] + 1;

    parentRowIndex[rowCount] = lastRowAtDepth[visibleDepth];
    posInSet[rowCount] = cursor;
    setSize[rowCount] = childIds.length;
    checksum =
      (checksum +
        (node.depthAndFlags >>> DEPTH_SHIFT) +
        node.nameId +
        node.visibleSubtreeCount) |
      0;
    lastRowAtDepth[visibleDepth + 1] = rowCount;
    rowCount += 1;

    if (isDirectoryNode(node)) {
      sp += 1;
      stackDirId[sp] = childId;
      stackCursor[sp] = 0;
      stackDepth[sp] = visibleDepth;
    }
  }

  return { rowCount, checksum };
}

// Identical preorder DFS over the SoA representation. Node fields and child
// lists are read from dense typed arrays instead of objects/Map; everything
// else (stack handling, output writes, checksum) matches sweepAoS exactly.
function sweepSoa(
  soa: SoaNodes,
  rootId: number,
  parentRowIndex: Int32Array,
  posInSet: Int32Array,
  setSize: Int32Array,
  lastRowAtDepth: Int32Array,
  stackDirId: Int32Array,
  stackCursor: Int32Array,
  stackDepth: Int32Array
): SweepOutput {
  const {
    depthAndFlags,
    nameId,
    visibleSubtreeCount,
    childStart,
    childCount,
    childIdsFlat,
  } = soa;
  lastRowAtDepth.fill(-1);
  let sp = 0;
  stackDirId[0] = rootId;
  stackCursor[0] = 0;
  stackDepth[0] = -1;

  let rowCount = 0;
  let checksum = 0;

  while (sp >= 0) {
    const dirId = stackDirId[sp];
    const base = childStart[dirId];
    const count = childCount[dirId];
    const cursor = stackCursor[sp];
    if (cursor >= count) {
      sp -= 1;
      continue;
    }
    stackCursor[sp] = cursor + 1;
    const childId = childIdsFlat[base + cursor];
    const flags = depthAndFlags[childId];
    const visibleDepth = stackDepth[sp] + 1;

    parentRowIndex[rowCount] = lastRowAtDepth[visibleDepth];
    posInSet[rowCount] = cursor;
    setSize[rowCount] = count;
    checksum =
      (checksum +
        (flags >>> DEPTH_SHIFT) +
        nameId[childId] +
        visibleSubtreeCount[childId]) |
      0;
    lastRowAtDepth[visibleDepth + 1] = rowCount;
    rowCount += 1;

    if ((flags & KIND_MASK) !== 0) {
      sp += 1;
      stackDirId[sp] = childId;
      stackCursor[sp] = 0;
      stackDepth[sp] = visibleDepth;
    }
  }

  return { rowCount, checksum };
}

function timeSweep(
  config: Config,
  run: () => SweepOutput
): { metrics: ReturnType<typeof summarize>; out: SweepOutput } {
  let out: SweepOutput = { rowCount: 0, checksum: 0 };
  for (let i = 0; i < config.warmupRuns; i += 1) out = run();
  const durations: number[] = [];
  for (let i = 0; i < config.runs; i += 1) {
    const started = performance.now();
    out = run();
    durations.push(performance.now() - started);
  }
  return { metrics: summarize(durations), out };
}

// Allocates `count` plain PathStoreNode-shaped objects so the retained-heap
// delta can be compared against the equivalent SoA typed arrays.
function allocAosObjects(count: number): PathStoreNode[] {
  const arr = new Array<PathStoreNode>(count);
  for (let i = 0; i < count; i += 1) {
    arr[i] = {
      parentId: i,
      nameId: i,
      depthAndFlags: i,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    };
  }
  return arr;
}

function main(): void {
  const config = parseArgs(process.argv.slice(2));
  console.log(
    `\nworkload=${config.workload}  runs=${config.runs}  warmup=${config.warmupRuns}\n`
  );

  const snapshot = buildSnapshot(config.workload);
  const nodeCount = snapshot.nodes.length;
  let directoryCount = 0;
  let totalChildren = 0;
  for (const index of snapshot.directories.values()) {
    directoryCount += 1;
    totalChildren += index.childIds.length;
  }
  console.log(
    `nodes=${nodeCount.toLocaleString()}  directories=${directoryCount.toLocaleString()}  childEdges=${totalChildren.toLocaleString()}\n`
  );

  // --- Construction + retained memory --------------------------------------
  const { soa, buildMs } = buildSoa(snapshot);
  console.log('=== construction / memory ===');
  console.log(`SoA mirror fill: ${buildMs.toFixed(2)}ms`);

  // Measure one representation at a time (RSS deltas), freeing each before the
  // next so the footprints don't overlap. `globalThis` parking keeps each
  // structure live across its measurement without the optimizer reclaiming it.
  const park = globalThis as unknown as { __keep?: unknown };

  const rssBeforeAos = retainedRssMb();
  park.__keep = allocAosObjects(nodeCount);
  const aosMb = retainedRssMb() - rssBeforeAos;
  park.__keep = undefined;

  const rssBeforeSoa = retainedRssMb();
  // Fill each array so its backing pages are faulted in — a fresh zero-filled
  // Int32Array is lazily committed and would otherwise read as ~0 RSS.
  const soaFields: Int32Array[] = [];
  for (let f = 0; f < 5; f += 1) {
    const arr = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i += 1) arr[i] = i;
    soaFields.push(arr);
  }
  park.__keep = soaFields;
  const soaMb = retainedRssMb() - rssBeforeSoa;
  park.__keep = undefined;

  console.log(
    `AoS ${nodeCount.toLocaleString()} node objects (5 int fields): ~${aosMb.toFixed(1)} MB RSS`
  );
  console.log(
    `SoA 5 x Int32Array(${nodeCount.toLocaleString()}):              ~${soaMb.toFixed(1)} MB RSS  (theoretical floor ${((nodeCount * 5 * 4) / (1024 * 1024)).toFixed(1)} MB)`
  );
  console.log(
    `memory ratio AoS/SoA: ${soaMb > 0 ? (aosMb / soaMb).toFixed(2) : 'n/a'}x\n`
  );

  // --- Traversal: shared output + stack buffers ----------------------------
  const parentRowIndex = new Int32Array(nodeCount);
  const posInSet = new Int32Array(nodeCount);
  const setSize = new Int32Array(nodeCount);
  const lastRowAtDepth = new Int32Array(STACK_CAPACITY);
  const stackDirId = new Int32Array(STACK_CAPACITY);
  const stackCursor = new Int32Array(STACK_CAPACITY);
  const stackDepth = new Int32Array(STACK_CAPACITY);

  const aos = timeSweep(config, () =>
    sweepAoS(
      snapshot,
      parentRowIndex,
      posInSet,
      setSize,
      lastRowAtDepth,
      stackDirId,
      stackCursor,
      stackDepth
    )
  );
  const soaSweep = timeSweep(config, () =>
    sweepSoa(
      soa,
      snapshot.rootId,
      parentRowIndex,
      posInSet,
      setSize,
      lastRowAtDepth,
      stackDirId,
      stackCursor,
      stackDepth
    )
  );

  console.log('=== full-tree DFS sweep (all directories expanded) ===');
  console.log(
    `rows swept: AoS=${aos.out.rowCount.toLocaleString()}  SoA=${soaSweep.out.rowCount.toLocaleString()}  checksumMatch=${aos.out.checksum === soaSweep.out.checksum}`
  );
  console.log(`AoS (objects + Map):  ${fmt(aos.metrics)}`);
  console.log(`SoA (typed arrays):   ${fmt(soaSweep.metrics)}`);
  console.log(
    `speedup (median AoS/SoA): ${(aos.metrics.medianMs / soaSweep.metrics.medianMs).toFixed(2)}x\n`
  );
}

main();
