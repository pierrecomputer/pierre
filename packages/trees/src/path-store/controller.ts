import { PathStore } from '@pierre/path-store';
import type { PathStoreVisibleRow } from '@pierre/path-store';

import type {
  PathStoreTreesBootstrapItem,
  PathStoreTreesBootstrapSnapshot,
  PathStoreTreesControllerListener,
  PathStoreTreesControllerOptions,
  PathStoreTreesVisibleRow,
} from './types';

let controllerCount = 0;

export const PATH_STORE_TREES_PUBLIC_IDENTITY = 'path' as const;

function createControllerId(): string {
  controllerCount += 1;
  return `pst_ctrl_${controllerCount.toString(36)}`;
}

function toBootstrapItem(
  row: Readonly<{
    isFlattened: boolean;
    kind: 'directory' | 'file';
    name: string;
    path: string;
  }>
): PathStoreTreesBootstrapItem {
  return {
    isFlattened: row.isFlattened,
    kind: row.kind,
    name: row.name,
    path: row.path,
  };
}

function toVisibleRow(row: PathStoreVisibleRow): PathStoreTreesVisibleRow {
  return {
    depth: row.depth,
    flattenedSegments: row.flattenedSegments?.map((segment) => ({
      isTerminal: segment.isTerminal,
      name: segment.name,
      path: segment.path,
    })),
    hasChildren: row.hasChildren,
    isExpanded: row.isExpanded,
    isFlattened: row.isFlattened,
    kind: row.kind,
    name: row.name,
    path: row.path,
  };
}

/**
 * Owns the live PathStore instance and exposes a small path-first boundary we
 * can evolve in later phases without leaking internal store IDs.
 */
export class PathStoreTreesController {
  readonly #controllerId: string;
  readonly #baseOptions: Omit<
    PathStoreTreesControllerOptions,
    'controllerId' | 'paths'
  >;
  readonly #listeners = new Set<PathStoreTreesControllerListener>();
  #store: PathStore;
  #unsubscribe: (() => void) | null;

  public constructor(options: PathStoreTreesControllerOptions) {
    const {
      controllerId = createControllerId(),
      paths,
      ...baseOptions
    } = options;
    this.#controllerId = controllerId;
    this.#baseOptions = baseOptions;
    this.#store = new PathStore({
      ...baseOptions,
      paths,
    });
    this.#unsubscribe = this.#subscribe();
  }

  public destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
  }

  public getControllerId(): string {
    return this.#controllerId;
  }

  public getSnapshot(): PathStoreTreesBootstrapSnapshot {
    const firstVisibleRow = this.#store.getVisibleSlice(0, 1)[0];

    return {
      controllerId: this.#controllerId,
      firstVisibleItem:
        firstVisibleRow == null ? null : toBootstrapItem(firstVisibleRow),
      phase: 'bootstrap',
      publicIdentity: PATH_STORE_TREES_PUBLIC_IDENTITY,
      visibleCount: this.#store.getVisibleCount(),
    };
  }

  public getVisibleCount(): number {
    return this.#store.getVisibleCount();
  }

  public getVisibleRows(
    start: number,
    end: number
  ): readonly PathStoreTreesVisibleRow[] {
    if (end < start) {
      return [];
    }

    return this.#store.getVisibleSlice(start, end).map(toVisibleRow);
  }

  public subscribe(listener: PathStoreTreesControllerListener): () => void {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Replaces controller-owned paths through an explicit action so later phases
   * can evolve the action model without exposing the raw PathStore instance.
   */
  public replacePaths(paths: readonly string[]): void {
    this.#unsubscribe?.();
    this.#store = new PathStore({
      ...this.#baseOptions,
      paths,
    });
    this.#unsubscribe = this.#subscribe();
    this.#emit();
  }

  public toDebugJSON(): string {
    return JSON.stringify(this.getSnapshot(), null, 2);
  }

  #emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
  }

  #subscribe(): () => void {
    return this.#store.on('*', () => {
      this.#emit();
    });
  }
}
