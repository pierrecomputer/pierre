import { PathStore } from '@pierre/path-store';
import type {
  PathStoreEvent,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStorePathInfo,
  PathStorePreparedInput,
  PathStoreRemoveOptions,
  PathStoreVisibleTreeProjectionData,
} from '@pierre/path-store';

import type {
  PathStoreTreesBatchEvent,
  PathStoreTreesControllerListener,
  PathStoreTreesControllerOptions,
  PathStoreTreesDirectoryHandle,
  PathStoreTreesFileHandle,
  PathStoreTreesItemHandle,
  PathStoreTreesMutationEvent,
  PathStoreTreesMutationEventForType,
  PathStoreTreesMutationEventType,
  PathStoreTreesMutationHandle,
  PathStoreTreesMutationSemanticEvent,
  PathStoreTreesResetEvent,
  PathStoreTreesResetOptions,
  PathStoreTreesSearchMode,
  PathStoreTreesSearchSessionHandle,
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

type MutationListener = (event: PathStoreTreesMutationEvent) => void;
type MutationListenerByType = Map<
  PathStoreTreesMutationEventType | '*',
  Set<MutationListener>
>;

function isPathMutationEvent(
  event: PathStoreEvent
): event is Extract<
  PathStoreEvent,
  { operation: 'add' | 'remove' | 'move' | 'batch' }
> {
  return (
    event.operation === 'add' ||
    event.operation === 'remove' ||
    event.operation === 'move' ||
    event.operation === 'batch'
  );
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

function getImmediateParentPath(path: string): string | null {
  const ancestorPaths = getAncestorDirectoryPaths(path);
  return ancestorPaths.at(-1) ?? null;
}

function getSiblingComparisonKey(
  path: string,
  parentPath: string | null
): string {
  if (parentPath == null) {
    return path;
  }

  return path.startsWith(parentPath) ? path.slice(parentPath.length) : path;
}

const normalizeSearchText = (value: string): string =>
  value.trim().toLowerCase().replaceAll('\\', '/');

function isFuzzySubsequenceMatch(search: string, target: string): boolean {
  let searchIndex = 0;
  let targetIndex = 0;

  while (searchIndex < search.length && targetIndex < target.length) {
    if (search[searchIndex] === target[targetIndex]) {
      searchIndex += 1;
    }
    targetIndex += 1;
  }

  return searchIndex === search.length;
}

function defaultPathStoreSearchMatcher(search: string, path: string): boolean {
  if (search.length === 0) {
    return false;
  }

  const normalizedSearch = normalizeSearchText(search);
  if (normalizedSearch.length === 0) {
    return false;
  }

  const normalizedPath = normalizeSearchText(path);
  return (
    normalizedPath.includes(normalizedSearch) ||
    isFuzzySubsequenceMatch(normalizedSearch, normalizedPath)
  );
}

// Applies a directory/file move to a tracked public path so focus/selection can
// follow moved items instead of falling back as if they were deleted.
function remapMovedPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  const descendantPrefix = fromPath.endsWith('/') ? fromPath : `${fromPath}/`;
  if (!path.startsWith(descendantPrefix)) {
    return path;
  }

  const targetPrefix = toPath.endsWith('/') ? toPath : `${toPath}/`;
  return `${targetPrefix}${path.slice(descendantPrefix.length)}`;
}

// Determines whether a tracked public path disappeared because a remove event
// deleted that exact item or a whole removed directory subtree.
function isPathRemoved(path: string, removedPath: string): boolean {
  if (path === removedPath) {
    return true;
  }

  const descendantPrefix = removedPath.endsWith('/')
    ? removedPath
    : `${removedPath}/`;
  return path.startsWith(descendantPrefix);
}

// Rewrites focus/selection paths through mutation events so controller state
// stays aligned with the mutated topology before the next projection rebuild.
function remapPathThroughMutation(
  path: string | null,
  event: PathStoreEvent,
  preserveRemovedPath: boolean = false
): string | null {
  if (path == null) {
    return null;
  }

  switch (event.operation) {
    case 'add':
    case 'expand':
    case 'collapse':
    case 'mark-directory-unloaded':
    case 'begin-child-load':
    case 'apply-child-patch':
    case 'complete-child-load':
    case 'fail-child-load':
    case 'cleanup':
      return path;
    case 'remove':
      return isPathRemoved(path, event.path)
        ? preserveRemovedPath
          ? path
          : null
        : path;
    case 'move':
      return remapMovedPath(path, event.from, event.to);
    case 'batch': {
      let nextPath: string | null = path;
      for (const childEvent of event.events) {
        nextPath = remapPathThroughMutation(
          nextPath,
          childEvent,
          preserveRemovedPath
        );
        if (nextPath == null) {
          return null;
        }
      }
      return nextPath;
    }
  }
}

function createMutationInvalidation(event: PathStoreEvent): {
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
} {
  return {
    canonicalChanged: event.canonicalChanged,
    projectionChanged: event.projectionChanged,
    visibleCountDelta: event.visibleCountDelta,
  };
}

function toTreesMutationSemanticEvent(
  event: Extract<PathStoreEvent, { operation: 'add' | 'remove' | 'move' }>
): PathStoreTreesMutationSemanticEvent {
  switch (event.operation) {
    case 'add':
      return {
        ...createMutationInvalidation(event),
        operation: 'add',
        path: event.path,
      };
    case 'remove':
      return {
        ...createMutationInvalidation(event),
        operation: 'remove',
        path: event.path,
        recursive: event.recursive,
      };
    case 'move':
      return {
        ...createMutationInvalidation(event),
        from: event.from,
        operation: 'move',
        to: event.to,
      };
  }
}

function toTreesBatchEvent(
  event: Extract<PathStoreEvent, { operation: 'batch' }>
): PathStoreTreesBatchEvent {
  return {
    ...createMutationInvalidation(event),
    events: event.events
      .filter(
        (
          childEvent
        ): childEvent is Extract<
          PathStoreEvent,
          { operation: 'add' | 'remove' | 'move' }
        > =>
          childEvent.operation === 'add' ||
          childEvent.operation === 'remove' ||
          childEvent.operation === 'move'
      )
      .map((childEvent) => toTreesMutationSemanticEvent(childEvent)),
    operation: 'batch',
  };
}

function toTreesMutationEvent(
  event: PathStoreEvent
): PathStoreTreesMutationEvent | null {
  switch (event.operation) {
    case 'add':
    case 'remove':
    case 'move':
      return toTreesMutationSemanticEvent(event);
    case 'batch':
      return toTreesBatchEvent(event);
    default:
      return null;
  }
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
export class PathStoreTreesController
  implements PathStoreTreesMutationHandle, PathStoreTreesSearchSessionHandle
{
  readonly #baseOptions: Omit<
    PathStoreTreesControllerOptions,
    'paths' | 'preparedInput'
  >;
  readonly #listeners = new Set<PathStoreTreesControllerListener>();
  readonly #mutationListeners: MutationListenerByType = new Map();
  #ancestorPathsByIndex = new Map<number, readonly string[]>();
  #focusedIndex = -1;
  #focusedPath: string | null = null;
  #hasFullProjection = false;
  #getParentIndexForVisibleRow = (_index: number): number => -1;
  #itemHandles = new Map<string, PathStoreTreesItemHandle>();
  #knownDirectoryPaths: readonly string[] | null = null;
  #knownPaths: readonly string[] | null = null;
  #onSearchChange: ((value: string | null) => void) | undefined;
  #projectionPaths: readonly string[] = [];
  #projectionPosInSetByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #projectionSetSizeByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #searchMatchPathSet = new Set<string>();
  #searchMatchingPaths: readonly string[] = [];
  #searchMode: PathStoreTreesSearchMode;
  #searchPreviousExpandedPaths: readonly string[] | null = null;
  #searchValue: string | null = null;
  #searchVisiblePathSet: Set<string> | null = null;
  #searchVisibleIndexByPath: Map<string, number> | null = null;
  #searchVisibleIndices: readonly number[] | null = null;
  #searchVisiblePaths: readonly string[] | null = null;
  #selectionAnchorPath: string | null = null;
  #selectedPaths = new Set<string>();
  #selectionVersion = 0;
  #store: PathStore;
  #storeVisibleCount = 0;
  #suppressStoreNotifications = false;
  #visibleCount = 0;
  #unsubscribe: (() => void) | null;
  #visibleIndexByPath: Map<string, number> | null = null;
  #visibleIndexByPathFactory: (() => Map<string, number>) | null = null;

  public constructor(options: PathStoreTreesControllerOptions) {
    const {
      fileTreeSearchMode,
      initialSearchQuery,
      onSearchChange,
      paths,
      preparedInput,
      ...baseOptions
    } = options;
    this.#baseOptions = baseOptions;
    this.#onSearchChange = onSearchChange;
    this.#searchMode = fileTreeSearchMode ?? 'hide-non-matches';
    this.#store = this.#createStore(paths, preparedInput);
    this.#rebuildVisibleProjection(null, false);
    if (initialSearchQuery != null) {
      this.#setSearchState(initialSearchQuery, false);
    }
    this.#unsubscribe = this.#subscribe();
  }

  public destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#mutationListeners.clear();
    this.#listeners.clear();
    this.#itemHandles.clear();
    this.#invalidateKnownPathCaches();
  }

  public focusFirstItem(): void {
    if (this.#getCurrentVisiblePaths().length > 0) {
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
    if (this.#focusedPath == null) {
      return;
    }

    const parentPath = getImmediateParentPath(this.#focusedPath);
    if (parentPath == null) {
      return;
    }

    const nextFocusedIndex = this.#resolveFocusedIndex(parentPath);
    if (nextFocusedIndex >= 0) {
      this.#setFocusedIndex(nextFocusedIndex);
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

  public focusNearestPath(path: string | null): string | null {
    const nextPath = this.resolveNearestVisiblePath(path);
    if (nextPath == null) {
      return null;
    }

    const nextFocusedIndex = this.#resolveFocusedIndex(nextPath);
    if (nextFocusedIndex >= 0) {
      this.#setFocusedIndex(nextFocusedIndex);
      return this.#getCurrentVisiblePaths()[nextFocusedIndex] ?? nextPath;
    }

    return null;
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

  public resolveNearestVisiblePath(path: string | null): string | null {
    const currentVisiblePaths = this.#getCurrentVisiblePaths();
    if (this.#visibleCount === 0) {
      return null;
    }

    if (path == null) {
      return this.#focusedPath ?? currentVisiblePaths[0] ?? null;
    }

    const resolvedPath = this.#store.getPathInfo(path)?.path ?? path;
    const directIndex = this.#resolveFocusedIndex(resolvedPath);
    if (directIndex >= 0) {
      return currentVisiblePaths[directIndex] ?? resolvedPath;
    }

    const siblingPath = this.#findNearestVisibleSiblingPath(resolvedPath);
    if (siblingPath != null) {
      return siblingPath;
    }

    return this.#focusedPath ?? currentVisiblePaths[0] ?? null;
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

    if (this.#searchVisibleIndices != null) {
      const projectionIndices = Array.from(
        { length: boundedEnd - boundedStart + 1 },
        (_, visibleOffset) =>
          this.#getProjectionIndexFromVisibleIndex(boundedStart + visibleOffset)
      );
      const visibleRowByProjectionIndex = new Map<
        number,
        ReturnType<PathStore['getVisibleSlice']>[number]
      >();
      let runStartIndex = projectionIndices[0] ?? -1;
      let runEndIndex = runStartIndex;
      for (let index = 1; index <= projectionIndices.length; index += 1) {
        const projectionIndex = projectionIndices[index];
        if (projectionIndex != null && projectionIndex === runEndIndex + 1) {
          runEndIndex = projectionIndex;
          continue;
        }

        if (runStartIndex >= 0) {
          const visibleSlice = this.#store.getVisibleSlice(
            runStartIndex,
            runEndIndex
          );
          visibleSlice.forEach((row, offset) => {
            visibleRowByProjectionIndex.set(runStartIndex + offset, row);
          });
        }

        if (projectionIndex == null) {
          runStartIndex = -1;
          runEndIndex = -1;
          continue;
        }

        runStartIndex = projectionIndex;
        runEndIndex = projectionIndex;
      }

      return Array.from(
        { length: boundedEnd - boundedStart + 1 },
        (_, visibleOffset) => {
          const visibleIndex = boundedStart + visibleOffset;
          const projectionIndex =
            this.#getProjectionIndexFromVisibleIndex(visibleIndex);
          const row = visibleRowByProjectionIndex.get(projectionIndex);
          const projectionPath = this.#projectionPaths[projectionIndex];
          if (row == null || projectionPath == null) {
            throw new Error(
              `Missing projection row for filtered visible index ${String(visibleIndex)}`
            );
          }

          return {
            ancestorPaths: this.#getAncestorPaths(projectionIndex),
            depth: row.depth,
            flattenedSegments: row.flattenedSegments?.map((segment) => ({
              isTerminal: segment.isTerminal,
              name: segment.name,
              path: segment.path,
            })),
            hasChildren: row.hasChildren,
            index: visibleIndex,
            isExpanded: row.isExpanded,
            isFlattened: row.isFlattened,
            isFocused: projectionPath === this.#focusedPath,
            isSelected: this.#selectedPaths.has(projectionPath),
            kind: row.kind,
            level: row.depth,
            name: row.name,
            path: projectionPath,
            posInSet: this.#projectionPosInSetByIndex[projectionIndex] ?? 0,
            setSize: this.#projectionSetSizeByIndex[projectionIndex] ?? 0,
          } satisfies PathStoreTreesVisibleRow;
        }
      );
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
    const nextSelectedPaths = [...this.#getCurrentVisiblePaths()];
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
      anchorPath == null ? -1 : this.#getVisibleIndexByPath(anchorPath);
    const targetIndex = this.#getVisibleIndexByPath(resolvedPath);
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
    const rangePaths = this.#getCurrentVisiblePaths().slice(
      startIndex,
      endIndex + 1
    );
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

    const visiblePaths = this.#getCurrentVisiblePaths();
    const currentPath = visiblePaths[focusedIndex] ?? null;
    const nextPath = visiblePaths[nextIndex] ?? null;
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
   * Applies one path-store-native file/directory addition through the shared
   * mutation handle without exposing the raw store to tree consumers.
   */
  public add(path: string): void {
    this.#store.add(path);
  }

  public remove(path: string, options: PathStoreRemoveOptions = {}): void {
    this.#store.remove(path, options);
  }

  public move(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions = {}
  ): void {
    this.#store.move(fromPath, toPath, options);
  }

  public batch(operations: readonly PathStoreOperation[]): void {
    this.#store.batch(operations);
  }

  public onMutation<TType extends PathStoreTreesMutationEventType | '*'>(
    type: TType,
    handler: (event: PathStoreTreesMutationEventForType<TType>) => void
  ): () => void {
    const key = type;
    const typedHandler = handler as MutationListener;
    let listenersForType = this.#mutationListeners.get(key);
    if (listenersForType == null) {
      listenersForType = new Set();
      this.#mutationListeners.set(key, listenersForType);
    }
    listenersForType.add(typedHandler);
    return () => {
      const registeredListeners = this.#mutationListeners.get(key);
      registeredListeners?.delete(typedHandler);
      if (registeredListeners?.size === 0) {
        this.#mutationListeners.delete(key);
      }
    };
  }

  public setSearch(value: string | null): void {
    this.#setSearchState(value, true);
  }

  public openSearch(initialValue: string = ''): void {
    this.#setSearchState(initialValue, true);
  }

  public closeSearch(): void {
    this.#setSearchState(null, true);
  }

  public isSearchOpen(): boolean {
    return this.#searchValue !== null;
  }

  public getSearchValue(): string {
    return this.#searchValue ?? '';
  }

  public getSearchMatchingPaths(): readonly string[] {
    return this.#searchMatchingPaths;
  }

  public focusNextSearchMatch(): void {
    this.#focusRelativeSearchMatch(1);
  }

  public focusPreviousSearchMatch(): void {
    this.#focusRelativeSearchMatch(-1);
  }

  /**
   * Rebuilds the controller around a new full path set. This is intentionally a
   * coarse whole-tree reset path rather than a localized mutation fast path.
   */
  public resetPaths(
    paths: readonly string[],
    options: PathStoreTreesResetOptions = {}
  ): void {
    const previousPathCount = this.#store.list().length;
    const previousVisibleCount = this.#visibleCount;
    const nextStore = this.#createStore(paths, options.preparedInput);
    const previousFocusedPath = this.#focusedPath;
    const previousSelectedPaths = this.getSelectedPaths();
    const previousSelectionAnchorPath = this.#selectionAnchorPath;

    this.#unsubscribe?.();
    this.#store = nextStore;
    this.#itemHandles.clear();
    this.#invalidateKnownPathCaches();
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
    this.#emitMutation({
      canonicalChanged: true,
      operation: 'reset',
      pathCountAfter: paths.length,
      pathCountBefore: previousPathCount,
      projectionChanged: true,
      usedPreparedInput: options.preparedInput != null,
      visibleCountDelta: this.#visibleCount - previousVisibleCount,
    } satisfies PathStoreTreesResetEvent);
  }

  #ensureVisibleIndexByPath(): ReadonlyMap<string, number> {
    this.#visibleIndexByPath ??=
      this.#visibleIndexByPathFactory?.() ?? new Map();

    return this.#visibleIndexByPath;
  }

  #findNearestVisibleSiblingPath(path: string): string | null {
    this.#ensureFullProjection();
    const parentPath = getImmediateParentPath(path);
    const candidateKey = getSiblingComparisonKey(path, parentPath);
    let previousSiblingPath: string | null = null;
    let nextSiblingPath: string | null = null;

    for (const siblingPath of this.#getCurrentVisiblePaths()) {
      if (getImmediateParentPath(siblingPath) !== parentPath) {
        continue;
      }

      const siblingKey = getSiblingComparisonKey(siblingPath, parentPath);
      if (siblingKey < candidateKey) {
        previousSiblingPath = siblingPath;
        continue;
      }

      if (siblingKey > candidateKey) {
        nextSiblingPath = siblingPath;
        break;
      }
    }

    return previousSiblingPath ?? nextSiblingPath;
  }

  #resolveFocusedIndex(path: string): number {
    const directIndex = this.#getVisibleIndexByPath(path);
    if (directIndex !== -1) {
      return directIndex;
    }

    const ancestorPath = findNearestVisibleAncestorPath(
      this.#searchVisibleIndexByPath ?? this.#ensureVisibleIndexByPath(),
      path
    );
    if (ancestorPath != null) {
      return this.#getVisibleIndexByPath(ancestorPath);
    }

    return this.#getCurrentVisiblePaths().length > 0 ? 0 : -1;
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

  #createStore(
    paths: readonly string[],
    preparedInput?: PathStorePreparedInput
  ): PathStore {
    return new PathStore({
      ...this.#baseOptions,
      paths,
      preparedInput,
    });
  }

  #getAllKnownPaths(): readonly string[] {
    if (this.#knownPaths != null) {
      return this.#knownPaths;
    }

    const knownPaths = new Set<string>();
    for (const path of this.#store.list()) {
      knownPaths.add(path);
      for (const ancestorPath of getAncestorDirectoryPaths(path)) {
        knownPaths.add(ancestorPath);
      }
    }

    this.#knownPaths = [...knownPaths].sort();
    return this.#knownPaths;
  }

  #getAllKnownDirectoryPaths(): readonly string[] {
    if (this.#knownDirectoryPaths != null) {
      return this.#knownDirectoryPaths;
    }

    this.#knownDirectoryPaths = this.#getAllKnownPaths().filter((path) =>
      path.endsWith('/')
    );
    return this.#knownDirectoryPaths;
  }

  #invalidateKnownPathCaches(): void {
    this.#knownDirectoryPaths = null;
    this.#knownPaths = null;
  }

  #getExpandedDirectoryPaths(): readonly string[] {
    return this.#getAllKnownDirectoryPaths().filter((path) =>
      this.#store.isExpanded(path)
    );
  }

  #restoreSearchExpandedPaths(keepSelectedOpen: boolean): void {
    const expandedPaths = new Set(this.#searchPreviousExpandedPaths ?? []);
    if (keepSelectedOpen) {
      for (const selectedPath of this.#selectedPaths) {
        for (const ancestorPath of getAncestorDirectoryPaths(selectedPath)) {
          expandedPaths.add(ancestorPath);
        }
      }
    }
    this.#setExpandedPaths(expandedPaths);
  }

  #setExpandedPaths(expandedPaths: ReadonlySet<string>): void {
    this.#suppressStoreNotifications = true;
    try {
      for (const directoryPath of this.#getAllKnownDirectoryPaths()) {
        const shouldExpand = expandedPaths.has(directoryPath);
        const isExpanded = this.#store.isExpanded(directoryPath);
        if (shouldExpand && !isExpanded) {
          this.#store.expand(directoryPath);
        } else if (!shouldExpand && isExpanded) {
          this.#store.collapse(directoryPath);
        }
      }
    } finally {
      this.#suppressStoreNotifications = false;
    }
  }

  #syncSearchVisibilityState(): void {
    const currentVisiblePaths = this.#projectionPaths;
    this.#searchMatchingPaths = currentVisiblePaths.filter((path) =>
      this.#searchMatchPathSet.has(path)
    );

    if (
      this.#searchValue == null ||
      this.#searchValue.length === 0 ||
      this.#searchMode !== 'hide-non-matches' ||
      this.#searchMatchPathSet.size === 0
    ) {
      this.#searchVisibleIndices = null;
      this.#searchVisiblePaths = null;
      this.#searchVisibleIndexByPath = null;
      this.#visibleCount = this.#storeVisibleCount;
      return;
    }

    const visibleIndices: number[] = [];
    const visiblePaths: string[] = [];
    const visibleIndexByPath = new Map<string, number>();
    for (const [index, path] of currentVisiblePaths.entries()) {
      if (this.#searchVisiblePathSet?.has(path) !== true) {
        continue;
      }

      visibleIndexByPath.set(path, visiblePaths.length);
      visibleIndices.push(index);
      visiblePaths.push(path);
    }

    this.#searchVisibleIndices = visibleIndices;
    this.#searchVisiblePaths = visiblePaths;
    this.#searchVisibleIndexByPath = visibleIndexByPath;
    this.#visibleCount = visiblePaths.length;
  }

  #getCurrentVisiblePaths(): readonly string[] {
    return this.#searchVisiblePaths ?? this.#projectionPaths;
  }

  #getProjectionIndexFromVisibleIndex(index: number): number {
    return this.#searchVisibleIndices?.[index] ?? index;
  }

  #getVisibleIndexByPath(path: string): number {
    return (
      this.#searchVisibleIndexByPath?.get(path) ??
      this.#ensureVisibleIndexByPath().get(path) ??
      -1
    );
  }

  #focusRelativeSearchMatch(direction: -1 | 1): void {
    const matchPaths = this.#searchMatchingPaths;
    if (matchPaths.length === 0) {
      return;
    }

    const focusedPath = this.#focusedPath;
    const currentIndex =
      focusedPath == null ? -1 : matchPaths.indexOf(focusedPath);
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : matchPaths.length - 1
        : Math.min(
            matchPaths.length - 1,
            Math.max(0, currentIndex + direction)
          );
    const nextPath = matchPaths[nextIndex];
    if (nextPath != null) {
      this.focusPath(nextPath);
    }
  }

  #setSearchState(value: string | null, emitChange: boolean): void {
    const normalizedValue = value == null ? null : normalizeSearchText(value);
    const previousSearch = this.#searchValue;
    if (previousSearch === normalizedValue) {
      return;
    }

    if (previousSearch == null && normalizedValue != null) {
      this.#searchPreviousExpandedPaths = this.#getExpandedDirectoryPaths();
    }

    this.#searchValue = normalizedValue;

    if (normalizedValue == null) {
      this.#restoreSearchExpandedPaths(true);
      this.#searchPreviousExpandedPaths = null;
      this.#searchMatchPathSet.clear();
      this.#searchVisiblePathSet = null;
      this.#rebuildVisibleProjection(this.#focusedPath, true);
    } else if (normalizedValue.length === 0) {
      this.#restoreSearchExpandedPaths(false);
      this.#searchMatchPathSet.clear();
      this.#searchVisiblePathSet = null;
      this.#rebuildVisibleProjection(this.#focusedPath, true);
    } else {
      const focusCandidate = this.#refreshActiveSearchState();
      this.#rebuildVisibleProjection(focusCandidate, true);
    }

    if (emitChange) {
      this.#onSearchChange?.(this.#searchValue);
      this.#emit();
    }
  }

  #refreshActiveSearchState(): string | null {
    if (this.#searchValue == null || this.#searchValue.length === 0) {
      this.#searchMatchPathSet.clear();
      return this.#focusedPath;
    }

    const knownPaths = this.#getAllKnownPaths();
    const matchingPaths = this.#store
      .list()
      .filter((path) =>
        defaultPathStoreSearchMatcher(this.#searchValue ?? '', path)
      );
    const matchingPathSet = new Set(matchingPaths);
    for (const path of knownPaths) {
      if (
        path.endsWith('/') &&
        defaultPathStoreSearchMatcher(this.#searchValue ?? '', path) &&
        !matchingPathSet.has(path)
      ) {
        matchingPaths.push(path);
        matchingPathSet.add(path);
      }
    }
    this.#searchMatchPathSet = new Set(matchingPaths);
    this.#searchVisiblePathSet =
      this.#searchMode === 'hide-non-matches' && matchingPaths.length > 0
        ? new Set<string>()
        : null;
    const expandedPaths =
      this.#searchMode === 'expand-matches'
        ? new Set(this.#searchPreviousExpandedPaths ?? [])
        : new Set<string>();

    for (const matchingPath of matchingPaths) {
      this.#searchVisiblePathSet?.add(matchingPath);
      if (matchingPath.endsWith('/')) {
        expandedPaths.add(matchingPath);
      }
      for (const ancestorPath of getAncestorDirectoryPaths(matchingPath)) {
        expandedPaths.add(ancestorPath);
        this.#searchVisiblePathSet?.add(ancestorPath);
      }
    }

    this.#setExpandedPaths(expandedPaths);
    return matchingPaths[0] ?? this.#focusedPath;
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #emitMutation(event: PathStoreTreesMutationEvent): void {
    this.#mutationListeners.get(event.operation)?.forEach((listener) => {
      listener(event);
    });
    this.#mutationListeners.get('*')?.forEach((listener) => {
      listener(event);
    });
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
    if (nextIndex !== currentIndex || this.#focusedIndex === -1) {
      if (
        !this.#hasFullProjection &&
        this.#searchVisibleIndices == null &&
        nextIndex >= this.#projectionPaths.length
      ) {
        this.#ensureFullProjection();
      }
      this.#setFocusedIndex(nextIndex);
    }
  }

  #rebuildVisibleProjection(
    focusedPathCandidate: string | null,
    full: boolean = true
  ): void {
    const rawVisibleCount = this.#store.getVisibleCount();
    this.#storeVisibleCount = rawVisibleCount;
    const projection = createVisibleProjection(
      this.#store.getVisibleTreeProjectionData(
        full
          ? undefined
          : Math.min(rawVisibleCount, INITIAL_PROJECTION_ROW_LIMIT)
      ),
      focusedPathCandidate
    );
    this.#ancestorPathsByIndex.clear();
    this.#hasFullProjection = projection.paths.length >= rawVisibleCount;
    this.#getParentIndexForVisibleRow = projection.getParentIndex;
    this.#projectionPaths = projection.paths;
    this.#projectionPosInSetByIndex = projection.posInSetByIndex;
    this.#projectionSetSizeByIndex = projection.setSizeByIndex;
    this.#visibleIndexByPath = projection.visibleIndexByPath;
    this.#visibleIndexByPathFactory = projection.visibleIndexByPathFactory;
    this.#syncSearchVisibilityState();
    this.#focusedIndex =
      focusedPathCandidate == null
        ? this.#getCurrentVisiblePaths().length > 0
          ? 0
          : -1
        : this.#resolveFocusedIndex(focusedPathCandidate);
    this.#focusedPath =
      this.#focusedIndex < 0
        ? null
        : (this.#getCurrentVisiblePaths()[this.#focusedIndex] ?? null);
  }

  #resolveSelectionPath(path: string): string | null {
    return this.#store.getPathInfo(path)?.path ?? null;
  }

  #setFocusedIndex(index: number, emit: boolean = true): void {
    const nextPath = this.#getCurrentVisiblePaths()[index];
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

  #applyMutationState(
    event: Extract<
      PathStoreEvent,
      { operation: 'add' | 'remove' | 'move' | 'batch' }
    >
  ): string | null {
    const nextFocusedPath = remapPathThroughMutation(
      this.#focusedPath,
      event,
      true
    );
    const nextSelectedPaths = [...this.#selectedPaths]
      .map((selectedPath) => remapPathThroughMutation(selectedPath, event))
      .filter((resolvedPath): resolvedPath is string => resolvedPath != null)
      .map(
        (resolvedPath) => this.#store.getPathInfo(resolvedPath)?.path ?? null
      )
      .filter((resolvedPath): resolvedPath is string => resolvedPath != null);
    const nextSelectionAnchorPath = remapPathThroughMutation(
      this.#selectionAnchorPath,
      event
    );
    const canonicalAnchorPath =
      nextSelectionAnchorPath == null
        ? null
        : (this.#store.getPathInfo(nextSelectionAnchorPath)?.path ?? null);
    const uniqueNextSelectedPaths = [...new Set(nextSelectedPaths)];
    const selectionChanged = !arePathSetsEqual(
      this.#selectedPaths,
      uniqueNextSelectedPaths
    );
    if (selectionChanged) {
      this.#selectedPaths = new Set(uniqueNextSelectedPaths);
      this.#selectionVersion += 1;
    }

    this.#selectionAnchorPath = canonicalAnchorPath;
    return nextFocusedPath;
  }

  #subscribe(): () => void {
    return this.#store.on('*', (event) => {
      if (this.#suppressStoreNotifications) {
        return;
      }
      if (event.canonicalChanged) {
        this.#itemHandles.clear();
        this.#invalidateKnownPathCaches();
      }
      const focusPathCandidate = isPathMutationEvent(event)
        ? this.#applyMutationState(event)
        : this.#focusedPath;
      const searchFocusCandidate =
        this.#searchValue != null && this.#searchValue.length > 0
          ? this.#refreshActiveSearchState()
          : this.#searchValue === ''
            ? this.#focusedPath
            : focusPathCandidate;
      this.#rebuildVisibleProjection(searchFocusCandidate, true);
      this.#emit();
      const mutationEvent = toTreesMutationEvent(event);
      if (mutationEvent != null) {
        this.#emitMutation(mutationEvent);
      }
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
