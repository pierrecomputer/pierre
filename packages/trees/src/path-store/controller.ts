import { PathStore } from '@pierre/path-store';
import type { PathStoreVisibleRow } from '@pierre/path-store';

import type {
  PathStoreTreesControllerListener,
  PathStoreTreesControllerOptions,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesFileHandle,
  PathStoreTreesItemHandle,
  PathStoreTreesVisibleRow,
} from './types';

interface PathStoreTreesItemMetadata {
  depth: number;
  kind: 'directory' | 'file';
  path: string;
}

interface PathStoreTreesItemState {
  expandedDirectories: Set<string>;
  initialExpandedPaths: readonly string[];
  itemHandles: Map<string, PathStoreTreesItemHandle>;
}

function resolvePathStoreTreesItemPath(
  itemMetadata: ReadonlyMap<string, PathStoreTreesItemMetadata>,
  path: string
): string | null {
  const directMatch = itemMetadata.get(path);
  if (directMatch != null) {
    return directMatch.path;
  }

  if (path.endsWith('/')) {
    return null;
  }

  const directoryMatch = itemMetadata.get(`${path}/`);
  return directoryMatch?.kind === 'directory' ? directoryMatch.path : null;
}

// Expanding a nested directory should make that directory visible, so this
// helper walks its ancestor chain in canonical path form.
function getAncestorDirectoryPaths(path: string): readonly string[] {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0) {
    return [];
  }

  const segments = normalizedPath.split('/');
  return segments
    .slice(0, -1)
    .map((_, index) => `${segments.slice(0, index + 1).join('/')}/`);
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

// Builds a path-first lookup table so `getItem(path)` can stay fast without
// reaching into path-store internals for every lookup.
function createPathStoreTreesItemMetadata(
  paths: readonly string[]
): Map<string, PathStoreTreesItemMetadata> {
  const itemMetadata = new Map<string, PathStoreTreesItemMetadata>();

  const ensureDirectory = (path: string, depth: number): void => {
    if (itemMetadata.has(path)) {
      return;
    }

    itemMetadata.set(path, {
      depth,
      kind: 'directory',
      path,
    });
  };

  for (const path of paths) {
    const isDirectory = path.endsWith('/');
    const normalizedPath = isDirectory ? path.slice(0, -1) : path;
    if (normalizedPath.length === 0) {
      continue;
    }

    const segments = normalizedPath.split('/');
    const directoryCount = isDirectory ? segments.length : segments.length - 1;

    for (let index = 0; index < directoryCount; index += 1) {
      const directoryPath = `${segments.slice(0, index + 1).join('/')}/`;
      ensureDirectory(directoryPath, index + 1);
    }

    if (!isDirectory) {
      itemMetadata.set(path, {
        depth: segments.length,
        kind: 'file',
        path,
      });
    }
  }

  return itemMetadata;
}

// Mirrors path-store's initial expansion contract so item handles can answer
// `isExpanded()` without reaching into path-store private state.
function createInitialExpandedDirectories(
  itemMetadata: ReadonlyMap<string, PathStoreTreesItemMetadata>,
  options: Omit<PathStoreTreesControllerOptions, 'paths'>
): readonly string[] {
  const expandedDirectories = new Set<string>();
  const { initialExpansion = 'closed', initialExpandedPaths } = options;

  if (initialExpansion === 'open') {
    for (const [path, metadata] of itemMetadata) {
      if (metadata.kind === 'directory') {
        expandedDirectories.add(path);
      }
    }
  } else if (typeof initialExpansion === 'number') {
    for (const [path, metadata] of itemMetadata) {
      if (metadata.kind === 'directory' && metadata.depth <= initialExpansion) {
        expandedDirectories.add(path);
      }
    }
  }

  for (const path of initialExpandedPaths ?? []) {
    const resolvedPath = resolvePathStoreTreesItemPath(itemMetadata, path);
    if (
      resolvedPath == null ||
      itemMetadata.get(resolvedPath)?.kind !== 'directory'
    ) {
      continue;
    }

    for (const ancestorPath of getAncestorDirectoryPaths(resolvedPath)) {
      expandedDirectories.add(ancestorPath);
    }
    expandedDirectories.add(resolvedPath);
  }

  return [...expandedDirectories];
}

/**
 * Owns the live PathStore instance and exposes a small path-first boundary we
 * can evolve in later phases without leaking internal store IDs.
 */
export class PathStoreTreesController {
  readonly #baseOptions: Omit<PathStoreTreesControllerOptions, 'paths'>;
  readonly #listeners = new Set<PathStoreTreesControllerListener>();
  #expandedDirectories = new Set<string>();
  #itemHandles = new Map<string, PathStoreTreesItemHandle>();
  readonly #itemMetadata = new Map<string, PathStoreTreesItemMetadata>();
  #store: PathStore;
  #unsubscribe: (() => void) | null;

  public constructor(options: PathStoreTreesControllerOptions) {
    const { paths, ...baseOptions } = options;
    this.#baseOptions = baseOptions;
    const itemState = this.#createItemState(paths);
    this.#store = new PathStore({
      ...baseOptions,
      initialExpandedPaths: itemState.initialExpandedPaths,
      paths,
    });
    // Item handles close over `this.#store`, so apply them only after the live
    // store instance exists.
    this.#applyItemState(itemState);
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

  /**
   * Returns the minimal Phase 2 item handle for the given path.
   *
   * Accepts both canonical directory paths (`src/`) and bare directory lookup
   * paths (`src`) so callers do not need to know the canonical slash rules.
   */
  public getItem(path: string): PathStoreTreesItemHandle | null {
    const resolvedPath = resolvePathStoreTreesItemPath(
      this.#itemMetadata,
      path
    );
    return resolvedPath == null
      ? null
      : (this.#itemHandles.get(resolvedPath) ?? null);
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
    const nextItemState = this.#createItemState(paths);
    const nextStore = new PathStore({
      ...this.#baseOptions,
      initialExpandedPaths: nextItemState.initialExpandedPaths,
      paths,
    });

    this.#unsubscribe?.();
    this.#store = nextStore;
    this.#applyItemState(nextItemState);
    this.#unsubscribe = this.#subscribe();
    this.#emit();
  }

  #applyItemState(itemState: PathStoreTreesItemState): void {
    this.#expandedDirectories = itemState.expandedDirectories;
    this.#itemHandles = itemState.itemHandles;
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

  #collapseDirectory(path: string): void {
    this.#store.collapse(path);
    this.#expandedDirectories.delete(path);
  }

  #createDirectoryHandle(path: string): PathStoreTreesDirectoryHandle {
    return {
      collapse: () => {
        this.#collapseDirectory(path);
      },
      expand: () => {
        this.#expandDirectory(path);
      },
      getPath: () => path,
      isDirectory: () => true,
      isExpanded: () => this.#expandedDirectories.has(path),
      toggle: () => {
        this.#toggleDirectory(path);
      },
    };
  }

  #createFileHandle(path: string): PathStoreTreesFileHandle {
    return {
      getPath: () => path,
      isDirectory: () => false,
    };
  }

  #expandDirectory(path: string): void {
    for (const ancestorPath of getAncestorDirectoryPaths(path)) {
      if (this.#expandedDirectories.has(ancestorPath)) {
        continue;
      }

      this.#store.expand(ancestorPath);
      this.#expandedDirectories.add(ancestorPath);
    }

    this.#store.expand(path);
    this.#expandedDirectories.add(path);
  }

  #createItemState(paths: readonly string[]): PathStoreTreesItemState {
    this.#itemMetadata.clear();
    const itemMetadata = createPathStoreTreesItemMetadata(paths);
    for (const [path, metadata] of itemMetadata) {
      this.#itemMetadata.set(path, metadata);
    }

    const initialExpandedPaths = createInitialExpandedDirectories(
      this.#itemMetadata,
      this.#baseOptions
    );
    const expandedDirectories = new Set(initialExpandedPaths);
    const itemHandles = new Map<string, PathStoreTreesItemHandle>();

    for (const metadata of this.#itemMetadata.values()) {
      const handle =
        metadata.kind === 'directory'
          ? this.#createDirectoryHandle(metadata.path)
          : this.#createFileHandle(metadata.path);
      itemHandles.set(metadata.path, handle);
    }

    return {
      expandedDirectories,
      initialExpandedPaths,
      itemHandles,
    };
  }

  #toggleDirectory(path: string): void {
    if (this.#expandedDirectories.has(path)) {
      this.#collapseDirectory(path);
      return;
    }

    this.#expandDirectory(path);
  }
}
