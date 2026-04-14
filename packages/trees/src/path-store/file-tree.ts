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
import fileTreeStyles from '../style.css';
import { PathStoreTreesController } from './controller';
import {
  hydratePathStoreTreesRoot,
  renderPathStoreTreesRoot,
  unmountPathStoreTreesRoot,
} from './runtime';
import { PathStoreTreesManagedSlotHost } from './slotHost';
import type {
  PathStoreFileTreeOptions,
  PathStoreFileTreeSsrPayload,
  PathStoreTreeHydrationProps,
  PathStoreTreeRenderProps,
  PathStoreTreesCompositionOptions,
  PathStoreTreesItemHandle,
  PathStoreTreesMutationEventForType,
  PathStoreTreesMutationEventType,
  PathStoreTreesMutationHandle,
  PathStoreTreesResetOptions,
  PathStoreTreesRowDecorationRenderer,
  PathStoreTreesSelectionChangeListener,
} from './types';
import { PathStoreTreesView } from './view';
import { PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT } from './virtualization';

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
  composition: PathStoreTreesCompositionOptions | undefined
): string {
  const headerHtml = composition?.header?.html?.trim();
  if (headerHtml == null || headerHtml.length === 0) {
    return '';
  }

  return `<div slot="${HEADER_SLOT_NAME}" data-path-store-managed-slot="${HEADER_SLOT_NAME}">${headerHtml}</div>`;
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

export class PathStoreFileTree implements PathStoreTreesMutationHandle {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly #composition: PathStoreTreesCompositionOptions | undefined;
  readonly #controller: PathStoreTreesController;
  readonly #id: string;
  readonly #onSelectionChange:
    | PathStoreTreesSelectionChangeListener
    | undefined;
  readonly #renderRowDecoration:
    | PathStoreTreesRowDecorationRenderer
    | undefined;
  readonly #slotHost = new PathStoreTreesManagedSlotHost();
  readonly #viewOptions: Pick<
    PathStoreFileTreeOptions,
    'itemHeight' | 'overscan' | 'viewportHeight'
  >;
  #fileTreeContainer: HTMLElement | undefined;
  #icons: PathStoreFileTreeOptions['icons'];
  #selectionVersion: number;
  #selectionSubscription: (() => void) | null = null;
  #wrapper: HTMLDivElement | undefined;

  public constructor(options: PathStoreFileTreeOptions) {
    const {
      composition,
      id,
      icons,
      itemHeight,
      onSelectionChange,
      overscan,
      renderRowDecoration,
      viewportHeight,
      ...controllerOptions
    } = options;
    this.#composition = composition;
    this.#id = createClientId(id);
    this.#icons = icons;
    this.#onSelectionChange = onSelectionChange;
    this.#renderRowDecoration = renderRowDecoration;
    this.#viewOptions = {
      itemHeight,
      overscan,
      viewportHeight,
    };
    this.#controller = new PathStoreTreesController(controllerOptions);
    this.#selectionVersion = this.#controller.getSelectionVersion();
    this.#selectionSubscription =
      this.#onSelectionChange == null
        ? null
        : this.#controller.subscribe(() => {
            this.#emitSelectionChange();
          });
  }

  public cleanUp(): void {
    if (this.#wrapper != null) {
      unmountPathStoreTreesRoot(this.#wrapper);
      delete this.#wrapper.dataset.fileTreeVirtualizedWrapper;
      this.#wrapper = undefined;
    }
    this.#slotHost.clearAll();
    this.#slotHost.setHost(null);
    if (this.#fileTreeContainer != null) {
      delete this.#fileTreeContainer.dataset.fileTreeVirtualized;
      this.#fileTreeContainer = undefined;
    }
    this.#selectionSubscription?.();
    this.#selectionSubscription = null;
    this.#controller.destroy();
  }

  public getFileTreeContainer(): HTMLElement | undefined {
    return this.#fileTreeContainer;
  }

  public getItem(path: string): PathStoreTreesItemHandle | null {
    return this.#controller.getItem(path);
  }

  public getSelectedPaths(): readonly string[] {
    return this.#controller.getSelectedPaths();
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

  public onMutation<TType extends PathStoreTreesMutationEventType | '*'>(
    type: TType,
    handler: (event: PathStoreTreesMutationEventForType<TType>) => void
  ): () => void {
    return this.#controller.onMutation(type, handler);
  }

  public remove(path: string, options?: PathStoreRemoveOptions): void {
    this.#controller.remove(path, options);
  }

  public resetPaths(
    paths: readonly string[],
    options?: PathStoreTreesResetOptions
  ): void {
    this.#controller.resetPaths(paths, options);
  }

  public setIcons(icons?: PathStoreFileTreeOptions['icons']): void {
    this.#icons = icons;

    const host = this.#fileTreeContainer;
    const wrapper = this.#wrapper;
    if (host == null || wrapper == null) {
      return;
    }

    this.#syncIconSurface(host, wrapper);
    renderPathStoreTreesRoot(wrapper, {
      composition: this.#composition,
      controller: this.#controller,
      icons: this.#icons,
      renderRowDecoration: this.#renderRowDecoration,
      slotHost: this.#slotHost,
      ...this.#getResolvedViewOptions(host),
    });
  }

  public hydrate({ fileTreeContainer }: PathStoreTreeHydrationProps): void {
    const host = this.#prepareHost(fileTreeContainer);
    const wrapper = this.#getOrCreateWrapper(host);
    this.#syncHeaderSlotContent();
    hydratePathStoreTreesRoot(wrapper, {
      composition: this.#composition,
      controller: this.#controller,
      icons: this.#icons,
      renderRowDecoration: this.#renderRowDecoration,
      slotHost: this.#slotHost,
      ...this.#getResolvedViewOptions(host),
    });
  }

  public render({
    containerWrapper,
    fileTreeContainer,
  }: PathStoreTreeRenderProps): void {
    const host = this.#prepareHost(
      fileTreeContainer ?? this.#fileTreeContainer,
      containerWrapper
    );
    const wrapper = this.#getOrCreateWrapper(host);
    this.#syncHeaderSlotContent();
    renderPathStoreTreesRoot(wrapper, {
      composition: this.#composition,
      controller: this.#controller,
      icons: this.#icons,
      renderRowDecoration: this.#renderRowDecoration,
      slotHost: this.#slotHost,
      ...this.#getResolvedViewOptions(host),
    });
  }

  #getResolvedViewOptions(host: HTMLElement): {
    itemHeight?: number;
    overscan?: number;
    viewportHeight: number;
  } {
    const viewportHeight =
      this.#viewOptions.viewportHeight ??
      host.clientHeight ??
      PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT;

    return {
      itemHeight: this.#viewOptions.itemHeight,
      overscan: this.#viewOptions.overscan,
      viewportHeight,
    };
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
      throw new Error('PathStoreFileTree requires a shadow root');
    }

    const existingWrapper = Array.from(shadowRoot.children).find(
      (element): element is HTMLDivElement =>
        element instanceof HTMLDivElement &&
        element.dataset.fileTreeId === this.#id
    );
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

export function preloadPathStoreFileTree(
  options: PathStoreFileTreeOptions
): PathStoreFileTreeSsrPayload {
  const {
    composition,
    id,
    icons,
    itemHeight,
    onSelectionChange: _onSelectionChange,
    overscan,
    renderRowDecoration,
    viewportHeight,
    ...controllerOptions
  } = options;
  const resolvedId = createServerId(id);
  const controller = new PathStoreTreesController(controllerOptions);
  const resolvedViewportHeight =
    viewportHeight ?? PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT;
  const normalizedIcons = normalizeFileTreeIcons(icons);
  const customSpriteSheet = normalizedIcons.spriteSheet?.trim() ?? '';
  const coloredIconsAttr =
    normalizedIcons.colored && isColoredBuiltInIconSet(normalizedIcons.set)
      ? ' data-file-tree-colored-icons="true"'
      : '';

  const bodyHtml = renderToString(
    h(PathStoreTreesView, {
      composition,
      controller,
      icons,
      itemHeight,
      overscan,
      renderRowDecoration,
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
