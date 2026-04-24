import { PathStore, PathStorePreparedInputBuilder } from '@pierre/path-store';
import type {
  PathStoreConstructorOptions,
  PathStoreEvent,
  PathStoreLoadAttempt,
  PathStorePathInfo,
  PathStorePreparedInput,
  PathStoreVisibleAncestorRow,
  PathStoreVisibleRowContext,
  PathStoreVisibleRow as PathStoreVisibleRowData,
  PathStoreVisibleTreeProjectionData,
} from '@pierre/path-store';

import {
  type FileTreePreparedInput,
  preparePresortedFileTreeInput,
  toPathStorePreparedInput,
} from '../preparedInput';
import { renameFileTreePaths } from '../utils/renameFileTreePaths';
import {
  buildDropOperations,
  createDropContext,
  dropTargetsEqual,
  type FileTreeDragSession,
  isSelfOrDescendantDrop,
  resolveDraggedPathsForStart,
} from './dragAndDrop';
import { prepareRevealDirectorySnapshot } from './loading/reveal';
import type {
  FileTreeBatchEvent,
  FileTreeBatchOperation,
  FileTreeBulkIngestEvent,
  FileTreeBulkIngestEventForType,
  FileTreeBulkIngestEventType,
  FileTreeBulkIngestHandle,
  FileTreeBulkIngestInfo,
  FileTreeControllerListener,
  FileTreeControllerOptions,
  FileTreeDirectoryHandle,
  FileTreeDragAndDropConfig,
  FileTreeDropTarget,
  FileTreeFileHandle,
  FileTreeItemHandle,
  FileTreeMoveOptions,
  FileTreeMutationEvent,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeMutationSemanticEvent,
  FileTreeRemoveOptions,
  FileTreeRenameEvent,
  FileTreeRenamingConfig,
  FileTreeResetEvent,
  FileTreeResetOptions,
  FileTreeRevealDirectorySnapshot,
  FileTreeRevealLoadingEvent,
  FileTreeRevealLoadingEventForType,
  FileTreeRevealLoadingEventType,
  FileTreeRevealLoadingHandle,
  FileTreeRevealLoadingInfo,
  FileTreeSearchMode,
  FileTreeSearchSessionHandle,
  FileTreeStickyRowCandidate,
  FileTreeVisibleRow,
} from './types';

type ProjectionIndexBuffer = Int32Array<ArrayBufferLike>;

interface FileTreeVisibleProjection {
  focusedIndex: number;
  getParentIndex(index: number): number;
  paths: readonly string[];
  posInSetByIndex: ProjectionIndexBuffer;
  setSizeByIndex: ProjectionIndexBuffer;
}

type MutationListener = (event: FileTreeMutationEvent) => void;
type MutationListenerByType = Map<
  FileTreeMutationEventType | '*',
  Set<MutationListener>
>;
type RevealLoadingListener = (event: FileTreeRevealLoadingEvent) => void;
type RevealLoadingListenerByType = Map<
  FileTreeRevealLoadingEventType | '*',
  Set<RevealLoadingListener>
>;
type BulkIngestListener = (event: FileTreeBulkIngestEvent) => void;
type BulkIngestListenerByType = Map<
  FileTreeBulkIngestEventType | '*',
  Set<BulkIngestListener>
>;

interface RevealSingleRequest {
  abortController: AbortController;
  attempt: PathStoreLoadAttempt;
  kind: 'single';
  path: string;
}

interface RevealBatchRequest {
  abortController: AbortController;
  attemptsByPath: Map<string, PathStoreLoadAttempt>;
  explicitPaths: Set<string>;
  kind: 'batch';
  paths: readonly string[];
}

type RevealRequest = RevealSingleRequest | RevealBatchRequest;

function getRevealRequestPaths(request: RevealRequest): readonly string[] {
  return request.kind === 'batch' ? request.paths : [request.path];
}

function registerTypedListener<TEvent, TKey extends string>(
  listenersByType: Map<TKey | '*', Set<(event: TEvent) => void>>,
  key: TKey | '*',
  handler: (event: TEvent) => void
): () => void {
  let listenersForType = listenersByType.get(key);
  if (listenersForType == null) {
    listenersForType = new Set();
    listenersByType.set(key, listenersForType);
  }
  listenersForType.add(handler);
  return () => {
    const registeredListeners = listenersByType.get(key);
    registeredListeners?.delete(handler);
    if (registeredListeners?.size === 0) {
      listenersByType.delete(key);
    }
  };
}

function emitTypedListeners<TEvent, TKey extends string>(
  listenersByType: Map<TKey | '*', Set<(event: TEvent) => void>>,
  key: TKey,
  event: TEvent
): void {
  listenersByType.get(key)?.forEach((listener) => {
    listener(event);
  });
  listenersByType.get('*')?.forEach((listener) => {
    listener(event);
  });
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

interface FileTreeRenameViewState {
  cancel(): void;
  commit(): void;
  getPath(): string | null;
  getValue(): string;
  isActive(): boolean;
  setValue(value: string): void;
}

interface FileTreeStartRenamingOptions {
  removeIfCanceled?: boolean;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const FILE_TREE_RENAME_VIEW = Symbol('FILE_TREE_RENAME_VIEW');

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
const CONTEXT_VISIBLE_ROW_RANGE_LIMIT = 512;

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

function areOrderedPathsEqual(
  currentPaths: readonly string[],
  nextPaths: readonly string[]
): boolean {
  if (currentPaths.length !== nextPaths.length) {
    return false;
  }

  for (let index = 0; index < currentPaths.length; index += 1) {
    if (currentPaths[index] !== nextPaths[index]) {
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

const normalizeSearchQuery = (value: string): string => {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return '';
  }

  const normalizedSeparators = trimmedValue.includes('\\')
    ? trimmedValue.replaceAll('\\', '/')
    : trimmedValue;
  return normalizedSeparators.toLowerCase();
};

const toLowerCaseSearchPath = (path: string): string => path.toLowerCase();

function isCanonicalDirectoryPath(path: string): boolean {
  return path.endsWith('/');
}

// Rename parity is defined around basename edits, so this helper strips the
// trailing slash from canonical directory paths before deriving the visible
// editable leaf segment.
function getRenameLeafName(path: string): string {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const separatorIndex = normalizedPath.lastIndexOf('/');
  return separatorIndex < 0
    ? normalizedPath
    : normalizedPath.slice(separatorIndex + 1);
}

// The legacy rename helper reports folder paths without a trailing slash, but
// the path-store mutation layer still moves canonical directory paths with `/`.
function toRenameHelperPath(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function toCanonicalRenamePath(path: string, isFolder: boolean): string {
  return isFolder && !path.endsWith('/') ? `${path}/` : path;
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

function haveMatchingPaths(
  currentPaths: readonly string[],
  preparedPaths: readonly string[]
): boolean {
  if (currentPaths === preparedPaths) {
    return true;
  }

  if (currentPaths.length !== preparedPaths.length) {
    return false;
  }

  for (let index = 0; index < currentPaths.length; index += 1) {
    if (currentPaths[index] !== preparedPaths[index]) {
      return false;
    }
  }

  return true;
}

// Keeps raw path lists and prepared input aligned so callers cannot silently
// reuse stale prepared data after the tree source changes.
function resolveFileTreeInput(
  options: Pick<FileTreeControllerOptions, 'paths' | 'preparedInput'>,
  context: 'constructor' | 'resetPaths',
  sort: FileTreeControllerOptions['sort']
): {
  paths: readonly string[];
  preparedInput: FileTreePreparedInput | undefined;
} {
  const { paths, preparedInput } = options;
  if (preparedInput == null) {
    if (paths == null) {
      throw new Error('FileTree requires paths or preparedInput');
    }

    return {
      paths,
      preparedInput: undefined,
    };
  }

  const preparedPaths = preparedInput.paths;
  if (paths == null) {
    return {
      paths: preparedPaths,
      preparedInput,
    };
  }

  const comparablePaths = PathStore.preparePaths(
    paths,
    sort == null ? {} : { sort }
  );
  if (!haveMatchingPaths(comparablePaths, preparedPaths)) {
    throw new Error(
      `FileTree ${context} received paths and preparedInput for different path lists`
    );
  }

  return {
    paths: preparedPaths,
    preparedInput,
  };
}

function toTreesMutationSemanticEvent(
  event: Extract<PathStoreEvent, { operation: 'add' | 'remove' | 'move' }>
): FileTreeMutationSemanticEvent {
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
): FileTreeBatchEvent {
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
): FileTreeMutationEvent | null {
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

// Keeps focus resolution cheap after expand/collapse by asking for only the
// candidate path and its ancestors instead of forcing a full visible-index map.
function resolveFocusedIndexByLookup(
  rowCount: number,
  getVisibleIndex: (path: string) => number | null,
  candidatePath: string | null
): number {
  if (rowCount === 0) {
    return -1;
  }

  if (candidatePath != null) {
    const directIndex = getVisibleIndex(candidatePath);
    if (directIndex != null) {
      return directIndex;
    }

    const ancestorPaths = getAncestorDirectoryPaths(candidatePath);
    for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
      const ancestorPath = ancestorPaths[index];
      if (ancestorPath == null) {
        continue;
      }

      const ancestorIndex = getVisibleIndex(ancestorPath);
      if (ancestorIndex != null) {
        return ancestorIndex;
      }
    }
  }

  return 0;
}

// Rebuilds the visible-row projection once so focus/navigation can use
// path-first metadata without recomputing sibling and parent info per render.
// Derives the row metadata that the renderer needs for roving tabindex and
// treeitem ARIA attrs without exposing PathStore's numeric row identities.
function createVisibleProjection(
  projection: PathStoreVisibleTreeProjectionData,
  focusedPathCandidate: string | null,
  resolveVisibleIndexByPath?: (path: string) => number | null
): FileTreeVisibleProjection {
  if (projection.paths.length === 0) {
    return {
      focusedIndex: -1,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
    };
  }

  if (focusedPathCandidate == null) {
    return {
      focusedIndex: 0,
      getParentIndex: projection.getParentIndex,
      paths: projection.paths,
      posInSetByIndex: projection.posInSetByIndex,
      setSizeByIndex: projection.setSizeByIndex,
    };
  }

  const getVisibleIndex =
    resolveVisibleIndexByPath ??
    ((path: string): number | null =>
      projection.visibleIndexByPath.get(path) ?? null);
  return {
    focusedIndex: resolveFocusedIndexByLookup(
      projection.paths.length,
      getVisibleIndex,
      focusedPathCandidate
    ),
    getParentIndex: projection.getParentIndex,
    paths: projection.paths,
    posInSetByIndex: projection.posInSetByIndex,
    setSizeByIndex: projection.setSizeByIndex,
  };
}

/**
 * Owns the live PathStore instance and exposes a small path-first boundary we
 * can evolve in later phases without leaking internal store IDs.
 */
export class FileTreeController
  implements
    FileTreeMutationHandle,
    FileTreeSearchSessionHandle,
    FileTreeRevealLoadingHandle,
    FileTreeBulkIngestHandle
{
  readonly #bulkIngestListeners: BulkIngestListenerByType = new Map();
  #bulkIngestInfo: FileTreeBulkIngestInfo | null = null;
  #bulkIngestAbortController: AbortController | null = null;
  #bulkIngestRunId = 0;
  #bulkSeedPaths: readonly string[] = [];
  readonly #listeners = new Set<FileTreeControllerListener>();
  readonly #loading: FileTreeControllerOptions['loading'];
  readonly #mutationListeners: MutationListenerByType = new Map();
  readonly #revealLoadingListeners: RevealLoadingListenerByType = new Map();
  #revealCustomSortWarned = false;
  readonly #revealInflightByPath = new Map<string, RevealRequest>();
  readonly #revealQueuedSpeculativePaths = new Set<string>();
  #revealRelevantSpeculativePaths = new Set<string>();
  #revealSpeculativeReconcileScheduled = false;
  readonly #revealRunningBatches = new Set<RevealBatchRequest>();
  readonly #storeOptions: Omit<
    PathStoreConstructorOptions,
    'paths' | 'preparedInput'
  >;
  #dragAndDropConfig: FileTreeDragAndDropConfig | null = null;
  #dragSession: FileTreeDragSession | null = null;
  #ancestorIndicesByIndex = new Map<number, readonly number[]>();
  #ancestorPathsByIndex = new Map<number, readonly string[]>();
  #focusedIndex = -1;
  #focusedPath: string | null = null;
  #hasFullProjection = false;
  #getParentIndexForVisibleRow = (_index: number): number => -1;
  #itemHandles = new Map<string, FileTreeItemHandle>();
  #knownDirectoryPaths: readonly string[] | null = null;
  #knownDirectoryPathsLowerCase: readonly string[] | null = null;
  #knownPaths: readonly string[] | null = null;
  #listedPaths: readonly string[] | null = null;
  #listedPathsLowerCase: readonly string[] | null = null;
  #onRename: ((event: FileTreeRenameEvent) => void) | undefined;
  #onRenameError: ((error: string) => void) | undefined;
  #onSearchChange: ((value: string | null) => void) | undefined;
  #projectionPaths: readonly string[] = [];
  #projectionPosInSetByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #projectionSetSizeByIndex: ProjectionIndexBuffer = new Int32Array(0);
  #renameCanRename: FileTreeRenamingConfig['canRename'] | undefined = undefined;
  #renameEnabled = false;
  #renamingPath: string | null = null;
  #renamingValue = '';
  #removeRenamingPathIfCanceled = false;
  #searchMatchPathSet = new Set<string>();
  #searchMatchingPaths: readonly string[] = [];
  #searchMode: FileTreeSearchMode;
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

  public constructor(options: FileTreeControllerOptions) {
    const {
      dragAndDrop,
      fileTreeSearchMode,
      initialSearchQuery,
      initialSelectedPaths,
      loading,
      renaming,
      onSearchChange,
      paths,
      preparedInput,
      ...storeOptions
    } = options;
    const resolvedInput =
      paths == null && preparedInput == null
        ? { paths: [] as readonly string[], preparedInput: undefined }
        : resolveFileTreeInput(
            { paths, preparedInput },
            'constructor',
            storeOptions.sort
          );
    this.#loading = loading;
    this.#storeOptions = storeOptions as Omit<
      PathStoreConstructorOptions,
      'paths' | 'preparedInput'
    >;
    if (dragAndDrop != null && dragAndDrop !== false) {
      this.#dragAndDropConfig = dragAndDrop === true ? {} : dragAndDrop;
    }
    this.#renameEnabled = renaming != null && renaming !== false;
    if (renaming != null && renaming !== false && renaming !== true) {
      this.#renameCanRename = renaming.canRename;
      this.#onRenameError = renaming.onError;
      this.#onRename = renaming.onRename;
    }
    this.#onSearchChange = onSearchChange;
    this.#searchMode = fileTreeSearchMode ?? 'hide-non-matches';
    this.#store = this.#createStore(
      resolvedInput.paths,
      resolvedInput.preparedInput
    );
    this.#initializeRevealStore(this.#store, resolvedInput.paths);
    if (loading?.mode === 'bulk') {
      this.#bulkSeedPaths =
        resolvedInput.preparedInput?.paths ??
        PathStore.preparePaths(resolvedInput.paths, this.#storeOptions);
      this.#bulkIngestInfo = {
        ingestedPathCount: this.#bulkSeedPaths.length,
        status: 'idle',
      };
    }
    const resolvedInitialSelectedPaths =
      initialSelectedPaths
        ?.map((path) => this.#resolveSelectionPath(path))
        .filter((resolved): resolved is string => resolved != null) ?? [];
    const initialFocusedPath = resolvedInitialSelectedPaths.at(-1) ?? null;
    if (resolvedInitialSelectedPaths.length > 0) {
      this.#selectedPaths = new Set(resolvedInitialSelectedPaths);
      this.#selectionAnchorPath = initialFocusedPath;
      this.#selectionVersion = 1;
    }
    this.#rebuildVisibleProjection(initialFocusedPath, false);
    if (initialSearchQuery != null) {
      this.#setSearchState(initialSearchQuery, false);
    }
    this.#unsubscribe = this.#subscribe();
  }

  public destroy(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    new Set(this.#revealInflightByPath.values()).forEach((request) => {
      this.#cancelRevealRequest(request);
    });
    this.#cancelActiveBulkIngest();
    this.#bulkIngestListeners.clear();
    this.#mutationListeners.clear();
    this.#listeners.clear();
    this.#revealInflightByPath.clear();
    this.#revealLoadingListeners.clear();
    this.#revealQueuedSpeculativePaths.clear();
    this.#revealRelevantSpeculativePaths.clear();
    this.#revealRunningBatches.clear();
    this.#itemHandles.clear();
    this.#dragSession = null;
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

  // DOM row events already know the target row is mounted, so they can focus it
  // by path without materializing every visible row in large open trees.
  public focusMountedPathFromInput(path: string): void {
    const resolvedPath = this.#store.getPathInfo(path)?.path ?? null;
    if (resolvedPath == null) {
      return;
    }

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

  public getFocusedItem(): FileTreeItemHandle | null {
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
  ): readonly FileTreeVisibleRow[] {
    if (end < start || this.#visibleCount === 0) {
      this.#updateRevealSpeculativeWindow([]);
      return [];
    }

    const boundedStart = Math.max(0, start);
    const boundedEnd = Math.min(this.#visibleCount - 1, end);
    if (boundedEnd < boundedStart) {
      this.#updateRevealSpeculativeWindow([]);
      return [];
    }

    const boundedLength = boundedEnd - boundedStart + 1;
    if (
      this.#searchVisibleIndices == null &&
      !this.#hasFullProjection &&
      boundedEnd >= this.#projectionPaths.length &&
      boundedLength <= CONTEXT_VISIBLE_ROW_RANGE_LIMIT
    ) {
      const rows: FileTreeVisibleRow[] = [];
      for (let index = boundedStart; index <= boundedEnd; index += 1) {
        const context = this.#store.getVisibleRowContext(index);
        if (context == null) {
          break;
        }

        rows.push(this.#createVisibleRowFromContext(context));
      }
      return rows;
    }

    if (
      !this.#hasFullProjection &&
      boundedEnd >= this.#projectionPaths.length
    ) {
      this.#ensureFullProjection();
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

      const rows = Array.from(
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

          return this.#createVisibleRow(row, visibleIndex, projectionIndex, {
            ancestorPaths: this.#getAncestorPaths(projectionIndex),
            path: projectionPath,
          });
        }
      );
      this.#updateRevealSpeculativeWindow(rows);
      return rows;
    }

    const rows = this.#store
      .getVisibleSlice(boundedStart, boundedEnd)
      .map((row, offset) => {
        const index = boundedStart + offset;
        const projectionPath = this.#projectionPaths[index];
        if (projectionPath == null) {
          throw new Error(
            `Missing projection path for visible index ${String(index)}`
          );
        }

        return this.#createVisibleRow(row, index, index, {
          ancestorPaths: this.#getAncestorPaths(index),
          path: projectionPath,
        });
      });
    this.#updateRevealSpeculativeWindow(rows);
    return rows;
  }

  public getStickyRowCandidates(
    scrollTop: number,
    itemHeight: number
  ): readonly FileTreeStickyRowCandidate[] | null {
    if (this.#searchVisibleIndices != null) {
      return null;
    }

    if (this.#visibleCount === 0 || scrollTop <= 0 || itemHeight <= 0) {
      return [];
    }

    const stickyRows: FileTreeStickyRowCandidate[] = [];
    for (let slotDepth = 0; slotDepth < this.#visibleCount; slotDepth += 1) {
      const slotTop = scrollTop + slotDepth * itemHeight;
      const thresholdIndex = Math.min(
        this.#visibleCount - 1,
        Math.floor(slotTop / itemHeight)
      );
      const candidateContext =
        this.#getStickyCandidateContextAt(thresholdIndex, slotDepth) ??
        (thresholdIndex > 0
          ? this.#getStickyCandidateContextAt(thresholdIndex - 1, slotDepth)
          : undefined);
      if (candidateContext == null) {
        break;
      }

      stickyRows.push({
        row: this.#createVisibleRowFromContext(candidateContext),
        subtreeEndIndex: candidateContext.subtreeEndIndex,
      });
    }

    return stickyRows;
  }

  /**
   * Returns the minimal Phase 2/3 item handle for the given path.
   *
   * Accepts both canonical directory paths (`src/`) and bare directory lookup
   * paths (`src`) so callers do not need to know the canonical slash rules.
   */
  public getItem(path: string): FileTreeItemHandle | null {
    const itemInfo = this.#store.getPathInfo(path);
    return itemInfo == null
      ? null
      : this.#getOrCreateItemHandle(itemInfo.path, itemInfo);
  }

  // Only use this for paths sourced from currently mounted directory rows. The
  // mounted-row invariant lets click handling skip public handle creation while
  // still revalidating stale DOM events against the live store.
  public resolveMountedDirectoryPathFromInput(path: string): string | null {
    const pathInfo = this.#store.getPathInfo(path);
    return pathInfo?.kind === 'directory' ? pathInfo.path : null;
  }

  // Only use this for paths sourced from currently mounted directory rows. The
  // live-path check prevents stale DOM events from throwing if the row was
  // removed or became a file before the click handler ran.
  public toggleMountedDirectoryFromInput(path: string): void {
    const directoryPath = this.resolveMountedDirectoryPathFromInput(path);
    if (directoryPath == null) {
      return;
    }

    this.#toggleDirectory(directoryPath);
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

  // Only use this for paths sourced from currently mounted rows. Visible rows
  // already provide canonical public paths, so regular row clicks can update
  // selection without re-normalizing the same path through the store.
  public selectOnlyMountedPathFromInput(path: string): void {
    this.#applySelection([path], path);
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

  public getDragAndDropConfig(): FileTreeDragAndDropConfig | null {
    return this.#dragAndDropConfig;
  }

  public isDragAndDropEnabled(): boolean {
    return this.#dragAndDropConfig != null;
  }

  public getDragSession(): {
    draggedPaths: readonly string[];
    primaryPath: string;
    target: FileTreeDropTarget | null;
  } | null {
    if (this.#dragSession == null) {
      return null;
    }

    return {
      draggedPaths: [...this.#dragSession.draggedPaths],
      primaryPath: this.#dragSession.primaryPath,
      target:
        this.#dragSession.target == null
          ? null
          : { ...this.#dragSession.target },
    };
  }

  public startDrag(path: string): boolean {
    if (this.#dragAndDropConfig == null) {
      return false;
    }

    const resolvedPath = this.#resolveSelectionPath(path);
    if (resolvedPath == null) {
      return false;
    }

    if (this.#searchValue != null && this.#searchValue.length > 0) {
      return false;
    }

    const selectedPaths = this.getSelectedPaths();
    const draggedPaths = resolveDraggedPathsForStart(
      resolvedPath,
      selectedPaths
    );
    if (this.#dragAndDropConfig.canDrag?.(draggedPaths) === false) {
      return false;
    }

    if (!selectedPaths.includes(resolvedPath)) {
      this.#applySelection([resolvedPath], resolvedPath, false);
    }

    this.#focusPathWithoutEmit(resolvedPath);
    this.#dragSession = {
      draggedPaths,
      primaryPath: resolvedPath,
      target: null,
    };
    this.#emit();
    return true;
  }

  public setDragTarget(target: FileTreeDropTarget | null): void {
    const dragSession = this.#dragSession;
    if (dragSession == null) {
      return;
    }

    let nextTarget = target;
    if (nextTarget != null) {
      const context = createDropContext(dragSession.draggedPaths, nextTarget);
      if (
        isSelfOrDescendantDrop(dragSession.draggedPaths, nextTarget) ||
        this.#dragAndDropConfig?.canDrop?.(context) === false
      ) {
        nextTarget = null;
      }
    }

    if (dropTargetsEqual(dragSession.target, nextTarget)) {
      return;
    }

    this.#dragSession = {
      ...dragSession,
      target: nextTarget,
    };
    this.#emit();
  }

  public cancelDrag(): void {
    if (this.#dragSession == null) {
      return;
    }

    this.#dragSession = null;
    this.#emit();
  }

  public completeDrag(): boolean {
    const dragSession = this.#dragSession;
    if (dragSession == null) {
      return false;
    }

    // Clear the public drag session before mutating so any store event emitted
    // by the committed move/batch sees drag state as already closed.
    this.#dragSession = null;
    const target =
      dragSession.target == null ? null : { ...dragSession.target };
    if (target == null) {
      this.#emit();
      return false;
    }

    const dropContext = createDropContext(dragSession.draggedPaths, target);
    if (
      isSelfOrDescendantDrop(dragSession.draggedPaths, target) ||
      this.#dragAndDropConfig?.canDrop?.(dropContext) === false
    ) {
      this.#emit();
      return false;
    }

    const dropPlan = buildDropOperations(dragSession.draggedPaths, target);
    if (dropPlan == null) {
      this.#emit();
      return false;
    }

    try {
      if (dropPlan.operations.length === 1) {
        const singleOperation = dropPlan.operations[0];
        if (singleOperation == null || singleOperation.type !== 'move') {
          throw new Error(
            'Expected a single move operation for one-item drops'
          );
        }

        this.#store.move(singleOperation.from, singleOperation.to, {
          collision: singleOperation.collision,
        });
      } else {
        this.#validateBatchDropOperations(dropPlan.operations);
        this.#store.batch(dropPlan.operations);
      }
    } catch (error) {
      this.#emit();
      this.#dragAndDropConfig?.onDropError?.(
        error instanceof Error ? error.message : String(error),
        dropContext
      );
      return false;
    }

    this.#dragAndDropConfig?.onDropComplete?.(dropPlan.result);
    return true;
  }

  public subscribe(listener: FileTreeControllerListener): () => void {
    this.#listeners.add(listener);
    listener();
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Applies one file/directory addition through the shared mutation handle
   * without exposing the raw store to tree consumers.
   */
  public add(path: string): void {
    this.#runPathChangingMutation(() => {
      this.#store.add(path);
    });
  }

  public remove(path: string, options: FileTreeRemoveOptions = {}): void {
    this.#runPathChangingMutation(() => {
      this.#store.remove(path, options);
    });
  }

  public move(
    fromPath: string,
    toPath: string,
    options: FileTreeMoveOptions = {}
  ): void {
    this.#runPathChangingMutation(() => {
      this.#store.move(fromPath, toPath, options);
    });
  }

  public batch(operations: readonly FileTreeBatchOperation[]): void {
    this.#runPathChangingMutation(() => {
      this.#store.batch(operations);
    });
  }

  public onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void
  ): () => void {
    return registerTypedListener(
      this.#mutationListeners,
      type,
      handler as MutationListener
    );
  }

  public getRevealLoadingInfo(path: string): FileTreeRevealLoadingInfo | null {
    if (this.#loading?.mode !== 'reveal') {
      return null;
    }

    const pathInfo = this.#store.getPathInfo(path);
    if (pathInfo == null || pathInfo.kind !== 'directory') {
      return null;
    }

    const errorMessage = this.#store.getDirectoryLoadError(pathInfo.path);
    const knownChildCount = this.#store.getDirectoryKnownChildCount(
      pathInfo.path
    );

    return {
      ...(errorMessage == null ? {} : { errorMessage }),
      ...(knownChildCount == null ? {} : { knownChildCount }),
      path: pathInfo.path,
      state: this.#store.getDirectoryLoadState(pathInfo.path),
    };
  }

  public onRevealLoading<TType extends FileTreeRevealLoadingEventType | '*'>(
    type: TType,
    handler: (event: FileTreeRevealLoadingEventForType<TType>) => void
  ): () => void {
    if (this.#loading?.mode !== 'reveal') {
      return () => {};
    }

    return registerTypedListener(
      this.#revealLoadingListeners,
      type,
      handler as RevealLoadingListener
    );
  }

  public getBulkIngestInfo(): FileTreeBulkIngestInfo | null {
    if (this.#loading?.mode !== 'bulk' || this.#bulkIngestInfo == null) {
      return null;
    }

    return { ...this.#bulkIngestInfo };
  }

  public onBulkIngest<TType extends FileTreeBulkIngestEventType | '*'>(
    type: TType,
    handler: (event: FileTreeBulkIngestEventForType<TType>) => void
  ): () => void {
    if (this.#loading?.mode !== 'bulk') {
      return () => {};
    }

    return registerTypedListener(
      this.#bulkIngestListeners,
      type,
      handler as BulkIngestListener
    );
  }

  public startBulkIngest(): void {
    if (this.#loading?.mode !== 'bulk') {
      return;
    }

    this.#cancelActiveBulkIngest();
    this.#resetStoreToBulkSeedPathsIfNeeded();
    const runId = this.#bulkIngestRunId + 1;
    this.#bulkIngestRunId = runId;
    const abortController = new AbortController();
    this.#bulkIngestAbortController = abortController;
    this.#bulkIngestInfo = {
      ingestedPathCount: this.#bulkSeedPaths.length,
      status: 'ingesting',
    };
    this.#emitBulkIngestEvent('started');
    void this.#runBulkIngest(runId, abortController);
  }

  public cancelBulkIngest(): void {
    this.#cancelActiveBulkIngest();
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

  public startRenaming(
    path: string = this.#focusedPath ?? '',
    options: FileTreeStartRenamingOptions = {}
  ): boolean {
    if (!this.#renameEnabled) {
      return false;
    }

    const itemInfo = this.#store.getPathInfo(path);
    if (itemInfo == null) {
      return false;
    }

    const canonicalPath = itemInfo.path;
    const isFolder = isCanonicalDirectoryPath(canonicalPath);
    const publicPath = toRenameHelperPath(canonicalPath);
    if (
      this.#renameCanRename?.({
        isFolder,
        path: publicPath,
      }) === false
    ) {
      return false;
    }

    // Expand any collapsed ancestors so the renaming row can actually mount.
    // If the row stays hidden under a collapsed directory, the React
    // rename-handoff effect keeps asking the view to reveal a row that can
    // never render, spinning the component forever.
    for (const ancestorPath of getAncestorDirectoryPaths(canonicalPath)) {
      if (!this.#store.isExpanded(ancestorPath)) {
        this.#store.expand(ancestorPath);
      }
    }

    this.#applySelection([canonicalPath], canonicalPath, false);
    if (this.#searchValue != null) {
      this.#setSearchState(null, false);
      this.#onSearchChange?.(this.#searchValue);
    }
    this.#focusPathWithoutEmit(canonicalPath);
    this.#renamingPath = canonicalPath;
    this.#renamingValue = getRenameLeafName(canonicalPath);
    this.#removeRenamingPathIfCanceled = options.removeIfCanceled ?? false;
    this.#emit();
    return true;
  }

  public [FILE_TREE_RENAME_VIEW](): FileTreeRenameViewState {
    return {
      cancel: () => {
        this.#cancelRenaming();
      },
      commit: () => {
        this.#completeRenaming();
      },
      getPath: () => this.#renamingPath,
      getValue: () => this.#renamingValue,
      isActive: () => this.#renamingPath != null,
      setValue: (value: string) => {
        this.#setRenamingValue(value);
      },
    };
  }

  #cancelRenaming(): void {
    if (this.#renamingPath == null) {
      return;
    }

    const renamingPath = this.#renamingPath;
    const removePlaceholderEntry = this.#removeRenamingPathIfCanceled;
    this.#renamingPath = null;
    this.#renamingValue = '';
    this.#removeRenamingPathIfCanceled = false;
    if (removePlaceholderEntry) {
      this.remove(
        renamingPath,
        isCanonicalDirectoryPath(renamingPath) ? { recursive: true } : undefined
      );
      return;
    }
    this.#focusPathWithoutEmit(renamingPath);
    this.#emit();
  }

  #completeRenaming(): void {
    const renamingPath = this.#renamingPath;
    if (renamingPath == null) {
      return;
    }

    if (
      this.#removeRenamingPathIfCanceled &&
      this.#renamingValue.trim().length === 0
    ) {
      this.#renamingPath = null;
      this.#renamingValue = '';
      this.#removeRenamingPathIfCanceled = false;
      this.remove(
        renamingPath,
        isCanonicalDirectoryPath(renamingPath) ? { recursive: true } : undefined
      );
      return;
    }

    const isFolder = isCanonicalDirectoryPath(renamingPath);
    const result = renameFileTreePaths({
      files: this.#store.list(),
      isFolder,
      nextBasename: this.#renamingValue,
      path: toRenameHelperPath(renamingPath),
    });

    this.#renamingPath = null;
    this.#renamingValue = '';
    this.#removeRenamingPathIfCanceled = false;

    if ('error' in result) {
      this.#focusPathWithoutEmit(renamingPath);
      this.#onRenameError?.(result.error);
      this.#emit();
      return;
    }

    if (result.sourcePath === result.destinationPath) {
      this.#focusPathWithoutEmit(renamingPath);
      this.#emit();
      return;
    }

    this.#onRename?.({
      destinationPath: result.destinationPath,
      isFolder: result.isFolder,
      sourcePath: result.sourcePath,
    });
    this.move(
      toCanonicalRenamePath(result.sourcePath, isFolder),
      toCanonicalRenamePath(result.destinationPath, isFolder)
    );
  }

  #setRenamingValue(value: string): void {
    if (this.#renamingPath == null || this.#renamingValue === value) {
      return;
    }

    this.#renamingValue = value;
    this.#emit();
  }

  /**
   * Rebuilds the controller around a new full path set. This is intentionally a
   * coarse whole-tree reset path rather than a localized mutation fast path.
   */
  public resetPaths(
    paths: readonly string[],
    options: FileTreeResetOptions = {}
  ): void {
    const previousPathCount = this.#store.list().length;
    const previousVisibleCount = this.#visibleCount;
    const resolvedInput = resolveFileTreeInput(
      { paths, preparedInput: options.preparedInput },
      'resetPaths',
      this.#storeOptions.sort
    );
    if (this.#loading?.mode === 'bulk') {
      this.#cancelActiveBulkIngest();
    }
    const nextStore = this.#createStore(
      resolvedInput.paths,
      resolvedInput.preparedInput,
      options.initialExpandedPaths
    );
    const previousFocusedPath = this.#focusedPath;
    const previousRenamingPath = this.#renamingPath;
    const previousSelectedPaths = this.getSelectedPaths();
    const previousSelectionAnchorPath = this.#selectionAnchorPath;

    this.#unsubscribe?.();
    this.#store = nextStore;
    if (this.#loading?.mode === 'bulk') {
      this.#bulkSeedPaths =
        resolvedInput.preparedInput?.paths ??
        PathStore.preparePaths(resolvedInput.paths, this.#storeOptions);
    }
    this.#initializeRevealStore(this.#store, resolvedInput.paths);
    this.#itemHandles.clear();
    this.#invalidateKnownPathCaches();
    this.#syncBulkIngestIdleInfo(resolvedInput.paths.length);
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
    this.#renamingPath =
      previousRenamingPath == null
        ? null
        : (nextStore.getPathInfo(previousRenamingPath)?.path ?? null);
    if (this.#renamingPath == null) {
      this.#renamingValue = '';
      this.#removeRenamingPathIfCanceled = false;
    }
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
      pathCountAfter: resolvedInput.paths.length,
      pathCountBefore: previousPathCount,
      projectionChanged: true,
      usedPreparedInput: options.preparedInput != null,
      visibleCountDelta: this.#visibleCount - previousVisibleCount,
    } satisfies FileTreeResetEvent);
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

    const ancestorPaths = getAncestorDirectoryPaths(path);
    for (let index = ancestorPaths.length - 1; index >= 0; index -= 1) {
      const ancestorPath = ancestorPaths[index];
      if (ancestorPath == null) {
        continue;
      }

      const ancestorIndex = this.#getVisibleIndexByPath(ancestorPath);
      if (ancestorIndex !== -1) {
        return ancestorIndex;
      }
    }

    return this.#getCurrentVisiblePaths().length > 0 ? 0 : -1;
  }

  #getOrCreateItemHandle(
    path: string,
    itemInfo?: PathStorePathInfo
  ): FileTreeItemHandle | null {
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

  #createVisibleRow(
    row: PathStoreVisibleRowData,
    visibleIndex: number,
    projectionIndex: number,
    projection: {
      ancestorPaths: readonly string[];
      path: string;
      posInSet?: number;
      setSize?: number;
    }
  ): FileTreeVisibleRow {
    return {
      ancestorPaths: projection.ancestorPaths,
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
      isFocused: projection.path === this.#focusedPath,
      isSelected: this.#selectedPaths.has(projection.path),
      kind: row.kind,
      level: row.depth,
      name: row.name,
      path: projection.path,
      posInSet:
        projection.posInSet ??
        this.#projectionPosInSetByIndex[projectionIndex] ??
        0,
      setSize:
        projection.setSize ??
        this.#projectionSetSizeByIndex[projectionIndex] ??
        0,
    };
  }

  #createVisibleRowFromContext(
    context: PathStoreVisibleRowContext | PathStoreVisibleAncestorRow
  ): FileTreeVisibleRow {
    return this.#createVisibleRow(context.row, context.index, context.index, {
      ancestorPaths: context.ancestorPaths,
      path: context.row.path,
      posInSet: context.posInSet,
      setSize: context.setSize,
    });
  }

  #getStickyCandidateContextAt(
    index: number,
    slotDepth: number
  ): PathStoreVisibleRowContext | PathStoreVisibleAncestorRow | undefined {
    const context = this.#store.getVisibleRowContext(index);
    if (context == null) {
      return undefined;
    }

    const ancestorRow = context.ancestorRows[slotDepth];
    if (ancestorRow != null) {
      return ancestorRow;
    }

    return slotDepth === context.ancestorRows.length &&
      context.row.kind === 'directory' &&
      context.row.isExpanded
      ? context
      : undefined;
  }

  #getAncestorIndices(index: number): readonly number[] {
    const cached = this.#ancestorIndicesByIndex.get(index);
    if (cached != null) {
      return cached;
    }

    const parentIndex = this.#getParentIndexForVisibleRow(index);
    const ancestorIndices =
      parentIndex < 0
        ? []
        : [...this.#getAncestorIndices(parentIndex), parentIndex];
    this.#ancestorIndicesByIndex.set(index, ancestorIndices);
    return ancestorIndices;
  }

  #getAncestorPaths(index: number): readonly string[] {
    const cached = this.#ancestorPathsByIndex.get(index);
    if (cached != null) {
      return cached;
    }

    const ancestorPaths = this.#getAncestorIndices(index)
      .map((ancestorIndex) => this.#projectionPaths[ancestorIndex] ?? '')
      .filter((path) => path !== '');
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

  #createDirectoryHandle(path: string): FileTreeDirectoryHandle {
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

  #createFileHandle(path: string): FileTreeFileHandle {
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

  // Validate multi-item drop batches against a throwaway store first so a later
  // collision cannot partially mutate the live tree before surfacing the error.
  #validateBatchDropOperations(
    operations: readonly FileTreeBatchOperation[]
  ): void {
    const currentPaths = this.#store.list();
    const validationStore = this.#createStore(currentPaths);
    validationStore.batch(operations);
  }

  // Cancels an active bulk ingest before user-driven canonical changes so later
  // streamed checkpoints cannot overwrite the live tree. Successful mutations
  // become the next bulk seed because they are now the controller's truth.
  #runPathChangingMutation<TValue>(mutation: () => TValue): TValue {
    if (this.#loading?.mode === 'bulk') {
      this.#cancelActiveBulkIngest();
    }

    const result = mutation();

    if (this.#loading?.mode === 'bulk') {
      this.#bulkSeedPaths = this.#store.list();
      this.#syncBulkIngestIdleInfo(this.#bulkSeedPaths.length);
    }

    return result;
  }

  #resetStoreToBulkSeedPathsIfNeeded(): void {
    if (this.#loading?.mode !== 'bulk') {
      return;
    }

    const currentPaths = this.#store.list();
    if (areOrderedPathsEqual(currentPaths, this.#bulkSeedPaths)) {
      return;
    }

    this.resetPaths(this.#bulkSeedPaths, {
      initialExpandedPaths: this.#getExpandedDirectoryPaths(),
      preparedInput: preparePresortedFileTreeInput(this.#bulkSeedPaths),
    });
  }

  #syncBulkIngestIdleInfo(pathCount: number): void {
    if (this.#loading?.mode !== 'bulk') {
      return;
    }

    this.#bulkIngestInfo = {
      ingestedPathCount: pathCount,
      status: 'idle',
    };
  }

  #initializeRevealStore(store: PathStore, seedPaths: readonly string[]): void {
    if (this.#loading?.mode !== 'reveal') {
      return;
    }

    const directoryPaths = new Set<string>();
    for (const path of seedPaths) {
      if (path.endsWith('/')) {
        directoryPaths.add(path);
      }
      for (const ancestorPath of getAncestorDirectoryPaths(path)) {
        directoryPaths.add(ancestorPath);
      }
    }

    store.batch(() => {
      for (const directoryPath of directoryPaths) {
        if (store.getDirectoryLoadState(directoryPath) !== 'loaded') {
          continue;
        }
        const hasKnownDescendant = store
          .list(directoryPath)
          .some((knownPath) => knownPath !== directoryPath);
        if (hasKnownDescendant) {
          continue;
        }

        const knownChildCount =
          store.getDirectoryKnownChildCount(directoryPath);
        store.markDirectoryUnloaded(
          directoryPath,
          knownChildCount == null ? {} : { knownChildCount }
        );
      }
    });
  }

  #createStore(
    paths: readonly string[] | undefined,
    preparedInput?: FileTreePreparedInput,
    initialExpandedPathsOverride?: readonly string[]
  ): PathStore {
    return new PathStore({
      ...this.#storeOptions,
      paths: paths ?? [],
      preparedInput:
        preparedInput == null
          ? undefined
          : toPathStorePreparedInput(preparedInput),
      ...(initialExpandedPathsOverride !== undefined
        ? { initialExpandedPaths: initialExpandedPathsOverride }
        : {}),
    });
  }

  #getListedPaths(): readonly string[] {
    if (this.#listedPaths != null) {
      return this.#listedPaths;
    }

    this.#listedPaths = this.#store.list();
    return this.#listedPaths;
  }

  #emitRevealLoadingEvent(
    type: FileTreeRevealLoadingEventType,
    path: string
  ): void {
    const info = this.getRevealLoadingInfo(path);
    if (info == null) {
      return;
    }

    emitTypedListeners(this.#revealLoadingListeners, type, {
      info,
      path,
      type,
    });
  }

  #cancelRevealRequest(request: RevealRequest): void {
    request.abortController.abort();
    if (request.kind === 'batch') {
      this.#revealRunningBatches.delete(request);
    }

    const cancelledPaths: string[] = [];
    this.#store.batch((store) => {
      for (const path of getRevealRequestPaths(request)) {
        if (this.#revealInflightByPath.get(path) === request) {
          this.#revealInflightByPath.delete(path);
        }

        const pathInfo = store.getPathInfo(path);
        if (pathInfo == null || pathInfo.kind !== 'directory') {
          continue;
        }
        if (store.getDirectoryLoadState(pathInfo.path) !== 'loading') {
          continue;
        }

        const knownChildCount = store.getDirectoryKnownChildCount(
          pathInfo.path
        );
        store.markDirectoryUnloaded(
          pathInfo.path,
          knownChildCount == null ? {} : { knownChildCount }
        );
        cancelledPaths.push(pathInfo.path);
      }
    });

    for (const path of cancelledPaths) {
      this.#emitRevealLoadingEvent('cancelled', path);
    }
  }

  #warnRevealCustomSortSlowPath(): void {
    if (this.#revealCustomSortWarned) {
      return;
    }

    if (
      typeof process !== 'undefined' &&
      process.env.NODE_ENV === 'production'
    ) {
      this.#revealCustomSortWarned = true;
      return;
    }

    this.#revealCustomSortWarned = true;
    console.warn(
      'FileTree reveal loading resorts async children locally when a custom comparator is configured. This keeps async-loaded directories correct but costs extra work.'
    );
  }

  #getRevealPolicy(): {
    maxSpeculativeBatchSize: number;
    maxSpeculativeInflightRequests: number;
  } {
    const policy =
      this.#loading?.mode === 'reveal' ? this.#loading.policy : null;
    return {
      maxSpeculativeBatchSize: policy?.maxSpeculativeBatchSize ?? 8,
      maxSpeculativeInflightRequests:
        policy?.maxSpeculativeInflightRequests ?? 1,
    };
  }

  #applyRevealSnapshot(
    path: string,
    attempt: PathStoreLoadAttempt,
    snapshot: FileTreeRevealDirectorySnapshot
  ): boolean {
    const preparedSnapshot = prepareRevealDirectorySnapshot({
      directoryPath: path,
      onCustomSort: () => {
        this.#warnRevealCustomSortSlowPath();
      },
      snapshot,
      sort: this.#storeOptions.sort,
    });

    let applied = false;
    let completed = false;
    this.#store.batch((store) => {
      applied = store.applyChildPatch(attempt, {
        operations: preparedSnapshot.children.map((childPath) => ({
          path: childPath,
          type: 'add' as const,
        })),
      });
      if (!applied) {
        return;
      }

      for (const childPath of preparedSnapshot.children) {
        if (!childPath.endsWith('/')) {
          continue;
        }

        const knownChildCount =
          preparedSnapshot.childDirectoryKnownChildCountByPath.get(childPath);
        store.markDirectoryUnloaded(
          childPath,
          knownChildCount == null ? {} : { knownChildCount }
        );
      }

      completed = store.completeChildLoad(attempt);
    });

    return applied && completed;
  }

  #cancelIrrelevantRevealBatches(): void {
    for (const request of this.#revealRunningBatches) {
      const stillRelevant = request.paths.some(
        (path) =>
          request.explicitPaths.has(path) ||
          this.#revealRelevantSpeculativePaths.has(path)
      );
      if (stillRelevant) {
        continue;
      }

      this.#cancelRevealRequest(request);
    }
  }

  #pumpRevealSpeculativeBatches(): void {
    if (this.#loading?.mode !== 'reveal') {
      return;
    }

    const { maxSpeculativeBatchSize, maxSpeculativeInflightRequests } =
      this.#getRevealPolicy();
    while (this.#revealRunningBatches.size < maxSpeculativeInflightRequests) {
      const nextPaths: string[] = [];
      for (const path of this.#revealQueuedSpeculativePaths) {
        if (!this.#revealRelevantSpeculativePaths.has(path)) {
          this.#revealQueuedSpeculativePaths.delete(path);
          continue;
        }
        if (this.#revealInflightByPath.has(path)) {
          this.#revealQueuedSpeculativePaths.delete(path);
          continue;
        }
        if (this.#store.getDirectoryLoadState(path) !== 'unloaded') {
          this.#revealQueuedSpeculativePaths.delete(path);
          continue;
        }

        nextPaths.push(path);
        this.#revealQueuedSpeculativePaths.delete(path);
        if (nextPaths.length >= maxSpeculativeBatchSize) {
          break;
        }
      }

      if (nextPaths.length === 0) {
        return;
      }

      void this.#startRevealSpeculativeBatch(nextPaths);
    }
  }

  async #startRevealSpeculativeBatch(paths: readonly string[]): Promise<void> {
    if (this.#loading?.mode !== 'reveal' || paths.length === 0) {
      return;
    }

    const attemptsByPath = new Map<string, PathStoreLoadAttempt>();
    for (const path of paths) {
      const pathInfo = this.#store.getPathInfo(path);
      if (pathInfo == null || pathInfo.kind !== 'directory') {
        continue;
      }
      if (this.#store.getDirectoryLoadState(pathInfo.path) !== 'unloaded') {
        continue;
      }

      const attempt = this.#store.beginChildLoad(pathInfo.path);
      if (attempt.reused) {
        continue;
      }
      attemptsByPath.set(pathInfo.path, attempt);
    }

    if (attemptsByPath.size === 0) {
      return;
    }

    const request: RevealBatchRequest = {
      abortController: new AbortController(),
      attemptsByPath,
      explicitPaths: new Set(),
      kind: 'batch',
      paths: [...attemptsByPath.keys()],
    };
    this.#revealRunningBatches.add(request);
    for (const path of request.paths) {
      this.#revealInflightByPath.set(path, request);
      this.#emitRevealLoadingEvent('started', path);
    }

    try {
      const results = await this.#loading.source.loadDirectories(
        request.paths,
        request.abortController.signal
      );
      if (request.abortController.signal.aborted) {
        return;
      }
      if (results.length !== request.paths.length) {
        throw new Error(
          `Reveal batch result length mismatch. Expected ${String(request.paths.length)} result entries, received ${String(results.length)}.`
        );
      }

      request.paths.forEach((path, index) => {
        const attempt = request.attemptsByPath.get(path);
        const result = results[index];
        if (attempt == null || result == null) {
          return;
        }

        if ('errorMessage' in result) {
          const failed = this.#store.failChildLoad(
            attempt,
            result.errorMessage
          );
          if (failed) {
            this.#emitRevealLoadingEvent('failed', path);
          }
          if (this.#revealInflightByPath.get(path) === request) {
            this.#revealInflightByPath.delete(path);
          }
          if (request.explicitPaths.has(path)) {
            void this.#startRevealExplicitLoad(path);
          }
          return;
        }

        if (this.#applyRevealSnapshot(path, attempt, result.snapshot)) {
          this.#emitRevealLoadingEvent('completed', path);
        }
        if (this.#revealInflightByPath.get(path) === request) {
          this.#revealInflightByPath.delete(path);
        }
      });
    } catch (error) {
      if (!request.abortController.signal.aborted) {
        const errorMessage = toErrorMessage(error);
        for (const path of request.paths) {
          const attempt = request.attemptsByPath.get(path);
          if (attempt == null) {
            continue;
          }

          const failed = this.#store.failChildLoad(attempt, errorMessage);
          if (failed) {
            this.#emitRevealLoadingEvent('failed', path);
          }
          if (this.#revealInflightByPath.get(path) === request) {
            this.#revealInflightByPath.delete(path);
          }
          if (request.explicitPaths.has(path)) {
            void this.#startRevealExplicitLoad(path);
          }
        }
      }
    } finally {
      this.#revealRunningBatches.delete(request);
      for (const path of request.paths) {
        if (this.#revealInflightByPath.get(path) === request) {
          this.#revealInflightByPath.delete(path);
        }
      }
      this.#pumpRevealSpeculativeBatches();
    }
  }

  async #startRevealExplicitLoad(path: string): Promise<void> {
    if (this.#loading?.mode !== 'reveal') {
      return;
    }

    const pathInfo = this.#store.getPathInfo(path);
    if (pathInfo == null || pathInfo.kind !== 'directory') {
      return;
    }

    const canonicalPath = pathInfo.path;
    const existingRequest = this.#revealInflightByPath.get(canonicalPath);
    if (existingRequest != null) {
      if (existingRequest.kind === 'batch') {
        existingRequest.explicitPaths.add(canonicalPath);
      }
      return;
    }

    const loadState = this.#store.getDirectoryLoadState(canonicalPath);
    if (loadState === 'loaded' || loadState === 'loading') {
      return;
    }

    this.#revealQueuedSpeculativePaths.delete(canonicalPath);
    const attempt = this.#store.beginChildLoad(canonicalPath);
    const request: RevealSingleRequest = {
      abortController: new AbortController(),
      attempt,
      kind: 'single',
      path: canonicalPath,
    };
    this.#revealInflightByPath.set(canonicalPath, request);
    if (!attempt.reused) {
      this.#emitRevealLoadingEvent('started', canonicalPath);
    }

    try {
      const snapshot = await this.#loading.source.loadDirectory(
        canonicalPath,
        request.abortController.signal
      );
      if (request.abortController.signal.aborted) {
        return;
      }
      if (this.#applyRevealSnapshot(canonicalPath, attempt, snapshot)) {
        this.#emitRevealLoadingEvent('completed', canonicalPath);
      }
    } catch (error) {
      if (!request.abortController.signal.aborted) {
        const failed = this.#store.failChildLoad(
          attempt,
          toErrorMessage(error)
        );
        if (failed) {
          this.#emitRevealLoadingEvent('failed', canonicalPath);
        }
      }
    } finally {
      if (this.#revealInflightByPath.get(canonicalPath) === request) {
        this.#revealInflightByPath.delete(canonicalPath);
      }
      this.#pumpRevealSpeculativeBatches();
    }
  }

  #scheduleRevealSpeculativeReconcile(): void {
    if (this.#revealSpeculativeReconcileScheduled) {
      return;
    }

    this.#revealSpeculativeReconcileScheduled = true;
    queueMicrotask(() => {
      this.#revealSpeculativeReconcileScheduled = false;
      this.#cancelIrrelevantRevealBatches();
      this.#pumpRevealSpeculativeBatches();
    });
  }

  #updateRevealSpeculativeWindow(rows: readonly FileTreeVisibleRow[]): void {
    if (this.#loading?.mode !== 'reveal') {
      return;
    }

    const nextRelevantPaths = new Set<string>();
    for (const row of rows) {
      if (row.kind !== 'directory') {
        continue;
      }
      if (this.#store.getDirectoryLoadState(row.path) === 'unloaded') {
        nextRelevantPaths.add(row.path);
      }
    }

    this.#revealRelevantSpeculativePaths = nextRelevantPaths;
    for (const path of this.#revealQueuedSpeculativePaths) {
      if (!nextRelevantPaths.has(path)) {
        this.#revealQueuedSpeculativePaths.delete(path);
      }
    }

    for (const path of nextRelevantPaths) {
      if (
        this.#revealInflightByPath.has(path) ||
        this.#revealQueuedSpeculativePaths.has(path) ||
        this.#store.getDirectoryLoadState(path) !== 'unloaded'
      ) {
        continue;
      }

      this.#revealQueuedSpeculativePaths.add(path);
    }

    this.#scheduleRevealSpeculativeReconcile();
  }

  #emitBulkIngestEvent(type: FileTreeBulkIngestEventType): void {
    if (this.#bulkIngestInfo == null) {
      return;
    }

    emitTypedListeners(this.#bulkIngestListeners, type, {
      info: { ...this.#bulkIngestInfo },
      type,
    });
  }

  #cancelActiveBulkIngest(): void {
    if (
      this.#loading?.mode !== 'bulk' ||
      this.#bulkIngestAbortController == null
    ) {
      return;
    }

    const abortController = this.#bulkIngestAbortController;
    this.#bulkIngestAbortController = null;
    abortController.abort();
    if (this.#bulkIngestInfo?.status === 'ingesting') {
      this.#bulkIngestInfo = {
        ...this.#bulkIngestInfo,
        ingestedPathCount: this.#store.list().length,
        status: 'cancelled',
      };
      this.#emitBulkIngestEvent('cancelled');
    }
  }

  #publishBulkCheckpoint(
    preparedInput: PathStorePreparedInput,
    ingestedPathCount: number
  ): void {
    this.#store.appendPreparedInput(preparedInput);

    if (this.#bulkIngestInfo != null) {
      this.#bulkIngestInfo = {
        ...this.#bulkIngestInfo,
        ingestedPathCount,
        status: 'ingesting',
      };
      this.#emitBulkIngestEvent('progressed');
    }
  }

  async #runBulkIngest(
    runId: number,
    abortController: AbortController
  ): Promise<void> {
    const loading = this.#loading;
    if (loading?.mode !== 'bulk') {
      return;
    }

    let pendingBuilder = new PathStorePreparedInputBuilder(this.#storeOptions);
    const checkpointPathCountCeiling =
      loading.policy?.checkpointPathCountCeiling;
    const checkpointTimeBudgetMs = loading.policy?.checkpointTimeBudgetMs ?? 16;
    let publishedPathCount = this.#bulkSeedPaths.length;
    let ingestedPathCount = this.#bulkSeedPaths.length;
    let lastPublishTime = now();
    let pendingPathCount = 0;
    let totalPathCount: number | undefined;

    try {
      const session = await loading.source.openSession(abortController.signal);
      if (
        this.#bulkIngestRunId !== runId ||
        this.#bulkIngestAbortController !== abortController
      ) {
        return;
      }

      totalPathCount = session.header.totalPathCount;
      if (totalPathCount != null) {
        if (
          !Number.isInteger(totalPathCount) ||
          totalPathCount < ingestedPathCount
        ) {
          throw new Error(
            `Bulk ingest totalPathCount must be an integer >= the seed path count. Received: ${String(totalPathCount)}`
          );
        }
        if (this.#bulkIngestInfo != null) {
          this.#bulkIngestInfo = {
            ...this.#bulkIngestInfo,
            totalPathCount,
          };
          this.#emitBulkIngestEvent('progressed');
        }
      }

      for await (const chunk of session.chunks) {
        if (
          this.#bulkIngestRunId !== runId ||
          this.#bulkIngestAbortController !== abortController
        ) {
          return;
        }

        pendingBuilder.appendPresortedPaths(chunk.paths);
        ingestedPathCount += chunk.paths.length;
        pendingPathCount += chunk.paths.length;
        if (totalPathCount != null && ingestedPathCount > totalPathCount) {
          throw new Error(
            `Bulk ingest exceeded totalPathCount. Received ${String(ingestedPathCount)} paths for a total of ${String(totalPathCount)}.`
          );
        }

        const elapsedMs = now() - lastPublishTime;
        if (
          elapsedMs >= checkpointTimeBudgetMs ||
          (checkpointPathCountCeiling != null &&
            pendingPathCount >= checkpointPathCountCeiling)
        ) {
          this.#publishBulkCheckpoint(
            pendingBuilder.build(),
            ingestedPathCount
          );
          pendingBuilder = new PathStorePreparedInputBuilder(
            this.#storeOptions
          );
          publishedPathCount = ingestedPathCount;
          pendingPathCount = 0;
          lastPublishTime = now();
        }
      }

      if (
        this.#bulkIngestRunId !== runId ||
        this.#bulkIngestAbortController !== abortController
      ) {
        return;
      }

      if (pendingPathCount > 0) {
        this.#publishBulkCheckpoint(pendingBuilder.build(), ingestedPathCount);
        publishedPathCount = ingestedPathCount;
      }
      if (totalPathCount != null && ingestedPathCount !== totalPathCount) {
        throw new Error(
          `Bulk ingest completed with ${String(ingestedPathCount)} paths but expected ${String(totalPathCount)}.`
        );
      }

      this.#bulkIngestAbortController = null;
      this.#bulkIngestInfo = {
        ...(totalPathCount == null ? {} : { totalPathCount }),
        ingestedPathCount,
        status: 'completed',
      };
      this.#emitBulkIngestEvent('completed');
    } catch (error) {
      if (abortController.signal.aborted || this.#bulkIngestRunId !== runId) {
        return;
      }

      this.#bulkIngestAbortController = null;
      this.#bulkIngestInfo = {
        errorMessage: toErrorMessage(error),
        ...(totalPathCount == null ? {} : { totalPathCount }),
        ingestedPathCount: publishedPathCount,
        status: 'failed',
      };
      this.#emitBulkIngestEvent('failed');
    } finally {
      if (
        this.#bulkIngestAbortController === abortController &&
        abortController.signal.aborted
      ) {
        this.#bulkIngestAbortController = null;
      }
    }
  }

  #getAllKnownPaths(): readonly string[] {
    if (this.#knownPaths != null) {
      return this.#knownPaths;
    }

    const knownPaths = new Set<string>();
    for (const path of this.#getListedPaths()) {
      knownPaths.add(path);
      for (const ancestorPath of getAncestorDirectoryPaths(path)) {
        knownPaths.add(ancestorPath);
      }
    }

    this.#knownPaths = [...knownPaths].sort();
    return this.#knownPaths;
  }

  // Cache lowercased path keys once so incremental search does not re-normalize
  // every file and directory path on each keystroke.
  #getListedPathsLowerCase(): readonly string[] {
    if (this.#listedPathsLowerCase != null) {
      return this.#listedPathsLowerCase;
    }

    this.#listedPathsLowerCase = this.#getListedPaths().map(
      toLowerCaseSearchPath
    );
    return this.#listedPathsLowerCase;
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

  #getAllKnownDirectoryPathsLowerCase(): readonly string[] {
    if (this.#knownDirectoryPathsLowerCase != null) {
      return this.#knownDirectoryPathsLowerCase;
    }

    this.#knownDirectoryPathsLowerCase = this.#getAllKnownDirectoryPaths().map(
      toLowerCaseSearchPath
    );
    return this.#knownDirectoryPathsLowerCase;
  }

  #invalidateKnownPathCaches(): void {
    this.#knownDirectoryPaths = null;
    this.#knownDirectoryPathsLowerCase = null;
    this.#knownPaths = null;
    this.#listedPaths = null;
    this.#listedPathsLowerCase = null;
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
    if (this.#searchValue == null || this.#searchValue.length === 0) {
      this.#searchMatchingPaths = [];
      this.#searchVisibleIndices = null;
      this.#searchVisiblePaths = null;
      this.#searchVisibleIndexByPath = null;
      this.#visibleCount = this.#storeVisibleCount;
      return;
    }

    const currentVisiblePaths = this.#projectionPaths;
    this.#searchMatchingPaths = currentVisiblePaths.filter((path) =>
      this.#searchMatchPathSet.has(path)
    );

    if (
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
    const searchIndex = this.#searchVisibleIndexByPath?.get(path);
    if (searchIndex != null) {
      return searchIndex;
    }

    return this.#store.getVisibleIndex(path) ?? -1;
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
    const normalizedValue = value == null ? null : normalizeSearchQuery(value);
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

    const searchValue = this.#searchValue;
    const listedPaths = this.#getListedPaths();
    const listedPathsLowerCase = this.#getListedPathsLowerCase();
    const matchingPaths: string[] = [];
    const matchingPathSet = new Set<string>();
    let focusCandidate: string | null = null;

    for (let index = 0; index < listedPaths.length; index += 1) {
      const lowerPath = listedPathsLowerCase[index];
      if (!lowerPath.includes(searchValue)) {
        continue;
      }

      const path = listedPaths[index];
      matchingPaths.push(path);
      matchingPathSet.add(path);
      focusCandidate ??= path;
    }

    const knownDirectoryPaths = this.#getAllKnownDirectoryPaths();
    const knownDirectoryPathsLowerCase =
      this.#getAllKnownDirectoryPathsLowerCase();
    for (let index = 0; index < knownDirectoryPaths.length; index += 1) {
      const lowerPath = knownDirectoryPathsLowerCase[index];
      if (!lowerPath.includes(searchValue)) {
        continue;
      }

      const path = knownDirectoryPaths[index];
      if (matchingPathSet.has(path)) {
        continue;
      }

      matchingPaths.push(path);
      matchingPathSet.add(path);
      focusCandidate ??= path;
    }

    this.#searchMatchPathSet = matchingPathSet;
    const searchVisiblePathSet =
      this.#searchMode === 'hide-non-matches' && matchingPaths.length > 0
        ? new Set<string>()
        : null;
    this.#searchVisiblePathSet = searchVisiblePathSet;
    const expandedPaths =
      this.#searchMode === 'expand-matches'
        ? new Set(this.#searchPreviousExpandedPaths ?? [])
        : new Set<string>();

    for (const matchingPath of matchingPaths) {
      if (searchVisiblePathSet != null) {
        searchVisiblePathSet.add(matchingPath);
      }
      if (matchingPath.endsWith('/')) {
        expandedPaths.add(matchingPath);
      }
      for (const ancestorPath of getAncestorDirectoryPaths(matchingPath)) {
        expandedPaths.add(ancestorPath);
        if (searchVisiblePathSet != null) {
          searchVisiblePathSet.add(ancestorPath);
        }
      }
    }

    this.#setExpandedPaths(expandedPaths);
    return focusCandidate ?? this.#focusedPath;
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #emitMutation(event: FileTreeMutationEvent): void {
    emitTypedListeners(this.#mutationListeners, event.operation, event);
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
    void this.#startRevealExplicitLoad(path);
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
    const projectionData = this.#store.getVisibleTreeProjectionData(
      full ? undefined : Math.min(rawVisibleCount, INITIAL_PROJECTION_ROW_LIMIT)
    );
    const projection = createVisibleProjection(
      projectionData,
      focusedPathCandidate,
      full ? (path) => this.#store.getVisibleIndex(path) : undefined
    );
    this.#ancestorIndicesByIndex.clear();
    this.#ancestorPathsByIndex.clear();
    this.#hasFullProjection = projection.paths.length >= rawVisibleCount;
    this.#getParentIndexForVisibleRow = projection.getParentIndex;
    this.#projectionPaths = projection.paths;
    this.#projectionPosInSetByIndex = projection.posInSetByIndex;
    this.#projectionSetSizeByIndex = projection.setSizeByIndex;
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
        : this.#resolveVisiblePathAtIndex(this.#focusedIndex);
  }

  #resolveVisiblePathAtIndex(index: number): string | null {
    const projectedPath = this.#getCurrentVisiblePaths()[index];
    if (projectedPath != null) {
      return projectedPath;
    }

    if (this.#searchVisibleIndices != null) {
      return null;
    }

    return this.#store.getVisibleRowContext(index)?.row.path ?? null;
  }

  #resolveSelectionPath(path: string): string | null {
    return this.#store.getPathInfo(path)?.path ?? null;
  }

  #focusPathWithoutEmit(path: string | null): void {
    if (path == null) {
      return;
    }

    const nextFocusedIndex = this.#resolveFocusedIndex(path);
    if (nextFocusedIndex >= 0) {
      this.#setFocusedIndex(nextFocusedIndex, false);
    }
  }

  #setFocusedIndex(index: number, emit: boolean = true): void {
    const nextPath = this.#resolveVisiblePathAtIndex(index);
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
    const nextRenamingPath = remapPathThroughMutation(
      this.#renamingPath,
      event
    );
    if (nextRenamingPath == null && this.#renamingPath != null) {
      this.#renamingValue = '';
    }
    this.#renamingPath = nextRenamingPath;
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
      if (this.#dragSession != null && isPathMutationEvent(event)) {
        this.#dragSession = null;
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
      const shouldBuildFullProjection =
        this.#searchValue != null ||
        (event.operation !== 'expand' && event.operation !== 'collapse');
      this.#rebuildVisibleProjection(
        searchFocusCandidate,
        shouldBuildFullProjection
      );
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
