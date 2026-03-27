import type { FileTreeRootProps } from './components/Root';
import { FileTreeContainerLoaded } from './components/web-components';
import {
  FILE_TREE_TAG_NAME,
  FILE_TREE_UNSAFE_CSS_ATTRIBUTE,
  FLATTENED_PREFIX,
} from './constants';
import type { TreeInstance } from './core/types/core';
import {
  getBenchmarkInstrumentation,
  inheritBenchmarkInstrumentation,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import { SVGSpriteSheet } from './sprite';
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeNode,
  GitStatusEntry,
} from './types';
import { wrapUnsafeCSS } from './utils/cssWrappers';
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
import type { ChildrenComparator } from './utils/sortChildren';

export type { GitStatusEntry } from './types';

let instanceId = -1;

interface FileTreeRenderProps {
  fileTreeContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
}

interface FileTreeHydrationProps {
  fileTreeContainer: HTMLElement;
}

export type FileTreeSearchMode =
  | 'expand-matches'
  | 'collapse-non-matches'
  | 'hide-non-matches';

export interface FileTreeSearchConfig {
  fileTreeSearchMode?: FileTreeSearchMode;
  search?: boolean;
}

export type FileTreeRenamingItem = {
  path: string;
  isFolder: boolean;
};

export type FileTreeRenameEvent = {
  sourcePath: string;
  destinationPath: string;
  isFolder: boolean;
};

export interface FileTreeRenamingConfig {
  canRename?: (item: FileTreeRenamingItem) => boolean;
  onError?: (error: string) => void;
  onRename?: (event: FileTreeRenameEvent) => void;
}

export type FileTreeSelectionItem = {
  path: string;
  isFolder: boolean;
};

export type FileTreeCollision = {
  origin: string | null;
  destination: string;
};

export interface FileTreeHandle {
  tree: TreeInstance<FileTreeNode>;
  pathToId: Map<string, string>;
  idToPath: Pick<Map<string, string>, 'get' | 'has'>;
  closeContextMenu?: () => void;
}

export interface FileTreeCallbacks {
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
  onFilesChange?: (files: string[]) => void;
  onContextMenuOpen?: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => void;
  onContextMenuClose?: () => void;
  /** Internal: called when a DnD move produces a new file list. */
  _onDragMoveFiles?: (newFiles: string[]) => void;
  /** Internal: called when a rename produces a new file list. */
  _onRenameFiles?: (newFiles: string[]) => void;
}

type RemappedIcon =
  | string
  | {
      name: string;
      width?: number;
      height?: number;
      viewBox?: string;
    };
export interface FileTreeIconConfig {
  spriteSheet?: string;
  remap?: Record<string, RemappedIcon>;
}

export interface FileTreeOptions {
  dragAndDrop?: boolean;
  fileTreeSearchMode?: FileTreeSearchMode;
  flattenEmptyDirectories?: boolean;
  gitStatus?: GitStatusEntry[];
  id?: string;
  initialFiles: string[];
  /** Paths that cannot be dragged (e.g. ['package.json']). Uses same path form as the tree (no f:: prefix). */
  lockedPaths?: string[];
  /** Return true to overwrite the destination file when a DnD move collides. */
  onCollision?: (collision: FileTreeCollision) => boolean;
  /** Enable inline item renaming (F2/context menu start). */
  renaming?: boolean | FileTreeRenamingConfig;
  /** Render the built-in search input. Defaults to `false`. */
  search?: boolean;
  /** Sort children within each directory. Defaults to `true` (folders first,
   *  dot-prefixed next, then case-insensitive alphabetical). Pass `false` to
   *  preserve insertion order, or `{ comparator: fn }` for custom sorting. */
  sort?: boolean | { comparator: ChildrenComparator };
  /** Inject raw CSS into the tree shadow root. Use this sparingly when CSS
   *  variables are not sufficient. */
  unsafeCSS?: string;
  useLazyDataLoader?: boolean;
  /** Enable virtualized rendering. Items are only rendered when visible.
   *  `threshold` is the minimum item count to activate virtualization. */
  virtualize?: { threshold: number } | false;
  icons?: FileTreeIconConfig;
}

export interface FileTreeStateConfig {
  // Initial state (uncontrolled - used once at creation)
  initialExpandedItems?: string[];
  initialSelectedItems?: string[];
  /** Prepopulate the search field (e.g. for demos). */
  initialSearchQuery?: string | null;

  // Controlled state (applied every render, overrides internal state)
  expandedItems?: string[];
  selectedItems?: string[];
  files?: string[];

  // State change callbacks
  onExpandedItemsChange?: (items: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
  onFilesChange?: (files: string[]) => void;
  onContextMenuOpen?: (
    item: ContextMenuItem,
    context: ContextMenuOpenContext
  ) => void;
  onContextMenuClose?: () => void;
}

const isBrowser = typeof document !== 'undefined';
/** Checks whether the renaming option is enabled (not false/undefined). */
export const isRenamingEnabled = (
  renaming: FileTreeOptions['renaming'] | undefined
): boolean => renaming != null && renaming !== false;

export class FileTree {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  __id: string;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private defaultSpriteSheet: SVGElement | undefined;
  private unsafeCSSStyle: HTMLStyleElement | undefined;

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
        onFilesChange: stateConfig.onFilesChange,
        onContextMenuOpen: stateConfig.onContextMenuOpen,
        onContextMenuClose: stateConfig.onContextMenuClose,
        _onDragMoveFiles:
          options.dragAndDrop === true
            ? (newFiles) => this.setFiles(newFiles)
            : undefined,
        _onRenameFiles: isRenamingEnabled(options.renaming)
          ? (newFiles) => this.setFiles(newFiles)
          : undefined,
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
    const hadContextMenu = this.callbacksRef.current.onContextMenuOpen != null;
    Object.assign(this.callbacksRef.current, callbacks);
    const hasContextMenu = this.callbacksRef.current.onContextMenuOpen != null;
    if (hadContextMenu !== hasContextMenu) {
      this.rerender();
    }
  }

  // --- Git status ---

  setGitStatus(entries: GitStatusEntry[] | undefined): void {
    this.options = inheritBenchmarkInstrumentation(this.options, {
      ...this.options,
      gitStatus: entries,
    });
    this.rerender();
  }

  getGitStatus(): GitStatusEntry[] | undefined {
    return this.options.gitStatus;
  }

  // --- Heavier updates (re-render) ---

  setFiles(files: string[]): void {
    if (this.options.initialFiles === files) {
      return;
    }
    this.options = inheritBenchmarkInstrumentation(this.options, {
      ...this.options,
      initialFiles: files,
    });
    this.callbacksRef.current.onFilesChange?.(files);
    this.rerender();
  }

  getFiles(): string[] {
    return this.options.initialFiles;
  }

  setOptions(
    options: Partial<FileTreeOptions>,
    state?: Partial<FileTreeStateConfig>
  ): void {
    const hadContextMenu = this.callbacksRef.current.onContextMenuOpen != null;

    if (options.dragAndDrop === false) {
      this.callbacksRef.current._onDragMoveFiles = undefined;
    } else if (
      options.dragAndDrop === true &&
      this.callbacksRef.current._onDragMoveFiles == null
    ) {
      this.callbacksRef.current._onDragMoveFiles = (newFiles) =>
        this.setFiles(newFiles);
    }
    if ('renaming' in options) {
      if (!isRenamingEnabled(options.renaming)) {
        this.callbacksRef.current._onRenameFiles = undefined;
      } else {
        this.callbacksRef.current._onRenameFiles ??= (newFiles) =>
          this.setFiles(newFiles);
      }
    }

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
    if (state?.onFilesChange !== undefined) {
      this.callbacksRef.current.onFilesChange = state.onFilesChange;
    }
    if (state?.onContextMenuOpen !== undefined) {
      this.callbacksRef.current.onContextMenuOpen = state.onContextMenuOpen;
    }
    if (state?.onContextMenuClose !== undefined) {
      this.callbacksRef.current.onContextMenuClose = state.onContextMenuClose;
    }

    // Check if structural props changed (require re-render)
    const structuralKeys = [
      'dragAndDrop',
      'fileTreeSearchMode',
      'gitStatus',
      'initialFiles',
      'icons',
      'flattenEmptyDirectories',
      'lockedPaths',
      'onCollision',
      'renaming',
      'sort',
      'unsafeCSS',
      'useLazyDataLoader',
      'virtualize',
    ] as const;
    let needsRerender = false;
    for (const key of structuralKeys) {
      if (key in options) {
        needsRerender = true;
        break;
      }
    }

    const nextFiles = state?.files;
    const stateFilesChanged =
      nextFiles !== undefined && this.options.initialFiles !== nextFiles;
    this.options = inheritBenchmarkInstrumentation(this.options, {
      ...this.options,
      ...options,
      ...(nextFiles !== undefined && { initialFiles: nextFiles }),
    });
    if (state != null) {
      this.stateConfig = inheritBenchmarkInstrumentation(this.options, {
        ...this.stateConfig,
        ...state,
      });
    }

    const hasContextMenu = this.callbacksRef.current.onContextMenuOpen != null;
    if (hadContextMenu !== hasContextMenu) {
      needsRerender = true;
    }

    if (needsRerender || stateFilesChanged) {
      if (stateFilesChanged && nextFiles !== undefined) {
        this.callbacksRef.current.onFilesChange?.(nextFiles);
      }
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

  private buildRootProps(overrides?: Partial<FileTreeRootProps>) {
    return {
      fileTreeOptions: this.options,
      stateConfig: this.stateConfig,
      handleRef: this.handleRef,
      callbacksRef: this.callbacksRef,
      ...overrides,
    };
  }

  private isVirtualized(): boolean {
    return this.options.virtualize != null && this.options.virtualize !== false;
  }

  private syncVirtualizedLayoutAttrs(
    fileTreeContainer?: HTMLElement,
    divWrapper?: HTMLElement
  ): void {
    const host = fileTreeContainer ?? this.fileTreeContainer;
    const wrapper = divWrapper ?? this.divWrapper;
    const isVirtualized = this.isVirtualized();

    if (host != null) {
      if (isVirtualized) {
        host.dataset.fileTreeVirtualized = 'true';
      } else {
        delete host.dataset.fileTreeVirtualized;
      }
    }
    if (wrapper != null) {
      if (isVirtualized) {
        wrapper.dataset.fileTreeVirtualizedWrapper = 'true';
      } else {
        delete wrapper.dataset.fileTreeVirtualizedWrapper;
      }
    }
  }

  private rerender(): void {
    if (this.divWrapper == null) return;
    if (this.fileTreeContainer != null) {
      this.syncIconSpriteSheets(this.fileTreeContainer);
      this.syncUnsafeCSS(this.fileTreeContainer);
    }
    this.syncVirtualizedLayoutAttrs(this.fileTreeContainer, this.divWrapper);
    preactRenderRoot(this.divWrapper, this.buildRootProps());
  }

  private parseSpriteSheet(spriteSheet: string): SVGElement | undefined {
    const fragment = document.createElement('div');
    fragment.innerHTML = spriteSheet;
    const svg = fragment.querySelector('svg');
    if (svg instanceof SVGElement) {
      return svg;
    }
    return undefined;
  }

  private isDefaultSpriteSheet(spriteSheet: SVGElement): boolean {
    return (
      spriteSheet.querySelector('#file-tree-icon-chevron') instanceof
        SVGElement &&
      spriteSheet.querySelector('#file-tree-icon-file') instanceof SVGElement &&
      spriteSheet.querySelector('#file-tree-icon-dot') instanceof SVGElement &&
      spriteSheet.querySelector('#file-tree-icon-lock') instanceof SVGElement
    );
  }

  private getTopLevelSpriteSheets(shadowRoot: ShadowRoot): SVGElement[] {
    return Array.from(shadowRoot.children).filter(
      (element): element is SVGElement => element instanceof SVGElement
    );
  }

  private ensureDefaultSpriteSheet(shadowRoot: ShadowRoot): void {
    let defaultSprite =
      this.defaultSpriteSheet != null &&
      this.defaultSpriteSheet.parentNode === shadowRoot
        ? this.defaultSpriteSheet
        : undefined;

    defaultSprite ??= this.getTopLevelSpriteSheets(shadowRoot).find((sprite) =>
      this.isDefaultSpriteSheet(sprite)
    );

    if (defaultSprite == null) {
      const builtInSprite = this.parseSpriteSheet(SVGSpriteSheet);
      if (builtInSprite != null) {
        shadowRoot.appendChild(builtInSprite);
        defaultSprite = builtInSprite;
      }
    }

    this.defaultSpriteSheet = defaultSprite;
  }

  private syncCustomSpriteSheet(shadowRoot: ShadowRoot): void {
    const topLevelSprites = this.getTopLevelSpriteSheets(shadowRoot);
    const defaultSprite = topLevelSprites.find((sprite) =>
      this.isDefaultSpriteSheet(sprite)
    );
    const currentCustomSprites = topLevelSprites.filter(
      (sprite) => sprite !== defaultSprite
    );

    const customSpriteSheet = this.options.icons?.spriteSheet?.trim() ?? '';
    if (customSpriteSheet.length === 0) {
      for (const customSprite of currentCustomSprites) {
        customSprite.remove();
      }
      return;
    }

    const customSprite = this.parseSpriteSheet(customSpriteSheet);
    if (customSprite == null) {
      for (const customSprite of currentCustomSprites) {
        customSprite.remove();
      }
      return;
    }

    if (
      currentCustomSprites.length === 1 &&
      currentCustomSprites[0].outerHTML === customSprite.outerHTML
    ) {
      return;
    }

    for (const currentCustomSprite of currentCustomSprites) {
      currentCustomSprite.remove();
    }
    shadowRoot.appendChild(customSprite);
  }

  private syncIconSpriteSheets(fileTreeContainer: HTMLElement): void {
    const shadowRoot = fileTreeContainer.shadowRoot;
    if (shadowRoot == null) {
      return;
    }

    this.ensureDefaultSpriteSheet(shadowRoot);
    this.syncCustomSpriteSheet(shadowRoot);
  }

  private syncUnsafeCSS(fileTreeContainer: HTMLElement): void {
    const shadowRoot = fileTreeContainer.shadowRoot;
    if (shadowRoot == null) {
      return;
    }

    const isUnsafeStyleElement = (
      element: Element | null | undefined
    ): element is HTMLStyleElement =>
      element != null &&
      element.tagName === 'STYLE' &&
      element.hasAttribute(FILE_TREE_UNSAFE_CSS_ATTRIBUTE);

    let unsafeStyle =
      isUnsafeStyleElement(this.unsafeCSSStyle) &&
      this.unsafeCSSStyle.parentNode === shadowRoot
        ? this.unsafeCSSStyle
        : undefined;

    unsafeStyle ??= Array.from(shadowRoot.children).find(
      (element): element is HTMLStyleElement => isUnsafeStyleElement(element)
    );

    const unsafeCSS = this.options.unsafeCSS?.trim() ?? '';
    if (unsafeCSS.length === 0) {
      unsafeStyle?.remove();
      this.unsafeCSSStyle = undefined;
      return;
    }

    if (unsafeStyle == null) {
      unsafeStyle = document.createElement('style');
      unsafeStyle.setAttribute(FILE_TREE_UNSAFE_CSS_ATTRIBUTE, '');
      shadowRoot.appendChild(unsafeStyle);
    }

    const wrappedUnsafeCSS = wrapUnsafeCSS(unsafeCSS);
    if (unsafeStyle.textContent !== wrappedUnsafeCSS) {
      unsafeStyle.textContent = wrappedUnsafeCSS;
    }

    this.unsafeCSSStyle = unsafeStyle;
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

    this.syncIconSpriteSheets(this.fileTreeContainer);
    this.syncUnsafeCSS(this.fileTreeContainer);
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
    this.syncVirtualizedLayoutAttrs(fileTreeContainer, divWrapper);

    // Seed the first virtualized window with the outer mount height so client
    // mounts can render the initial rows immediately before the layout effect
    // performs the authoritative viewport measurement.
    const initialViewportHeight =
      containerWrapper?.clientHeight ?? fileTreeContainer.clientHeight;

    withBenchmarkPhase(
      getBenchmarkInstrumentation(this.options),
      'fileTree.render.mount',
      () =>
        preactRenderRoot(
          divWrapper,
          this.buildRootProps({ initialViewportHeight })
        )
    );
  }

  hydrate(props: FileTreeHydrationProps): void {
    const { fileTreeContainer } = props;

    let discoveredId: string | undefined;
    for (const element of Array.from(
      fileTreeContainer.shadowRoot?.children ?? []
    )) {
      if (element instanceof SVGElement) {
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
      this.options = inheritBenchmarkInstrumentation(this.options, {
        ...this.options,
        id: discoveredId,
      });
    }

    this.fileTreeContainer = fileTreeContainer;
    this.syncIconSpriteSheets(fileTreeContainer);
    this.syncUnsafeCSS(fileTreeContainer);
    this.syncVirtualizedLayoutAttrs(fileTreeContainer, this.divWrapper);

    if (this.divWrapper == null) {
      console.warn('FileTree: expected html not found, rendering instead');
      this.render(props);
    } else {
      preactHydrateRoot(this.divWrapper, this.buildRootProps());
      // Preact's hydrate() only attaches function props (event handlers),
      // skipping non-function props like `draggable`. When DnD is enabled
      // client-side but wasn't during SSR, patch the attribute manually.
      if (this.options.dragAndDrop === true) {
        for (const btn of this.divWrapper.querySelectorAll(
          'button[data-type="item"]'
        )) {
          (btn as HTMLElement).draggable = true;
        }
      }
    }
  }

  cleanUp(): void {
    if (this.fileTreeContainer != null) {
      delete this.fileTreeContainer.dataset.fileTreeVirtualized;
    }
    if (this.divWrapper != null) {
      delete this.divWrapper.dataset.fileTreeVirtualizedWrapper;
      preactUnmountRoot(this.divWrapper);
    }
    this.handleRef.current = null;
    this.expandPathsCache.clear();
    this.expandPathsCacheFor = null;
    this.unsafeCSSStyle?.remove();
    this.unsafeCSSStyle = undefined;
    this.fileTreeContainer = undefined;
    this.divWrapper = undefined;
    this.defaultSpriteSheet = undefined;
  }
}
