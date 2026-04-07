import { PathStore } from '@pierre/path-store';
import type { PathStoreVisibleRow } from '@pierre/path-store';

import type {
  PathStoreTreesControllerListener,
  PathStoreTreesControllerOptions,
  PathStoreTreesVisibleRow,
} from './types';

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
  readonly #baseOptions: Omit<PathStoreTreesControllerOptions, 'paths'>;
  readonly #listeners = new Set<PathStoreTreesControllerListener>();
  #store: PathStore;
  #unsubscribe: (() => void) | null;

  public constructor(options: PathStoreTreesControllerOptions) {
    const { paths, ...baseOptions } = options;
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
    listener();
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

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #subscribe(): () => void {
    return this.#store.on('*', () => {
      this.#emit();
    });
  }
}
