import {
  getPreparedInputEntries,
  getPreparedInputPresortedPaths,
  getPreparedInputPresortedPathsContainDirectories,
  PathStoreBuilder,
  prepareInput as prepareCanonicalInput,
  preparePaths as prepareCanonicalPaths,
  preparePresortedInput as prepareCanonicalPresortedInput,
  preparePathEntries,
} from './builder';
import {
  addPath,
  collectAncestorIds,
  findNodeId,
  getDirectoryIndex,
  listPaths,
  materializeNodePath,
  movePath,
  recomputeCountsRecursive,
  removePath,
  requireNode,
} from './canonical';
import { rebuildVisibleChildChunks } from './child-index';
import {
  cleanupPathStoreState,
  hasActiveCleanupBlockingLoads,
} from './cleanup';
import {
  batchEvents,
  createApplyChildPatchEvent,
  createBeginChildLoadEvent,
  createCleanupEvent,
  createCompleteChildLoadEvent,
  createFailChildLoadEvent,
  createMarkDirectoryUnloadedEvent,
  finalizeEvent,
  recordEvent,
  subscribe,
} from './events';
import { getFlattenedChildDirectoryId } from './flatten';
import {
  PATH_STORE_NODE_FLAG_ROOT,
  PATH_STORE_NODE_KIND_DIRECTORY,
} from './internal-types';
import {
  getBenchmarkInstrumentation,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import {
  collapsePath,
  expandPath,
  getVisibleCount,
  getVisibleSlice,
  getVisibleTreeProjectionData as getVisibleTreeProjectionDataFromState,
  getVisibleTreeProjection as getVisibleTreeProjectionFromState,
} from './projection';
import type {
  PathStoreChildPatch,
  PathStoreCleanupOptions,
  PathStoreCleanupResult,
  PathStoreConstructorOptions,
  PathStoreDirectoryLoadState,
  PathStoreEventForType,
  PathStoreEventType,
  PathStoreLoadAttempt,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreOptions,
  PathStorePathInfo,
  PathStorePreparedInput,
  PathStoreRemoveOptions,
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjection,
  PathStoreVisibleTreeProjectionData,
} from './public-types';
import {
  compareSegmentSortKeys,
  createSegmentSortKey,
  getSegmentSortKey,
} from './sort';
import {
  beginDirectoryLoad,
  completeDirectoryLoad,
  failDirectoryLoad,
  getDirectoryLoadState as getStoredDirectoryLoadState,
  isDirectoryExpanded,
  isDirectoryLoadAttemptCurrent,
  markDirectoryUnloadedState,
  setDirectoryExpanded,
} from './state';
import { createPathStoreState } from './state';
import type { PathStoreState } from './state';

// Initializes the common all-directories-open startup shape without rerunning
// the generic count-repair walk the constructor uses for arbitrary expansion
// overrides. This keeps the presorted first-render path from paying for a
// second full-tree pass after the builder has already finalized subtree counts.
function initializeOpenVisibleCounts(state: PathStoreState): void {
  const { directories, nodes, options, rootId } = state.snapshot;

  const computeVisibleCounts = (nodeId: number): number => {
    const currentNode = nodes[nodeId];
    if (currentNode == null) {
      throw new Error(`Unknown node ID: ${String(nodeId)}`);
    }

    if (currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      currentNode.visibleSubtreeCount = 1;
      return 1;
    }

    const currentIndex = directories.get(nodeId);
    if (currentIndex == null) {
      throw new Error(
        `Unknown directory child index for node ${String(nodeId)}`
      );
    }

    let totalChildSubtreeNodeCount = 0;
    let totalChildVisibleSubtreeCount = 0;
    const childIds = currentIndex.childIds;
    for (let ci = 0; ci < childIds.length; ci++) {
      const childId = childIds[ci];
      if (childId == null) {
        continue;
      }
      const childNode = nodes[childId];
      totalChildSubtreeNodeCount += childNode.subtreeNodeCount;
      // Inline the file-node case to avoid a recursive call for each file.
      // Files always have visibleSubtreeCount = 1 (already set during
      // construction), so we can accumulate directly.
      if (childNode.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
        totalChildVisibleSubtreeCount += computeVisibleCounts(childId);
      } else {
        totalChildVisibleSubtreeCount += 1;
      }
    }

    currentIndex.totalChildSubtreeNodeCount = totalChildSubtreeNodeCount;
    currentIndex.totalChildVisibleSubtreeCount = totalChildVisibleSubtreeCount;
    rebuildVisibleChildChunks(nodes, currentIndex);

    if ((currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
      currentNode.visibleSubtreeCount = totalChildVisibleSubtreeCount;
      return totalChildVisibleSubtreeCount;
    }

    const flattenedChildId =
      options.flattenEmptyDirectories === true &&
      currentIndex.childIds.length === 1
        ? currentIndex.childIds[0]
        : null;
    const flattenedChildNode =
      flattenedChildId == null ? null : nodes[flattenedChildId];
    const isFlattenedDirectory =
      flattenedChildNode?.kind === PATH_STORE_NODE_KIND_DIRECTORY;

    currentNode.visibleSubtreeCount = isFlattenedDirectory
      ? totalChildVisibleSubtreeCount
      : 1 + totalChildVisibleSubtreeCount;
    return currentNode.visibleSubtreeCount;
  };

  computeVisibleCounts(rootId);
}

function canInitializeOpenVisibleCounts(
  options: PathStoreConstructorOptions
): boolean {
  return (
    options.initialExpansion === 'open' &&
    (options.initialExpandedPaths == null ||
      options.initialExpandedPaths.length === 0)
  );
}

export class PathStore {
  readonly #state: PathStoreState;

  public constructor(options: PathStoreConstructorOptions = {}) {
    const instrumentation = getBenchmarkInstrumentation(options);
    const builder = withBenchmarkPhase(
      instrumentation,
      'store.builder.create',
      () => new PathStoreBuilder(options)
    );
    if (options.preparedInput != null) {
      const presortedPaths = getPreparedInputPresortedPaths(
        options.preparedInput
      );
      if (presortedPaths != null) {
        builder.appendPresortedPaths(
          presortedPaths,
          getPreparedInputPresortedPathsContainDirectories(
            options.preparedInput
          )
        );
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
        builder.appendPreparedPaths(
          withBenchmarkPhase(instrumentation, 'store.preparePathEntries', () =>
            preparePathEntries(inputPaths, options)
          )
        );
      }
    }

    this.#state = withBenchmarkPhase(
      instrumentation,
      'store.state.create',
      () =>
        createPathStoreState(
          withBenchmarkPhase(instrumentation, 'store.builder.finish', () =>
            builder.finish()
          ),
          options.initialExpansion ?? 'closed',
          instrumentation
        )
    );
    const expandedDirectoryCount = withBenchmarkPhase(
      instrumentation,
      'store.state.initializeExpandedPaths',
      () => this.initializeExpandedPaths(options.initialExpandedPaths)
    );
    const canUseOpenVisibleCounts =
      canInitializeOpenVisibleCounts(options) ||
      ((options.initialExpansion ?? 'closed') === 'closed' &&
        expandedDirectoryCount === this.#state.snapshot.directories.size - 1) ||
      ((options.initialExpandedPaths?.length ?? 0) > 0 &&
        withBenchmarkPhase(
          instrumentation,
          'store.state.checkAllDirectoriesExpanded',
          () => this.hasAllDirectoriesExpanded()
        ));
    if (canUseOpenVisibleCounts) {
      withBenchmarkPhase(
        instrumentation,
        'store.state.initializeOpenVisibleCounts',
        () => initializeOpenVisibleCounts(this.#state)
      );
    } else {
      withBenchmarkPhase(instrumentation, 'store.state.recomputeCounts', () =>
        recomputeCountsRecursive(this.#state, this.#state.snapshot.rootId)
      );
    }
  }

  public static preparePaths(
    paths: readonly string[],
    options: PathStoreOptions = {}
  ): string[] {
    return prepareCanonicalPaths(paths, options);
  }

  public static prepareInput(
    paths: readonly string[],
    options: PathStoreOptions = {}
  ): PathStorePreparedInput {
    return prepareCanonicalInput(paths, options);
  }

  public static preparePresortedInput(
    paths: readonly string[]
  ): PathStorePreparedInput {
    return prepareCanonicalPresortedInput(paths);
  }

  public list(path?: string): string[] {
    return withBenchmarkPhase(this.#state.instrumentation, 'store.list', () =>
      listPaths(this.#state, path)
    );
  }

  public add(path: string): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.add', () => {
      const previousVisibleCount = getVisibleCount(this.#state);
      recordEvent(
        this.#state,
        finalizeEvent(
          this.#state,
          previousVisibleCount,
          addPath(this.#state, path)
        )
      );
    });
  }

  public remove(path: string, options: PathStoreRemoveOptions = {}): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.remove', () => {
      const previousVisibleCount = getVisibleCount(this.#state);
      recordEvent(
        this.#state,
        finalizeEvent(
          this.#state,
          previousVisibleCount,
          removePath(this.#state, path, options)
        )
      );
    });
  }

  public move(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions = {}
  ): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.move', () => {
      const previousVisibleCount = getVisibleCount(this.#state);
      const event = movePath(this.#state, fromPath, toPath, options);
      if (event != null) {
        recordEvent(
          this.#state,
          finalizeEvent(this.#state, previousVisibleCount, event)
        );
      }
    });
  }

  public batch(
    operations: readonly PathStoreOperation[] | ((store: PathStore) => void)
  ): void {
    batchEvents(this.#state, () => {
      if (typeof operations === 'function') {
        operations(this);
        return;
      }

      for (const operation of operations) {
        switch (operation.type) {
          case 'add':
            this.add(operation.path);
            break;
          case 'remove':
            this.remove(operation.path, { recursive: operation.recursive });
            break;
          case 'move':
            this.move(operation.from, operation.to, {
              collision: operation.collision,
            });
            break;
        }
      }
    });
  }

  public getVisibleCount(): number {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.getVisibleCount',
      () => getVisibleCount(this.#state)
    );
  }

  public getVisibleSlice(
    start: number,
    end: number
  ): readonly PathStoreVisibleRow[] {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.getVisibleSlice',
      () => getVisibleSlice(this.#state, start, end)
    );
  }

  public getVisibleTreeProjection(): PathStoreVisibleTreeProjection {
    return getVisibleTreeProjectionFromState(this.#state);
  }

  public getVisibleTreeProjectionData(
    maxRows?: number
  ): PathStoreVisibleTreeProjectionData {
    return getVisibleTreeProjectionDataFromState(this.#state, maxRows);
  }

  /**
   * Resolves a lookup path to the store's canonical path and item kind.
   * Lets tree adapters answer path-first queries without building a second
   * whole-tree metadata index alongside the store.
   */
  public getPathInfo(path: string): PathStorePathInfo | null {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.getPathInfo',
      () => {
        const nodeId = findNodeId(this.#state, path);
        if (nodeId == null) {
          return null;
        }

        const node = requireNode(this.#state, nodeId);
        return {
          depth: node.depth,
          kind:
            node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? 'directory' : 'file',
          path: materializeNodePath(this.#state, nodeId),
        } satisfies PathStorePathInfo;
      }
    );
  }

  public isExpanded(path: string): boolean {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.isExpanded',
      () => {
        const directoryNodeId = this.requireDirectoryNodeId(path);
        const directoryNode = requireNode(this.#state, directoryNodeId);
        return isDirectoryExpanded(this.#state, directoryNodeId, directoryNode);
      }
    );
  }

  public expand(path: string): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.expand', () => {
      const previousVisibleCount = getVisibleCount(this.#state);
      const event = expandPath(this.#state, path);
      if (event != null) {
        recordEvent(
          this.#state,
          finalizeEvent(this.#state, previousVisibleCount, event)
        );
      }
    });
  }

  public collapse(path: string): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.collapse', () => {
      const previousVisibleCount = getVisibleCount(this.#state);
      const event = collapsePath(this.#state, path);
      if (event != null) {
        recordEvent(
          this.#state,
          finalizeEvent(this.#state, previousVisibleCount, event)
        );
      }
    });
  }

  public on<TType extends PathStoreEventType | '*'>(
    type: TType,
    handler: (event: PathStoreEventForType<TType>) => void
  ): () => void {
    return subscribe(this.#state, type, handler);
  }

  public getDirectoryLoadState(path: string): PathStoreDirectoryLoadState {
    const directoryNodeId = this.requireDirectoryNodeId(path);
    return getStoredDirectoryLoadState(this.#state, directoryNodeId);
  }

  public markDirectoryUnloaded(path: string): void {
    withBenchmarkPhase(
      this.#state.instrumentation,
      'store.markDirectoryUnloaded',
      () => {
        const directoryNodeId = this.requireDirectoryNodeId(path);
        if (
          getDirectoryIndex(this.#state, directoryNodeId).childIds.length > 0
        ) {
          throw new Error(
            `Cannot mark a directory with known children as unloaded: "${path}"`
          );
        }

        const previousVisibleCount = getVisibleCount(this.#state);
        markDirectoryUnloadedState(this.#state, directoryNodeId);
        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createMarkDirectoryUnloadedEvent({
              affectedAncestorIds: collectAncestorIds(
                this.#state,
                directoryNodeId
              ),
              affectedNodeIds: [directoryNodeId],
              path,
              projectionChanged:
                this.isDirectoryProjectionVisible(directoryNodeId),
            })
          )
        );
      }
    );
  }

  public beginChildLoad(path: string): PathStoreLoadAttempt {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.beginChildLoad',
      () => {
        const directoryNodeId = this.requireDirectoryNodeId(path);
        const previousVisibleCount = getVisibleCount(this.#state);
        const attempt = beginDirectoryLoad(this.#state, directoryNodeId);
        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createBeginChildLoadEvent({
              affectedAncestorIds: collectAncestorIds(
                this.#state,
                directoryNodeId
              ),
              affectedNodeIds: [directoryNodeId],
              attemptId: attempt.attemptId,
              path,
              projectionChanged:
                this.isDirectoryProjectionVisible(directoryNodeId),
              reused: attempt.reused,
            })
          )
        );
        return attempt;
      }
    );
  }

  public applyChildPatch(
    attempt: PathStoreLoadAttempt,
    patch: PathStoreChildPatch
  ): boolean {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.applyChildPatch',
      () => {
        const directoryNodeId = this.resolveActiveDirectoryNodeId(
          attempt.nodeId
        );
        if (
          directoryNodeId == null ||
          getStoredDirectoryLoadState(this.#state, directoryNodeId) !==
            'loading' ||
          !isDirectoryLoadAttemptCurrent(
            this.#state,
            directoryNodeId,
            attempt.attemptId
          )
        ) {
          return false;
        }

        const directoryPath = materializeNodePath(this.#state, directoryNodeId);
        this.validateChildPatch(directoryPath, patch);
        const previousVisibleCount = getVisibleCount(this.#state);
        const childEvents: import('./public-types').PathStoreSemanticEvent[] =
          [];

        for (const operation of patch.operations) {
          assertOperationTargetsDirectory(directoryPath, operation);
          const operationVisibleCount = getVisibleCount(this.#state);

          switch (operation.type) {
            case 'add':
              childEvents.push(
                finalizeEvent(
                  this.#state,
                  operationVisibleCount,
                  addPath(this.#state, operation.path)
                )
              );
              break;
            case 'remove':
              childEvents.push(
                finalizeEvent(
                  this.#state,
                  operationVisibleCount,
                  removePath(this.#state, operation.path, {
                    recursive: operation.recursive,
                  })
                )
              );
              break;
            case 'move': {
              const event = movePath(
                this.#state,
                operation.from,
                operation.to,
                { collision: operation.collision }
              );
              if (event != null) {
                childEvents.push(
                  finalizeEvent(this.#state, operationVisibleCount, event)
                );
              }
              break;
            }
          }
        }

        const projectionChanged =
          childEvents.some((event) => event.projectionChanged) ||
          this.isDirectoryProjectionVisible(directoryNodeId);

        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createApplyChildPatchEvent({
              affectedAncestorIds: collectAncestorIds(
                this.#state,
                directoryNodeId
              ),
              affectedNodeIds: [directoryNodeId],
              attemptId: attempt.attemptId,
              childEvents,
              path: materializeNodePath(this.#state, directoryNodeId),
              projectionChanged,
            })
          )
        );

        return true;
      }
    );
  }

  public completeChildLoad(attempt: PathStoreLoadAttempt): boolean {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.completeChildLoad',
      () => {
        const directoryNodeId = this.resolveActiveDirectoryNodeId(
          attempt.nodeId
        );
        if (directoryNodeId == null) {
          return false;
        }
        const previousVisibleCount = getVisibleCount(this.#state);
        const applied = completeDirectoryLoad(
          this.#state,
          directoryNodeId,
          attempt.attemptId
        );
        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createCompleteChildLoadEvent({
              affectedAncestorIds: collectAncestorIds(
                this.#state,
                directoryNodeId
              ),
              affectedNodeIds: [directoryNodeId],
              attemptId: attempt.attemptId,
              path: materializeNodePath(this.#state, directoryNodeId),
              projectionChanged:
                this.isDirectoryProjectionVisible(directoryNodeId),
              stale: !applied,
            })
          )
        );
        return applied;
      }
    );
  }

  public failChildLoad(
    attempt: PathStoreLoadAttempt,
    errorMessage?: string
  ): boolean {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.failChildLoad',
      () => {
        const directoryNodeId = this.resolveActiveDirectoryNodeId(
          attempt.nodeId
        );
        if (directoryNodeId == null) {
          return false;
        }
        const previousVisibleCount = getVisibleCount(this.#state);
        const applied = failDirectoryLoad(
          this.#state,
          directoryNodeId,
          attempt.attemptId,
          errorMessage
        );
        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createFailChildLoadEvent({
              affectedAncestorIds: collectAncestorIds(
                this.#state,
                directoryNodeId
              ),
              affectedNodeIds: [directoryNodeId],
              attemptId: attempt.attemptId,
              errorMessage,
              path: materializeNodePath(this.#state, directoryNodeId),
              projectionChanged:
                this.isDirectoryProjectionVisible(directoryNodeId),
              stale: !applied,
            })
          )
        );
        return applied;
      }
    );
  }

  public cleanup(
    options: PathStoreCleanupOptions = {}
  ): PathStoreCleanupResult {
    return withBenchmarkPhase(
      this.#state.instrumentation,
      'store.cleanup',
      () => {
        if (this.#state.transactionStack.length > 0) {
          throw new Error(
            'Cleanup cannot run during an open batch or transaction.'
          );
        }

        if (hasActiveCleanupBlockingLoads(this.#state)) {
          throw new Error(
            'Cleanup cannot run while directory loads are active.'
          );
        }

        const previousVisibleCount = getVisibleCount(this.#state);
        const result = cleanupPathStoreState(
          this.#state,
          options.mode ?? 'stable'
        );
        recordEvent(
          this.#state,
          finalizeEvent(
            this.#state,
            previousVisibleCount,
            createCleanupEvent({
              ...result,
              affectedAncestorIds: [],
              affectedNodeIds: [],
              projectionChanged: result.idsPreserved === false,
            })
          )
        );
        return result;
      }
    );
  }

  public getNodeCount(): number {
    return this.#state.activeNodeCount;
  }

  private initializeExpandedPaths(
    expandedPaths: readonly string[] | undefined
  ): number {
    if (expandedPaths == null || expandedPaths.length === 0) {
      return 0;
    }

    let expandedDirectoryCount = 0;
    const previousChildOffsets: number[] = [];
    const previousNodeIds: number[] = [];
    let previousEndIndex = 0;
    let previousPath: string | null = null;
    const segmentTable = this.#state.snapshot.segmentTable;
    const segmentValues = segmentTable.valueById;
    const nodes = this.#state.snapshot.nodes;
    const targetSegmentSortKeyCache = new Map<
      string,
      ReturnType<typeof createSegmentSortKey>
    >();

    for (const path of expandedPaths) {
      if (previousPath != null && path < previousPath) {
        previousPath = null;
        previousEndIndex = 0;
        previousChildOffsets.length = 0;
        previousNodeIds.length = 0;
      }

      const hasTrailingSlash =
        path.length > 0 && path.charCodeAt(path.length - 1) === 47;
      const endIndex = hasTrailingSlash ? path.length - 1 : path.length;
      if (endIndex === 0) {
        previousPath = path;
        previousEndIndex = endIndex;
        previousChildOffsets.length = 0;
        previousNodeIds.length = 0;
        continue;
      }

      let sharedDepth = 0;
      let unsharedSegmentStart = 0;
      if (previousPath != null) {
        const compareLength = Math.min(endIndex, previousEndIndex);
        let prefixMatched = true;
        for (let charIndex = 0; charIndex < compareLength; charIndex += 1) {
          const charCode = path.charCodeAt(charIndex);
          if (charCode !== previousPath.charCodeAt(charIndex)) {
            prefixMatched = false;
            break;
          }
          if (charCode === 47) {
            sharedDepth += 1;
            unsharedSegmentStart = charIndex + 1;
          }
        }

        if (prefixMatched) {
          if (
            compareLength === previousEndIndex &&
            endIndex > compareLength &&
            path.charCodeAt(compareLength) === 47
          ) {
            sharedDepth += 1;
            unsharedSegmentStart = compareLength + 1;
          } else if (
            compareLength === endIndex &&
            previousEndIndex > compareLength &&
            previousPath.charCodeAt(compareLength) === 47
          ) {
            sharedDepth += 1;
            unsharedSegmentStart = endIndex + 1;
          }
        }

        sharedDepth = Math.min(sharedDepth, previousNodeIds.length);
      }

      let currentDirectoryId =
        sharedDepth === 0
          ? this.#state.snapshot.rootId
          : (previousNodeIds[sharedDepth - 1] ?? this.#state.snapshot.rootId);
      let resolvedDepth = sharedDepth;
      let foundDirectory = true;
      let segmentStart = unsharedSegmentStart;

      while (segmentStart <= endIndex) {
        const slashIndex = path.indexOf('/', segmentStart);
        const segmentEnd =
          slashIndex === -1 || slashIndex > endIndex ? endIndex : slashIndex;
        const segment = path.slice(segmentStart, segmentEnd);
        const currentIndex = getDirectoryIndex(this.#state, currentDirectoryId);
        const childIds = currentIndex.childIds;
        const searchStartIndex =
          resolvedDepth === sharedDepth
            ? (previousChildOffsets[resolvedDepth] ?? 0)
            : 0;
        let nextChildOffset = searchStartIndex;
        let nextNodeId: number | undefined;
        const targetSegmentSortKey =
          targetSegmentSortKeyCache.get(segment) ??
          createSegmentSortKey(segment);
        targetSegmentSortKeyCache.set(segment, targetSegmentSortKey);
        const searchForSegment = (
          startIndex: number,
          endIndex: number
        ): boolean => {
          for (
            nextChildOffset = startIndex;
            nextChildOffset < endIndex;
            nextChildOffset += 1
          ) {
            const candidateNodeId = childIds[nextChildOffset];
            const candidateNode = nodes[candidateNodeId];
            const candidateSegment = segmentValues[candidateNode.nameId];
            if (candidateSegment === segment) {
              nextNodeId = candidateNodeId;
              return true;
            }
            const orderComparison = compareSegmentSortKeys(
              getSegmentSortKey(segmentTable, candidateNode.nameId),
              targetSegmentSortKey
            );
            if (
              orderComparison > 0 ||
              (orderComparison === 0 && candidateSegment > segment)
            ) {
              return false;
            }
          }
          return false;
        };

        const foundFromStart = searchForSegment(
          searchStartIndex,
          childIds.length
        );
        if (!foundFromStart && searchStartIndex > 0) {
          searchForSegment(0, searchStartIndex);
        }
        if (nextNodeId === undefined) {
          foundDirectory = false;
          break;
        }

        const nextNode = requireNode(this.#state, nextNodeId);
        if (nextNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
          foundDirectory = false;
          break;
        }

        previousChildOffsets[resolvedDepth] = nextChildOffset;
        previousNodeIds[resolvedDepth] = nextNodeId;
        currentDirectoryId = nextNodeId;
        resolvedDepth += 1;
        if (segmentEnd === endIndex) {
          break;
        }
        segmentStart = segmentEnd + 1;
      }

      previousPath = path;
      previousEndIndex = endIndex;
      previousChildOffsets.length = resolvedDepth;
      previousNodeIds.length = resolvedDepth;
      if (!foundDirectory) {
        // A missing or non-directory lookup path must not leave behind a shared
        // prefix cache for the next entry. Otherwise the next valid path can
        // inherit an ancestor depth that was never actually expanded.
        previousPath = null;
        previousEndIndex = 0;
        previousChildOffsets.length = 0;
        previousNodeIds.length = 0;
        continue;
      }

      for (
        let depthIndex = sharedDepth;
        depthIndex < resolvedDepth;
        depthIndex += 1
      ) {
        const directoryNodeId = previousNodeIds[depthIndex];
        if (directoryNodeId == null) {
          continue;
        }

        const directoryNode = requireNode(this.#state, directoryNodeId);
        if (isDirectoryExpanded(this.#state, directoryNodeId, directoryNode)) {
          continue;
        }

        setDirectoryExpanded(this.#state, directoryNodeId, true, directoryNode);
        expandedDirectoryCount += 1;
      }
    }

    return expandedDirectoryCount;
  }

  private hasAllDirectoriesExpanded(): boolean {
    for (const directoryNodeId of this.#state.snapshot.directories.keys()) {
      if (directoryNodeId === this.#state.snapshot.rootId) {
        continue;
      }

      const directoryNode = requireNode(this.#state, directoryNodeId);
      if (!isDirectoryExpanded(this.#state, directoryNodeId, directoryNode)) {
        return false;
      }
    }

    return true;
  }

  private requireDirectoryNodeId(path: string): number {
    const directoryNodeId = findNodeId(this.#state, path);
    if (directoryNodeId == null) {
      throw new Error(`Path does not exist: "${path}"`);
    }

    const directoryNode = requireNode(this.#state, directoryNodeId);
    if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      throw new Error(`Path is not a directory: "${path}"`);
    }

    return directoryNodeId;
  }

  private resolveActiveDirectoryNodeId(directoryNodeId: number): number | null {
    try {
      const directoryNode = requireNode(this.#state, directoryNodeId);
      if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
        throw new Error(`Node is not a directory: ${String(directoryNodeId)}`);
      }

      return directoryNodeId;
    } catch {
      return null;
    }
  }

  private isDirectoryProjectionVisible(directoryNodeId: number): boolean {
    let currentNodeId = directoryNodeId;

    while (currentNodeId !== this.#state.snapshot.rootId) {
      const currentNode = requireNode(this.#state, currentNodeId);
      const parentId = currentNode.parentId;
      if (parentId !== this.#state.snapshot.rootId) {
        const parentNode = requireNode(this.#state, parentId);
        const flattenedChildDirectoryId = getFlattenedChildDirectoryId(
          this.#state,
          parentId
        );
        if (
          !isDirectoryExpanded(this.#state, parentId, parentNode) &&
          flattenedChildDirectoryId !== currentNodeId
        ) {
          return false;
        }
      }
      currentNodeId = parentId;
    }

    return true;
  }

  private validateChildPatch(
    directoryPath: string,
    patch: PathStoreChildPatch
  ): void {
    // Phase 7A chooses correctness over patch-application cleverness: validate
    // the whole child patch against a throwaway subtree store first so the real
    // store stays atomic if any later operation would fail. This is an
    // intentionally heavier O(n) preflight for large directories and a good
    // candidate for targeted optimization after 7A semantics are proven.
    const validationStore = new PathStore({
      paths: this.list(directoryPath),
      presorted: true,
      sort: this.#state.snapshot.options.sort,
    });
    validationStore.batch(patch.operations);
  }
}

function assertOperationTargetsDirectory(
  directoryPath: string,
  operation: PathStoreOperation
): void {
  switch (operation.type) {
    case 'add':
    case 'remove':
      if (
        !operation.path.startsWith(directoryPath) ||
        operation.path === directoryPath
      ) {
        throw new Error(
          `Child patch operation must stay within ${directoryPath}: "${operation.path}"`
        );
      }
      break;
    case 'move':
      if (
        !operation.from.startsWith(directoryPath) ||
        !operation.to.startsWith(directoryPath) ||
        operation.from === directoryPath ||
        operation.to === directoryPath
      ) {
        throw new Error(
          `Child patch move must stay within ${directoryPath}: "${operation.from}" -> "${operation.to}"`
        );
      }
      break;
  }
}
