import { createVisibleTreeProjection, PathStore } from '@pierre/path-store';
import type {
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjectionRow,
} from '@pierre/path-store';

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
  itemMetadata: Map<string, PathStoreTreesItemMetadata>;
}

interface PathStoreTreesVisibleProjection {
  focusedPath: string | null;
  parentPaths: Map<string, string | null>;
  projectionRows: readonly PathStoreVisibleTreeProjectionRow[];
  visibleIndexByPath: Map<string, number>;
  visibleRows: readonly PathStoreVisibleRow[];
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

function findNearestVisibleAncestorPath(
  visibleIndexByPath: ReadonlyMap<string, number>,
  path: string
): string | null {
  const ancestorPaths = getAncestorDirectoryPaths(path);
  for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
    const ancestorPath = ancestorPaths[index];
    if (ancestorPath != null && visibleIndexByPath.has(ancestorPath)) {
      return ancestorPath;
    }
  }

  return null;
}

// Keeps logical focus on a visible row. When a focused descendant disappears,
// this falls back to the nearest visible ancestor before defaulting to row 0.
function resolveFocusedPath(
  targetPaths: readonly string[],
  visibleIndexByPath: ReadonlyMap<string, number>,
  candidatePath: string | null
): string | null {
  if (targetPaths.length === 0) {
    return null;
  }

  if (candidatePath != null) {
    if (visibleIndexByPath.has(candidatePath)) {
      return candidatePath;
    }

    const ancestorPath = findNearestVisibleAncestorPath(
      visibleIndexByPath,
      candidatePath
    );
    if (ancestorPath != null) {
      return ancestorPath;
    }
  }

  return targetPaths[0] ?? null;
}

// Rebuilds the visible-row projection once so focus/navigation can use
// path-first metadata without recomputing sibling and parent info per render.
// Derives the row metadata that the renderer needs for roving tabindex and
// treeitem ARIA attrs without exposing path-store's numeric row identities.
function createVisibleProjection(
  rows: readonly PathStoreVisibleRow[],
  focusedPathCandidate: string | null
): PathStoreTreesVisibleProjection {
  const projection = createVisibleTreeProjection(rows);
  const targetPaths = projection.rows.map((row) => row.path);

  const focusedPath = resolveFocusedPath(
    targetPaths,
    projection.visibleIndexByPath,
    focusedPathCandidate
  );
  const parentPaths = new Map<string, string | null>();
  for (const row of projection.rows) {
    parentPaths.set(row.path, row.parentPath);
  }

  return {
    focusedPath,
    parentPaths,
    projectionRows: projection.rows,
    visibleIndexByPath: projection.visibleIndexByPath,
    visibleRows: rows,
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
  #ancestorPathsByPath = new Map<string, readonly string[]>();
  #expandedDirectories = new Set<string>();
  #focusedPath: string | null = null;
  #itemHandles = new Map<string, PathStoreTreesItemHandle>();
  #itemMetadata = new Map<string, PathStoreTreesItemMetadata>();
  #parentPaths = new Map<string, string | null>();
  #projectionRows: readonly PathStoreVisibleTreeProjectionRow[] = [];
  #store: PathStore;
  #unsubscribe: (() => void) | null;
  #visibleIndexByPath = new Map<string, number>();
  #visibleRows: readonly PathStoreVisibleRow[] = [];

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
    this.#rebuildVisibleProjection(null);
    this.#unsubscribe = this.#subscribe();
  }

  public destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
  }

  public focusFirstItem(): void {
    const firstRow = this.#visibleRows[0];
    if (firstRow != null) {
      this.#setFocusedPath(firstRow.path);
    }
  }

  public focusLastItem(): void {
    const lastRow = this.#visibleRows[this.#visibleRows.length - 1];
    if (lastRow != null) {
      this.#setFocusedPath(lastRow.path);
    }
  }

  public focusNextItem(): void {
    this.#moveFocus(1);
  }

  public focusParentItem(): void {
    if (this.#focusedPath == null) {
      return;
    }

    const parentPath = this.#parentPaths.get(this.#focusedPath) ?? null;
    if (parentPath != null) {
      this.#setFocusedPath(parentPath);
    }
  }

  public focusPath(path: string): void {
    const resolvedPath = resolvePathStoreTreesItemPath(
      this.#itemMetadata,
      path
    );
    if (resolvedPath == null) {
      return;
    }

    const nextFocusedPath = resolveFocusedPath(
      this.#visibleRows.map((row) => row.path),
      this.#visibleIndexByPath,
      resolvedPath
    );
    if (nextFocusedPath != null) {
      this.#setFocusedPath(nextFocusedPath);
    }
  }

  public focusPreviousItem(): void {
    this.#moveFocus(-1);
  }

  public getFocusedIndex(): number {
    if (this.#focusedPath == null) {
      return -1;
    }

    return this.#visibleIndexByPath.get(this.#focusedPath) ?? -1;
  }

  public getFocusedItem(): PathStoreTreesItemHandle | null {
    return this.#focusedPath == null
      ? null
      : (this.#itemHandles.get(this.#focusedPath) ?? null);
  }

  public getFocusedPath(): string | null {
    return this.#focusedPath;
  }

  public getVisibleCount(): number {
    return this.#visibleRows.length;
  }

  public getVisibleRows(
    start: number,
    end: number
  ): readonly PathStoreTreesVisibleRow[] {
    if (end < start || this.#visibleRows.length === 0) {
      return [];
    }

    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(this.#visibleRows.length - 1, end);
    if (boundedEnd < boundedStart) {
      return [];
    }

    return this.#visibleRows
      .slice(boundedStart, boundedEnd + 1)
      .map((row, offset) => {
        const projectionRow = this.#projectionRows[boundedStart + offset];
        if (projectionRow == null) {
          throw new Error(
            `Missing projection row for visible index ${String(boundedStart + offset)}`
          );
        }

        return {
          ancestorPaths: this.#getAncestorPaths(projectionRow.path),
          depth: row.depth,
          flattenedSegments: row.flattenedSegments?.map((segment) => ({
            isTerminal: segment.isTerminal,
            name: segment.name,
            path: segment.path,
          })),
          hasChildren: row.hasChildren,
          index: projectionRow.index,
          isExpanded: row.isExpanded,
          isFlattened: row.isFlattened,
          isFocused: projectionRow.path === this.#focusedPath,
          kind: row.kind,
          level: row.depth,
          name: row.name,
          path: projectionRow.path,
          posInSet: projectionRow.posInSet,
          setSize: projectionRow.setSize,
        } satisfies PathStoreTreesVisibleRow;
      });
  }

  /**
   * Returns the minimal Phase 2/3 item handle for the given path.
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
    const previousFocusedPath = this.#focusedPath;

    this.#unsubscribe?.();
    this.#store = nextStore;
    this.#applyItemState(nextItemState);
    this.#rebuildVisibleProjection(previousFocusedPath);
    this.#unsubscribe = this.#subscribe();
    this.#emit();
  }

  #applyItemState(itemState: PathStoreTreesItemState): void {
    this.#expandedDirectories = itemState.expandedDirectories;
    this.#itemHandles = itemState.itemHandles;
    this.#itemMetadata = itemState.itemMetadata;
  }

  #getAncestorPaths(path: string): readonly string[] {
    const cached = this.#ancestorPathsByPath.get(path);
    if (cached != null) {
      return cached;
    }

    const parentPath = this.#parentPaths.get(path) ?? null;
    const ancestorPaths =
      parentPath == null
        ? []
        : [...this.#getAncestorPaths(parentPath), parentPath];
    this.#ancestorPathsByPath.set(path, ancestorPaths);
    return ancestorPaths;
  }

  #collapseDirectory(path: string): void {
    this.#expandedDirectories.delete(path);
    this.#store.collapse(path);
  }

  #createDirectoryHandle(path: string): PathStoreTreesDirectoryHandle {
    return {
      collapse: () => {
        this.#collapseDirectory(path);
      },
      expand: () => {
        this.#expandDirectory(path);
      },
      focus: () => {
        this.focusPath(path);
      },
      getPath: () => path,
      isDirectory: () => true,
      isExpanded: () => this.#expandedDirectories.has(path),
      isFocused: () => this.#focusedPath === path,
      toggle: () => {
        this.#toggleDirectory(path);
      },
    };
  }

  #createFileHandle(path: string): PathStoreTreesFileHandle {
    return {
      focus: () => {
        this.focusPath(path);
      },
      getPath: () => path,
      isDirectory: () => false,
      isFocused: () => this.#focusedPath === path,
    };
  }

  #createItemState(paths: readonly string[]): PathStoreTreesItemState {
    const itemMetadata = createPathStoreTreesItemMetadata(paths);
    const initialExpandedPaths = createInitialExpandedDirectories(
      itemMetadata,
      this.#baseOptions
    );
    const expandedDirectories = new Set(initialExpandedPaths);
    const itemHandles = new Map<string, PathStoreTreesItemHandle>();

    for (const metadata of itemMetadata.values()) {
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
      itemMetadata,
    };
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #expandDirectory(path: string): void {
    for (const ancestorPath of getAncestorDirectoryPaths(path)) {
      if (this.#expandedDirectories.has(ancestorPath)) {
        continue;
      }

      this.#expandedDirectories.add(ancestorPath);
      this.#store.expand(ancestorPath);
    }

    this.#expandedDirectories.add(path);
    this.#store.expand(path);
  }

  #moveFocus(offset: -1 | 1): void {
    const itemCount = this.#projectionRows.length;
    if (itemCount === 0) {
      return;
    }

    const focusedIndex = this.getFocusedIndex();
    const currentIndex = focusedIndex === -1 ? 0 : focusedIndex;
    const nextIndex = Math.min(
      itemCount - 1,
      Math.max(0, currentIndex + offset)
    );
    const nextRow = this.#visibleRows[nextIndex];
    if (nextRow != null) {
      this.#setFocusedPath(nextRow.path);
    }
  }

  #rebuildVisibleProjection(focusedPathCandidate: string | null): void {
    const visibleCount = this.#store.getVisibleCount();
    const rows =
      visibleCount > 0 ? this.#store.getVisibleSlice(0, visibleCount - 1) : [];
    const projection = createVisibleProjection(rows, focusedPathCandidate);
    this.#ancestorPathsByPath.clear();
    this.#focusedPath = projection.focusedPath;
    this.#parentPaths = projection.parentPaths;
    this.#projectionRows = projection.projectionRows;
    this.#visibleIndexByPath = projection.visibleIndexByPath;
    this.#visibleRows = projection.visibleRows;
  }

  #setFocusedPath(path: string): void {
    const currentFocusedPath = this.#focusedPath;
    if (currentFocusedPath === path) {
      return;
    }

    if (!this.#visibleIndexByPath.has(path)) {
      return;
    }
    this.#focusedPath = path;
    this.#emit();
  }

  #subscribe(): () => void {
    return this.#store.on('*', () => {
      this.#rebuildVisibleProjection(this.#focusedPath);
      this.#emit();
    });
  }

  #toggleDirectory(path: string): void {
    if (this.#expandedDirectories.has(path)) {
      this.#collapseDirectory(path);
      return;
    }

    this.#expandDirectory(path);
  }
}
