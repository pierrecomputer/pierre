import {
  type TreeConfig,
  type TreeInstance,
  createTree,
  syncDataLoaderFeature,
} from '@headless-tree/core';

import { FILE_TREE_TAG_NAME } from '../constants';
import { FileTreeContainerLoaded } from './web-components';

let instanceId = -1;

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
}

export class FileTree<T> {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly __id: number = ++instanceId;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private tree: TreeInstance<T> | undefined;

  constructor(public options: FileTreeOptions<T>) {
    this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    this.tree = createTree({
      ...options.config,
      features: [syncDataLoaderFeature],
    });
    console.log('tree', this.tree);
  }

  setOptions(options: FileTreeOptions<T>): void {
    console.log('setOptions faked for now', options);
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
    return this.fileTreeContainer;
  }

  getFileTreeContainer(): HTMLElement | undefined {
    return this.fileTreeContainer;
  }

  private getOrCreateDivWrapperNode(container: HTMLElement): HTMLElement {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.divWrapper == null) {
      this.divWrapper = document.createElement('div');
      this.divWrapper.id = 'file-tree-div-wrapper';
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
    fileTreeContainer = this.getOrCreateFileTreeContainer(
      fileTreeContainer,
      containerWrapper
    );
    const divWrapper = this.getOrCreateDivWrapperNode(fileTreeContainer);
    const output = this.generateFileTreeFake();
    divWrapper.innerHTML = output;
  }

  hydrate({
    fileTreeContainer,
    prerenderedHTML,
  }: FileTreeHydrationProps): void {
    console.log('hydrate faked for now', fileTreeContainer, prerenderedHTML);
  }

  cleanUp(): void {
    console.log('cleanUp faked for now');
  }

  generateFileTreeFake(): string {
    return '<div>File Tree Fake</div><slot name="fake-slot"></slot>';
  }
}
