import type { FileTreeIcons, RemappedIcon } from '../iconConfig';
import type { FileTreePreparedInput } from '../preparedInput';
import type {
  ContextMenuAnchorRect,
  GitStatus,
  GitStatusEntry,
} from '../types';
import type { FileTreeDensity } from './density';

/**
 * The provisional public identity stays path-first so later phases can evolve
 * internal row bookkeeping without freezing the underlying path-store numeric
 * IDs.
 */
export type FileTreePublicId = string;

// The types below intentionally duplicate shapes from `@pierre/path-store`
// (PathStoreCompareEntry, PathStorePathComparator, PathStoreInitialExpansion,
// PathStoreRemoveOptions, PathStoreCollisionStrategy, PathStoreMoveOptions,
// PathStoreOperation, and the relevant PathStoreConstructorOptions fields).
//
// They are NOT re-exports. Keeping a parallel set of `FileTree*` types lets
// `@pierre/trees` present a self-contained public API: consumers never need to
// import from `@pierre/path-store` to call `controller.batch(...)`,
// `controller.move(...)`, etc. Path-store remains a runtime dependency but is
// not part of the documented surface.
//
// Trade-off: there is no compile-time link between the two. If `path-store`
// changes one of these shapes, update the matching `FileTree*` type here by
// hand. The structural equivalence is exercised in tests via the values that
// flow between the two layers.

export interface FileTreeSortEntry {
  basename: string;
  depth: number;
  isDirectory: boolean;
  path: FileTreePublicId;
  segments: readonly string[];
}

export type FileTreeSortComparator = (
  left: FileTreeSortEntry,
  right: FileTreeSortEntry
) => number;

export type FileTreeInitialExpansion = 'closed' | 'open' | number;

export interface FileTreeRemoveOptions {
  recursive?: boolean;
}

export type FileTreeCollisionStrategy = 'error' | 'replace' | 'skip';

export interface FileTreeMoveOptions {
  collision?: FileTreeCollisionStrategy;
}

export type FileTreeBatchOperation =
  | { path: FileTreePublicId; type: 'add' }
  | ({ path: FileTreePublicId; type: 'remove' } & FileTreeRemoveOptions)
  | ({
      from: FileTreePublicId;
      to: FileTreePublicId;
      type: 'move';
    } & FileTreeMoveOptions);

// Mirrors the subset of PathStoreConstructorOptions that trees forwards to its
// underlying store. See the duplication note above the FileTree* type cluster.
interface FileTreeStoreOptions {
  flattenEmptyDirectories?: boolean;
  initialExpansion?: FileTreeInitialExpansion;
  initialExpandedPaths?: readonly FileTreePublicId[];
  presorted?: boolean;
  sort?: 'default' | FileTreeSortComparator;
}

type FileTreeInputOptions =
  | {
      paths: readonly FileTreePublicId[];
      preparedInput?: FileTreePreparedInput;
    }
  | {
      paths?: readonly FileTreePublicId[];
      preparedInput: FileTreePreparedInput;
    };

type FileTreeControllerBehaviorOptions = FileTreeStoreOptions & {
  dragAndDrop?: boolean | FileTreeDragAndDropConfig;
  fileTreeSearchMode?: FileTreeSearchMode;
  initialSearchQuery?: string | null;
  initialSelectedPaths?: readonly FileTreePublicId[];
  onSearchChange?: FileTreeSearchChangeListener;
  renaming?: boolean | FileTreeRenamingConfig;
};

export type FileTreeControllerOptions = FileTreeControllerBehaviorOptions &
  FileTreeInputOptions;

export interface FileTreeVisibleSegment {
  isTerminal: boolean;
  name: string;
  path: FileTreePublicId;
}

export interface FileTreeVisibleRow {
  ancestorPaths: readonly FileTreePublicId[];
  depth: number;
  flattenedSegments?: readonly FileTreeVisibleSegment[];
  hasChildren: boolean;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  level: number;
  name: string;
  path: FileTreePublicId;
  posInSet: number;
  setSize: number;
}

export interface FileTreeItemHandleBase {
  deselect(): void;
  focus(): void;
  getPath(): FileTreePublicId;
  isFocused(): boolean;
  isDirectory(): boolean;
  isSelected(): boolean;
  select(): void;
  toggleSelect(): void;
}

export interface FileTreeDirectoryHandle extends FileTreeItemHandleBase {
  collapse(): void;
  expand(): void;
  isDirectory(): true;
  isExpanded(): boolean;
  toggle(): void;
}

export interface FileTreeFileHandle extends FileTreeItemHandleBase {
  isDirectory(): false;
}

export type FileTreeItemHandle = FileTreeDirectoryHandle | FileTreeFileHandle;

export interface FileTreeRenderOptions {
  // Hint how many rows should fit in the first render before the browser can
  // measure the real scroll viewport. Fractional values are allowed when the
  // desired first-render budget is not an exact multiple of itemHeight.
  initialVisibleRowCount?: number;
  itemHeight?: number;
  overscan?: number;
  stickyFolders?: boolean;
}

export type FileTreeSearchMode =
  | 'expand-matches'
  | 'collapse-non-matches'
  | 'hide-non-matches';

// Controls what happens to the search session when the search input loses
// focus. `'close'` (the default, and the legacy behavior) clears the query and
// closes the search session as soon as the input is blurred. `'retain'` keeps
// the current query and leaves the session open, so the filter stays applied
// until the caller explicitly closes it (via Escape, Enter, or a programmatic
// `closeSearch()`). `'retain'` is useful for trees mounted with an
// `initialSearchQuery` that should survive concurrent siblings stealing focus
// during mount.
export type FileTreeSearchBlurBehavior = 'close' | 'retain';

export type FileTreeSearchChangeListener = (value: string | null) => void;

export interface FileTreeSearchSessionHandle {
  closeSearch(): void;
  focusNextSearchMatch(): void;
  focusPreviousSearchMatch(): void;
  getSearchMatchingPaths(): readonly FileTreePublicId[];
  getSearchValue(): string;
  isSearchOpen(): boolean;
  openSearch(initialValue?: string): void;
  setSearch(value: string | null): void;
}

export interface FileTreeDropTarget {
  directoryPath: FileTreePublicId | null;
  flattenedSegmentPath: FileTreePublicId | null;
  hoveredPath: FileTreePublicId | null;
  kind: 'directory' | 'root';
}

export interface FileTreeDropContext {
  draggedPaths: readonly FileTreePublicId[];
  target: FileTreeDropTarget;
}

export interface FileTreeDropResult extends FileTreeDropContext {
  operation: 'batch' | 'move';
}

export interface FileTreeDragAndDropConfig {
  canDrag?: (paths: readonly FileTreePublicId[]) => boolean;
  canDrop?: (event: FileTreeDropContext) => boolean;
  onDropComplete?: (event: FileTreeDropResult) => void;
  onDropError?: (error: string, event: FileTreeDropContext) => void;
  openOnDropDelay?: number;
}

export interface FileTreeRenamingItem {
  isFolder: boolean;
  path: FileTreePublicId;
}

export interface FileTreeRenameEvent {
  destinationPath: FileTreePublicId;
  isFolder: boolean;
  sourcePath: FileTreePublicId;
}

export interface FileTreeRenamingConfig {
  canRename?: (item: FileTreeRenamingItem) => boolean;
  onError?: (error: string) => void;
  onRename?: (event: FileTreeRenameEvent) => void;
}

type FileTreeOptionSurface = FileTreeRenderOptions & {
  composition?: FileTreeCompositionOptions;
  density?: FileTreeDensity;
  gitStatus?: readonly GitStatusEntry[];
  id?: string;
  icons?: FileTreeIcons;
  onSelectionChange?: FileTreeSelectionChangeListener;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  search?: boolean;
  // When `true`, renders the search input with a synthetic focus ring so the
  // input looks focused even though no browser focus is attached. The ring is
  // dismissed automatically on the first real interaction with the input
  // (focus, pointer down, or input). Intended for demos and marketing pages
  // that pre-populate an `initialSearchQuery` and want the visual to match a
  // focused state without stealing real focus from siblings.
  searchFakeFocus?: boolean;
  searchBlurBehavior?: FileTreeSearchBlurBehavior;
  unsafeCSS?: string;
};

export type FileTreeOptions = FileTreeControllerOptions & FileTreeOptionSurface;

export interface FileTreeViewportMetrics {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface FileTreeRange {
  end: number;
  start: number;
}

export interface FileTreeStickyWindowLayout {
  offsetHeight: number;
  stickyInset: number;
  totalHeight: number;
  windowHeight: number;
}

export interface FileTreeViewProps extends Omit<
  FileTreeRenderOptions,
  'initialVisibleRowCount'
> {
  composition?: FileTreeCompositionOptions;
  controller: import('./FileTreeController').FileTreeController;
  directoriesWithGitChanges?: ReadonlySet<FileTreePublicId>;
  gitStatusByPath?: ReadonlyMap<FileTreePublicId, GitStatus>;
  ignoredGitDirectories?: ReadonlySet<FileTreePublicId>;
  icons?: FileTreeIcons;
  // First-render viewport height in CSS pixels, used as the fallback when the
  // scroll element's clientHeight is still zero. The public option is
  // `initialVisibleRowCount` (rows); the resolver multiplies it by itemHeight
  // before passing the pixel value down here.
  initialViewportHeight?: number;
  instanceId?: string;
  renamingEnabled?: boolean;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  searchBlurBehavior?: FileTreeSearchBlurBehavior;
  searchEnabled?: boolean;
  searchFakeFocus?: boolean;
  slotHost?: FileTreeSlotHost;
}

export interface FileTreeRenderProps {
  containerWrapper?: HTMLElement;
  fileTreeContainer?: HTMLElement;
}

export interface FileTreeHydrationProps {
  fileTreeContainer: HTMLElement;
}

export interface FileTreeSsrPayload {
  domOuterStart: string;
  id: string;
  outerEnd: string;
  outerStart: string;
  shadowHtml: string;
}

export interface FileTreeMutationEventInvalidation {
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
}

export interface FileTreeAddEvent extends FileTreeMutationEventInvalidation {
  operation: 'add';
  path: FileTreePublicId;
}

export interface FileTreeRemoveEvent extends FileTreeMutationEventInvalidation {
  operation: 'remove';
  path: FileTreePublicId;
  recursive: boolean;
}

export interface FileTreeMoveEvent extends FileTreeMutationEventInvalidation {
  from: FileTreePublicId;
  operation: 'move';
  to: FileTreePublicId;
}

export interface FileTreeResetEvent extends FileTreeMutationEventInvalidation {
  operation: 'reset';
  pathCountAfter: number;
  pathCountBefore: number;
  usedPreparedInput: boolean;
}

export type FileTreeMutationSemanticEvent =
  | FileTreeAddEvent
  | FileTreeRemoveEvent
  | FileTreeMoveEvent
  | FileTreeResetEvent;

export interface FileTreeBatchEvent extends FileTreeMutationEventInvalidation {
  events: readonly FileTreeMutationSemanticEvent[];
  operation: 'batch';
}

export type FileTreeMutationEvent =
  | FileTreeMutationSemanticEvent
  | FileTreeBatchEvent;

export type FileTreeMutationEventType = FileTreeMutationEvent['operation'];

export type FileTreeMutationEventForType<
  TType extends FileTreeMutationEventType | '*',
> = TType extends '*'
  ? FileTreeMutationEvent
  : Extract<FileTreeMutationEvent, { operation: TType }>;

export interface FileTreeResetOptions {
  // When provided, replaces the baseline expansion set stored at construction
  // time. Useful when the caller is swapping in a dramatically different path
  // list (e.g. upgrading from an SSR preview to a full dataset) and wants the
  // fresh store to start with expansion state that reflects the new paths.
  initialExpandedPaths?: readonly FileTreePublicId[];
  // Must describe the same path list passed to resetPaths(paths, ...).
  preparedInput?: FileTreePreparedInput;
}

export interface FileTreeMutationHandle {
  add(path: FileTreePublicId): void;
  batch(operations: readonly FileTreeBatchOperation[]): void;
  move(
    fromPath: FileTreePublicId,
    toPath: FileTreePublicId,
    options?: FileTreeMoveOptions
  ): void;
  onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void
  ): () => void;
  remove(path: FileTreePublicId, options?: FileTreeRemoveOptions): void;
  resetPaths(
    paths: readonly FileTreePublicId[],
    options?: FileTreeResetOptions
  ): void;
}

export type FileTreeControllerListener = () => void;

export type FileTreeListener = () => void;

export type FileTreeSelectionChangeListener = (
  selectedPaths: readonly FileTreePublicId[]
) => void;

export interface FileTreeContextMenuItem {
  kind: 'directory' | 'file';
  name: string;
  path: FileTreePublicId;
}

export interface FileTreeContextMenuOpenContext {
  anchorElement: HTMLElement;
  anchorRect: ContextMenuAnchorRect;
  /**
   * Closes the current context menu. Pass `{ restoreFocus: false }` when the
   * caller is about to transfer focus into another owned surface, such as the
   * inline rename input, so the menu close path does not steal focus back to
   * the row first.
   */
  close: (options?: { restoreFocus?: boolean }) => void;
  restoreFocus: () => void;
}

export interface FileTreeHeaderCompositionOptions {
  html?: string;
  render?: () => HTMLElement | null;
}

export type FileTreeContextMenuTriggerMode = 'both' | 'button' | 'right-click';
export type FileTreeContextMenuButtonVisibility = 'always' | 'when-needed';

export interface FileTreeContextMenuCompositionOptions {
  enabled?: boolean;
  triggerMode?: FileTreeContextMenuTriggerMode;
  buttonVisibility?: FileTreeContextMenuButtonVisibility;
  onOpen?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => void;
  onClose?: () => void;
  /**
   * If the interactive menu surface renders through a portal instead of inside
   * the returned element, mark that portaled root with
   * `data-file-tree-context-menu-root="true"` so internal clicks are not
   * treated as outside clicks.
   */
  render?: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => HTMLElement | null;
}

export interface FileTreeCompositionOptions {
  contextMenu?: FileTreeContextMenuCompositionOptions;
  header?: FileTreeHeaderCompositionOptions;
}

export interface FileTreeRowDecorationText {
  text: string;
  title?: string;
}

export interface FileTreeRowDecorationIcon {
  icon: RemappedIcon;
  title?: string;
}

export type FileTreeRowDecoration =
  | FileTreeRowDecorationText
  | FileTreeRowDecorationIcon;

export interface FileTreeRowDecorationContext {
  item: FileTreeContextMenuItem;
  row: FileTreeVisibleRow;
}

export type FileTreeRowDecorationRenderer = (
  context: FileTreeRowDecorationContext
) => FileTreeRowDecoration | null;

export interface FileTreeSlotHost {
  clearSlotContent(slotName: string): void;
  setSlotContent(slotName: string, content: HTMLElement | null): void;
}
