import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';

import { getBuiltInSpriteSheet } from '../builtInIcons';
import {
  adoptDeclarativeShadowDom,
  ensureFileTreeStyles,
  FileTreeContainerLoaded,
} from '../components/web-components';
import { FILE_TREE_STYLE_ATTRIBUTE, FILE_TREE_TAG_NAME } from '../constants';
import fileTreeStyles from '../style.css';
import { PathStoreTreesController } from './controller';
import {
  hydratePathStoreTreesRoot,
  renderPathStoreTreesRoot,
  unmountPathStoreTreesRoot,
} from './runtime';
import type {
  PathStoreFileTreeOptions,
  PathStoreFileTreeSsrPayload,
  PathStoreTreeHydrationProps,
  PathStoreTreeRenderProps,
  PathStoreTreesItemHandle,
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

function ensureBuiltInSpriteSheet(shadowRoot: ShadowRoot): void {
  if (shadowRoot.querySelector('svg[data-icon-sprite]') != null) {
    return;
  }

  const spriteSheet = parseSpriteSheet(getBuiltInSpriteSheet('minimal'));
  if (spriteSheet != null) {
    shadowRoot.prepend(spriteSheet);
  }
}

export class PathStoreFileTree {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly #controller: PathStoreTreesController;
  readonly #id: string;
  readonly #viewOptions: Pick<
    PathStoreFileTreeOptions,
    'itemHeight' | 'overscan' | 'viewportHeight'
  >;
  #fileTreeContainer: HTMLElement | undefined;
  #wrapper: HTMLDivElement | undefined;

  public constructor(options: PathStoreFileTreeOptions) {
    const { id, itemHeight, overscan, viewportHeight, ...controllerOptions } =
      options;
    this.#id = createClientId(id);
    this.#viewOptions = {
      itemHeight,
      overscan,
      viewportHeight,
    };
    this.#controller = new PathStoreTreesController(controllerOptions);
  }

  public cleanUp(): void {
    if (this.#wrapper != null) {
      unmountPathStoreTreesRoot(this.#wrapper);
      delete this.#wrapper.dataset.fileTreeVirtualizedWrapper;
      this.#wrapper = undefined;
    }
    if (this.#fileTreeContainer != null) {
      delete this.#fileTreeContainer.dataset.fileTreeVirtualized;
      this.#fileTreeContainer = undefined;
    }
    this.#controller.destroy();
  }

  public getFileTreeContainer(): HTMLElement | undefined {
    return this.#fileTreeContainer;
  }

  public getItem(path: string): PathStoreTreesItemHandle | null {
    return this.#controller.getItem(path);
  }

  public hydrate({ fileTreeContainer }: PathStoreTreeHydrationProps): void {
    const host = this.#prepareHost(fileTreeContainer);
    const wrapper = this.#getOrCreateWrapper(host);
    hydratePathStoreTreesRoot(wrapper, {
      controller: this.#controller,
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
    renderPathStoreTreesRoot(wrapper, {
      controller: this.#controller,
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
    ensureBuiltInSpriteSheet(shadowRoot);
    host.dataset.fileTreeVirtualized = 'true';
    host.style.display = 'flex';
    this.#fileTreeContainer = host;
    return host;
  }
}

export function preloadPathStoreFileTree(
  options: PathStoreFileTreeOptions
): PathStoreFileTreeSsrPayload {
  const { id, itemHeight, overscan, viewportHeight, ...controllerOptions } =
    options;
  const resolvedId = createServerId(id);
  const controller = new PathStoreTreesController(controllerOptions);
  const resolvedViewportHeight =
    viewportHeight ?? PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT;

  const bodyHtml = renderToString(
    h(PathStoreTreesView, {
      controller,
      itemHeight,
      overscan,
      viewportHeight: resolvedViewportHeight,
    })
  );
  controller.destroy();

  const shadowHtml = `${getBuiltInSpriteSheet('minimal')}<style ${FILE_TREE_STYLE_ATTRIBUTE}>${fileTreeStyles}</style><div data-file-tree-id="${resolvedId}" data-file-tree-virtualized-wrapper="true">${bodyHtml}</div>`;
  const html = `<file-tree-container id="${resolvedId}" data-file-tree-virtualized="true"><template shadowrootmode="open">${shadowHtml}</template></file-tree-container>`;
  return {
    html,
    id: resolvedId,
    shadowHtml,
  };
}
