import type {
  DirectoryChildIndex,
  NodeId,
  PathStoreNode,
  PathStoreSnapshot,
  PreparedPath,
  ResolvedPathStoreOptions,
  SegmentId,
} from './internal-types';
import { PATH_STORE_NODE_FLAG_EXPLICIT } from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import { PATH_STORE_NODE_KIND_FILE } from './internal-types';
import {
  getBenchmarkInstrumentation,
  setBenchmarkCounter,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import type { BenchmarkInstrumentation } from './internal/benchmarkInstrumentation';
import { resolvePathStoreOptions } from './options';
import { parseInputPath } from './path';
import type {
  PathStoreCompareEntry,
  PathStoreOptions,
  PathStorePathComparator,
} from './public-types';
import { internSegment } from './segments';
import { createSegmentTable } from './segments';
import { comparePreparedPaths } from './sort';

function createDirectoryChildIndex(): DirectoryChildIndex {
  return {
    childIds: [],
    childIdByNameId: new Map<SegmentId, NodeId>(),
    childPositionById: new Map<NodeId, number>(),
  };
}

function appendChildReference(
  index: DirectoryChildIndex,
  childId: NodeId
): void {
  index.childPositionById.set(childId, index.childIds.length);
  index.childIds.push(childId);
}

function createCompareEntry(preparedPath: PreparedPath): PathStoreCompareEntry {
  return {
    basename: preparedPath.basename,
    depth: preparedPath.segments.length,
    isDirectory: preparedPath.isDirectory,
    path: preparedPath.path,
    segments: preparedPath.segments,
  };
}

function compareWithSortOption(
  left: PreparedPath,
  right: PreparedPath,
  sort: 'default' | PathStorePathComparator
): number {
  if (sort === 'default') {
    return comparePreparedPaths(left, right);
  }

  return sort(createCompareEntry(left), createCompareEntry(right));
}

function createRootNode(): PathStoreNode {
  return {
    depth: 0,
    flags: PATH_STORE_NODE_FLAG_EXPLICIT | PATH_STORE_NODE_FLAG_ROOT,
    id: 0,
    kind: PATH_STORE_NODE_KIND_DIRECTORY,
    nameId: 0,
    parentId: 0,
    pathCache: '',
    pathCacheVersion: 0,
    subtreeNodeCount: 1,
    visibleSubtreeCount: 1,
  };
}

function computeSharedPrefixLength(
  left: readonly string[],
  right: readonly string[]
): number {
  const maxLength = Math.min(left.length, right.length);
  for (let index = 0; index < maxLength; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return maxLength;
}

function getDirectoryDepth(preparedPath: PreparedPath): number {
  return preparedPath.isDirectory
    ? preparedPath.segments.length
    : preparedPath.segments.length - 1;
}

export function preparePaths(
  paths: readonly string[],
  options: PathStoreOptions = {}
): string[] {
  return preparePathEntries(paths, options).map((entry) => entry.path);
}

export function preparePathEntries(
  paths: readonly string[],
  options: PathStoreOptions = {}
): PreparedPath[] {
  const resolvedOptions = resolvePathStoreOptions(options);
  const instrumentation = getBenchmarkInstrumentation(options);
  setBenchmarkCounter(instrumentation, 'workload.inputFiles', paths.length);
  const preparedPaths = withBenchmarkPhase(
    instrumentation,
    'store.preparePathEntries.parse',
    () => paths.map((path) => parseInputPath(path))
  );

  withBenchmarkPhase(instrumentation, 'store.preparePathEntries.sort', () =>
    preparedPaths.sort((left, right) =>
      compareWithSortOption(left, right, resolvedOptions.sort)
    )
  );

  return preparedPaths;
}

export class PathStoreBuilder {
  private readonly directories = new Map<NodeId, DirectoryChildIndex>();
  private readonly directoryStack: NodeId[] = [0];
  private lastPreparedPath: PreparedPath | null = null;
  private readonly nodes: PathStoreNode[] = [createRootNode()];
  private readonly options: ResolvedPathStoreOptions;
  private readonly instrumentation: BenchmarkInstrumentation | null;
  private readonly segmentTable = createSegmentTable();

  public constructor(options: PathStoreOptions = {}) {
    this.instrumentation = getBenchmarkInstrumentation(options);
    this.options = resolvePathStoreOptions(options);
    this.directories.set(0, createDirectoryChildIndex());
  }

  public appendPaths(paths: readonly string[]): this {
    return withBenchmarkPhase(
      this.instrumentation,
      'store.builder.appendPaths.parse',
      () => this.appendPreparedPaths(paths.map((path) => parseInputPath(path)))
    );
  }

  public appendPreparedPaths(preparedPaths: readonly PreparedPath[]): this {
    withBenchmarkPhase(
      this.instrumentation,
      'store.builder.appendPreparedPaths',
      () => {
        for (const preparedPath of preparedPaths) {
          this.appendPreparedPath(preparedPath);
        }
      }
    );

    return this;
  }

  public finish(): PathStoreSnapshot {
    withBenchmarkPhase(
      this.instrumentation,
      'store.builder.computeSubtreeCounts',
      () => this.computeSubtreeCounts(0)
    );
    return {
      directories: this.directories,
      nodes: this.nodes,
      options: this.options,
      rootId: 0,
      segmentTable: this.segmentTable,
    };
  }

  private appendPreparedPath(preparedPath: PreparedPath): void {
    if (this.lastPreparedPath != null) {
      const orderComparison = compareWithSortOption(
        this.lastPreparedPath,
        preparedPath,
        this.options.sort
      );
      if (orderComparison > 0) {
        throw new Error(
          `Builder input must be sorted before appendPaths(): "${preparedPath.path}"`
        );
      }

      if (
        orderComparison === 0 &&
        preparedPath.path === this.lastPreparedPath.path
      ) {
        throw new Error(`Duplicate path: "${preparedPath.path}"`);
      }
    }

    const previousPath = this.lastPreparedPath;
    const currentDirectoryDepth = getDirectoryDepth(preparedPath);
    const previousDirectoryDepth =
      previousPath == null ? 0 : getDirectoryDepth(previousPath);
    const sharedPrefixLength =
      previousPath == null
        ? 0
        : computeSharedPrefixLength(
            previousPath.segments,
            preparedPath.segments
          );
    const sharedDirectoryDepth = Math.min(
      sharedPrefixLength,
      currentDirectoryDepth,
      previousDirectoryDepth
    );

    this.directoryStack.length = sharedDirectoryDepth + 1;

    for (
      let segmentIndex = sharedDirectoryDepth;
      segmentIndex < currentDirectoryDepth;
      segmentIndex++
    ) {
      const parentId = this.directoryStack[this.directoryStack.length - 1];
      if (parentId === undefined) {
        throw new Error(
          'Directory stack underflow while building the path store'
        );
      }

      const childId = this.getOrCreateDirectoryChild(
        parentId,
        preparedPath.segments[segmentIndex]
      );
      this.directoryStack.push(childId);
    }

    if (preparedPath.isDirectory) {
      const directoryId = this.directoryStack[this.directoryStack.length - 1];
      if (directoryId === undefined) {
        throw new Error(
          `Unable to resolve directory node for "${preparedPath.path}"`
        );
      }

      this.promoteDirectoryToExplicit(directoryId, preparedPath.path);
      this.lastPreparedPath = preparedPath;
      return;
    }

    const parentId = this.directoryStack[this.directoryStack.length - 1];
    if (parentId === undefined) {
      throw new Error(
        `Unable to resolve file parent for "${preparedPath.path}"`
      );
    }

    this.createFileChild(parentId, preparedPath.basename, preparedPath.path);
    this.lastPreparedPath = preparedPath;
  }

  private createFileChild(
    parentId: NodeId,
    basename: string,
    path: string
  ): NodeId {
    const nameId = internSegment(this.segmentTable, basename);
    const parentIndex = this.getDirectoryIndex(parentId);
    const existingChildId = parentIndex.childIdByNameId.get(nameId);
    if (existingChildId !== undefined) {
      throw new Error(`Path collides with an existing entry: "${path}"`);
    }

    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depth: parentNode.depth + 1,
      flags: 0,
      id: nodeId,
      kind: PATH_STORE_NODE_KIND_FILE,
      nameId,
      parentId,
      pathCache: path,
      pathCacheVersion: 0,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    parentIndex.childIdByNameId.set(nameId, nodeId);
    appendChildReference(parentIndex, nodeId);
    return nodeId;
  }

  private getOrCreateDirectoryChild(parentId: NodeId, segment: string): NodeId {
    const nameId = internSegment(this.segmentTable, segment);
    const parentIndex = this.getDirectoryIndex(parentId);
    const existingChildId = parentIndex.childIdByNameId.get(nameId);
    if (existingChildId !== undefined) {
      const existingNode = this.nodes[existingChildId];
      if (existingNode?.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
        throw new Error(
          `Path collides with an existing file while creating directory "${segment}"`
        );
      }

      return existingChildId;
    }

    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depth: parentNode.depth + 1,
      flags: 0,
      id: nodeId,
      kind: PATH_STORE_NODE_KIND_DIRECTORY,
      nameId,
      parentId,
      pathCache: null,
      pathCacheVersion: 0,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    parentIndex.childIdByNameId.set(nameId, nodeId);
    appendChildReference(parentIndex, nodeId);
    this.directories.set(nodeId, createDirectoryChildIndex());
    return nodeId;
  }

  private promoteDirectoryToExplicit(directoryId: NodeId, path: string): void {
    const directoryNode = this.nodes[directoryId];
    if (directoryNode === undefined) {
      throw new Error(`Unknown directory node ID: ${String(directoryId)}`);
    }

    if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      throw new Error(`Path is not a directory: "${path}"`);
    }

    if ((directoryNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0) {
      throw new Error(`Duplicate path: "${path}"`);
    }

    directoryNode.flags |= PATH_STORE_NODE_FLAG_EXPLICIT;
    directoryNode.pathCache = path;
  }

  private getDirectoryIndex(directoryId: NodeId): DirectoryChildIndex {
    const existingIndex = this.directories.get(directoryId);
    if (existingIndex !== undefined) {
      return existingIndex;
    }

    throw new Error(
      `Unknown directory child index for node ${String(directoryId)}`
    );
  }

  // Computes subtree counts after bulk ingest so later phases can add
  // projection math without changing the canonical storage layout.
  private computeSubtreeCounts(nodeId: NodeId): number {
    const node = this.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`Unknown node ID: ${String(nodeId)}`);
    }

    if (node.kind === PATH_STORE_NODE_KIND_FILE) {
      node.subtreeNodeCount = 1;
      node.visibleSubtreeCount = 1;
      return 1;
    }

    const directoryIndex = this.getDirectoryIndex(nodeId);
    let subtreeNodeCount = 1;
    for (const childId of directoryIndex.childIds) {
      subtreeNodeCount += this.computeSubtreeCounts(childId);
    }

    node.subtreeNodeCount = subtreeNodeCount;
    node.visibleSubtreeCount = subtreeNodeCount;
    return subtreeNodeCount;
  }
}
