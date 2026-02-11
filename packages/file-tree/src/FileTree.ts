import { type TreeConfig, type TreeInstance } from '@headless-tree/core';

import { FileTreeContainerLoaded } from './components/web-components';
import { FILE_TREE_TAG_NAME, FLATTENED_PREFIX } from './constants';
import { SVGSpriteSheet } from './sprite';
import { type FileTreeNode } from './types';
import { expandImplicitParentDirectories } from './utils/expandImplicitParentDirectories';
import {
  buildDirectChildCountMap,
  expandPathsWithAncestors,
  filterOrphanedPaths,
  isOrphanedPathForExpandedSet,
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

  // Advanced headless-tree config (kept for passthrough)
  config?: HeadlessTreeConfig;
}

export interface FileTreeStateConfig {
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
}

const isBrowser = typeof document !== 'undefined';

export class FileTree {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  __id: string;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private spriteSVG: SVGElement | undefined;

  /** Populated by the Preact Root component with the tree instance + maps. */
  readonly handleRef: { current: FileTreeHandle | null } = { current: null };

  /** Populated by FileTree, read by the Preact Root for callbacks. */
  readonly callbacksRef: { current: FileTreeCallbacks };

  private expandPathsCache: Map<string, string[]> = new Map();
  private expandPathsCacheFor: Map<string, string> | null = null;
  private childCountCache: Map<string, number> | null = null;
  private childCountCacheFor: Map<string, string> | null = null;

  constructor(
    public options: FileTreeOptions,
    public stateConfig: FileTreeStateConfig = {}
  ) {
    if (typeof document !== 'undefined') {
      this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    }
    this.__id = options.id ?? `ft_${isBrowser ? 'brw' : 'srv'}_${++instanceId}`;
    this.callbacksRef = {
      current: {
        onExpandedItemsChange: stateConfig.onExpandedItemsChange,
        onSelectedItemsChange: stateConfig.onSelectedItemsChange,
        onSelection: stateConfig.onSelection,
      },
    };
  }

  // --- State setters (imperative) ---

  setExpandedItems(items: string[]): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    if (this.expandPathsCacheFor !== handle.pathToId) {
      this.expandPathsCache.clear();
      this.expandPathsCacheFor = handle.pathToId;
    }
    if (this.childCountCacheFor !== handle.pathToId) {
      this.childCountCache = buildDirectChildCountMap(handle.pathToId);
      this.childCountCacheFor = handle.pathToId;
    }

    // Preserve hidden subtree expansion state even when the controlled
    // expandedItems list omits descendants (e.g. when collapsing an ancestor).
    // This avoids losing subtree state in controlled mode, and prevents
    // "flash closed then reopen" behavior on round-trips.
    const desiredExpandedSet = new Set(expandImplicitParentDirectories(items));

    const currentIds = handle.tree.getState().expandedItems ?? [];
    const currentPaths: string[] = [];
    {
      const seen = new Set<string>();
      for (const id of currentIds) {
        const raw = handle.idToPath.get(id);
        if (raw == null) continue;
        const path = raw.startsWith(FLATTENED_PREFIX)
          ? raw.slice(FLATTENED_PREFIX.length)
          : raw;
        if (path === 'root' || path === '') continue;
        if (seen.has(path)) continue;
        seen.add(path);
        currentPaths.push(path);
      }
    }

    const hiddenPathsToPreserve: string[] = [];
    for (const path of currentPaths) {
      if (desiredExpandedSet.has(path)) continue;
      if (
        isOrphanedPathForExpandedSet(
          path,
          desiredExpandedSet,
          handle.pathToId,
          {
            flattenEmptyDirectories: this.options.flattenEmptyDirectories,
            childCount: this.childCountCache ?? undefined,
          }
        )
      ) {
        hiddenPathsToPreserve.push(path);
      }
    }

    const ids = expandPathsWithAncestors(items, handle.pathToId, {
      flattenEmptyDirectories: this.options.flattenEmptyDirectories,
      cache: this.expandPathsCache,
    });
    const flattenEmptyDirectories =
      this.options.flattenEmptyDirectories === true;
    const preserveIds = hiddenPathsToPreserve
      .map((path) => {
        if (path.startsWith(FLATTENED_PREFIX)) {
          return handle.pathToId.get(path);
        }
        return flattenEmptyDirectories
          ? (handle.pathToId.get(FLATTENED_PREFIX + path) ??
              handle.pathToId.get(path))
          : handle.pathToId.get(path);
      })
      .filter((id): id is string => id != null);

    if (preserveIds.length === 0) {
      handle.tree.applySubStateUpdate('expandedItems', () => ids);
    } else {
      const next = new Set<string>(ids);
      for (const id of preserveIds) next.add(id);
      handle.tree.applySubStateUpdate('expandedItems', () => Array.from(next));
    }
    // Schedule a lazy rebuild so getItems() returns updated children on the
    // next render. applySubStateUpdate already triggers a re-render via the
    // config setState chain; scheduleRebuildTree just sets a flag that
    // getItems() checks, avoiding a redundant synchronous rebuild+render.
    handle.tree.scheduleRebuildTree();
  }

  setSelectedItems(items: string[]): void {
    const handle = this.handleRef.current;
    if (handle == null) return;
    const flattenEmptyDirectories =
      this.options.flattenEmptyDirectories === true;
    const ids = items
      .map((path) => {
        // If the caller explicitly passes a flattened path, respect it.
        if (path.startsWith(FLATTENED_PREFIX)) {
          return handle.pathToId.get(path);
        }
        return flattenEmptyDirectories
          ? (handle.pathToId.get(FLATTENED_PREFIX + path) ??
              handle.pathToId.get(path))
          : handle.pathToId.get(path);
      })
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
    const flatId = handle.pathToId.get(FLATTENED_PREFIX + path);
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
    const id =
      handle.pathToId.get(path) ?? handle.pathToId.get(FLATTENED_PREFIX + path);
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
    const selectionPaths = paths.map((path) =>
      path.startsWith(FLATTENED_PREFIX)
        ? path.slice(FLATTENED_PREFIX.length)
        : path
    );
    return filterOrphanedPaths(
      selectionPaths,
      handle.pathToId,
      this.options.flattenEmptyDirectories
    );
  }

  getSelectedItems(): string[] {
    const handle = this.handleRef.current;
    if (handle == null) return [];
    const ids = handle.tree.getState().selectedItems ?? [];
    return ids
      .map((id) => handle.idToPath.get(id))
      .filter((path): path is string => path != null)
      .map((path) =>
        path.startsWith(FLATTENED_PREFIX)
          ? path.slice(FLATTENED_PREFIX.length)
          : path
      );
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

  setOptions(
    options: Partial<FileTreeOptions>,
    state?: Partial<FileTreeStateConfig>
  ): void {
    // Update callbacks without re-rendering
    if (state?.onExpandedItemsChange !== undefined) {
      this.callbacksRef.current.onExpandedItemsChange =
        state.onExpandedItemsChange;
    }
    if (state?.onSelectedItemsChange !== undefined) {
      this.callbacksRef.current.onSelectedItemsChange =
        state.onSelectedItemsChange;
    }
    if (state?.onSelection !== undefined) {
      this.callbacksRef.current.onSelection = state.onSelection;
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
    if (state != null) {
      this.stateConfig = { ...this.stateConfig, ...state };
    }

    if (needsRerender) {
      this.rerender();
    } else {
      // State-only changes - use imperative methods
      if (state?.expandedItems !== undefined) {
        this.setExpandedItems(state.expandedItems);
      }
      if (state?.selectedItems !== undefined) {
        this.setSelectedItems(state.selectedItems);
      }
    }
  }

  private buildRootProps() {
    return {
      fileTreeOptions: this.options,
      stateConfig: this.stateConfig,
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

    // Best-effort: ensure a shadow root exists even if the custom element
    // definition hasn't run yet.
    if (this.fileTreeContainer.shadowRoot == null) {
      try {
        this.fileTreeContainer.attachShadow({ mode: 'open' });
      } catch {
        // ignore
      }
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
    else {
      const targetParent = container.shadowRoot ?? container;
      if (this.divWrapper.parentNode !== targetParent) {
        targetParent.appendChild(this.divWrapper);
      }
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

    let discoveredId: string | undefined;
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
        element.dataset.fileTreeId != null
      ) {
        discoveredId ??= element.dataset.fileTreeId;
        if (element.dataset.fileTreeId === this.__id) {
          this.divWrapper = element;
          break;
        }
        // Fallback: accept the first SSR wrapper and adopt its id.
        this.divWrapper ??= element;
        continue;
      }
    }

    if (discoveredId != null && this.__id !== discoveredId) {
      this.__id = discoveredId;
      this.options = { ...this.options, id: discoveredId };
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
    this.expandPathsCache.clear();
    this.expandPathsCacheFor = null;
    this.fileTreeContainer = undefined;
    this.divWrapper = undefined;
    this.spriteSVG = undefined;
  }
}
