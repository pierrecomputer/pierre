import {
  type ItemInstance,
  type TreeConfig,
  type TreeInstance,
  createTree,
  syncDataLoaderFeature,
} from '@headless-tree/core';

import { FILE_TREE_TAG_NAME } from '../constants';
import { SVGSpriteSheet } from '../sprite';
import { iconHtml } from '../utils/icon';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { propsToHtml } from '../utils/propsToHtml';
import { FileTreeContainerLoaded } from './web-components';

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
  private tree: TreeInstance<T> | undefined;

  constructor(public options: FileTreeOptions<T>) {
    if (typeof document !== 'undefined') {
      this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    }
    this.__id = options.id ?? `ft_${isBrowser ? 'brw' : 'srv'}_${++instanceId}`;
    const createTreeOptions = {
      ...options.config,
      features: [syncDataLoaderFeature],
    };
    this.tree = createTree(createTreeOptions);
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

  private attachEventListeners(): void {
    if (this.divWrapper == null) {
      throw new Error('FileTree attachEventListeners: divWrapper is null');
    }
    this.divWrapper.onclick = (e) => {
      const itemElement = (e.target as HTMLElement)?.closest(
        '[data-type="item"]'
      ) as HTMLElement;
      const itemId = itemElement?.dataset?.itemId;
      if (itemId == null) {
        console.warn('FileTree attachEventListeners: itemId is null');
        return;
      }
      const item = this.tree?.getItemInstance(itemId);
      if (item == null) {
        console.warn('FileTree attachEventListeners: item not found');
        return;
      }
      // console.log(this.__id, itemId, item.getItemData(), item.getItemMeta());
      if (item.isExpanded()) {
        item.collapse();
        itemElement.setAttribute('aria-expanded', 'false');
        const numChildren = (item.getItemData() as any).children?.length ?? 0;
        // remove the next numChildren elements after the itemElement
        for (let i = 0; i < numChildren; i++) {
          itemElement.nextElementSibling?.remove();
        }
      } else {
        item.expand();
        itemElement.setAttribute('aria-expanded', 'true');
        const newhtml = this.generateFileTreeFake(itemId);
        const newElement = document.createElement('div');
        newElement.innerHTML = newhtml;
        while (newElement.lastElementChild != null) {
          itemElement.after(newElement.lastElementChild);
        }
      }
    };
  }

  render({ fileTreeContainer, containerWrapper }: FileTreeRenderProps): void {
    if (this.tree == null) {
      throw new Error('FileTree: Tree is not initialized');
    }

    fileTreeContainer = this.getOrCreateFileTreeContainer(
      fileTreeContainer,
      containerWrapper
    );
    const divWrapper = this.getOrCreateDivWrapperNode(fileTreeContainer);
    const output = this.generateFileTreeFake();
    divWrapper.innerHTML = output;
    this.attachEventListeners();
  }

  hydrate(props: FileTreeHydrationProps): void {
    const { fileTreeContainer, prerenderedHTML } = props;
    prerenderHTMLIfNecessary(fileTreeContainer, prerenderedHTML);
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
      console.log('divWrapper is null in hydrate, rendering');
      this.render(props);
    } else {
      this.fileTreeContainer = fileTreeContainer;
      delete this.divWrapper.dataset.dehydrated;
      if (this.tree == null) {
        throw new Error(
          'FileTree: this.tree is null, but ssr html was provided'
        );
      }
      this.tree.setMounted(true);
      this.tree.rebuildTree();
      this.attachEventListeners();
    }
  }

  cleanUp(): void {
    // todo
  }

  generateFileTreeFake(subtreeId?: string): string {
    console.log('generateFileTreeFake called', this.__id, typeof document);
    if (this.tree == null) {
      throw new Error('FileTree: Tree is not initialized');
    }
    // idk if these should be here, but works for now.
    // maybe they should be in 'hydrate'? but not totally sure.
    // maybe it should get called here but only once unless unmounted?
    this.tree.setMounted(true);
    this.tree.rebuildTree();
    const subtree =
      subtreeId != null
        ? this.tree.getItemInstance(subtreeId).getChildren()
        : this.tree.getItems();
    const listHtml = subtree
      ?.map((item: ItemInstance<any>) => {
        const itemData = item.getItemData();
        const itemProps = item.getProps();
        return `<div data-type="item" data-item-id="${item.getId()}" ${propsToHtml(itemProps)}>
          <div data-item-section="content">${itemData.name}</div>
          ${
            itemData.children != null && itemData.children.length > 0
              ? `<div data-item-section="icon">${iconHtml('file-tree-icon-chevron')}</div>`
              : ''
          }
        </div>`;
      })
      .join('');
    const containerProps = this.tree.getContainerProps();
    if (subtreeId != null) {
      return listHtml;
    }
    return `<div ${propsToHtml(containerProps)}>${listHtml}</div>`;
  }
}
