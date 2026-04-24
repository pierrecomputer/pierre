import {
  appendChildReference,
  createDirectoryChildIndex,
  createPresortedDirectoryChildIndex,
} from './child-index';
import { rebuildDirectoryChildAggregates } from './child-index';
import {
  addNodeFlag,
  createNodeDepthAndFlags,
  getNodeDepth,
  hasNodeFlag,
  isDirectoryNode,
} from './internal-types';
import type {
  DirectoryChildIndex,
  InternalPreparedInput,
  NodeId,
  PathStoreNode,
  PathStoreSnapshot,
  PreparedPath,
  ResolvedPathStoreOptions,
  SegmentSortKey,
} from './internal-types';

interface PathStoreBuilderStartupHints {
  initialExpandedPaths?: readonly string[];
}

// Options passed to PathStoreBuilder.finish(). Callers that run their own
// per-node count computation afterwards (PathStore constructor always runs
// either initializeOpenVisibleCounts or recomputeCountsRecursive) can set
// skipSubtreeCountPass to avoid buildPresortedFinish's backward accumulation
// pass. Callers that read subtreeNodeCount directly from the returned
// snapshot (for example, static-store) must leave skipSubtreeCountPass
// unset or false.
export interface BuilderFinishOptions {
  skipSubtreeCountPass?: boolean;
}

type PreparedInputKind = 'prepared' | 'presorted';

const PREPARED_INPUT_KIND = Symbol('pathStorePreparedInputKind');

type ValidatedPreparedInput = InternalPreparedInput & {
  [PREPARED_INPUT_KIND]?: PreparedInputKind;
};

function attachPreparedInputKind<TValue extends InternalPreparedInput>(
  value: TValue,
  kind: PreparedInputKind
): TValue {
  (value as ValidatedPreparedInput)[PREPARED_INPUT_KIND] = kind;
  return value;
}

import { PATH_STORE_NODE_FLAG_EXPLICIT } from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
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
import {
  comparePreparedPaths,
  comparePreparedPathsWithCachedSortKeys,
} from './sort';

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
    depthAndFlags: createNodeDepthAndFlags(
      0,
      PATH_STORE_NODE_FLAG_EXPLICIT | PATH_STORE_NODE_FLAG_ROOT,
      PATH_STORE_NODE_KIND_DIRECTORY
    ),
    nameId: 0,
    parentId: 0,
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

function isPreparedPathArray(value: unknown): value is readonly PreparedPath[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry != null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        Array.isArray(entry.segments) &&
        typeof entry.basename === 'string' &&
        typeof entry.isDirectory === 'boolean'
    )
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

export function preparePaths(
  paths: readonly string[],
  options: PathStoreOptions = {}
): string[] {
  return preparePathEntries(paths, options).map((entry) => entry.path);
}

export function prepareInput(
  paths: readonly string[],
  options: PathStoreOptions = {}
): InternalPreparedInput {
  const preparedPaths = preparePathEntries(paths, options);
  return attachPreparedInputKind(
    {
      paths: preparedPaths.map((entry) => entry.path),
      preparedPaths,
    },
    'prepared'
  );
}

export function preparePresortedInput(
  paths: readonly string[]
): InternalPreparedInput {
  // Skip the defensive copy: the input is `readonly string[]`, internal
  // consumers (builder.appendPresortedPaths / appendPresortedFilePaths) only
  // iterate it, and we brand the returned prepared input so it cannot be
  // round-tripped through a mutating caller without going back through
  // PathStore.prepareInput. On 929K-path workloads the copy alone costs
  // several milliseconds that page.createOptions cannot afford.
  const pathCount = paths.length;
  let presortedPathsContainDirectories = false;

  for (let index = 0; index < pathCount; index += 1) {
    const path = paths[index];
    if (path.length > 0 && path.charCodeAt(path.length - 1) === 47) {
      presortedPathsContainDirectories = true;
      break;
    }
  }

  return attachPreparedInputKind(
    {
      paths,
      presortedPaths: paths,
      presortedPathsContainDirectories,
    },
    'presorted'
  );
}

export function getPreparedInputEntries(
  preparedInput: import('./public-types').PathStorePreparedInput
): readonly PreparedPath[] {
  const internalPreparedInput =
    preparedInput as Partial<ValidatedPreparedInput>;
  const preparedPaths = internalPreparedInput.preparedPaths;
  if (
    internalPreparedInput[PREPARED_INPUT_KIND] === 'prepared' &&
    preparedPaths != null
  ) {
    return preparedPaths;
  }

  if (!isPreparedPathArray(preparedPaths)) {
    throw new Error('preparedInput must come from PathStore.prepareInput()');
  }

  return preparedPaths;
}

export function getPreparedInputPresortedPaths(
  preparedInput: import('./public-types').PathStorePreparedInput
): readonly string[] | null {
  const internalPreparedInput =
    preparedInput as Partial<ValidatedPreparedInput>;
  if (
    internalPreparedInput[PREPARED_INPUT_KIND] === 'presorted' &&
    internalPreparedInput.presortedPaths != null
  ) {
    return internalPreparedInput.presortedPaths;
  }

  return isStringArray(internalPreparedInput.presortedPaths)
    ? internalPreparedInput.presortedPaths
    : null;
}

export function getPreparedInputPresortedPathsContainDirectories(
  preparedInput: import('./public-types').PathStorePreparedInput
): boolean | null {
  const internalPreparedInput = preparedInput as Partial<InternalPreparedInput>;
  return typeof internalPreparedInput.presortedPathsContainDirectories ===
    'boolean'
    ? internalPreparedInput.presortedPathsContainDirectories
    : null;
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
  // Tracks directory node IDs in creation order during presorted ingestion,
  // so later callers (initializeOpenVisibleCounts) can walk only directories
  // in post-order (via reverse iteration) without scanning the whole nodes
  // array or allocating via Array.from(directories.keys()).
  private readonly presortedDirectoryNodeIds: NodeId[] = [];
  private readonly initialExpandedPathSet: ReadonlySet<string> | null;
  private createdDirectoriesAllExpanded = false;
  private createdDirectoryCount = 0;
  private lastPreparedPath: PreparedPath | null = null;
  private readonly nodes: PathStoreNode[] = [createRootNode()];
  private readonly options: ResolvedPathStoreOptions;
  private readonly instrumentation: BenchmarkInstrumentation | null;
  private readonly segmentSortKeyCache = new Map<string, SegmentSortKey>();
  private readonly segmentTable = createSegmentTable();
  private hasDeferredDirectoryIndexes = false;

  public constructor(options: PathStoreOptions = {}) {
    this.instrumentation = getBenchmarkInstrumentation(options);
    this.options = resolvePathStoreOptions(options);

    const initialExpandedPaths =
      (options as PathStoreBuilderStartupHints).initialExpandedPaths ?? null;
    if (initialExpandedPaths == null || initialExpandedPaths.length === 0) {
      this.initialExpandedPathSet = null;
    } else {
      // Normalize trailing slashes so the Set matches what the presorted
      // builder's path.slice(0, slashPos) produces (no trailing slash).
      // charCodeAt + slice is measurably faster than endsWith on hot paths;
      // on linux-10x this loop runs 61K times.
      const normalizedPaths = new Set<string>();
      const hintCount = initialExpandedPaths.length;
      for (let index = 0; index < hintCount; index += 1) {
        const path = initialExpandedPaths[index];
        const length = path.length;
        normalizedPaths.add(
          length > 0 && path.charCodeAt(length - 1) === 47
            ? path.slice(0, length - 1)
            : path
        );
      }
      this.initialExpandedPathSet = normalizedPaths;
      this.createdDirectoriesAllExpanded = true;
    }

    this.directories.set(0, createDirectoryChildIndex());
  }

  public appendPaths(paths: readonly string[]): this {
    return withBenchmarkPhase(
      this.instrumentation,
      'store.builder.appendPaths.parse',
      () => this.appendPreparedPaths(paths.map((path) => parseInputPath(path)))
    );
  }

  public appendPreparedPaths(
    preparedPaths: readonly PreparedPath[],
    validateOrder = true
  ): this {
    this.createdDirectoriesAllExpanded = false;

    withBenchmarkPhase(
      this.instrumentation,
      'store.builder.appendPreparedPaths',
      () => {
        for (const preparedPath of preparedPaths) {
          this.appendPreparedPath(preparedPath, validateOrder);
        }
      }
    );

    return this;
  }

  public appendPresortedPaths(
    paths: readonly string[],
    containsDirectories: boolean | null = null
  ): this {
    withBenchmarkPhase(
      this.instrumentation,
      'store.builder.appendPresortedPaths',
      () => {
        if (containsDirectories === false) {
          this.appendPresortedFilePaths(paths);
          return;
        }

        this.createdDirectoriesAllExpanded = false;

        let previousPath: string | null = null;
        let currentDepth = 0;
        const nodes = this.nodes;
        const segmentTable = this.segmentTable;
        const idByValue = segmentTable.idByValue;
        const valueById = segmentTable.valueById;
        const dirStack = this.directoryStack;
        let stackTop = 0;

        // Cache the previous file's directory prefix so consecutive files in
        // the same directory can use a fast native startsWith check instead of
        // the full char-by-char prefix comparison.
        let cachedDirPrefix = '';
        let cachedDirDepth = 0;

        for (const path of paths) {
          // Only catches adjacent duplicates — presorted input guarantees
          // duplicates are consecutive, so this is sufficient.
          if (previousPath === path) {
            throw new Error(`Duplicate path: "${path}"`);
          }

          // Inline prefix comparison to avoid per-path result object
          // allocation and function-call overhead.
          const hasTrailingSlash =
            path.length > 0 && path.charCodeAt(path.length - 1) === 47;
          const endIndex = hasTrailingSlash ? path.length - 1 : path.length;
          let sharedDirectoryDepth = 0;
          let unsharedSegmentStart = 0;

          if (previousPath != null) {
            // Fast path: if the path starts with the cached directory prefix,
            // skip the char-by-char comparison.  Native startsWith uses
            // optimized memory comparison.  The inner indexOf loop still
            // handles any new subdirectories beyond the cached prefix.
            if (
              cachedDirPrefix.length > 0 &&
              path.length > cachedDirPrefix.length &&
              path.startsWith(cachedDirPrefix)
            ) {
              sharedDirectoryDepth = cachedDirDepth;
              unsharedSegmentStart = cachedDirPrefix.length;
            } else {
              const compareLength = Math.min(endIndex, previousPath.length);
              let prefixMatched = true;
              for (let ci = 0; ci < compareLength; ci++) {
                const cc = path.charCodeAt(ci);
                if (cc !== previousPath.charCodeAt(ci)) {
                  prefixMatched = false;
                  break;
                }
                if (cc === 47) {
                  sharedDirectoryDepth++;
                  unsharedSegmentStart = ci + 1;
                }
              }
              if (
                prefixMatched &&
                hasTrailingSlash &&
                compareLength === endIndex &&
                previousPath.length > endIndex &&
                previousPath.charCodeAt(endIndex) === 47
              ) {
                sharedDirectoryDepth++;
                unsharedSegmentStart = endIndex + 1;
              }
            }
          }

          stackTop = sharedDirectoryDepth;
          currentDepth = sharedDirectoryDepth;

          let segmentStart = unsharedSegmentStart;
          let slashPos = path.indexOf('/', segmentStart);
          while (slashPos >= 0 && slashPos < endIndex) {
            const parentId = dirStack[stackTop];
            if (parentId === undefined) {
              throw new Error(
                'Directory stack underflow while building the path store'
              );
            }

            currentDepth++;
            const dirSeg = path.slice(segmentStart, slashPos);
            let dirNameId = idByValue.get(dirSeg);
            if (dirNameId === undefined) {
              dirNameId = valueById.length;
              idByValue.set(dirSeg, dirNameId);
              valueById.push(dirSeg);
            }
            const nodeId = nodes.length;
            nodes.push({
              depthAndFlags: createNodeDepthAndFlags(
                currentDepth,
                0,
                PATH_STORE_NODE_KIND_DIRECTORY
              ),
              nameId: dirNameId,
              parentId,
              subtreeNodeCount: 1,
              visibleSubtreeCount: 1,
            });
            this.recordCreatedDirectoryPath(path.slice(0, slashPos));
            stackTop++;
            dirStack[stackTop] = nodeId;
            segmentStart = slashPos + 1;
            slashPos = path.indexOf('/', segmentStart);
          }

          if (hasTrailingSlash) {
            if (segmentStart < endIndex) {
              const parentId = dirStack[stackTop];
              if (parentId === undefined) {
                throw new Error(
                  `Unable to resolve directory parent for "${path}"`
                );
              }

              currentDepth++;
              const trailSeg = path.slice(segmentStart, endIndex);
              let trailNameId = idByValue.get(trailSeg);
              if (trailNameId === undefined) {
                trailNameId = valueById.length;
                idByValue.set(trailSeg, trailNameId);
                valueById.push(trailSeg);
              }
              const nodeId = nodes.length;
              nodes.push({
                depthAndFlags: createNodeDepthAndFlags(
                  currentDepth,
                  0,
                  PATH_STORE_NODE_KIND_DIRECTORY
                ),
                nameId: trailNameId,
                parentId,
                subtreeNodeCount: 1,
                visibleSubtreeCount: 1,
              });
              stackTop++;
              dirStack[stackTop] = nodeId;
            }

            const directoryId = dirStack[stackTop];
            if (directoryId === undefined) {
              throw new Error(`Unable to resolve directory node for "${path}"`);
            }

            this.promoteDirectoryToExplicit(directoryId, path);
          } else {
            const parentId = dirStack[stackTop];
            if (parentId === undefined) {
              throw new Error(`Unable to resolve file parent for "${path}"`);
            }

            const fileSeg = path.slice(segmentStart);
            let fileNameId = idByValue.get(fileSeg);
            if (fileNameId === undefined) {
              fileNameId = valueById.length;
              idByValue.set(fileSeg, fileNameId);
              valueById.push(fileSeg);
            }
            nodes.push({
              depthAndFlags: createNodeDepthAndFlags(currentDepth + 1, 0),
              nameId: fileNameId,
              parentId,
              subtreeNodeCount: 1,
              visibleSubtreeCount: 1,
            });
          }

          // Update the directory prefix cache.  Only allocate a new prefix
          // string when the directory actually changed.
          if (segmentStart !== cachedDirPrefix.length) {
            cachedDirPrefix = path.substring(0, segmentStart);
            cachedDirDepth = currentDepth;
          }

          previousPath = path;
        }

        // Sync directory stack length for potential subsequent non-presorted
        // operations.
        dirStack.length = stackTop + 1;

        if (previousPath != null) {
          this.lastPreparedPath = parseInputPath(previousPath);
        }

        this.hasDeferredDirectoryIndexes = true;
      }
    );

    return this;
  }

  // File-only presorted input can skip all explicit-directory handling and the
  // trailing-slash checks in the hottest builder loop.
  private appendPresortedFilePaths(paths: readonly string[]): void {
    let previousPath: string | null = null;
    let currentDepth = 0;
    const nodes = this.nodes;
    const segmentTable = this.segmentTable;
    const idByValue = segmentTable.idByValue;
    const valueById = segmentTable.valueById;
    const dirStack = this.directoryStack;
    let stackTop = 0;
    let cachedDirPrefix = '';
    let cachedDirDepth = 0;

    for (const path of paths) {
      if (previousPath === path) {
        throw new Error(`Duplicate path: "${path}"`);
      }

      const endIndex = path.length;
      let sharedDirectoryDepth = 0;
      let unsharedSegmentStart = 0;

      if (previousPath != null) {
        if (
          cachedDirPrefix.length > 0 &&
          path.length > cachedDirPrefix.length &&
          path.startsWith(cachedDirPrefix)
        ) {
          sharedDirectoryDepth = cachedDirDepth;
          unsharedSegmentStart = cachedDirPrefix.length;
        } else {
          const compareLength = Math.min(endIndex, previousPath.length);
          for (let ci = 0; ci < compareLength; ci++) {
            const cc = path.charCodeAt(ci);
            if (cc !== previousPath.charCodeAt(ci)) {
              break;
            }
            if (cc === 47) {
              sharedDirectoryDepth++;
              unsharedSegmentStart = ci + 1;
            }
          }
        }
      }

      stackTop = sharedDirectoryDepth;
      currentDepth = sharedDirectoryDepth;

      let segmentStart = unsharedSegmentStart;
      let slashPos = path.indexOf('/', segmentStart);
      while (slashPos >= 0) {
        const parentId = dirStack[stackTop];
        if (parentId === undefined) {
          throw new Error(
            'Directory stack underflow while building the path store'
          );
        }

        currentDepth++;
        const dirSeg = path.slice(segmentStart, slashPos);
        let dirNameId = idByValue.get(dirSeg);
        if (dirNameId === undefined) {
          dirNameId = valueById.length;
          idByValue.set(dirSeg, dirNameId);
          valueById.push(dirSeg);
        }
        const nodeId = nodes.length;
        nodes.push({
          depthAndFlags: createNodeDepthAndFlags(
            currentDepth,
            0,
            PATH_STORE_NODE_KIND_DIRECTORY
          ),
          nameId: dirNameId,
          parentId,
          subtreeNodeCount: 1,
          visibleSubtreeCount: 1,
        });
        this.recordCreatedDirectoryPath(path.slice(0, slashPos));
        this.presortedDirectoryNodeIds.push(nodeId);
        stackTop++;
        dirStack[stackTop] = nodeId;
        segmentStart = slashPos + 1;
        slashPos = path.indexOf('/', segmentStart);
      }

      const parentId = dirStack[stackTop];
      if (parentId === undefined) {
        throw new Error(`Unable to resolve file parent for "${path}"`);
      }

      const fileSeg = path.slice(segmentStart);
      let fileNameId = idByValue.get(fileSeg);
      if (fileNameId === undefined) {
        fileNameId = valueById.length;
        idByValue.set(fileSeg, fileNameId);
        valueById.push(fileSeg);
      }
      nodes.push({
        depthAndFlags: createNodeDepthAndFlags(currentDepth + 1, 0),
        nameId: fileNameId,
        parentId,
        subtreeNodeCount: 1,
        visibleSubtreeCount: 1,
      });

      if (segmentStart !== cachedDirPrefix.length) {
        cachedDirPrefix = path.substring(0, segmentStart);
        cachedDirDepth = currentDepth;
      }

      previousPath = path;
    }

    dirStack.length = stackTop + 1;

    if (previousPath != null) {
      this.lastPreparedPath = parseInputPath(previousPath);
    }

    this.hasDeferredDirectoryIndexes = true;
  }

  public finish(options: BuilderFinishOptions = {}): PathStoreSnapshot {
    const skipSubtreeCountPass = options.skipSubtreeCountPass === true;
    if (this.hasDeferredDirectoryIndexes) {
      withBenchmarkPhase(
        this.instrumentation,
        'store.builder.buildDirectoryIndexes',
        () => this.buildPresortedFinish(skipSubtreeCountPass)
      );
      this.hasDeferredDirectoryIndexes = false;
    } else if (!skipSubtreeCountPass) {
      withBenchmarkPhase(
        this.instrumentation,
        'store.builder.computeSubtreeCounts',
        () => this.computeSubtreeCounts(0)
      );
    }
    return {
      directories: this.directories,
      nodes: this.nodes,
      options: this.options,
      rootId: 0,
      segmentTable: this.segmentTable,
      presortedDirectoryNodeIds:
        this.presortedDirectoryNodeIds.length > 0
          ? this.presortedDirectoryNodeIds
          : null,
    };
  }

  // Reports whether the presorted builder saw every created directory in the
  // caller's startup expansion hint. PathStore uses this to recognize the
  // "all directories start open" case without rescanning the finished
  // snapshot.
  public didMatchAllInitialExpandedPaths(): boolean {
    return (
      this.createdDirectoriesAllExpanded &&
      this.initialExpandedPathSet != null &&
      this.createdDirectoryCount === this.initialExpandedPathSet.size
    );
  }

  private appendPreparedPath(
    preparedPath: PreparedPath,
    validateOrder: boolean
  ): void {
    if (this.hasDeferredDirectoryIndexes) {
      this.buildDirectoryIndexes();
      this.hasDeferredDirectoryIndexes = false;
    }

    if (this.lastPreparedPath != null) {
      if (preparedPath.path === this.lastPreparedPath.path) {
        throw new Error(`Duplicate path: "${preparedPath.path}"`);
      }

      if (validateOrder) {
        const orderComparison =
          this.options.sort === 'default'
            ? comparePreparedPathsWithCachedSortKeys(
                this.lastPreparedPath,
                preparedPath,
                this.segmentSortKeyCache
              )
            : compareWithSortOption(
                this.lastPreparedPath,
                preparedPath,
                this.options.sort
              );
        if (orderComparison > 0) {
          throw new Error(
            `Builder input must be sorted before appendPaths(): "${preparedPath.path}"`
          );
        }
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

      const childId = validateOrder
        ? this.getOrCreateDirectoryChild(
            parentId,
            preparedPath.segments[segmentIndex]
          )
        : this.createDirectoryChild(
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

    if (validateOrder) {
      this.createFileChild(parentId, preparedPath.basename, preparedPath.path);
    } else {
      this.createFileChildUnchecked(parentId, preparedPath.basename);
    }
    this.lastPreparedPath = preparedPath;
  }

  // Compares each newly created directory path against the caller's startup
  // expansion hint while the presorted builder is already walking those same
  // prefixes, so constructor fast paths can avoid a second tree-wide scan.
  private recordCreatedDirectoryPath(path: string): void {
    if (
      !this.createdDirectoriesAllExpanded ||
      this.initialExpandedPathSet == null
    ) {
      return;
    }

    this.createdDirectoryCount += 1;
    if (!this.initialExpandedPathSet.has(path)) {
      this.createdDirectoriesAllExpanded = false;
    }
  }

  private createFileChild(
    parentId: NodeId,
    basename: string,
    path: string
  ): NodeId {
    const nameId = internSegment(this.segmentTable, basename);
    const parentIndex = this.getDirectoryIndex(parentId);
    const nameMap = parentIndex.childIdByNameId;
    if (nameMap != null) {
      const existingChildId = nameMap.get(nameId);
      if (existingChildId !== undefined) {
        throw new Error(`Path collides with an existing entry: "${path}"`);
      }
    }

    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depthAndFlags: createNodeDepthAndFlags(getNodeDepth(parentNode) + 1, 0),
      nameId,
      parentId,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    if (nameMap != null) {
      nameMap.set(nameId, nodeId);
    }
    appendChildReference(parentIndex, nodeId);
    return nodeId;
  }

  // Bulk-ingested file nodes leave full paths lazy so first render only pays to
  // materialize the tiny visible window instead of caching every file string up
  // front.
  private createFileChildUnchecked(parentId: NodeId, basename: string): NodeId {
    const nameId = internSegment(this.segmentTable, basename);
    const parentIndex = this.getDirectoryIndex(parentId);
    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depthAndFlags: createNodeDepthAndFlags(getNodeDepth(parentNode) + 1, 0),
      nameId,
      parentId,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    if (parentIndex.childIdByNameId != null) {
      parentIndex.childIdByNameId.set(nameId, nodeId);
    }
    appendChildReference(parentIndex, nodeId);
    return nodeId;
  }

  private getOrCreateDirectoryChild(parentId: NodeId, segment: string): NodeId {
    const nameId = internSegment(this.segmentTable, segment);
    const parentIndex = this.getDirectoryIndex(parentId);
    if (parentIndex.childIdByNameId != null) {
      const existingChildId = parentIndex.childIdByNameId.get(nameId);
      if (existingChildId !== undefined) {
        const existingNode = this.nodes[existingChildId];
        if (existingNode != null && !isDirectoryNode(existingNode)) {
          throw new Error(
            `Path collides with an existing file while creating directory "${segment}"`
          );
        }

        return existingChildId;
      }
    }

    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depthAndFlags: createNodeDepthAndFlags(
        getNodeDepth(parentNode) + 1,
        0,
        PATH_STORE_NODE_KIND_DIRECTORY
      ),
      nameId,
      parentId,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    if (parentIndex.childIdByNameId != null) {
      parentIndex.childIdByNameId.set(nameId, nodeId);
    }
    appendChildReference(parentIndex, nodeId);
    this.directories.set(nodeId, createDirectoryChildIndex());
    return nodeId;
  }

  // Sorted unique prepared input only introduces brand-new directories beyond
  // the shared prefix with the previous path, so no existing-child lookup is
  // required in this fast path.
  private createDirectoryChild(parentId: NodeId, segment: string): NodeId {
    const nameId = internSegment(this.segmentTable, segment);
    const parentIndex = this.getDirectoryIndex(parentId);
    const parentNode = this.nodes[parentId];
    if (parentNode === undefined) {
      throw new Error(`Unknown parent node ID: ${String(parentId)}`);
    }

    const nodeId = this.nodes.length;
    this.nodes.push({
      depthAndFlags: createNodeDepthAndFlags(
        getNodeDepth(parentNode) + 1,
        0,
        PATH_STORE_NODE_KIND_DIRECTORY
      ),
      nameId,
      parentId,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    if (parentIndex.childIdByNameId != null) {
      parentIndex.childIdByNameId.set(nameId, nodeId);
    }
    appendChildReference(parentIndex, nodeId);
    this.directories.set(nodeId, createDirectoryChildIndex());
    return nodeId;
  }

  private promoteDirectoryToExplicit(directoryId: NodeId, path: string): void {
    const directoryNode = this.nodes[directoryId];
    if (directoryNode === undefined) {
      throw new Error(`Unknown directory node ID: ${String(directoryId)}`);
    }

    if (!isDirectoryNode(directoryNode)) {
      throw new Error(`Path is not a directory: "${path}"`);
    }

    if (hasNodeFlag(directoryNode, PATH_STORE_NODE_FLAG_EXPLICIT)) {
      throw new Error(`Duplicate path: "${path}"`);
    }

    addNodeFlag(directoryNode, PATH_STORE_NODE_FLAG_EXPLICIT);
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

  // Builds directory-child indexes from the flat node list created by the
  // presorted fast path, then computes subtree counts bottom-up and rebuilds
  // directory child aggregates — all in linear passes instead of recursive
  // tree descent.
  private buildPresortedFinish(skipSubtreeCountPass: boolean): void {
    const nodes = this.nodes;
    const directories = this.directories;

    // Replace the root's directory index with a presorted-lightweight version
    // so it also skips child-position-map population like all other directories
    // created in this pass.
    directories.set(0, createPresortedDirectoryChildIndex());

    // Forward pass: create directory indexes and register children.  Node IDs
    // are assigned sequentially during presorted construction, so iterating in
    // ID order preserves the canonical sorted child order.  Child-position maps
    // are left null to avoid per-child Map.set overhead; they are rebuilt lazily
    // on the first mutation or sibling lookup.
    //
    // A single-entry parent cache avoids repeated Map.get lookups for
    // consecutive children that share the same parent directory.
    let cachedParentId = -1;
    let cachedParentIndex: DirectoryChildIndex | null = null;

    for (let nodeId = 1; nodeId < nodes.length; nodeId++) {
      const node = nodes[nodeId];
      if (node == null) {
        continue;
      }

      if (isDirectoryNode(node)) {
        const dirIndex = createPresortedDirectoryChildIndex();
        directories.set(nodeId, dirIndex);

        // If the next node shares this directory as its parent, the cache
        // will hit immediately.
        cachedParentId = nodeId;
        cachedParentIndex = dirIndex;
      }

      let parentIndex: DirectoryChildIndex | null | undefined;
      if (node.parentId === cachedParentId) {
        parentIndex = cachedParentIndex;
      } else {
        parentIndex = directories.get(node.parentId);
        cachedParentId = node.parentId;
        cachedParentIndex = parentIndex ?? null;
      }

      if (parentIndex != null) {
        parentIndex.childIds.push(nodeId);
      }
    }

    // Backward pass: accumulate subtree counts bottom-up into parent nodes.
    // Parents always have lower IDs than their children, so iterating
    // backward ensures each child's counts are finalized before its parent
    // reads them. Directory-level aggregates (totalChildSubtreeNodeCount,
    // etc.) and visible-child chunk summaries are NOT computed here; they
    // are derived during state initialization when initializeOpenVisibleCounts
    // or recomputeCountsRecursive iterates each directory's children.
    //
    // PathStore's constructor always runs one of those re-walks and will
    // populate both subtreeNodeCount and visibleSubtreeCount from childIds,
    // so the caller can pass skipSubtreeCountPass to avoid ~990K redundant
    // adds here. Callers that read subtreeNodeCount directly off the
    // snapshot (static-store) must leave skipSubtreeCountPass unset.
    if (skipSubtreeCountPass) {
      return;
    }
    for (let nodeId = nodes.length - 1; nodeId >= 1; nodeId--) {
      const node = nodes[nodeId];
      if (node == null) {
        continue;
      }

      const parentNode = nodes[node.parentId];
      if (parentNode != null) {
        parentNode.subtreeNodeCount += node.subtreeNodeCount;
        parentNode.visibleSubtreeCount += node.visibleSubtreeCount;
      }
    }
  }

  // Builds directory-child indexes in the same layout as buildPresortedFinish
  // but without fused subtree-count computation (used when flushing deferred
  // indexes before switching to the non-presorted append path).
  private buildDirectoryIndexes(): void {
    const nodes = this.nodes;

    for (let nodeId = 1; nodeId < nodes.length; nodeId++) {
      const node = nodes[nodeId];
      if (node == null) {
        continue;
      }

      if (isDirectoryNode(node)) {
        this.directories.set(nodeId, createDirectoryChildIndex());
      }

      const parentIndex = this.directories.get(node.parentId);
      if (parentIndex != null) {
        if (parentIndex.childIdByNameId != null) {
          parentIndex.childIdByNameId.set(node.nameId, nodeId);
        }
        appendChildReference(parentIndex, nodeId);
      }
    }
  }

  // Computes subtree counts after bulk ingest so projection math can read
  // aggregate counts without changing the canonical storage layout.
  private computeSubtreeCounts(nodeId: NodeId): number {
    const node = this.nodes[nodeId];
    if (node === undefined) {
      throw new Error(`Unknown node ID: ${String(nodeId)}`);
    }

    if (!isDirectoryNode(node)) {
      node.subtreeNodeCount = 1;
      node.visibleSubtreeCount = 1;
      return 1;
    }

    const directoryIndex = this.getDirectoryIndex(nodeId);
    let subtreeNodeCount = 1;
    for (const childId of directoryIndex.childIds) {
      subtreeNodeCount += this.computeSubtreeCounts(childId);
    }

    // Children already have final counts from the recursive descent above, so
    // the directory can derive its cached child aggregates before writing its
    // own subtree totals.
    rebuildDirectoryChildAggregates(this.nodes, directoryIndex);
    node.subtreeNodeCount = subtreeNodeCount;
    node.visibleSubtreeCount = subtreeNodeCount;
    return subtreeNodeCount;
  }
}
