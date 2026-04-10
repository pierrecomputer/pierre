import { PathStore } from '@pierre/path-store';
import type {
  PathStorePathInfo,
  PathStoreVisibleTreeProjectionData,
} from '@pierre/path-store';

import type {
  PathStoreTreesControllerListener,
  PathStoreTreesControllerOptions,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesFileHandle,
  PathStoreTreesItemHandle,
  PathStoreTreesVisibleRow,
} from './types';

type ProjectionIndexBuffer = Int32Array<ArrayBufferLike>;

interface PathStoreTreesVisibleProjection {
  focusedIndex: number;
  getParentIndex(index: number): number;
  paths: readonly string[];
  posInSetByIndex: ProjectionIndexBuffer;
  setSizeByIndex: ProjectionIndexBuffer;
  visibleIndexByPath: Map<string, number> | null;
  visibleIndexByPathFactory: () => Map<string, number>;
}

// Initial render only mounts a tiny viewport slice, so controller startup can
// cap its first projection build and defer the full 494k-row metadata walk
// until the user actually navigates outside that initial window.
const INITIAL_PROJECTION_ROW_LIMIT = 512;

function arePathSetsEqual(
  currentPaths: ReadonlySet<string>,
  nextPaths: readonly string[]
): boolean {
  if (currentPaths.size !== nextPaths.length) {
    return false;
  }

  for (const path of nextPaths) {
    if (!currentPaths.has(path)) {
      return false;
    }
  }

  return true;
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
function resolveFocusedIndex(
  rowCount: number,
  visibleIndexByPath: ReadonlyMap<string, number>,
  candidatePath: string | null
): number {
  if (rowCount === 0) {
    return -1;
  }

  if (candidatePath != null) {
    const directIndex = visibleIndexByPath.get(candidatePath);
    if (directIndex != null) {
      return directIndex;
    }

    const ancestorPath = findNearestVisibleAncestorPath(
      visibleIndexByPath,
      candidatePath
    );
    if (ancestorPath != null) {
      return visibleIndexByPath.get(ancestorPath) ?? 0;
    }
  }

  return 0;
}

// Rebuilds the visible-row projection once so focus/navigation can use
// path-first metadata without recomputing sibling and parent info per render.
// Derives the row metadata that the renderer needs for roving tabindex and
// treeitem ARIA attrs without exposing path-store's numeric row identities.
function createVisibleProjection(
  projection: PathStoreVisibleTreeProjectionData,
  focusedPathCandidate: string | null
): PathStoreTreesVisibleProjection {
  if (projection.paths.length === 0) {
    return {
      focusedIndex: -1,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
      visibleIndexByPath: null,
      visibleIndexByPathFactory: () => projection.visibleIndexByPath,
    };
  }

  if (focusedPathCandidate == null) {
    return {
      focusedIndex: 0,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
      visibleIndexByPath: null,
      visibleIndexByPathFactory: () => projection.visibleIndexByPath,
    };
  }

  const visibleIndexByPath = projection.visibleIndexByPath;
  return {
    focusedIndex: resolveFocusedIndex(
      projection.paths.length,
      visibleIndexByPath,
      focusedPathCandidate
    ),
    getParentIndex: projection.getParentIndex,
    paths: projection.paths,
    posInSetByIndex: projection.posInSetByIndex,
    setSizeByIndex: projection.setSizeByIndex,
    visibleIndexByPath,
    visibleIndexByPathFactory: () => visibleIndexByPath,
  };
}

/**
 * Owns the live PathStore instance and exposes a small path-first boundary we
 * can evolve in later phases without leaking internal store IDs.
 */
export class PathStoreTreesController {
  readonly #baseOptions: Omit<PathStoreTreesControllerOptions, 'paths'>;
  readonly #listeners = new Set<PathStoreTreesControllerListener>();
  #ancestorPathsByIndex = new Map<number, readonly string[]>();
  #focusedIndex = -1;
  #focusedPath: string | null = null;
  #hasFullProjection = false;
  #getParentIndexForVisibleRow = (_index: number): number => -1;
  #itemHandles = new Map<string, PathStoreTreesItemHandle>();
  #projectionPaths: readonly string[] = [];
  #projectionPosInSetByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #projectionSetSizeByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #selectionAnchorPath: string | null = null;
  #selectedPaths = new Set<string>();
  #selectionVersion = 0;
  #store: PathStore;
  #visibleCount = 0;
  #unsubscribe: (() => void) | null;
  #visibleIndexByPath: Map<string, number> | null = null;
  #visibleIndexByPathFactory: (() => Map<string, number>) | null = null;

  public constructor(options: PathStoreTreesControllerOptions) {
    const { paths, ...baseOptions } = options;
    this.#baseOptions = baseOptions;
    this.#store = new PathStore({
      ...baseOptions,
      paths,
    });
    this.#rebuildVisibleProjection(null, false);
    this.#unsubscribe = this.#subscribe();
  }

  public destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#listeners.clear();
  }

  public focusFirstItem(): void {
    if (this.#projectionPaths.length > 0) {
      this.#setFocusedIndex(0);
    }
  }

  public focusLastItem(): void {
    if (this.#visibleCount <= 0) {
      return;
    }

    this.#ensureFullProjection();
    this.#setFocusedIndex(this.#visibleCount - 1);
  }

  public focusNextItem(): void {
    this.#moveFocus(1);
  }

  public focusParentItem(): void {
    if (this.#focusedIndex < 0) {
      return;
    }

    const parentIndex = this.#getParentIndexForVisibleRow(this.#focusedIndex);
    if (parentIndex >= 0) {
      this.#setFocusedIndex(parentIndex);
    }
  }

  public focusPath(path: string): void {
    const resolvedPath = this.#store.getPathInfo(path)?.path ?? null;
    if (resolvedPath == null) {
      return;
    }

    this.#ensureFullProjection();
    const nextFocusedIndex = this.#resolveFocusedIndex(resolvedPath);
    if (nextFocusedIndex >= 0) {
      this.#setFocusedIndex(nextFocusedIndex);
    }
  }

  public focusPreviousItem(): void {
    this.#moveFocus(-1);
  }

  public getFocusedIndex(): number {
    return this.#focusedIndex;
  }

  public getFocusedItem(): PathStoreTreesItemHandle | null {
    return this.#focusedPath == null
      ? null
      : this.#getOrCreateItemHandle(this.#focusedPath);
  }

  public getFocusedPath(): string | null {
    return this.#focusedPath;
  }

  public getSelectedPaths(): readonly string[] {
    return [...this.#selectedPaths];
  }

  public getSelectionVersion(): number {
    return this.#selectionVersion;
  }

  public getVisibleCount(): number {
    return this.#visibleCount;
  }

  public getVisibleRows(
    start: number,
    end: number
  ): readonly PathStoreTreesVisibleRow[] {
    if (end < start || this.#visibleCount === 0) {
      return [];
    }

    if (!this.#hasFullProjection && end >= this.#projectionPaths.length) {
      this.#ensureFullProjection();
    }

    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(this.#visibleCount - 1, end);
    if (boundedEnd < boundedStart) {
      return [];
    }

    return this.#store
      .getVisibleSlice(boundedStart, boundedEnd)
      .map((row, offset) => {
        const index = boundedStart + offset;
        const projectionPath = this.#projectionPaths[index];
        if (projectionPath == null) {
          throw new Error(
            `Missing projection path for visible index ${String(index)}`
          );
        }

        return {
          ancestorPaths: this.#getAncestorPaths(index),
          depth: row.depth,
          flattenedSegments: row.flattenedSegments?.map((segment) => ({
            isTerminal: segment.isTerminal,
            name: segment.name,
            path: segment.path,
          })),
          hasChildren: row.hasChildren,
          index,
          isExpanded: row.isExpanded,
          isFlattened: row.isFlattened,
          isFocused: projectionPath === this.#focusedPath,
          isSelected: this.#selectedPaths.has(projectionPath),
          kind: row.kind,
          level: row.depth,
          name: row.name,
          path: projectionPath,
          posInSet: this.#projectionPosInSetByIndex[index] ?? 0,
          setSize: this.#projectionSetSizeByIndex[index] ?? 0,
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
    const itemInfo = this.#store.getPathInfo(path);
    return itemInfo == null
      ? null
      : this.#getOrCreateItemHandle(itemInfo.path, itemInfo);
  }

  public selectAllVisiblePaths(): void {
    this.#ensureFullProjection();
    const nextSelectedPaths = [...this.#projectionPaths];
    this.#applySelection(
      nextSelectedPaths,
      this.#focusedPath ?? this.#selectionAnchorPath
    );
  }

  public selectOnlyPath(path: string): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null) {
      return;
    }

    this.#applySelection([resolvedPath], resolvedPath);
  }

  public selectPath(path: string): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null || this.#selectedPaths.has(resolvedPath)) {
      return;
    }

    this.#applySelection([...this.#selectedPaths, resolvedPath]);
  }

  public deselectPath(path: string): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null || !this.#selectedPaths.has(resolvedPath)) {
      return;
    }

    this.#applySelection(
      [...this.#selectedPaths].filter(
        (selectedPath) => selectedPath !== resolvedPath
      )
    );
  }

  public toggleFocusedSelection(): void {
    if (this.#focusedPath == null) {
      return;
    }

    this.togglePathSelectionFromInput(this.#focusedPath);
  }

  public togglePathSelection(path: string): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null) {
      return;
    }

    if (this.#selectedPaths.has(resolvedPath)) {
      this.deselectPath(resolvedPath);
      return;
    }

    this.selectPath(resolvedPath);
  }

  public togglePathSelectionFromInput(path: string): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null) {
      return;
    }

    if (this.#selectedPaths.has(resolvedPath)) {
      this.#applySelection(
        [...this.#selectedPaths].filter(
          (selectedPath) => selectedPath !== resolvedPath
        ),
        resolvedPath
      );
      return;
    }

    this.#applySelection([...this.#selectedPaths, resolvedPath], resolvedPath);
  }

  public selectPathRange(path: string, unionSelection: boolean): void {
    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null) {
      return;
    }

    this.#ensureFullProjection();
    const anchorPath = this.#selectionAnchorPath;
    const anchorIndex =
      anchorPath == null ? -1 : this.#findVisibleIndexByPath(anchorPath);
    const targetIndex = this.#findVisibleIndexByPath(resolvedPath);
    if (anchorIndex === -1 || targetIndex === -1) {
      const nextSelectedPaths = unionSelection
        ? [...this.#selectedPaths, resolvedPath]
        : [resolvedPath];
      this.#applySelection(nextSelectedPaths, resolvedPath);
      return;
    }

    const [startIndex, endIndex] =
      anchorIndex <= targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    const rangePaths = this.#projectionPaths.slice(startIndex, endIndex + 1);
    const nextSelectedPaths = unionSelection
      ? [...this.#selectedPaths, ...rangePaths]
      : rangePaths;
    this.#applySelection(nextSelectedPaths, anchorPath);
  }

  public extendSelectionFromFocused(offset: -1 | 1): void {
    if (this.#focusedPath == null) {
      return;
    }

    const focusedIndex = this.#focusedIndex;
    if (focusedIndex === -1) {
      return;
    }

    const nextIndex = Math.min(
      this.#visibleCount - 1,
      Math.max(0, focusedIndex + offset)
    );
    if (nextIndex === focusedIndex) {
      return;
    }

    if (!this.#hasFullProjection && nextIndex >= this.#projectionPaths.length) {
      this.#ensureFullProjection();
    }

    const currentPath = this.#projectionPaths[focusedIndex] ?? null;
    const nextPath = this.#projectionPaths[nextIndex] ?? null;
    if (currentPath == null || nextPath == null) {
      return;
    }

    const nextSelectedPaths = new Set(this.#selectedPaths);
    if (nextSelectedPaths.has(currentPath) && nextSelectedPaths.has(nextPath)) {
      nextSelectedPaths.delete(currentPath);
    } else {
      nextSelectedPaths.add(nextPath);
    }

    this.#applySelection(
      [...nextSelectedPaths],
      this.#selectionAnchorPath ?? currentPath,
      false
    );
    this.#setFocusedIndex(nextIndex);
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
    const nextStore = new PathStore({
      ...this.#baseOptions,
      paths,
    });
    const previousFocusedPath = this.#focusedPath;
    const previousSelectedPaths = this.getSelectedPaths();
    const previousSelectionAnchorPath = this.#selectionAnchorPath;

    this.#unsubscribe?.();
    this.#store = nextStore;
    this.#itemHandles.clear();
    const nextSelectedPaths = previousSelectedPaths
      .map((selectedPath) => nextStore.getPathInfo(selectedPath)?.path ?? null)
      .filter((resolved): resolved is string => resolved != null);
    const selectionChanged = !arePathSetsEqual(
      this.#selectedPaths,
      nextSelectedPaths
    );
    this.#selectedPaths = new Set(nextSelectedPaths);
    if (selectionChanged) {
      this.#selectionVersion += 1;
    }
    this.#selectionAnchorPath =
      previousSelectionAnchorPath == null
        ? null
        : (nextStore.getPathInfo(previousSelectionAnchorPath)?.path ?? null);
    this.#rebuildVisibleProjection(
      previousFocusedPath,
      previousFocusedPath != null ||
        nextSelectedPaths.length > 0 ||
        this.#selectionAnchorPath != null
    );
    this.#unsubscribe = this.#subscribe();
    this.#emit();
  }

  #ensureVisibleIndexByPath(): ReadonlyMap<string, number> {
    this.#visibleIndexByPath ??=
      this.#visibleIndexByPathFactory?.() ?? new Map();

    return this.#visibleIndexByPath;
  }

  #findVisibleIndexByPath(path: string): number {
    return this.#ensureVisibleIndexByPath().get(path) ?? -1;
  }

  #resolveFocusedIndex(path: string): number {
    const directIndex = this.#findVisibleIndexByPath(path);
    if (directIndex !== -1) {
      return directIndex;
    }

    const ancestorPath = findNearestVisibleAncestorPath(
      this.#ensureVisibleIndexByPath(),
      path
    );
    return ancestorPath == null
      ? -1
      : this.#findVisibleIndexByPath(ancestorPath);
  }

  #getOrCreateItemHandle(
    path: string,
    itemInfo?: PathStorePathInfo
  ): PathStoreTreesItemHandle | null {
    const cachedHandle = this.#itemHandles.get(path);
    if (cachedHandle != null) {
      return cachedHandle;
    }

    const resolvedItemInfo = itemInfo ?? this.#store.getPathInfo(path);
    if (resolvedItemInfo == null) {
      return null;
    }

    const handle =
      resolvedItemInfo.kind === 'directory'
        ? this.#createDirectoryHandle(resolvedItemInfo.path)
        : this.#createFileHandle(resolvedItemInfo.path);
    this.#itemHandles.set(resolvedItemInfo.path, handle);
    return handle;
  }

  #getAncestorPaths(index: number): readonly string[] {
    const cached = this.#ancestorPathsByIndex.get(index);
    if (cached != null) {
      return cached;
    }

    const parentIndex = this.#getParentIndexForVisibleRow(index);
    const ancestorPaths =
      parentIndex < 0
        ? []
        : [
            ...this.#getAncestorPaths(parentIndex),
            this.#projectionPaths[parentIndex] ?? '',
          ].filter((path) => path !== '');
    this.#ancestorPathsByIndex.set(index, ancestorPaths);
    return ancestorPaths;
  }

  #collapseDirectory(path: string): void {
    this.#store.collapse(path);
  }

  #applySelection(
    nextSelectedPaths: readonly string[],
    nextAnchorPath: string | null = this.#selectionAnchorPath,
    emit: boolean = true
  ): void {
    const uniqueSelectedPaths = [...new Set(nextSelectedPaths)];
    const selectionChanged = !arePathSetsEqual(
      this.#selectedPaths,
      uniqueSelectedPaths
    );
    const anchorChanged = this.#selectionAnchorPath !== nextAnchorPath;
    if (!selectionChanged && !anchorChanged) {
      return;
    }

    this.#selectedPaths = new Set(uniqueSelectedPaths);
    this.#selectionAnchorPath = nextAnchorPath;
    if (selectionChanged) {
      this.#selectionVersion += 1;
    }
    if (emit) {
      this.#emit();
    }
  }

  #createDirectoryHandle(path: string): PathStoreTreesDirectoryHandle {
    return {
      collapse: () => {
        this.#collapseDirectory(path);
      },
      deselect: () => {
        this.deselectPath(path);
      },
      expand: () => {
        this.#expandDirectory(path);
      },
      focus: () => {
        this.focusPath(path);
      },
      getPath: () => path,
      isDirectory: () => true,
      isExpanded: () => this.#store.isExpanded(path),
      isFocused: () => this.#focusedPath === path,
      isSelected: () => this.#selectedPaths.has(path),
      select: () => {
        this.selectPath(path);
      },
      toggleSelect: () => {
        this.togglePathSelection(path);
      },
      toggle: () => {
        this.#toggleDirectory(path);
      },
    };
  }

  #createFileHandle(path: string): PathStoreTreesFileHandle {
    return {
      deselect: () => {
        this.deselectPath(path);
      },
      focus: () => {
        this.focusPath(path);
      },
      getPath: () => path,
      isDirectory: () => false,
      isFocused: () => this.#focusedPath === path,
      isSelected: () => this.#selectedPaths.has(path),
      select: () => {
        this.selectPath(path);
      },
      toggleSelect: () => {
        this.togglePathSelection(path);
      },
    };
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #expandDirectory(path: string): void {
    for (const ancestorPath of getAncestorDirectoryPaths(path)) {
      if (this.#store.isExpanded(ancestorPath)) {
        continue;
      }

      this.#store.expand(ancestorPath);
    }

    if (!this.#store.isExpanded(path)) {
      this.#store.expand(path);
    }
  }

  #moveFocus(offset: -1 | 1): void {
    const itemCount = this.#visibleCount;
    if (itemCount === 0) {
      return;
    }

    const currentIndex = this.#focusedIndex === -1 ? 0 : this.#focusedIndex;
    const nextIndex = Math.min(
      itemCount - 1,
      Math.max(0, currentIndex + offset)
    );
    if (!this.#hasFullProjection && nextIndex >= this.#projectionPaths.length) {
      this.#ensureFullProjection();
    }
    if (nextIndex !== currentIndex || this.#focusedIndex === -1) {
      this.#setFocusedIndex(nextIndex);
    }
  }

  #rebuildVisibleProjection(
    focusedPathCandidate: string | null,
    full: boolean = true
  ): void {
    this.#visibleCount = this.#store.getVisibleCount();
    const projection = createVisibleProjection(
      this.#store.getVisibleTreeProjectionData(
        full
          ? undefined
          : Math.min(this.#visibleCount, INITIAL_PROJECTION_ROW_LIMIT)
      ),
      focusedPathCandidate
    );
    this.#ancestorPathsByIndex.clear();
    this.#hasFullProjection = projection.paths.length >= this.#visibleCount;
    this.#focusedIndex = projection.focusedIndex;
    this.#focusedPath =
      projection.focusedIndex < 0
        ? null
        : (projection.paths[projection.focusedIndex] ?? null);
    this.#getParentIndexForVisibleRow = projection.getParentIndex;
    this.#projectionPaths = projection.paths;
    this.#projectionPosInSetByIndex = projection.posInSetByIndex;
    this.#projectionSetSizeByIndex = projection.setSizeByIndex;
    this.#visibleIndexByPath = projection.visibleIndexByPath;
    this.#visibleIndexByPathFactory = projection.visibleIndexByPathFactory;
  }

  #resolveSelectionPath(path: string): string | null {
    return this.#store.getPathInfo(path)?.path ?? null;
  }

  #setFocusedIndex(index: number, emit: boolean = true): void {
    const nextPath = this.#projectionPaths[index];
    if (nextPath == null) {
      return;
    }

    if (this.#focusedIndex === index && this.#focusedPath === nextPath) {
      return;
    }

    this.#focusedIndex = index;
    this.#focusedPath = nextPath;
    if (emit) {
      this.#emit();
    }
  }

  #ensureFullProjection(): void {
    if (this.#hasFullProjection) {
      return;
    }

    this.#rebuildVisibleProjection(this.#focusedPath, true);
  }

  #subscribe(): () => void {
    return this.#store.on('*', () => {
      this.#rebuildVisibleProjection(this.#focusedPath, true);
      this.#emit();
    });
  }

  #toggleDirectory(path: string): void {
    if (this.#store.isExpanded(path)) {
      this.#collapseDirectory(path);
      return;
    }

    this.#expandDirectory(path);
  }
}
