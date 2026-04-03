import {
  PathStoreBuilder,
  preparePaths as prepareCanonicalPaths,
  preparePathEntries,
} from './builder';
import {
  addPath,
  findNodeId,
  listPaths,
  movePath,
  recomputeCountsRecursive,
  removePath,
  requireNode,
} from './canonical';
import { batchEvents, recordEvent, subscribe } from './events';
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
  PathStoreConstructorOptions,
  PathStoreEvent,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreOptions,
  PathStoreRemoveOptions,
  PathStoreVisibleRow,
} from './public-types';
import { setDirectoryExpanded } from './state';
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

  public list(path?: string): string[] {
    return withBenchmarkPhase(this.#state.instrumentation, 'store.list', () =>
      listPaths(this.#state, path)
    );
  }

  public add(path: string): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.add', () => {
      recordEvent(this.#state, addPath(this.#state, path));
    });
  }

  public remove(path: string, options: PathStoreRemoveOptions = {}): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.remove', () => {
      recordEvent(this.#state, removePath(this.#state, path, options));
    });
  }

  public move(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions = {}
  ): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.move', () => {
      const event = movePath(this.#state, fromPath, toPath, options);
      if (event != null) {
        recordEvent(this.#state, event);
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
      const event = expandPath(this.#state, path);
      if (event != null) {
        recordEvent(this.#state, event);
      }
    });
  }

  public collapse(path: string): void {
    withBenchmarkPhase(this.#state.instrumentation, 'store.collapse', () => {
      const event = collapsePath(this.#state, path);
      if (event != null) {
        recordEvent(this.#state, event);
      }
    });
  }

  public on(
    type: string,
    handler: (event: PathStoreEvent) => void
  ): () => void {
    return subscribe(this.#state, type, handler);
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
}
