import { type ItemInstance, type TreeConfig } from '@headless-tree/core';

import { FileTreeContainerLoaded } from './components/web-components';
import { FILE_TREE_TAG_NAME } from './constants';
import { SVGSpriteSheet } from './sprite';
import { preactHydrateRoot, preactRenderRoot } from './utils/preactRenderer';

let instanceId = -1;

export type FileTreeItem<T> = ItemInstance<T>;
export interface FileTreeRenderProps {
  fileTreeContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
}

export interface FileTreeHydrationProps {
  fileTreeContainer: HTMLElement;
  prerenderedHTML?: string;
}

export interface FileTreeOptions<T> {
  // probably change the name here once i know a better one
  config: Omit<TreeConfig<T>, 'features'>;
  id?: string;
}

const isBrowser = typeof document !== 'undefined';

export class FileTree<T> {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly __id: string;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private spriteSVG: SVGElement | undefined;
  private initialTreeConfig: TreeConfig<T>;

  constructor(public options: FileTreeOptions<T>) {
    if (typeof document !== 'undefined') {
      this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    }
    this.__id = options.id ?? `ft_${isBrowser ? 'brw' : 'srv'}_${++instanceId}`;
    this.initialTreeConfig = {
      ...options.config,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setOptions(options: FileTreeOptions<T>): void {
    // todo
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
      this.divWrapper = document.createElement('div');
      this.divWrapper.dataset.fileTreeId = this.__id.toString();
      container.shadowRoot?.appendChild(this.divWrapper);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.divWrapper.parentNode !== container) {
      container.shadowRoot?.appendChild(this.divWrapper);
    }
    return this.divWrapper;
  }

  render({ fileTreeContainer, containerWrapper }: FileTreeRenderProps): void {
    if (this.initialTreeConfig == null) {
      throw new Error('FileTree: Tree is not initialized');
    }

    fileTreeContainer = this.getOrCreateFileTreeContainer(
      fileTreeContainer,
      containerWrapper
    );
    const divWrapper = this.getOrCreateDivWrapperNode(fileTreeContainer);
    preactRenderRoot(divWrapper, {
      treeConfig: this.initialTreeConfig,
    });
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
      preactHydrateRoot(this.divWrapper, {
        treeConfig: this.initialTreeConfig,
      });
    }
  }

  cleanUp(): void {
    // todo
  }
}
