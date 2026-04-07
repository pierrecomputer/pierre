import type { PathStoreConstructorOptions } from '@pierre/path-store';

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
  depth: number;
  flattenedSegments?: readonly PathStoreTreesVisibleSegment[];
  hasChildren: boolean;
  isExpanded: boolean;
  isFlattened: boolean;
  kind: 'directory' | 'file';
  name: string;
  path: PathStoreTreesPublicId;
}

export interface PathStoreTreesRenderOptions {
  itemHeight?: number;
  overscan?: number;
  viewportHeight?: number;
}

export interface PathStoreFileTreeOptions
  extends PathStoreTreesControllerOptions, PathStoreTreesRenderOptions {
  id?: string;
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
