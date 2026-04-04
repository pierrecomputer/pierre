import {
  getPreparedInputEntries,
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
import {
  batchEvents,
  createApplyChildPatchEvent,
  createBeginChildLoadEvent,
  createCompleteChildLoadEvent,
  createFailChildLoadEvent,
  createMarkDirectoryUnloadedEvent,
  finalizeEvent,
  recordEvent,
  subscribe,
} from './events';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import {
  getBenchmarkInstrumentation,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import {
  collapsePath,
  expandPath,
  getVisibleCount,
  getVisibleSlice,
} from './projection';
import type {
  PathStoreChildPatch,
  PathStoreConstructorOptions,
  PathStoreDirectoryLoadState,
  PathStoreEventForType,
  PathStoreEventType,
  PathStoreLoadAttempt,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreOptions,
  PathStorePreparedInput,
  PathStoreRemoveOptions,
  PathStoreVisibleRow,
} from './public-types';
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
      builder.appendPreparedPaths(
        getPreparedInputEntries(options.preparedInput)
      );
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
    withBenchmarkPhase(
      instrumentation,
      'store.state.initializeExpandedPaths',
      () => this.initializeExpandedPaths(options.initialExpandedPaths)
    );
    withBenchmarkPhase(instrumentation, 'store.state.recomputeCounts', () =>
      recomputeCountsRecursive(this.#state, this.#state.snapshot.rootId)
    );
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

  public cleanup(): void {}

  public getNodeCount(): number {
    return this.#state.activeNodeCount;
  }

  private initializeExpandedPaths(
    expandedPaths: readonly string[] | undefined
  ): void {
    if (expandedPaths == null || expandedPaths.length === 0) {
      return;
    }

    for (const path of expandedPaths) {
      const directoryNodeId = findNodeId(this.#state, path);
      if (directoryNodeId == null) {
        throw new Error(`Path does not exist: "${path}"`);
      }

      const directoryNode = requireNode(this.#state, directoryNodeId);
      if (directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
        throw new Error(`Path is not a directory: "${path}"`);
      }

      setDirectoryExpanded(this.#state, directoryNodeId, true, directoryNode);
    }
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
        if (!isDirectoryExpanded(this.#state, parentId, parentNode)) {
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
