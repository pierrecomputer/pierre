import { toHtml } from 'hast-util-to-html';

import { DEFAULT_THEMES, DIFFS_TAG_NAME } from '../constants';
import {
  ImageDiffRenderer,
  type ImageRenderResult,
} from '../renderers/ImageDiffRenderer';
import { SVGSpriteSheet } from '../sprite';
import type {
  FileContents,
  FileDiffMetadata,
  ImageDiffOptions,
  ThemeTypes,
} from '../types';
import { isImageFile } from '../utils/imageDetection';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { DiffsContainerLoaded } from './web-components';

export interface ImageDiffRenderProps {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  forceRender?: boolean;
}

export interface ImageDiffHydrationProps
  extends Omit<ImageDiffRenderProps, 'fileContainer'> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

let instanceId = -1;

export class ImageDiff {
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: number = ++instanceId;

  private fileContainer: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;
  private headerElement: HTMLElement | undefined;
  private contentElement: HTMLElement | undefined;

  private imageRenderer: ImageDiffRenderer;

  private oldFile: FileContents | undefined;
  private newFile: FileContents | undefined;
  private fileDiff: FileDiffMetadata | undefined;

  private swipePosition = 50;
  private isDragging = false;
  private swipeHandle: Element | undefined;

  constructor(
    public options: ImageDiffOptions = { theme: DEFAULT_THEMES },
    private isContainerManaged = false
  ) {
    this.imageRenderer = new ImageDiffRenderer(options);
  }

  static isImageDiff(fileDiff: FileDiffMetadata): boolean {
    const isExplicitImageContent = fileDiff.contentType === 'image';
    const hasImageUrl =
      fileDiff.oldImageUrl != null || fileDiff.newImageUrl != null;
    const isBinaryImageFile =
      fileDiff.isBinary === true && isImageFile(fileDiff.name);
    const hasTextHunks =
      (fileDiff.hunks?.length ?? 0) > 0 &&
      (fileDiff.splitLineCount > 0 || fileDiff.unifiedLineCount > 0);
    const isImageFileWithoutTextContent =
      !hasTextHunks && isImageFile(fileDiff.name);

    return (
      isExplicitImageContent ||
      hasImageUrl ||
      isBinaryImageFile ||
      isImageFileWithoutTextContent
    );
  }

  setOptions(options: ImageDiffOptions | undefined): void {
    if (options == null) return;
    this.options = options;
    this.imageRenderer.setOptions(options);
  }

  setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.options = { ...this.options, themeType };

    if (this.headerElement != null) {
      if (themeType === 'system') {
        delete this.headerElement.dataset.themeType;
      } else {
        this.headerElement.dataset.themeType = themeType;
      }
    }
  }

  cleanUp(): void {
    this.removeSwipeListeners();

    this.fileDiff = undefined;
    this.oldFile = undefined;
    this.newFile = undefined;

    if (!this.isContainerManaged) {
      this.fileContainer?.parentNode?.removeChild(this.fileContainer);
    }
    if (this.fileContainer?.shadowRoot != null) {
      this.fileContainer.shadowRoot.innerHTML = '';
    }
    this.fileContainer = undefined;
    this.headerElement = undefined;
    this.contentElement = undefined;
  }

  hydrate(props: ImageDiffHydrationProps): void {
    const { fileContainer, prerenderedHTML } = props;
    prerenderHTMLIfNecessary(fileContainer, prerenderedHTML);

    for (const element of Array.from(
      fileContainer.shadowRoot?.children ?? []
    )) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if ('diffsHeader' in element.dataset) {
        this.headerElement = element;
        continue;
      }
      if ('imageDiff' in element.dataset) {
        this.contentElement = element;
        continue;
      }
    }

    if (this.contentElement == null) {
      this.render(props);
    } else {
      const { oldFile, newFile, fileDiff } = props;
      this.fileContainer = fileContainer;
      this.oldFile = oldFile;
      this.newFile = newFile;
      this.fileDiff = fileDiff;
      this.setupSwipeInteraction();
    }
  }

  render({
    oldFile,
    newFile,
    fileDiff,
    forceRender = false,
    fileContainer,
    containerWrapper,
  }: ImageDiffRenderProps): void {
    const filesChanged =
      oldFile !== this.oldFile ||
      newFile !== this.newFile ||
      fileDiff !== this.fileDiff;

    if (!forceRender && !filesChanged) {
      return;
    }

    this.oldFile = oldFile;
    this.newFile = newFile;
    this.fileDiff = fileDiff;

    if (fileDiff == null) {
      return;
    }

    const { disableFileHeader = false } = this.options;

    if (disableFileHeader && this.headerElement != null) {
      this.headerElement.parentNode?.removeChild(this.headerElement);
      this.headerElement = undefined;
    }

    fileContainer = this.getOrCreateFileContainer(
      fileContainer,
      containerWrapper
    );

    const oldImageUrl = oldFile?.imageUrl ?? fileDiff.oldImageUrl;
    const newImageUrl = newFile?.imageUrl ?? fileDiff.newImageUrl;

    const result = this.imageRenderer.renderDiff(
      fileDiff,
      oldImageUrl,
      newImageUrl
    );

    if (result.headerAST != null) {
      this.applyHeaderToDOM(result, fileContainer);
    }

    this.applyContentToDOM(result, fileContainer);
  }

  rerender(): void {
    if (this.fileDiff == null) {
      return;
    }
    this.render({
      oldFile: this.oldFile,
      newFile: this.newFile,
      fileDiff: this.fileDiff,
      forceRender: true,
    });
  }

  private getOrCreateFileContainer(
    fileContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    this.fileContainer =
      fileContainer ??
      this.fileContainer ??
      document.createElement(DIFFS_TAG_NAME);

    if (parentNode != null && this.fileContainer.parentNode !== parentNode) {
      parentNode.appendChild(this.fileContainer);
    }

    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
        this.fileContainer.shadowRoot?.appendChild(this.spriteSVG);
      }
    }

    return this.fileContainer;
  }

  private applyHeaderToDOM(
    result: ImageRenderResult,
    container: HTMLElement
  ): void {
    if (result.headerAST == null) {
      return;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = toHtml(result.headerAST);
    const newHeader = tempDiv.firstElementChild;

    if (!(newHeader instanceof HTMLElement)) {
      return;
    }

    if (this.headerElement != null) {
      container.shadowRoot?.replaceChild(newHeader, this.headerElement);
    } else {
      container.shadowRoot?.prepend(newHeader);
    }

    this.headerElement = newHeader;
  }

  private applyContentToDOM(
    result: ImageRenderResult,
    container: HTMLElement
  ): void {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = toHtml(result.containerAST);
    const newContent = tempDiv.firstElementChild;

    if (!(newContent instanceof HTMLElement)) {
      return;
    }

    if (this.contentElement != null) {
      container.shadowRoot?.replaceChild(newContent, this.contentElement);
    } else {
      container.shadowRoot?.appendChild(newContent);
    }

    this.contentElement = newContent;
    this.setupSwipeInteraction();
  }

  private setupSwipeInteraction(): void {
    if (this.contentElement == null) {
      return;
    }

    const newHandle = this.contentElement.querySelector('[data-swipe-handle]');
    if (newHandle == null) {
      return;
    }

    this.removeSwipeListeners();

    this.swipeHandle = newHandle;
    this.swipeHandle.addEventListener('pointerdown', this.handleSwipeStart);
    document.addEventListener('pointermove', this.handleSwipeMove);
    document.addEventListener('pointerup', this.handleSwipeEnd);
    document.addEventListener('pointercancel', this.handleSwipeEnd);

    this.updateSwipePosition(this.swipePosition);
  }

  private removeSwipeListeners(): void {
    if (this.swipeHandle != null) {
      this.swipeHandle.removeEventListener(
        'pointerdown',
        this.handleSwipeStart
      );
      this.swipeHandle = undefined;
    }
    document.removeEventListener('pointermove', this.handleSwipeMove);
    document.removeEventListener('pointerup', this.handleSwipeEnd);
    document.removeEventListener('pointercancel', this.handleSwipeEnd);
  }

  private handleSwipeStart = (e: Event): void => {
    e.preventDefault();
    this.isDragging = true;
  };

  private handleSwipeMove = (e: Event): void => {
    if (!this.isDragging || this.contentElement == null) {
      return;
    }

    if (!(e instanceof PointerEvent)) {
      return;
    }

    const container = this.contentElement.querySelector(
      '[data-swipe-container]'
    );
    if (container == null) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));

    this.updateSwipePosition(percentage);
  };

  private handleSwipeEnd = (): void => {
    this.isDragging = false;
  };

  private updateSwipePosition(percentage: number): void {
    this.swipePosition = percentage;

    if (this.contentElement == null) {
      return;
    }

    const container = this.contentElement.querySelector<HTMLElement>(
      '[data-swipe-container]'
    );

    if (container == null) {
      return;
    }

    container.style.setProperty('--swipe-position', `${percentage}%`);
    container.style.setProperty('--swipe-clip-left', `${percentage}%`);
    container.style.setProperty('--swipe-clip-right', `${100 - percentage}%`);
  }

  getFileContainer(): HTMLElement | undefined {
    return this.fileContainer;
  }
}
