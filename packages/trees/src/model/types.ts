import type {
  PathStoreConstructorOptions,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreRemoveOptions,
} from '@pierre/path-store';

import type { FileTreeIcons, RemappedIcon } from '../iconConfig';
import type { FileTreePreparedInput } from '../preparedInput';
import type {
  ContextMenuAnchorRect,
  GitStatus,
  GitStatusEntry,
} from '../types';

/**
 * The provisional public identity stays path-first so later phases can evolve
 * internal row bookkeeping without freezing the underlying path-store numeric
 * IDs.
 */
export type FileTreePublicId = string;
type FileTreeStoreOptions = Omit<
  PathStoreConstructorOptions,
  'paths' | 'preparedInput'
>;

type FileTreeInputOptions =
  | {
      paths: readonly string[];
      preparedInput?: FileTreePreparedInput;
    }
  | {
      paths?: readonly string[];
      preparedInput: FileTreePreparedInput;
    };

type FileTreeControllerBehaviorOptions = FileTreeStoreOptions & {
  dragAndDrop?: boolean | FileTreeDragAndDropConfig;
  fileTreeSearchMode?: FileTreeSearchMode;
  initialSearchQuery?: string | null;
  initialSelectedPaths?: readonly string[];
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
  itemHeight?: number;
  overscan?: number;
  viewportHeight?: number;
}

export type FileTreeSearchMode =
  | 'expand-matches'
  | 'collapse-non-matches'
  | 'hide-non-matches';

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
  gitStatus?: readonly GitStatusEntry[];
  id?: string;
  icons?: FileTreeIcons;
  onSelectionChange?: FileTreeSelectionChangeListener;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  search?: boolean;
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

export interface FileTreeViewProps extends FileTreeRenderOptions {
  composition?: FileTreeCompositionOptions;
  controller: import('./FileTreeController').FileTreeController;
  directoriesWithGitChanges?: ReadonlySet<FileTreePublicId>;
  gitStatusByPath?: ReadonlyMap<FileTreePublicId, GitStatus>;
  ignoredGitDirectories?: ReadonlySet<FileTreePublicId>;
  icons?: FileTreeIcons;
  instanceId?: string;
  renamingEnabled?: boolean;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  searchEnabled?: boolean;
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
  initialExpandedPaths?: readonly string[];
  // Must describe the same path list passed to resetPaths(paths, ...).
  preparedInput?: FileTreePreparedInput;
}

export interface FileTreeMutationHandle {
  add(path: FileTreePublicId): void;
  batch(operations: readonly PathStoreOperation[]): void;
  move(
    fromPath: FileTreePublicId,
    toPath: FileTreePublicId,
    options?: PathStoreMoveOptions
  ): void;
  onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void
  ): () => void;
  remove(path: FileTreePublicId, options?: PathStoreRemoveOptions): void;
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
