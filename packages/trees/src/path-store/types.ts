import type {
  PathStoreConstructorOptions,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStorePreparedInput,
  PathStoreRemoveOptions,
} from '@pierre/path-store';

import type { FileTreeIcons, RemappedIcon } from '../iconConfig';
import type { ContextMenuAnchorRect } from '../types';

/**
 * The provisional public identity stays path-first so later phases can evolve
 * internal row bookkeeping without freezing path-store numeric IDs.
 */
export type PathStoreTreesPublicId = string;

export interface PathStoreTreesControllerOptions extends PathStoreConstructorOptions {
  paths: readonly string[];
}

export interface PathStoreTreesVisibleSegment {
  isTerminal: boolean;
  name: string;
  path: PathStoreTreesPublicId;
}

export interface PathStoreTreesVisibleRow {
  ancestorPaths: readonly PathStoreTreesPublicId[];
  depth: number;
  flattenedSegments?: readonly PathStoreTreesVisibleSegment[];
  hasChildren: boolean;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  level: number;
  name: string;
  path: PathStoreTreesPublicId;
  posInSet: number;
  setSize: number;
}

export interface PathStoreTreesItemHandleBase {
  deselect(): void;
  focus(): void;
  getPath(): PathStoreTreesPublicId;
  isFocused(): boolean;
  isDirectory(): boolean;
  isSelected(): boolean;
  select(): void;
  toggleSelect(): void;
}

export interface PathStoreTreesDirectoryHandle extends PathStoreTreesItemHandleBase {
  collapse(): void;
  expand(): void;
  isDirectory(): true;
  isExpanded(): boolean;
  toggle(): void;
}

export interface PathStoreTreesFileHandle extends PathStoreTreesItemHandleBase {
  isDirectory(): false;
}

export type PathStoreTreesItemHandle =
  | PathStoreTreesDirectoryHandle
  | PathStoreTreesFileHandle;

export interface PathStoreTreesRenderOptions {
  itemHeight?: number;
  overscan?: number;
  viewportHeight?: number;
}

export interface PathStoreFileTreeOptions
  extends PathStoreTreesControllerOptions, PathStoreTreesRenderOptions {
  composition?: PathStoreTreesCompositionOptions;
  id?: string;
  icons?: FileTreeIcons;
  onSelectionChange?: PathStoreTreesSelectionChangeListener;
  renderRowDecoration?: PathStoreTreesRowDecorationRenderer;
}

export interface PathStoreTreesViewportMetrics {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface PathStoreTreesRange {
  end: number;
  start: number;
}

export interface PathStoreTreesStickyWindowLayout {
  offsetHeight: number;
  stickyInset: number;
  totalHeight: number;
  windowHeight: number;
}

export interface PathStoreTreesViewProps extends PathStoreTreesRenderOptions {
  controller: import('./controller').PathStoreTreesController;
  composition?: PathStoreTreesCompositionOptions;
  icons?: FileTreeIcons;
  renderRowDecoration?: PathStoreTreesRowDecorationRenderer;
  slotHost?: PathStoreTreesSlotHost;
}

export interface PathStoreTreeRenderProps {
  containerWrapper?: HTMLElement;
  fileTreeContainer?: HTMLElement;
}

export interface PathStoreTreeHydrationProps {
  fileTreeContainer: HTMLElement;
}

export interface PathStoreFileTreeSsrPayload {
  html: string;
  id: string;
  shadowHtml: string;
}

export interface PathStoreTreesMutationEventInvalidation {
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
}

export interface PathStoreTreesAddEvent extends PathStoreTreesMutationEventInvalidation {
  operation: 'add';
  path: PathStoreTreesPublicId;
}

export interface PathStoreTreesRemoveEvent extends PathStoreTreesMutationEventInvalidation {
  operation: 'remove';
  path: PathStoreTreesPublicId;
  recursive: boolean;
}

export interface PathStoreTreesMoveEvent extends PathStoreTreesMutationEventInvalidation {
  from: PathStoreTreesPublicId;
  operation: 'move';
  to: PathStoreTreesPublicId;
}

export interface PathStoreTreesResetEvent extends PathStoreTreesMutationEventInvalidation {
  operation: 'reset';
  pathCountAfter: number;
  pathCountBefore: number;
  usedPreparedInput: boolean;
}

export type PathStoreTreesMutationSemanticEvent =
  | PathStoreTreesAddEvent
  | PathStoreTreesRemoveEvent
  | PathStoreTreesMoveEvent
  | PathStoreTreesResetEvent;

export interface PathStoreTreesBatchEvent extends PathStoreTreesMutationEventInvalidation {
  events: readonly PathStoreTreesMutationSemanticEvent[];
  operation: 'batch';
}

export type PathStoreTreesMutationEvent =
  | PathStoreTreesMutationSemanticEvent
  | PathStoreTreesBatchEvent;

export type PathStoreTreesMutationEventType =
  PathStoreTreesMutationEvent['operation'];

export type PathStoreTreesMutationEventForType<
  TType extends PathStoreTreesMutationEventType | '*',
> = TType extends '*'
  ? PathStoreTreesMutationEvent
  : Extract<PathStoreTreesMutationEvent, { operation: TType }>;

export interface PathStoreTreesResetOptions {
  preparedInput?: PathStorePreparedInput;
}

export interface PathStoreTreesMutationHandle {
  add(path: PathStoreTreesPublicId): void;
  batch(operations: readonly PathStoreOperation[]): void;
  move(
    fromPath: PathStoreTreesPublicId,
    toPath: PathStoreTreesPublicId,
    options?: PathStoreMoveOptions
  ): void;
  onMutation<TType extends PathStoreTreesMutationEventType | '*'>(
    type: TType,
    handler: (event: PathStoreTreesMutationEventForType<TType>) => void
  ): () => void;
  remove(path: PathStoreTreesPublicId, options?: PathStoreRemoveOptions): void;
  resetPaths(
    paths: readonly PathStoreTreesPublicId[],
    options?: PathStoreTreesResetOptions
  ): void;
}

export type PathStoreTreesControllerListener = () => void;

export type PathStoreTreesSelectionChangeListener = (
  selectedPaths: readonly PathStoreTreesPublicId[]
) => void;

export interface PathStoreTreesContextMenuItem {
  kind: 'directory' | 'file';
  name: string;
  path: PathStoreTreesPublicId;
}

export interface PathStoreTreesContextMenuOpenContext {
  anchorElement: HTMLElement;
  anchorRect: ContextMenuAnchorRect;
  close: () => void;
  restoreFocus: () => void;
}

export interface PathStoreTreesHeaderCompositionOptions {
  html?: string;
  render?: () => HTMLElement | null;
}

export interface PathStoreTreesContextMenuCompositionOptions {
  enabled?: boolean;
  onOpen?: (
    item: PathStoreTreesContextMenuItem,
    context: PathStoreTreesContextMenuOpenContext
  ) => void;
  onClose?: () => void;
  render?: (
    item: PathStoreTreesContextMenuItem,
    context: PathStoreTreesContextMenuOpenContext
  ) => HTMLElement | null;
}

export interface PathStoreTreesCompositionOptions {
  contextMenu?: PathStoreTreesContextMenuCompositionOptions;
  header?: PathStoreTreesHeaderCompositionOptions;
}

export interface PathStoreTreesRowDecorationText {
  text: string;
  title?: string;
}

export interface PathStoreTreesRowDecorationIcon {
  icon: RemappedIcon;
  title?: string;
}

export type PathStoreTreesRowDecoration =
  | PathStoreTreesRowDecorationText
  | PathStoreTreesRowDecorationIcon;

export interface PathStoreTreesRowDecorationContext {
  item: PathStoreTreesContextMenuItem;
  row: PathStoreTreesVisibleRow;
}

export type PathStoreTreesRowDecorationRenderer = (
  context: PathStoreTreesRowDecorationContext
) => PathStoreTreesRowDecoration | null;

export interface PathStoreTreesSlotHost {
  clearSlotContent(slotName: string): void;
  setSlotContent(slotName: string, content: HTMLElement | null): void;
}
