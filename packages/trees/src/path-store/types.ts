import type { PathStoreConstructorOptions } from '@pierre/path-store';

import type { FileTreeIcons } from '../iconConfig';

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
  icons?: FileTreeIcons;
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

export type PathStoreTreesControllerListener = () => void;

export type PathStoreTreesSelectionChangeListener = (
  selectedPaths: readonly PathStoreTreesPublicId[]
) => void;

export interface PathStoreTreesHeaderCompositionOptions {
  html?: string;
  render?: () => HTMLElement | null;
}

export interface PathStoreTreesCompositionOptions {
  header?: PathStoreTreesHeaderCompositionOptions;
}
