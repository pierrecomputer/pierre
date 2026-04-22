import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import {
  getBuiltInSpriteSheet,
  isColoredBuiltInIconSet,
} from '../builtInIcons';
import {
  FileTreeContainerLoaded,
  prepareFileTreeShadowRoot,
} from '../components/web-components';
import {
  FILE_TREE_STYLE_ATTRIBUTE,
  FILE_TREE_TAG_NAME,
  FILE_TREE_UNSAFE_CSS_ATTRIBUTE,
  HEADER_SLOT_NAME,
} from '../constants';
import { normalizeFileTreeIcons } from '../iconConfig';
import {
  type FileTreeDensityPreset,
  resolveFileTreeDensity,
} from '../model/density';
import { FileTreeController } from '../model/FileTreeController';
import {
  type FileTreeGitStatusState,
  resolveFileTreeGitStatusState,
} from '../model/gitStatus';
import type {
  FileTreeBatchOperation,
  FileTreeCompositionOptions,
  FileTreeHydrationProps,
  FileTreeItemHandle,
  FileTreeListener,
  FileTreeMoveOptions,
  FileTreeMutationEventForType,
  FileTreeMutationEventType,
  FileTreeMutationHandle,
  FileTreeOptions,
  FileTreeRemoveOptions,
  FileTreeRenderProps,
  FileTreeResetOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchSessionHandle,
  FileTreeSelectionChangeListener,
  FileTreeSsrPayload,
  FileTreeViewProps,
} from '../model/types';
import {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_VIEWPORT_HEIGHT,
} from '../model/virtualization';
import fileTreeStyles from '../style.css';
import {
  escapeStyleTextForHtml,
  wrapCoreCSS,
  wrapUnsafeCSS,
} from '../utils/cssWrappers';
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

// Translates the public row-budget hint into the provisional pixel height shared
// by SSR and the first client render before the DOM can report a measured
// scroll viewport.
function resolveInitialViewportHeight({
  initialVisibleRowCount,
  itemHeight,
}: Pick<FileTreeOptions, 'initialVisibleRowCount' | 'itemHeight'>): number {
  return initialVisibleRowCount == null
    ? FILE_TREE_DEFAULT_VIEWPORT_HEIGHT
    : Math.max(0, initialVisibleRowCount) *
        (itemHeight ?? FILE_TREE_DEFAULT_ITEM_HEIGHT);
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

// Builds the host element opening markup. The optional `hostStyle` string is
// emitted as an inline `style="..."` so vanilla SSR consumers (who serialize
// the payload directly) get the resolved density variables on first paint
// without needing the React wrapper to paint them.
function getFileTreeOuterStart(
  id: string,
  mode: 'declarative' | 'dom',
  hostStyle: string
): string {
  const templateAttr =
    mode === 'declarative'
      ? 'shadowrootmode="open"'
      : 'data-file-tree-shadowrootmode="open"';
  const styleAttr = hostStyle.length === 0 ? '' : ` style="${hostStyle}"`;
  return `<file-tree-container id="${id}" data-file-tree-virtualized="true"${styleAttr}><template ${templateAttr}>`;
}

function getFileTreeOuterEnd(headerSlotHtml: string): string {
  return `</template>${headerSlotHtml}</file-tree-container>`;
}

// Reassembles the serializable SSR payload into the full host markup. Use
// `mode: 'dom'` when the string will be inserted via DOM APIs such as
// `innerHTML` or `dangerouslySetInnerHTML`; otherwise the default declarative
// form preserves native declarative shadow DOM parsing.
export function serializeFileTreeSsrPayload(
  payload: FileTreeSsrPayload,
  mode: 'declarative' | 'dom' = 'declarative'
): string {
  return `${mode === 'declarative' ? payload.outerStart : payload.domOuterStart}${payload.shadowHtml}${payload.outerEnd}`;
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
  readonly #searchBlurBehavior: FileTreeOptions['searchBlurBehavior'];
  readonly #searchEnabled: boolean;
  readonly #searchFakeFocus: boolean;
  readonly #slotHost = new FileTreeManagedSlotHost();
  readonly #density: FileTreeDensityPreset;
  readonly #viewOptions: Pick<
    FileTreeOptions,
    'initialVisibleRowCount' | 'itemHeight' | 'overscan' | 'stickyFolders'
  >;
  #fileTreeContainer: HTMLElement | undefined;
  #gitStatusState: FileTreeGitStatusState | null;
  #icons: FileTreeOptions['icons'];
  readonly #unsafeCSS: string | undefined;
  #unsafeCSSStyle: HTMLStyleElement | undefined;
  #appliedUnsafeCSS: string | undefined;
  #selectionVersion: number;
  #selectionSubscription: (() => void) | null = null;
  #wrapper: HTMLDivElement | undefined;

  public constructor(options: FileTreeOptions) {
    const {
      composition,
      density,
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
      searchBlurBehavior,
      searchFakeFocus,
      stickyFolders,
      unsafeCSS,
      initialVisibleRowCount,
      ...controllerOptions
    } = options;
    this.#composition = composition;
    this.#id = createClientId(id);
    this.#gitStatusState = resolveFileTreeGitStatusState(gitStatus);
    this.#icons = icons;
    this.#unsafeCSS = unsafeCSS;
    this.#onSelectionChange = onSelectionChange;
    this.#renderRowDecoration = renderRowDecoration;
    this.#renamingEnabled = renaming != null && renaming !== false;
    this.#searchBlurBehavior = searchBlurBehavior;
    this.#searchEnabled = search === true;
    this.#searchFakeFocus = searchFakeFocus === true;
    this.#density = resolveFileTreeDensity(density, itemHeight);
    this.#viewOptions = {
      itemHeight: this.#density.itemHeight,
      overscan,
      stickyFolders,
      initialVisibleRowCount,
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

  public getItemHeight(): number {
    return this.#density.itemHeight;
  }

  public getDensityFactor(): number {
    return this.#density.factor;
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

  public batch(operations: readonly FileTreeBatchOperation[]): void {
    this.#controller.batch(operations);
  }

  public move(
    fromPath: string,
    toPath: string,
    options?: FileTreeMoveOptions
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

  public startRenaming(
    path?: string,
    options?: { removeIfCanceled?: boolean }
  ): boolean {
    return this.#controller.startRenaming(path, options);
  }

  public remove(path: string, options?: FileTreeRemoveOptions): void {
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
    renderFileTreeRoot(mountedTree.wrapper, this.#getViewProps());
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

    renderFileTreeRoot(mountedTree.wrapper, this.#getViewProps());
  }

  public setIcons(icons?: FileTreeOptions['icons']): void {
    this.#icons = icons;

    const mountedTree = this.#getMountedTreeElements();
    if (mountedTree == null) {
      return;
    }

    this.#syncIconSurface(mountedTree.host, mountedTree.wrapper);
    renderFileTreeRoot(mountedTree.wrapper, this.#getViewProps());
  }

  public hydrate({ fileTreeContainer }: FileTreeHydrationProps): void {
    const host = this.#prepareHost(fileTreeContainer);
    const wrapper = this.#getOrCreateWrapper(host);
    this.#syncHeaderSlotContent();
    hydrateFileTreeRoot(wrapper, this.#getViewProps());
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
    renderFileTreeRoot(wrapper, this.#getViewProps());
  }

  #getInitialViewOptions(): {
    initialViewportHeight: number;
    itemHeight?: number;
    overscan?: number;
    stickyFolders?: boolean;
  } {
    return {
      initialViewportHeight: resolveInitialViewportHeight({
        initialVisibleRowCount: this.#viewOptions.initialVisibleRowCount,
        itemHeight: this.#viewOptions.itemHeight,
      }),
      itemHeight: this.#viewOptions.itemHeight,
      overscan: this.#viewOptions.overscan,
      stickyFolders: this.#viewOptions.stickyFolders,
    };
  }

  #getViewProps(): FileTreeViewProps {
    return {
      composition: this.#composition,
      controller: this.#controller,
      gitStatusByPath: this.#gitStatusState?.statusByPath,
      ignoredGitDirectories: this.#gitStatusState?.ignoredDirectoryPaths,
      directoriesWithGitChanges: this.#gitStatusState?.directoriesWithChanges,
      icons: this.#icons,
      instanceId: this.#id,
      renamingEnabled: this.#renamingEnabled,
      renderRowDecoration: this.#renderRowDecoration,
      searchBlurBehavior: this.#searchBlurBehavior,
      searchEnabled: this.#searchEnabled,
      searchFakeFocus: this.#searchFakeFocus,
      slotHost: this.#slotHost,
      ...this.#getInitialViewOptions(),
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

  #syncUnsafeCSS(shadowRoot: ShadowRoot): void {
    const existingUnsafeStyle = shadowRoot.querySelector(
      `style[${FILE_TREE_UNSAFE_CSS_ATTRIBUTE}]`
    );
    if (
      this.#unsafeCSSStyle == null &&
      existingUnsafeStyle instanceof HTMLStyleElement
    ) {
      this.#unsafeCSSStyle = existingUnsafeStyle;
    }

    if (this.#unsafeCSS == null || this.#unsafeCSS === '') {
      this.#unsafeCSSStyle?.remove();
      this.#unsafeCSSStyle = undefined;
      this.#appliedUnsafeCSS = undefined;
      return;
    }

    if (
      this.#unsafeCSSStyle?.parentNode === shadowRoot &&
      this.#appliedUnsafeCSS === this.#unsafeCSS
    ) {
      return;
    }

    this.#unsafeCSSStyle ??= document.createElement('style');
    this.#unsafeCSSStyle.setAttribute(FILE_TREE_UNSAFE_CSS_ATTRIBUTE, '');
    if (this.#unsafeCSSStyle.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.#unsafeCSSStyle);
    }
    this.#unsafeCSSStyle.textContent = wrapUnsafeCSS(this.#unsafeCSS);
    this.#appliedUnsafeCSS = this.#unsafeCSS;
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
    prepareFileTreeShadowRoot(host, shadowRoot);
    this.#syncUnsafeCSS(shadowRoot);
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
    density,
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
    searchBlurBehavior,
    searchFakeFocus,
    stickyFolders,
    unsafeCSS,
    initialVisibleRowCount,
    ...controllerOptions
  } = options;
  const resolvedDensity = resolveFileTreeDensity(density, itemHeight);
  const resolvedItemHeight = resolvedDensity.itemHeight;
  const resolvedId = createServerId(id);
  const controller = new FileTreeController({
    ...controllerOptions,
    fileTreeSearchMode,
    initialSearchQuery,
    renaming,
  });
  const gitStatusState = resolveFileTreeGitStatusState(gitStatus);
  const initialViewportHeight = resolveInitialViewportHeight({
    initialVisibleRowCount,
    itemHeight: resolvedItemHeight,
  });
  const normalizedIcons = normalizeFileTreeIcons(icons);
  const customSpriteSheet = normalizedIcons.spriteSheet?.trim() ?? '';
  const coloredIconsAttr =
    normalizedIcons.colored && isColoredBuiltInIconSet(normalizedIcons.set)
      ? ' data-file-tree-colored-icons="true"'
      : '';
  const wrappedCoreCss = escapeStyleTextForHtml(wrapCoreCSS(fileTreeStyles));
  const unsafeCssStyle =
    unsafeCSS == null || unsafeCSS === ''
      ? ''
      : `<style ${FILE_TREE_UNSAFE_CSS_ATTRIBUTE}>${escapeStyleTextForHtml(
          wrapUnsafeCSS(unsafeCSS)
        )}</style>`;

  const bodyHtml = renderToString(
    h(FileTreeView, {
      composition,
      controller,
      gitStatusByPath: gitStatusState?.statusByPath,
      ignoredGitDirectories: gitStatusState?.ignoredDirectoryPaths,
      directoriesWithGitChanges: gitStatusState?.directoriesWithChanges,
      icons,
      instanceId: resolvedId,
      itemHeight: resolvedItemHeight,
      overscan,
      renamingEnabled: renaming != null && renaming !== false,
      renderRowDecoration,
      searchBlurBehavior,
      searchEnabled: search === true,
      searchFakeFocus: searchFakeFocus === true,
      stickyFolders,
      initialViewportHeight,
    })
  );
  controller.destroy();

  const shadowHtml = `${getBuiltInSpriteSheet(normalizedIcons.set)}${customSpriteSheet}<style ${FILE_TREE_STYLE_ATTRIBUTE}>${wrappedCoreCss}</style>${unsafeCssStyle}<div data-file-tree-id="${resolvedId}" data-file-tree-virtualized-wrapper="true"${coloredIconsAttr}>${bodyHtml}</div>`;
  const headerSlotHtml = getHeaderSlotHtml(composition);
  // Inline the resolved density on the host so vanilla SSR consumers get the
  // same first paint as the React wrapper, where the model paints these vars
  // for them. The two paths must agree because the SSR shadow body was laid
  // out using the same resolved itemHeight.
  const hostStyle = `--trees-item-height:${String(resolvedItemHeight)}px;--trees-density-override:${String(resolvedDensity.factor)}`;
  const outerStart = getFileTreeOuterStart(
    resolvedId,
    'declarative',
    hostStyle
  );
  const domOuterStart = getFileTreeOuterStart(resolvedId, 'dom', hostStyle);
  const outerEnd = getFileTreeOuterEnd(headerSlotHtml);
  return {
    domOuterStart,
    id: resolvedId,
    outerEnd,
    outerStart,
    shadowHtml,
  };
}
