import { type TreeConfig, type TreeInstance } from '@headless-tree/core';

import { FileTreeContainerLoaded } from './components/web-components';
import { FILE_TREE_TAG_NAME } from './constants';
import { SVGSpriteSheet } from './sprite';
import { type FileTreeNode } from './types';
import {
  expandPathsWithAncestors,
  filterOrphanedPaths,
} from './utils/expandPaths';
import {
  preactHydrateRoot,
  preactRenderRoot,
  preactUnmountRoot,
} from './utils/preactRenderer';

let instanceId = -1;

interface FileTreeRenderProps {
  fileTreeContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
}

interface FileTreeHydrationProps {
  fileTreeContainer: HTMLElement;
  prerenderedHTML?: string;
}

export type FileTreeSearchMode = 'expand-matches' | 'collapse-non-matches';

export type FileTreeSelectionItem = {
  path: string;
  isFolder: boolean;
};

export type HeadlessTreeConfig = Omit<
  TreeConfig<FileTreeNode>,
  'features' | 'dataLoader' | 'rootItemId' | 'getItemName' | 'isItemFolder'
> & {
  fileTreeSearchMode?: FileTreeSearchMode;
};

export interface FileTreeHandle {
  tree: TreeInstance<FileTreeNode>;
  pathToId: Map<string, string>;
  idToPath: Map<string, string>;
}

export interface FileTreeCallbacks {
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
}

export interface FileTreeOptions {
  files: string[];
  id?: string;
  flattenEmptyDirectories?: boolean;
  useLazyDataLoader?: boolean;

  // Initial state (uncontrolled - used once at creation)
  defaultExpandedItems?: string[];
  defaultSelectedItems?: string[];

  // Controlled state (applied every render, overrides internal state)
  expandedItems?: string[];
  selectedItems?: string[];

  // State change callbacks
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;

  // Advanced headless-tree config (kept for passthrough)
  config?: HeadlessTreeConfig;
}

const isBrowser = typeof document !== 'undefined';

export class FileTree {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly __id: string;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private spriteSVG: SVGElement | undefined;

  /** Populated by the Preact Root component with the tree instance + maps. */
  readonly handleRef: { current: FileTreeHandle | null } = { current: null };

  /** Populated by FileTree, read by the Preact Root for callbacks. */
  readonly callbacksRef: { current: FileTreeCallbacks };

  constructor(public options: FileTreeOptions) {
    if (typeof document !== 'undefined') {
      this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    }
    this.__id = options.id ?? `ft_${isBrowser ? 'brw' : 'srv'}_${++instanceId}`;
    this.callbacksRef = {
      current: {
        onExpandedItemsChange: options.onExpandedItemsChange,
        onSelectedItemsChange: options.onSelectedItemsChange,
        onSelection: options.onSelection,
      },
    };
  }

  // --- State setters (imperative) ---

  setExpandedItems(items: string[]): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    const ids = expandPathsWithAncestors(items, handle.pathToId);
    handle.tree.applySubStateUpdate('expandedItems', () => ids);
    // Schedule a lazy rebuild so getItems() returns updated children on the
    // next render. applySubStateUpdate already triggers a re-render via the
    // config setState chain; scheduleRebuildTree just sets a flag that
    // getItems() checks, avoiding a redundant synchronous rebuild+render.
    handle.tree.scheduleRebuildTree();
  }

  setSelectedItems(items: string[]): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    const ids = items
      .map((path) => handle.pathToId.get(path))
      .filter((id): id is string => id != null);
    handle.tree.applySubStateUpdate('selectedItems', () => ids);
  }

  // --- Convenience methods ---

  expandItem(path: string): void {
    const current = this.getExpandedItems();
    if (!current.includes(path)) {
      this.setExpandedItems([...current, path]);
    }
  }

  collapseItem(path: string): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    // Remove both the regular and flattened IDs for this path so neither
    // survives to re-expand the folder on a controlled state round-trip.
    const idsToRemove = new Set<string>();
    const id = handle.pathToId.get(path);
    if (id != null) idsToRemove.add(id);
    const flatId = handle.pathToId.get('f::' + path);
    if (flatId != null) idsToRemove.add(flatId);
    if (idsToRemove.size === 0) return;
    const currentIds = handle.tree.getState().expandedItems ?? [];
    handle.tree.applySubStateUpdate('expandedItems', () =>
      currentIds.filter((i) => !idsToRemove.has(i))
    );
    handle.tree.scheduleRebuildTree();
  }

  toggleItemExpanded(path: string): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    const id = handle.pathToId.get(path) ?? handle.pathToId.get('f::' + path);
    if (id == null) return;
    const currentIds = handle.tree.getState().expandedItems ?? [];
    if (currentIds.includes(id)) {
      this.collapseItem(path);
    } else {
      this.expandItem(path);
    }
  }

  // --- Getters ---

  getExpandedItems(): string[] {
    const handle = this.handleRef.current;
    if (handle == null) return [];
    const ids = handle.tree.getState().expandedItems ?? [];
    const paths = ids
      .map((id) => handle.idToPath.get(id))
      .filter((path): path is string => path != null);
    return filterOrphanedPaths(paths, handle.pathToId);
  }

  getSelectedItems(): string[] {
    const handle = this.handleRef.current;
    if (handle == null) return [];
    const ids = handle.tree.getState().selectedItems ?? [];
    return ids
      .map((id) => handle.idToPath.get(id))
      .filter((path): path is string => path != null);
  }

  // --- Callbacks ---

  setCallbacks(callbacks: Partial<FileTreeCallbacks>): void {
    Object.assign(this.callbacksRef.current, callbacks);
  }

  // --- Heavier updates (re-render) ---

  setFiles(files: string[]): void {
    this.options = { ...this.options, files };
    this.rerender();
  }

  setOptions(options: Partial<FileTreeOptions>): void {
    // Update callbacks without re-rendering
    if (options.onExpandedItemsChange !== undefined) {
      this.callbacksRef.current.onExpandedItemsChange =
        options.onExpandedItemsChange;
    }
    if (options.onSelectedItemsChange !== undefined) {
      this.callbacksRef.current.onSelectedItemsChange =
        options.onSelectedItemsChange;
    }
    if (options.onSelection !== undefined) {
      this.callbacksRef.current.onSelection = options.onSelection;
    }

    // Check if structural props changed (require re-render)
    const structuralKeys = [
      'files',
      'flattenEmptyDirectories',
      'useLazyDataLoader',
      'config',
    ] as const;
    let needsRerender = false;
    for (const key of structuralKeys) {
      if (key in options) {
        needsRerender = true;
        break;
      }
    }

    this.options = { ...this.options, ...options };

    if (needsRerender) {
      this.rerender();
    } else {
      // State-only changes - use imperative methods
      if (options.expandedItems !== undefined) {
        this.setExpandedItems(options.expandedItems);
      }
      if (options.selectedItems !== undefined) {
        this.setSelectedItems(options.selectedItems);
      }
    }
  }

  private buildRootProps() {
    return {
      fileTreeOptions: this.options,
      handleRef: this.handleRef,
      callbacksRef: this.callbacksRef,
    };
  }

  private rerender(): void {
    if (this.divWrapper == null) return;
    preactRenderRoot(this.divWrapper, this.buildRootProps());
  }

  private getOrCreateFileTreeContainer(
    fileTreeContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    this.fileTreeContainer =
      fileTreeContainer ??
      this.fileTreeContainer ??
      document.createElement(FILE_TREE_TAG_NAME);
    if (
      parentNode != null &&
      this.fileTreeContainer.parentNode !== parentNode
    ) {
      parentNode.appendChild(this.fileTreeContainer);
    }
    // First try to find the sprite SVG
    if (this.spriteSVG == null) {
      for (const element of Array.from(
        this.fileTreeContainer.shadowRoot?.children ?? []
      )) {
        if (element instanceof SVGElement) {
          this.spriteSVG = element;
          break;
        }
      }
    }
    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
        this.fileTreeContainer.shadowRoot?.appendChild(this.spriteSVG);
      }
    }
    return this.fileTreeContainer;
  }

  getFileTreeContainer(): HTMLElement | undefined {
    return this.fileTreeContainer;
  }

  private getOrCreateDivWrapperNode(container: HTMLElement): HTMLElement {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.divWrapper == null) {
      for (const element of Array.from(container.shadowRoot?.children ?? [])) {
        if (
          element instanceof HTMLDivElement &&
          element.dataset.fileTreeId === this.__id
        ) {
          this.divWrapper = element;
          break;
        }
      }
      if (this.divWrapper == null) {
        this.divWrapper = document.createElement('div');
        this.divWrapper.dataset.fileTreeId = this.__id.toString();
        container.shadowRoot?.appendChild(this.divWrapper);
      }
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.divWrapper.parentNode !== container) {
      container.shadowRoot?.appendChild(this.divWrapper);
    }
    return this.divWrapper;
  }

  render({ fileTreeContainer, containerWrapper }: FileTreeRenderProps): void {
    fileTreeContainer = this.getOrCreateFileTreeContainer(
      fileTreeContainer,
      containerWrapper
    );
    const divWrapper = this.getOrCreateDivWrapperNode(fileTreeContainer);
    preactRenderRoot(divWrapper, this.buildRootProps());
  }

  hydrate(props: FileTreeHydrationProps): void {
    const { fileTreeContainer } = props;
    for (const element of Array.from(
      fileTreeContainer.shadowRoot?.children ?? []
    )) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (
        element instanceof HTMLDivElement &&
        (element.dataset.fileTreeId?.startsWith('ft_srv_') ?? false)
      ) {
        this.divWrapper = element;
        continue;
      }
    }
    if (this.divWrapper == null) {
      console.warn('FileTree: expected html not found, rendering instead');
      this.render(props);
    } else {
      this.fileTreeContainer = fileTreeContainer;
      preactHydrateRoot(this.divWrapper, this.buildRootProps());
    }
  }

  cleanUp(): void {
    if (this.divWrapper != null) {
      preactUnmountRoot(this.divWrapper);
    }
    this.handleRef.current = null;
    this.fileTreeContainer = undefined;
    this.divWrapper = undefined;
    this.spriteSVG = undefined;
  }
}
