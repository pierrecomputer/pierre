import type {
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreRemoveOptions,
} from '@pierre/path-store';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import {
  getBuiltInSpriteSheet,
  isColoredBuiltInIconSet,
} from '../builtInIcons';
import {
  adoptDeclarativeShadowDom,
  ensureFileTreeStyles,
  FileTreeContainerLoaded,
} from '../components/web-components';
import {
  FILE_TREE_STYLE_ATTRIBUTE,
  FILE_TREE_TAG_NAME,
  HEADER_SLOT_NAME,
} from '../constants';
import { normalizeFileTreeIcons } from '../iconConfig';
import { FileTreeController } from '../model/FileTreeController';
import {
  type FileTreeGitStatusState,
  resolveFileTreeGitStatusState,
} from '../model/gitStatus';
import type {
  FileTreeCompositionOptions,
  FileTreeHydrationProps,
  FileTreeItemHandle,
  FileTreeListener,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeOptions,
  FileTreeRenderProps,
  FileTreeResetOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
  FileTreeSsrPayload,
  FileTreeViewProps,
} from '../model/types';
import { FILE_TREE_DEFAULT_VIEWPORT_HEIGHT } from '../model/virtualization';
import fileTreeStyles from '../style.css';
import { FileTreeView } from './FileTreeView';
import {
  hydrateFileTreeRoot,
  renderFileTreeRoot,
  unmountFileTreeRoot,
} from './runtime';
import { FileTreeManagedSlotHost } from './slotHost';

let serverInstanceId = 0;
let clientInstanceId = 0;

function createClientId(explicitId?: string): string {
  if (explicitId != null && explicitId.length > 0) {
    return explicitId;
  }

  clientInstanceId += 1;
  return `pst_ft_${clientInstanceId}`;
}

function createServerId(explicitId?: string): string {
  if (explicitId != null && explicitId.length > 0) {
    return explicitId;
  }

  serverInstanceId += 1;
  return `pst_srv_${serverInstanceId}`;
}

function parseSpriteSheet(spriteSheet: string): SVGElement | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const wrapper = document.createElement('div');
  wrapper.innerHTML = spriteSheet;
  const svg = wrapper.querySelector('svg');
  return svg instanceof SVGElement ? svg : undefined;
}

function getHeaderSlotHtml(
  composition: FileTreeCompositionOptions | undefined
): string {
  const headerHtml = composition?.header?.html?.trim();
  if (headerHtml == null || headerHtml.length === 0) {
    return '';
  }

  return `<div slot="${HEADER_SLOT_NAME}" data-file-tree-managed-slot="${HEADER_SLOT_NAME}">${headerHtml}</div>`;
}

function isBuiltInSpriteSheet(spriteSheet: SVGElement): boolean {
  return (
    spriteSheet.querySelector('#file-tree-icon-chevron') instanceof
      SVGElement &&
    spriteSheet.querySelector('#file-tree-icon-file') instanceof SVGElement &&
    spriteSheet.querySelector('#file-tree-icon-dot') instanceof SVGElement &&
    spriteSheet.querySelector('#file-tree-icon-lock') instanceof SVGElement
  );
}

function getTopLevelSpriteSheets(shadowRoot: ShadowRoot): SVGElement[] {
  return Array.from(shadowRoot.children).filter(
    (element): element is SVGElement => element instanceof SVGElement
  );
}

export class FileTree
  implements FileTreeMutationHandle, FileTreeSearchSessionHandle
{
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  #composition: FileTreeCompositionOptions | undefined;
  readonly #controller: FileTreeController;
  #id: string;
  readonly #onSelectionChange: FileTreeSelectionChangeListener | undefined;
  readonly #renderRowDecoration: FileTreeRowDecorationRenderer | undefined;
  readonly #renamingEnabled: boolean;
  readonly #searchEnabled: boolean;
  readonly #slotHost = new FileTreeManagedSlotHost();
  readonly #viewOptions: Pick<
    FileTreeOptions,
    'itemHeight' | 'overscan' | 'viewportHeight'
  >;
  #fileTreeContainer: HTMLElement | undefined;
  #gitStatusState: FileTreeGitStatusState | null;
  #icons: FileTreeOptions['icons'];
  #selectionVersion: number;
  #selectionSubscription: (() => void) | null = null;
  #wrapper: HTMLDivElement | undefined;

  public constructor(options: FileTreeOptions) {
    const {
      composition,
      fileTreeSearchMode,
      gitStatus,
      id,
      initialSearchQuery,
      icons,
      itemHeight,
      onSearchChange,
      onSelectionChange,
      overscan,
      renderRowDecoration,
      renaming,
      search,
      viewportHeight,
      ...controllerOptions
    } = options;
    this.#composition = composition;
    this.#id = createClientId(id);
    this.#gitStatusState = resolveFileTreeGitStatusState(gitStatus);
    this.#icons = icons;
    this.#onSelectionChange = onSelectionChange;
    this.#renderRowDecoration = renderRowDecoration;
    this.#renamingEnabled = renaming != null && renaming !== false;
    this.#searchEnabled = search === true;
    this.#viewOptions = {
      itemHeight,
      overscan,
      viewportHeight,
    };
    this.#controller = new FileTreeController({
      ...controllerOptions,
      fileTreeSearchMode,
      initialSearchQuery,
      onSearchChange,
      renaming,
    });
    this.#selectionVersion = this.#controller.getSelectionVersion();
    this.#selectionSubscription =
      this.#onSelectionChange == null
        ? null
        : this.subscribe(() => {
            this.#emitSelectionChange();
          });
  }

  public unmount(): void {
    if (this.#wrapper != null) {
      unmountFileTreeRoot(this.#wrapper);
      delete this.#wrapper.dataset.fileTreeVirtualizedWrapper;
      this.#wrapper = undefined;
    }

    this.#slotHost.clearAll();
    this.#slotHost.setHost(null);
    if (this.#fileTreeContainer != null) {
      delete this.#fileTreeContainer.dataset.fileTreeVirtualized;
      this.#fileTreeContainer = undefined;
    }
  }

  public cleanUp(): void {
    this.unmount();
    this.#selectionSubscription?.();
    this.#selectionSubscription = null;
    this.#controller.destroy();
  }

  public getFileTreeContainer(): HTMLElement | undefined {
    return this.#fileTreeContainer;
  }

  public getItem(path: string): FileTreeItemHandle | null {
    return this.#controller.getItem(path);
  }

  public getFocusedItem(): FileTreeItemHandle | null {
    return this.#controller.getFocusedItem();
  }

  public getFocusedPath(): string | null {
    return this.#controller.getFocusedPath();
  }

  public getSelectedPaths(): readonly string[] {
    return this.#controller.getSelectedPaths();
  }

  public getComposition(): FileTreeCompositionOptions | undefined {
    return this.#composition;
  }

  public subscribe(listener: FileTreeListener): () => void {
    let hasSeenInitialSnapshot = false;

    return this.#controller.subscribe(() => {
      // useSyncExternalStore seeds the initial render through getSnapshot(), so
      // the model-level subscribe wrapper suppresses the controller's immediate
      // replay and only forwards subsequent store changes to React.
      if (!hasSeenInitialSnapshot) {
        hasSeenInitialSnapshot = true;
        return;
      }

      listener();
    });
  }

  public focusPath(path: string): void {
    this.#controller.focusPath(path);
  }

  public focusNearestPath(path: string | null): string | null {
    return this.#controller.focusNearestPath(path);
  }

  public add(path: string): void {
    this.#controller.add(path);
  }

  public batch(operations: readonly PathStoreOperation[]): void {
    this.#controller.batch(operations);
  }

  public move(
    fromPath: string,
    toPath: string,
    options?: PathStoreMoveOptions
  ): void {
    this.#controller.move(fromPath, toPath, options);
  }

  public onMutation<TType extends FileTreeMutationEventType | '*'>(
    type: TType,
    handler: (event: FileTreeMutationEventForType<TType>) => void
  ): () => void {
    return this.#controller.onMutation(type, handler);
  }

  public setSearch(value: string | null): void {
    this.#controller.setSearch(value);
  }

  public openSearch(initialValue?: string): void {
    this.#controller.openSearch(initialValue);
  }

  public closeSearch(): void {
    this.#controller.closeSearch();
  }

  public isSearchOpen(): boolean {
    return this.#controller.isSearchOpen();
  }

  public getSearchValue(): string {
    return this.#controller.getSearchValue();
  }

  public getSearchMatchingPaths(): readonly string[] {
    return this.#controller.getSearchMatchingPaths();
  }

  public focusNextSearchMatch(): void {
    this.#controller.focusNextSearchMatch();
  }

  public focusPreviousSearchMatch(): void {
    this.#controller.focusPreviousSearchMatch();
  }

  public startRenaming(path?: string): boolean {
    return this.#controller.startRenaming(path);
  }

  public remove(path: string, options?: PathStoreRemoveOptions): void {
    this.#controller.remove(path, options);
  }

  public resetPaths(
    paths: readonly string[],
    options?: FileTreeResetOptions
  ): void {
    this.#controller.resetPaths(paths, options);
  }

  // Deliberately rerenders even when the same object reference is passed again.
  // Callers can reuse one composition object while changing what its render
  // callbacks return, so identity alone is not a reliable no-op signal.
  public setComposition(composition?: FileTreeCompositionOptions): void {
    this.#composition = composition;

    const mountedTree = this.#getMountedTreeElements();
    if (mountedTree == null) {
      return;
    }

    this.#syncHeaderSlotContent();
    renderFileTreeRoot(
      mountedTree.wrapper,
      this.#getViewProps(mountedTree.host)
    );
  }

  public setGitStatus(gitStatus?: FileTreeOptions['gitStatus']): void {
    this.#gitStatusState = resolveFileTreeGitStatusState(
      gitStatus,
      this.#gitStatusState
    );

    const mountedTree = this.#getMountedTreeElements();
    if (mountedTree == null) {
      return;
    }

    renderFileTreeRoot(
      mountedTree.wrapper,
      this.#getViewProps(mountedTree.host)
    );
  }

  public setIcons(icons?: FileTreeOptions['icons']): void {
    this.#icons = icons;

    const mountedTree = this.#getMountedTreeElements();
    if (mountedTree == null) {
      return;
    }

    this.#syncIconSurface(mountedTree.host, mountedTree.wrapper);
    renderFileTreeRoot(
      mountedTree.wrapper,
      this.#getViewProps(mountedTree.host)
    );
  }

  public hydrate({ fileTreeContainer }: FileTreeHydrationProps): void {
    const host = this.#prepareHost(fileTreeContainer);
    const wrapper = this.#getOrCreateWrapper(host);
    this.#syncHeaderSlotContent();
    hydrateFileTreeRoot(wrapper, this.#getViewProps(host));
  }

  public render({
    containerWrapper,
    fileTreeContainer,
  }: FileTreeRenderProps): void {
    const host = this.#prepareHost(
      fileTreeContainer ?? this.#fileTreeContainer,
      containerWrapper
    );
    const wrapper = this.#getOrCreateWrapper(host);
    this.#syncHeaderSlotContent();
    renderFileTreeRoot(wrapper, this.#getViewProps(host));
  }

  #getResolvedViewOptions(host: HTMLElement): {
    itemHeight?: number;
    overscan?: number;
    viewportHeight: number;
  } {
    const viewportHeight =
      this.#viewOptions.viewportHeight ??
      host.clientHeight ??
      FILE_TREE_DEFAULT_VIEWPORT_HEIGHT;

    return {
      itemHeight: this.#viewOptions.itemHeight,
      overscan: this.#viewOptions.overscan,
      viewportHeight,
    };
  }

  #getViewProps(host: HTMLElement): FileTreeViewProps {
    return {
      composition: this.#composition,
      controller: this.#controller,
      directoriesWithGitChanges: this.#gitStatusState?.directoriesWithChanges,
      gitStatusByPath: this.#gitStatusState?.statusByPath,
      icons: this.#icons,
      instanceId: this.#id,
      renamingEnabled: this.#renamingEnabled,
      renderRowDecoration: this.#renderRowDecoration,
      searchEnabled: this.#searchEnabled,
      slotHost: this.#slotHost,
      ...this.#getResolvedViewOptions(host),
    };
  }

  // Resolves the mounted DOM surfaces so runtime setters can rerender in place.
  #getMountedTreeElements(): {
    host: HTMLElement;
    wrapper: HTMLDivElement;
  } | null {
    const host = this.#fileTreeContainer;
    const wrapper = this.#wrapper;
    if (host == null || wrapper == null) {
      return null;
    }

    return { host, wrapper };
  }

  #syncIconSurface(host: HTMLElement, wrapper: HTMLElement): void {
    const shadowRoot = host.shadowRoot;
    if (shadowRoot != null) {
      this.#syncBuiltInSpriteSheet(shadowRoot);
      this.#syncCustomSpriteSheet(shadowRoot);
    }

    this.#syncIconModeAttrs(wrapper);
  }

  #emitSelectionChange(): void {
    const onSelectionChange = this.#onSelectionChange;
    if (onSelectionChange == null) {
      return;
    }

    const nextSelectionVersion = this.#controller.getSelectionVersion();
    if (nextSelectionVersion === this.#selectionVersion) {
      return;
    }

    this.#selectionVersion = nextSelectionVersion;
    onSelectionChange(this.#controller.getSelectedPaths());
  }

  // Keeps header slot content attached to the host light DOM so hydration and
  // later composition surfaces can share one host-managed slot path.
  #syncHeaderSlotContent(): void {
    const renderHeader = this.#composition?.header?.render;
    if (renderHeader != null) {
      this.#slotHost.setSlotContent(HEADER_SLOT_NAME, renderHeader());
      return;
    }

    this.#slotHost.setSlotHtml(
      HEADER_SLOT_NAME,
      this.#composition?.header?.html ?? null
    );
  }

  #syncBuiltInSpriteSheet(shadowRoot: ShadowRoot): void {
    const currentBuiltInSprite = getTopLevelSpriteSheets(shadowRoot).find(
      (sprite) => isBuiltInSpriteSheet(sprite)
    );
    const nextBuiltInSprite = parseSpriteSheet(
      getBuiltInSpriteSheet(normalizeFileTreeIcons(this.#icons).set)
    );
    if (nextBuiltInSprite == null) {
      return;
    }

    if (
      currentBuiltInSprite != null &&
      currentBuiltInSprite.outerHTML === nextBuiltInSprite.outerHTML
    ) {
      return;
    }

    if (currentBuiltInSprite != null) {
      currentBuiltInSprite.replaceWith(nextBuiltInSprite);
    } else {
      shadowRoot.prepend(nextBuiltInSprite);
    }
  }

  #syncCustomSpriteSheet(shadowRoot: ShadowRoot): void {
    const topLevelSprites = getTopLevelSpriteSheets(shadowRoot);
    const builtInSprite = topLevelSprites.find((sprite) =>
      isBuiltInSpriteSheet(sprite)
    );
    const currentCustomSprites = topLevelSprites.filter(
      (sprite) => sprite !== builtInSprite
    );
    const customSpriteSheet =
      normalizeFileTreeIcons(this.#icons).spriteSheet?.trim() ?? '';
    if (customSpriteSheet.length === 0) {
      for (const currentCustomSprite of currentCustomSprites) {
        currentCustomSprite.remove();
      }
      return;
    }

    const customSprite = parseSpriteSheet(customSpriteSheet);
    if (customSprite == null) {
      for (const currentCustomSprite of currentCustomSprites) {
        currentCustomSprite.remove();
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

  #syncIconModeAttrs(wrapper: HTMLElement): void {
    const normalizedIcons = normalizeFileTreeIcons(this.#icons);
    if (
      normalizedIcons.colored &&
      isColoredBuiltInIconSet(normalizedIcons.set)
    ) {
      wrapper.dataset.fileTreeColoredIcons = 'true';
    } else {
      delete wrapper.dataset.fileTreeColoredIcons;
    }
  }

  #getOrCreateWrapper(host: HTMLElement): HTMLDivElement {
    if (this.#wrapper != null) {
      return this.#wrapper;
    }

    const shadowRoot = host.shadowRoot;
    if (shadowRoot == null) {
      throw new Error('FileTree requires a shadow root');
    }

    const wrapperCandidates = Array.from(shadowRoot.children).filter(
      (element): element is HTMLDivElement =>
        element instanceof HTMLDivElement &&
        typeof element.dataset.fileTreeId === 'string' &&
        element.dataset.fileTreeId.length > 0
    );
    const existingWrapper =
      wrapperCandidates.find(
        (element) => element.dataset.fileTreeId === this.#id
      ) ?? wrapperCandidates[0];
    if (existingWrapper != null) {
      this.#id = existingWrapper.dataset.fileTreeId ?? this.#id;
    }
    this.#wrapper = existingWrapper ?? document.createElement('div');
    this.#wrapper.dataset.fileTreeId = this.#id;
    this.#wrapper.dataset.fileTreeVirtualizedWrapper = 'true';
    this.#syncIconSurface(host, this.#wrapper);

    if (this.#wrapper.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.#wrapper);
    }

    return this.#wrapper;
  }

  #prepareHost(
    fileTreeContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    const host =
      fileTreeContainer ??
      this.#fileTreeContainer ??
      document.createElement(FILE_TREE_TAG_NAME);
    if (parentNode != null && host.parentNode !== parentNode) {
      parentNode.appendChild(host);
    }

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    adoptDeclarativeShadowDom(host, shadowRoot);
    ensureFileTreeStyles(shadowRoot);
    host.dataset.fileTreeVirtualized = 'true';
    host.style.display = 'flex';
    this.#slotHost.setHost(host);
    this.#fileTreeContainer = host;
    return host;
  }
}

export function preloadFileTree(options: FileTreeOptions): FileTreeSsrPayload {
  const {
    composition,
    fileTreeSearchMode,
    gitStatus,
    id,
    initialSearchQuery,
    icons,
    itemHeight,
    onSearchChange: _onSearchChange,
    onSelectionChange: _onSelectionChange,
    overscan,
    renderRowDecoration,
    renaming,
    search,
    viewportHeight,
    ...controllerOptions
  } = options;
  const resolvedId = createServerId(id);
  const controller = new FileTreeController({
    ...controllerOptions,
    fileTreeSearchMode,
    initialSearchQuery,
    renaming,
  });
  const gitStatusState = resolveFileTreeGitStatusState(gitStatus);
  const resolvedViewportHeight =
    viewportHeight ?? FILE_TREE_DEFAULT_VIEWPORT_HEIGHT;
  const normalizedIcons = normalizeFileTreeIcons(icons);
  const customSpriteSheet = normalizedIcons.spriteSheet?.trim() ?? '';
  const coloredIconsAttr =
    normalizedIcons.colored && isColoredBuiltInIconSet(normalizedIcons.set)
      ? ' data-file-tree-colored-icons="true"'
      : '';

  const bodyHtml = renderToString(
    h(FileTreeView, {
      composition,
      controller,
      directoriesWithGitChanges: gitStatusState?.directoriesWithChanges,
      gitStatusByPath: gitStatusState?.statusByPath,
      icons,
      instanceId: resolvedId,
      itemHeight,
      overscan,
      renamingEnabled: renaming != null && renaming !== false,
      renderRowDecoration,
      searchEnabled: search === true,
      viewportHeight: resolvedViewportHeight,
    })
  );
  controller.destroy();

  const shadowHtml = `${getBuiltInSpriteSheet(normalizedIcons.set)}${customSpriteSheet}<style ${FILE_TREE_STYLE_ATTRIBUTE}>${fileTreeStyles}</style><div data-file-tree-id="${resolvedId}" data-file-tree-virtualized-wrapper="true"${coloredIconsAttr}>${bodyHtml}</div>`;
  const headerSlotHtml = getHeaderSlotHtml(composition);
  const html = `<file-tree-container id="${resolvedId}" data-file-tree-virtualized="true"><template shadowrootmode="open">${shadowHtml}</template>${headerSlotHtml}</file-tree-container>`;
  return {
    html,
    id: resolvedId,
    shadowHtml,
  };
}
